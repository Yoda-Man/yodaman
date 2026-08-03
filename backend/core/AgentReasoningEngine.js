const contextEngine = require('../infrastructure/ContextEngine');
const { stripCliNoise } = require('../infrastructure/CliOutput');
const impactAnalyzer = require('../infrastructure/ImpactAnalyzer');
const toolBox = require('../infrastructure/ToolBox');
const taskStore = require('../infrastructure/TaskStore');
const graphifyService = require('../infrastructure/GraphifyService');
const logger = require('../infrastructure/Logger');
const defaultCodingSkill = require('./DefaultCodingSkill');
const queueService = require('./QueueService');

// Tools whose success invalidates the retrieval index and the knowledge graph.
const MUTATING_TOOLS = new Set(['writeFile']);

function safeToolName(rawToolCall) {
    try {
        return JSON.parse(rawToolCall).name;
    } catch {
        return undefined;
    }
}

/**
 * AgentReasoningEngine (Core Layer)
 * 
 * Orchestrates the autonomous "thought" loop of the AI.
 * It manages context, parses tool calls, and interacts with the infrastructure layer
 * to execute actions and gather information.
 */
class AgentReasoningEngine {
    constructor() {
        /** @type {Map<string, Function>} Pending approval resolvers. */
        this.pendingApprovals = new Map();
        /** @type {Map<string, object>} Recent task state for external clients. */
        this.tasks = new Map(taskStore.list().map((task) => [task.taskId, task]));
        /** @type {Set<string>} Task IDs that should stop at the next safe point. */
        this.cancelledTasks = new Set();
        /** @type {number} Maximum number of tool iterations to prevent infinite loops. */
        this.maxIterations = 10;
    }

    /**
     * Dynamically builds the system prompt with current tools and plugins.
     */
    getSystemPrompt() {
        return `
You are Yoda-Agent, a powerful coding assistant integrated into the YodaMan platform.
You have access to the following tools to help the user with their coding tasks:

${toolBox.getToolDefinitions()}

${defaultCodingSkill}

### Process:
- Plan before you code. For any significant feature, use specPropose to create an OpenSpec change BEFORE implementing.
- Use tools to gather information or make changes.
- To call a tool, use the following format:
<tool_call>
{
  "name": "toolName",
  "parameters": { "param1": "value1" }
}
</tool_call>

- After a tool call, the user (system) will provide the result.
- Continue until the task is complete, then provide a final summary.
- Always be concise and precise.

### OpenSpec Workflow (Propose → Apply → Archive):
For any feature touching multiple files or introducing new patterns:
1. Call specPropose(project, changeName, description) to create the change proposal.
2. Implement the tasks defined in tasks.md.
3. Call specValidate(project, changeName) to verify completeness.
4. Call specArchive(project, changeName) to finalize the completed change.
For simple bug fixes or single-file edits, skip the workflow.

### Graph-Aware Responses:
When project graph context is provided (you will see "Graphify knowledge graph report" in your context), reference it in your answer:
- Cite specific files and their dependencies from the graph.
- Append a '[view graph](http://localhost:5190)' link when you use graph-derived information.
- If you identify similar patterns, suggest files to create based on existing module structure.
- Mention how many files will be affected by a proposed change.
`;
    }

    /**
     * Signals that an action has been approved or rejected.
     */
    signalApproval(taskId, approved) {
        const resolver = this.pendingApprovals.get(taskId);
        if (resolver) {
            const task = this.tasks.get(taskId);
            if (task) {
                task.status = approved ? 'running' : 'rejected';
                task.pendingApproval = null;
                task.updatedAt = new Date().toISOString();
            }
            resolver(approved);
            this.pendingApprovals.delete(taskId);
        }
    }

    /**
     * Requests cancellation for an active task.
     */
    cancelTask(taskId) {
        this.cancelledTasks.add(taskId);
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'cancelling';
            task.updatedAt = new Date().toISOString();
        }
        const resolver = this.pendingApprovals.get(taskId);
        if (resolver) {
            resolver(false);
            this.pendingApprovals.delete(taskId);
        }
    }

    isCancelled(taskId) {
        return this.cancelledTasks.has(taskId);
    }

    getTasks() {
        return Array.from(this.tasks.values()).sort((a, b) => {
            const left = a.updatedAt || a.createdAt || '';
            const right = b.updatedAt || b.createdAt || '';
            return right.localeCompare(left);
        });
    }

    getPendingApprovals() {
        return this.getTasks()
            .filter((task) => task.pendingApproval)
            .map((task) => ({
                taskId: task.taskId,
                task: task.task,
                projectId: task.projectId,
                createdAt: task.createdAt,
                updatedAt: task.updatedAt,
                approval: task.pendingApproval
            }));
    }

    getTaskEvents(taskId) {
        return (this.tasks.get(taskId) || {}).events || [];
    }

    recordTask(taskId, patch) {
        const current = this.tasks.get(taskId) || {};
        const nextTask = {
            ...current,
            ...patch,
            taskId,
            updatedAt: new Date().toISOString()
        };
        this.tasks.set(taskId, nextTask);

        if (this.tasks.size > 50) {
            const oldest = this.getTasks().at(-1);
            if (oldest) this.tasks.delete(oldest.taskId);
        }

        taskStore.upsert(taskId, nextTask);
    }

    recordTaskEvent(taskId, event) {
        const current = this.tasks.get(taskId) || { taskId, events: [] };
        const events = [...(current.events || []), {
            timestamp: new Date().toISOString(),
            ...event
        }].slice(-200);
        this.recordTask(taskId, { events });
    }

    async executeTask(task, taskId, onStep, metadata = {}) {
        const now = new Date().toISOString();
        this.recordTask(taskId, {
            task,
            projectId: metadata.projectId,
            status: 'running',
            createdAt: now,
            events: [],
            pendingApproval: null,
            finalAnswer: null,
            error: null
        });

        let graphContext = '';
        let graphAvailable = false;
        if (metadata.projectId) {
            const insights = await graphifyService.query(task, metadata.projectId);
            const report = graphifyService.readReport(metadata.projectId, { maxChars: 4000 });
            graphAvailable = !!(report || insights);
            graphContext = [
                '',
                '',
                'Graphify knowledge graph report:',
                report || '(No Graphify report generated yet.)',
                '',
                'Graphify query insights:',
                insights,
                '',
                '--- Graph-Aware Response Instructions ---',
                'You have access to project graph context above. When you reference files, modules, or dependencies from the graph,',
                'append a "[view graph](http://localhost:5190)" link to your answer so the user can explore the visual graph.',
                'Example: "Similar endpoints exist in `routes/user.js` and `routes/product.js` [view graph](http://localhost:5190)"',
                'If the graph has no data for this query, omit the link.',
                '-----------------------------------------'
            ].join('\n');
        }

        const uploadedFileContext = Array.isArray(metadata.uploadedFiles) && metadata.uploadedFiles.length
            ? [
                '',
                '',
                'Attached local files for this task:',
                ...metadata.uploadedFiles.map(file => `- ${file.filename} (${file.size} bytes): ${file.path}`)
            ].join('\n')
            : '';

        let conversation = `${this.getSystemPrompt()}${graphContext}${uploadedFileContext}\n\nUser Task: ${task}`;
        let iteration = 0;
        // Workspaces this task wrote to, refreshed once when the task ends.
        const touchedWorkspaces = new Set();
        let finalAnswer = '';

        console.log(`[Agent] 🧠 Starting reasoning loop for task: "${task.substring(0, 50)}..."`);

        while (iteration < this.maxIterations) {
            if (this.isCancelled(taskId)) {
                const event = { type: 'task_cancelled', taskId, message: 'Task cancelled.' };
                this.recordTaskEvent(taskId, event);
                if (onStep) onStep(event);
                this.recordTask(taskId, { status: 'cancelled' });
                this.cancelledTasks.delete(taskId);
                return null;
            }

            iteration++;
            console.log(`[Agent] Iteration ${iteration}/${this.maxIterations}`);
            
            const raw = await contextEngine.execute(['ask', '--', conversation]);
            const output = stripCliNoise(raw.output);

            if (this.isCancelled(taskId)) {
                const event = { type: 'task_cancelled', taskId, message: 'Task cancelled.' };
                this.recordTaskEvent(taskId, event);
                if (onStep) onStep(event);
                this.recordTask(taskId, { status: 'cancelled' });
                this.cancelledTasks.delete(taskId);
                return null;
            }
            
            const response = output.trim();
            conversation += `\n\nAssistant: ${response}`;

            const toolCallMatch = response.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
            
            if (toolCallMatch) {
                try {
                    const toolCall = JSON.parse(toolCallMatch[1]);
                    
                    // --- DIFF APPROVAL (The "Trust Gap") ---
                    if (toolCall.name === 'writeFile') {
                        const oldContent = await toolBox.getFileContent(toolCall.parameters.filePath);
                        const newContent = toolCall.parameters.content;

                        // A line diff says what changed; it never says what it costs.
                        // Attach the graph-derived blast radius so the reviewer is
                        // making a risk decision, not just reading a diff.
                        const impact = metadata.projectId
                            ? impactAnalyzer.analyzeFile(metadata.projectId, toolCall.parameters.filePath)
                            : { available: false, reason: 'no workspace selected' };

                        logger.info('approval_impact_assessed', {
                            taskId,
                            filePath: toolCall.parameters.filePath,
                            available: impact.available,
                            impactedCount: impact.impactedCount ?? null,
                            testCount: impact.testCount ?? null,
                            risk: impact.risk ?? null,
                            summary: impactAnalyzer.summarize(impact)
                        });

                        const pendingApproval = {
                            tool: 'writeFile',
                            params: {
                                filePath: toolCall.parameters.filePath,
                                oldContent,
                                newContent
                            },
                            impact
                        };

                        this.recordTask(taskId, {
                            status: 'awaiting_approval',
                            pendingApproval
                        });

                        const approvalEvent = {
                            type: 'awaiting_approval',
                            tool: 'writeFile',
                            taskId,
                            params: pendingApproval.params,
                            impact
                        };
                        this.recordTaskEvent(taskId, approvalEvent);
                        if (onStep) onStep(approvalEvent);

                        // Wait for approval signal
                        const approved = await new Promise((resolve) => {
                            this.pendingApprovals.set(taskId, resolve);
                        });

                        if (this.isCancelled(taskId)) {
                            const event = { type: 'task_cancelled', taskId, message: 'Task cancelled.' };
                            this.recordTaskEvent(taskId, event);
                            if (onStep) onStep(event);
                            this.recordTask(taskId, { status: 'cancelled', pendingApproval: null });
                            this.cancelledTasks.delete(taskId);
                            return null;
                        }

                        if (!approved) {
                            const result = { error: "User rejected this change." };
                            conversation += `\n\nSystem (Tool Result): ${JSON.stringify(result)}`;
                            const event = { type: 'tool_end', taskId, tool: toolCall.name, result };
                            this.recordTaskEvent(taskId, event);
                            if (onStep) onStep(event);
                            this.recordTask(taskId, { status: 'running', pendingApproval: null });
                            continue; 
                        }

                        this.recordTask(taskId, { status: 'running', pendingApproval: null });
                    }
                    // ---------------------------


                    const startEvent = { type: 'tool_start', taskId, tool: toolCall.name, params: toolCall.parameters };
                    this.recordTaskEvent(taskId, startEvent);
                    if (onStep) onStep(startEvent);

                    // Use the unified toolBox.callTool which handles built-ins and plugins
                    const result = await toolBox.callTool(toolCall.name, toolCall.parameters);

                    const resultStr = JSON.stringify(result, null, 2);
                    conversation += `\n\nSystem (Tool Result): ${resultStr}`;
                    
                    // An accepted write makes the ctx index and the graph stale the
                    // moment it lands. Mark the workspace dirty and refresh once
                    // when the task ends, rather than rebuilding per write.
                    if (MUTATING_TOOLS.has(toolCall.name) && !result?.error && metadata.projectId) {
                        touchedWorkspaces.add(metadata.projectId);
                    }

                    const endEvent = { type: 'tool_end', taskId, tool: toolCall.name, result };
                    this.recordTaskEvent(taskId, endEvent);
                    if (onStep) onStep(endEvent);
                } catch (err) {
                    logger.error('agent_tool_failed', err, {
                        taskId,
                        projectId: metadata.projectId,
                        tool: toolCallMatch ? safeToolName(toolCallMatch[1]) : undefined,
                        userAction: 'agent_tool_call',
                        severity: 'high'
                    });
                    conversation += `\n\nSystem (Error): ${err.message}`;
                    const event = { type: 'error', taskId, message: err.message };
                    this.recordTaskEvent(taskId, event);
                    if (onStep) onStep(event);
                    this.recordTask(taskId, { status: 'error', error: err.message });
                }
            } else {
                console.log('[Agent] ✅ Task completed.');
                finalAnswer = response;
                break;
            }
        }



        if (iteration >= this.maxIterations) {
            finalAnswer = "I reached the maximum number of steps without finishing. Please try breaking the task into smaller parts.";
            console.warn('[Agent] ⚠️ Max iterations reached.');
        }

        this.recordTask(taskId, { status: 'completed', finalAnswer });
        this.recordTaskEvent(taskId, { type: 'final_answer', taskId, answer: finalAnswer });
        this.cancelledTasks.delete(taskId);
        this.refreshTouchedWorkspaces(touchedWorkspaces, taskId);
        return finalAnswer;
    }

    /**
     * Re-sync the retrieval index and knowledge graph for workspaces this task
     * modified. Fire-and-forget: the answer is already on its way to the user,
     * and a failed refresh must never fail the task. Without this, every
     * accepted write silently degrades the next answer.
     */
    refreshTouchedWorkspaces(workspaces, taskId) {
        for (const projectPath of workspaces) {
            logger.info('post_write_refresh_started', { taskId, path: projectPath });

            try {
                queueService.addToQueue(projectPath);
            } catch (err) {
                logger.error('post_write_reindex_failed', err, { taskId, path: projectPath });
            }

            graphifyService.build(projectPath, { update: true })
                .then(() => logger.info('post_write_graph_updated', { taskId, path: projectPath }))
                .catch(err => logger.error('post_write_graph_failed', err, { taskId, path: projectPath }));
        }
    }

    clearTasks() {
        this.tasks.clear();
        this.cancelledTasks.clear();
        this.pendingApprovals.clear();
        taskStore.clear();
    }
}

module.exports = new AgentReasoningEngine();
