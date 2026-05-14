const contextEngine = require('../infrastructure/ContextEngine');
const toolBox = require('../infrastructure/ToolBox');

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
            resolver(approved);
            this.pendingApprovals.delete(taskId);
        }
    }

    async executeTask(task, taskId, onStep) {
        let conversation = `${this.getSystemPrompt()}\n\nUser Task: ${task}`;
        let iteration = 0;
        let finalAnswer = '';

        console.log(`[Agent] 🧠 Starting reasoning loop for task: "${task.substring(0, 50)}..."`);

        while (iteration < this.maxIterations) {
            iteration++;
            console.log(`[Agent] Iteration ${iteration}/${this.maxIterations}`);
            
            const { output } = await contextEngine.execute(['ask', '--', conversation]);
            
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

                        if (onStep) onStep({ 
                            type: 'awaiting_approval', 
                            tool: 'writeFile', 
                            taskId,
                            params: {
                                filePath: toolCall.parameters.filePath,
                                oldContent,
                                newContent
                            }
                        });

                        // Wait for approval signal
                        const approved = await new Promise((resolve) => {
                            this.pendingApprovals.set(taskId, resolve);
                        });

                        if (!approved) {
                            const result = { error: "User rejected this change." };
                            conversation += `\n\nSystem (Tool Result): ${JSON.stringify(result)}`;
                            if (onStep) onStep({ type: 'tool_end', tool: toolCall.name, result });
                            continue; 
                        }
                    }
                    // ---------------------------


                    if (onStep) onStep({ type: 'tool_start', tool: toolCall.name, params: toolCall.parameters });

                    // Use the unified toolBox.callTool which handles built-ins and plugins
                    const result = await toolBox.callTool(toolCall.name, toolCall.parameters);

                    const resultStr = JSON.stringify(result, null, 2);
                    conversation += `\n\nSystem (Tool Result): ${resultStr}`;
                    
                    if (onStep) onStep({ type: 'tool_end', tool: toolCall.name, result });
                } catch (err) {
                    console.error(`[Agent] Tool Execution Error: ${err.message}`);
                    conversation += `\n\nSystem (Error): ${err.message}`;
                    if (onStep) onStep({ type: 'error', message: err.message });
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

        return finalAnswer;
    }
}

module.exports = new AgentReasoningEngine();
