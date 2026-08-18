const contextEngine = require('../infrastructure/ContextEngine');
const { stripCliNoise, hasSubstantiveAnswer } = require('../infrastructure/CliOutput');
const impactAnalyzer = require('../infrastructure/ImpactAnalyzer');
const specDrift = require('../stardust/SpecDrift');
const toolBox = require('../infrastructure/ToolBox');
const taskStore = require('../infrastructure/TaskStore');
const graphifyService = require('../infrastructure/GraphifyService');
const logger = require('../infrastructure/Logger');
const defaultCodingSkill = require('./DefaultCodingSkill');
const queueService = require('./QueueService');
const ConversationBuffer = require('./ConversationBuffer');
const stardustBrief = require('./StardustBrief');
const dependencyChecker = require('../infrastructure/DependencyChecker');

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
- Read the Stardust Brief below the system prompt first — it contains the workspace's structural state,
  OpenSpec intent, and per-file risk analysis. Do not re-derive what it already tells you.
- Use tools to gather information or make changes. To call one:
<tool_call>
{
  "name": "toolName",
  "parameters": { "param1": "value1" }
}
</tool_call>
- After a tool call the system provides the result. Continue until the task is done, then give a final summary.
- Be concise and precise.

### The three tools that power every answer:
- Context Expert (semantic search + LLM reasoning): use searchCode(query, project) to find files by meaning.
- Graphify (knowledge graph): use impactOf(file, project) before editing to see blast radius and tests.
  The brief already covers focus files — call impactOf only for files it does not name.
- OpenSpec (architecture intent): use specDrift before building to avoid re-implementing documented work.
  Use specPropose → specValidate → specArchive for multi-file features.

### Before you edit:
- Call impactOf(file, project) on any file you intend to change that the brief does not already cover.
  It returns dependents, covering tests and the specs describing that file from an in-process graph read.
- If impactOf reports dependents and no covering tests, say so and add or extend a test before changing behaviour.
- Prefer applyPatch over writeFile for edits to existing files: a targeted replacement, not a whole-file rewrite.
- When you cite structure from the graph or the brief, append a '[view graph](http://localhost:5190)' link,
  and say how many files a proposed change would reach.

### Context discipline:
Earlier steps of a long task may appear collapsed under "Earlier steps in this task".
That is a real record of work already done — do not repeat those tool calls. If you need a
detail that was collapsed, call the tool again for that detail rather than re-running the
whole sequence.
`;
    }

    /**
     * Shorter prompt for models below 14B params.
     * Drops verbose sections, uses terse one-line-per-tool summary.
     */
    getCompactSystemPrompt() {
        return `
You are Yoda-Agent. Tools:

${toolBox.getBriefToolDefinitions()}

Rules:
- Read the Stardust Brief first — it has graph structure, specs, and per-file risks.
- Call: <tool_call>{"name":"tool","parameters":{}}</tool_call>
- Before editing: impactOf(file). No tests covering → say so.
- Multi-file features: specPropose → specValidate → specArchive.
- Check specDrift first to avoid re-implementing documented work.
- Be concise. One tool call per turn.
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

        // The workspace's own state, composed from all three tools and scoped to
        // the files this task names. Replaces the blind 4,000-character dump of
        // GRAPH_REPORT.md that used to be prepended to every task regardless of
        // whether the task was structural. Never fatal: a failed brief costs
        // context, not the task.
        let brief = '';
        if (metadata.projectId) {
            try {
                brief = (await stardustBrief.build(metadata.projectId, task)).text;
            } catch (err) {
                logger.warn('stardust_brief_failed', { taskId, path: metadata.projectId, reason: err.message });
            }
        }

        const uploadedFileContext = Array.isArray(metadata.uploadedFiles) && metadata.uploadedFiles.length
            ? [
                '',
                '',
                'Attached local files for this task:',
                ...metadata.uploadedFiles.map(file => `- ${file.filename} (${file.size} bytes): ${file.path}`)
            ].join('\n')
            : '';

        // Bounded transcript. ctx keeps no session, so every iteration re-sends
        // the conversation — which made a plain growing string quadratic in
        // tokens and eventually large enough to exceed ARG_MAX.
        // Models <14B get a shorter prompt + tighter budget automatically.
        let compact = false;
        try {
            compact = dependencyChecker.isWeakModel(await dependencyChecker.detectCtxModel());
        } catch (err) {
            // Never block a task on model detection — but say so, because a
            // silent failure here downgrades every prompt without explanation.
            logger.warn('agent_model_detect_failed', { taskId, reason: err?.message });
        }
        const conversation = new ConversationBuffer({
            system: (compact ? this.getCompactSystemPrompt() : this.getSystemPrompt()) + uploadedFileContext,
            brief,
            task,
        });

        let iteration = 0;
        // Workspaces this task wrote to, refreshed once when the task ends.
        const touchedWorkspaces = new Set();
        let finalAnswer = '';

        logger.info('agent_loop_started', { taskPreview: task.substring(0, 50) });

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
            logger.info('agent_iteration', { iteration, maxIterations: this.maxIterations });

            // Scoping to the workspace is what makes retrieval mean anything —
            // unscoped, ctx answers against every indexed project at once.
            const prompt = conversation.render();
            const stats = conversation.stats();
            logger.info('agent_prompt_built', {
                taskId,
                iteration,
                promptChars: stats.promptChars,
                budget: stats.budget,
                turns: stats.turns,
                digested: stats.digested,
            });

            // The fixed parts alone are over budget, so compaction cannot help.
            // Answer quality falls off measurably past the budget, so this is the
            // one prompt condition worth surfacing rather than absorbing.
            if (stats.overBudget) {
                logger.warn('agent_prompt_over_budget', {
                    taskId,
                    iteration,
                    promptChars: stats.promptChars,
                    budget: stats.budget,
                    hint: 'The system prompt and Stardust brief exceed the budget on their own. Reduce the number of loaded plugins, or raise YODAMAN_AGENT_PROMPT_CHARS if the model has a larger context window.',
                });
            }

            const raw = await contextEngine.ask(prompt, { project: metadata.projectId });
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
            conversation.addAssistant(response);

            // ctx can exit mid-generation and still have written part of an answer;
            // ContextEngine.ask salvages it rather than losing it. But a truncated
            // response must not be presented as a finished one — with ctx 1.4.0 this
            // happens precisely when the model starts emitting a tool call, so the
            // step that got cut off is usually the one that mattered.
            if (raw.partial) {
                logger.warn('agent_response_truncated', {
                    taskId,
                    iteration,
                    chars: response.length,
                    reason: raw.error,
                    hint: 'ctx exited non-zero while streaming the answer. Answer salvaged but incomplete.',
                });
                const event = { type: 'response_truncated', taskId, iteration, message: raw.error };
                this.recordTaskEvent(taskId, event);
                if (onStep) onStep(event);
            }

            // Generation produced nothing but the RAG citation block. Retrying is
            // worth a step: this is intermittent, and accepting it means the user's
            // answer is a list of filenames.
            if (!hasSubstantiveAnswer(response)) {
                logger.warn('agent_empty_answer', {
                    taskId,
                    iteration,
                    chars: response.length,
                    hint: 'ctx returned citations with no generated text. Retrying with an explicit instruction.',
                });
                conversation.addNote('Your previous response contained only citations and no answer. Reply with exactly ONE of: a direct answer in prose, or a single <tool_call>{"name":"readFile","parameters":{"filePath":"path/to/file"}}</tool_call> block.');
                if (iteration < this.maxIterations) continue;

                finalAnswer = 'Context Expert returned source citations but no generated answer, on every attempt. Check that the configured model is reachable (`yodaman doctor`) and that the prompt is within its context window. For reliable tool-calling, use a model with ≥14B parameters (e.g. qwen2.5:14b, codestral:22b, deepseek-coder-v2). Current model: see Health dashboard.';
                break;
            }

            const toolCallMatch = response.match(/<tool_call>([\s\S]*?)<\/tool_call>/);

            if (toolCallMatch) {
                try {
                    let rawJson = toolCallMatch[1].trim();
                    // JSON repair for 9B models: fix trailing commas, unquoted keys, missing braces
                    let toolCall;
                    try {
                        toolCall = JSON.parse(rawJson);
                    } catch (parseErr) {
                        const repaired = repairJSON(rawJson);
                        if (repaired) {
                            logger.info('agent_tool_call_repaired', { taskId, iteration, original: rawJson.slice(0, 80), repaired: repaired.slice(0, 80) });
                            toolCall = JSON.parse(repaired);
                        } else {
                            throw parseErr;
                        }
                    }
                    
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

                        // Goldust: add OpenSpec spec awareness to the impact.
                        // Which specs describe this file, and would the change cause drift?
                        let specImpact = { available: false, reason: 'no projectId' };
                        if (metadata.projectId) {
                            try {
                                const specs = specDrift.readSpecs(metadata.projectId);
                                const mentionedIn = [];
                                for (const spec of specs) {
                                    const refs = specDrift.extractReferences(spec.text);
                                    if (refs.some(r => toolCall.parameters.filePath.includes(r) || r.includes(toolCall.parameters.filePath))) {
                                        mentionedIn.push(spec.id);
                                    }
                                }
                                specImpact = { available: true, specCount: specs.length, mentionedIn };
                            } catch (_) { /* OpenSpec unavailable */ }
                        }

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
                            impact,
                            specImpact
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
                            impact,
                            specImpact
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
                            conversation.addToolResult(toolCall.name, result);
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

                    // Clipped on arrival: a large file read must not be re-sent in
                    // full on every remaining iteration.
                    conversation.addToolResult(toolCall.name, result);


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
                    conversation.addNote(`Error: ${err.message}`);
                    const event = { type: 'error', taskId, message: err.message };
                    this.recordTaskEvent(taskId, event);
                    if (onStep) onStep(event);
                    this.recordTask(taskId, { status: 'error', error: err.message });
                }
            } else {
                logger.info('agent_task_completed');
                // No tool call to act on. If the response was cut off, say so —
                // otherwise a half-finished thought reads as a considered answer.
                finalAnswer = raw.partial
                    ? `${response}\n\n---\n⚠️ This answer is incomplete: the Context Expert CLI exited while streaming it — ${raw.error || 'unknown reason'}. Ask again, or run the tool the answer was reaching for directly.`
                    : response;
                break;
            }
        }



        // Only when the loop genuinely ran out of steps. A branch that already
        // reached a conclusion — including a specific diagnosis of why it could not
        // answer — has said something more useful than "try smaller parts".
        if (iteration >= this.maxIterations && !finalAnswer) {
            finalAnswer = "I reached the maximum number of steps without finishing. Please try breaking the task into smaller parts.";
            logger.warn('agent_max_iterations_reached', { maxIterations: this.maxIterations });
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

/**
 * JSON repair for small models. Fixes common mistakes: trailing commas,
 * single quotes used as key/value delimiters, missing closing braces,
 * and unquoted keys. Returns the repaired string or null if unfixable.
 */
function repairJSON(raw) {
    let s = raw.trim();
    // Strip markdown backtick fences some models wrap JSON in
    if (s.startsWith('```') && s.endsWith('```')) {
        s = s.slice(3, -3).trim();
    }
    // Fix trailing comma before }
    s = s.replace(/,\s*}/g, '}');
    // Fix trailing comma before ]
    s = s.replace(/,\s*\]/g, ']');
    // Fix single-quoted keys and values (simple case)
    if (!s.includes('"') && s.includes("'")) {
        try {
            JSON.parse(s.replace(/'/g, '"'));
            s = s.replace(/'/g, '"');
        } catch (_) {
            // The quote swap did not produce valid JSON, so keep the original
            // and let the caller's final parse check reject it.
        }
    }
    // Add missing closing brace
    if (s.startsWith('{') && !s.endsWith('}')) {
        const openBraces = (s.match(/{/g) || []).length;
        const closeBraces = (s.match(/}/g) || []).length;
        s += '}'.repeat(openBraces - closeBraces);
    }
    // Verify the repair actually parses
    try { JSON.parse(s); return s; } catch (_) { return null; }
}

module.exports = new AgentReasoningEngine();
