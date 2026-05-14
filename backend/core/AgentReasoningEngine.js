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
        /** @type {number} Maximum number of tool iterations to prevent infinite loops. */
        this.maxIterations = 10;
        
        /** @type {string} The core system prompt defining tools and expected behavior. */
        this.systemPrompt = `
You are Yoda-Agent, a powerful coding assistant integrated into the YodaMan platform.
You have access to the following tools to help the user with their coding tasks:

1. readFile(filePath): Returns the content of a file.
2. writeFile(filePath, content): Writes content to a file.
3. executeCommand(command, cwd): Runs a shell command and returns output.
4. searchCode(query): Searches the codebase for relevant snippets.
5. listFiles(directoryPath): Lists files in a directory.

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
     * Executes a complex coding task using a multi-step reasoning loop.
     * @param {string} task - The user's request.
     * @param {Function} onStep - Callback for real-time progress updates.
     * @returns {Promise<string>} The final response from the agent.
     */
    async executeTask(task, onStep) {
        let conversation = `${this.systemPrompt}\n\nUser Task: ${task}`;
        let iteration = 0;
        let finalAnswer = '';

        console.log(`[Agent] 🧠 Starting reasoning loop for task: "${task.substring(0, 50)}..."`);

        while (iteration < this.maxIterations) {
            iteration++;
            console.log(`[Agent] Iteration ${iteration}/${this.maxIterations}`);
            
            // Call the ContextEngine (using 'ask' as the reasoning interface)
            const { output } = await contextEngine.execute(['ask', '--', conversation]);
            
            const response = output.trim();
            conversation += `\n\nAssistant: ${response}`;

            // Parse for tool calls using XML-like tags
            const toolCallMatch = response.match(/<tool_call>([\s\S]*?)<\/tool_call>/);
            
            if (toolCallMatch) {
                try {
                    const toolCall = JSON.parse(toolCallMatch[1]);
                    console.log(`[Agent] 🛠 Invoking tool: ${toolCall.name}`);
                    
                    if (onStep) onStep({ type: 'tool_start', tool: toolCall.name, params: toolCall.parameters });

                    let result;
                    switch (toolCall.name) {
                        case 'readFile':
                            result = await toolBox.readFile(toolCall.parameters);
                            break;
                        case 'writeFile':
                            result = await toolBox.writeFile(toolCall.parameters);
                            break;
                        case 'executeCommand':
                            result = await toolBox.executeCommand(toolCall.parameters);
                            break;
                        case 'searchCode':
                            result = await toolBox.searchCode(toolCall.parameters);
                            break;
                        case 'listFiles':
                            result = await toolBox.listFiles(toolCall.parameters);
                            break;
                        default:
                            result = { error: `Unknown tool: ${toolCall.name}` };
                    }

                    const resultStr = JSON.stringify(result, null, 2);
                    conversation += `\n\nSystem (Tool Result): ${resultStr}`;
                    
                    if (onStep) onStep({ type: 'tool_end', tool: toolCall.name, result });
                } catch (err) {
                    console.error(`[Agent] Tool Execution Error: ${err.message}`);
                    conversation += `\n\nSystem (Error): ${err.message}`;
                    if (onStep) onStep({ type: 'error', message: err.message });
                }
            } else {
                // No more tool calls means the agent has reached a conclusion
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
