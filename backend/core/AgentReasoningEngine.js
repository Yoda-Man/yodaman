const contextEngine = require('../infrastructure/ContextEngine');
const toolBox = require('../infrastructure/ToolBox');
const taskStore = require('../infrastructure/TaskStore');

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

### Process:
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

        let conversation = `${this.getSystemPrompt()}\n\nUser Task: ${task}`;
        let iteration = 0;
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
            
            const { output } = await contextEngine.execute(['ask', '--', conversation]);

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
                        const pendingApproval = {
                            tool: 'writeFile',
                            params: {
                                filePath: toolCall.parameters.filePath,
                                oldContent,
                                newContent
                            }
                        };

                        this.recordTask(taskId, {
                            status: 'awaiting_approval',
                            pendingApproval
                        });

                        const approvalEvent = { 
                            type: 'awaiting_approval', 
                            tool: 'writeFile', 
                            taskId,
                            params: pendingApproval.params
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
                    
                    const endEvent = { type: 'tool_end', taskId, tool: toolCall.name, result };
                    this.recordTaskEvent(taskId, endEvent);
                    if (onStep) onStep(endEvent);
                } catch (err) {
                    console.error(`[Agent] Tool Execution Error: ${err.message}`);
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
        return finalAnswer;
    }
}

module.exports = new AgentReasoningEngine();
