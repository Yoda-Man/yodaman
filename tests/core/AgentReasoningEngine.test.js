jest.mock('../../backend/infrastructure/ContextEngine', () => ({
    execute: jest.fn(),
    ask: jest.fn(),
    projectName: jest.fn(async (p) => p)
}));

jest.mock('../../backend/infrastructure/ToolBox', () => ({
    getToolDefinitions: jest.fn(() => '1. readFile(filePath: string (path)): Returns the content of a file.'),
    getFileContent: jest.fn(),
    callTool: jest.fn()
}));

jest.mock('../../backend/infrastructure/Logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

jest.mock('../../backend/infrastructure/GraphifyService', () => ({
    query: jest.fn(async () => ''),
    readReport: jest.fn(() => '')
}));

const contextEngine = require('../../backend/infrastructure/ContextEngine');
const toolBox = require('../../backend/infrastructure/ToolBox');
const logger = require('../../backend/infrastructure/Logger');
const agentEngine = require('../../backend/core/AgentReasoningEngine');

const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 20; attempt++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('Timed out waiting for condition');
};

describe('AgentReasoningEngine', () => {
    beforeEach(() => {
        agentEngine.pendingApprovals.clear();
        agentEngine.tasks.clear();
        agentEngine.cancelledTasks.clear();
        contextEngine.execute.mockReset();
        contextEngine.ask.mockReset();
        toolBox.getFileContent.mockReset();
        toolBox.callTool.mockReset();
        logger.error.mockReset();
        agentEngine.maxIterations = 10;
    });

    test('should cancel before starting a reasoning iteration', async () => {
        const events = [];

        agentEngine.cancelTask('task-1');
        const result = await agentEngine.executeTask('Do something', 'task-1', (event) => {
            events.push(event);
        });

        expect(result).toBeNull();
        expect(contextEngine.ask).not.toHaveBeenCalled();
        expect(events).toEqual([
            { type: 'task_cancelled', taskId: 'task-1', message: 'Task cancelled.' }
        ]);
    });

    test('should include taskId in tool events', async () => {
        const events = [];
        contextEngine.ask
            .mockResolvedValueOnce({
                output: '<tool_call>{"name":"readFile","parameters":{"filePath":"README.md"}}</tool_call>'
            })
            .mockResolvedValueOnce({
                output: 'Finished.'
            });

        toolBox.callTool.mockResolvedValueOnce({ content: '# YodaMan' });

        const result = await agentEngine.executeTask('Read README', 'task-2', (event) => {
            events.push(event);
        });

        expect(result).toBe('Finished.');
        expect(events).toEqual([
            {
                type: 'tool_start',
                taskId: 'task-2',
                tool: 'readFile',
                params: { filePath: 'README.md' }
            },
            {
                type: 'tool_end',
                taskId: 'task-2',
                tool: 'readFile',
                result: { content: '# YodaMan' }
            }
        ]);
    });

    test('should expose pending approvals from task state', () => {
        agentEngine.recordTask('task-3', {
            task: 'Edit a file',
            projectId: '/project',
            status: 'awaiting_approval',
            createdAt: '2026-05-16T00:00:00.000Z',
            pendingApproval: {
                tool: 'writeFile',
                params: {
                    filePath: '/project/file.js',
                    oldContent: '',
                    newContent: 'console.log("hi");'
                }
            }
        });

        expect(agentEngine.getPendingApprovals()).toEqual([
            {
                taskId: 'task-3',
                task: 'Edit a file',
                projectId: '/project',
                createdAt: '2026-05-16T00:00:00.000Z',
                updatedAt: expect.any(String),
                approval: {
                    tool: 'writeFile',
                    params: {
                        filePath: '/project/file.js',
                        oldContent: '',
                        newContent: 'console.log("hi");'
                    }
                }
            }
        ]);
    });

    test('should continue when a write approval is rejected', async () => {
        const events = [];
        toolBox.getFileContent.mockResolvedValueOnce('old');
        contextEngine.ask
            .mockResolvedValueOnce({
                output: '<tool_call>{"name":"writeFile","parameters":{"filePath":"README.md","content":"new"}}</tool_call>'
            })
            .mockResolvedValueOnce({
                output: 'No change made.'
            });

        const taskPromise = agentEngine.executeTask('Update README', 'task-4', (event) => {
            events.push(event);
        });

        await waitFor(() => agentEngine.pendingApprovals.has('task-4'));
        agentEngine.signalApproval('task-4', false);
        const result = await taskPromise;

        expect(result).toBe('No change made.');
        expect(toolBox.callTool).not.toHaveBeenCalled();
        expect(events.map((event) => event.type)).toEqual([
            'awaiting_approval',
            'tool_end'
        ]);
        expect(agentEngine.tasks.get('task-4')).toMatchObject({
            status: 'completed',
            pendingApproval: null,
            finalAnswer: 'No change made.'
        });
    });

    test('should report malformed tool calls as task errors', async () => {
        const events = [];
        contextEngine.ask
            .mockResolvedValueOnce({
                output: '<tool_call>{"name":"readFile","parameters":</tool_call>'
            })
            .mockResolvedValueOnce({
                output: 'Recovered after error.'
            });

        const result = await agentEngine.executeTask('Bad tool call', 'task-5', (event) => {
            events.push(event);
        });

        expect(result).toBe('Recovered after error.');
        expect(events[0]).toMatchObject({
            type: 'error',
            taskId: 'task-5'
        });
        expect(agentEngine.tasks.get('task-5').error).toMatch(/Unexpected end of JSON input/);
    });

    test('should write agent tool failures to live logs with task context', async () => {
        const failure = new Error('Agent shell commands are disabled');
        contextEngine.ask
            .mockResolvedValueOnce({
                output: '<tool_call>{"name":"executeCommand","parameters":{"command":"npm test","cwd":"/tmp/project"}}</tool_call>'
            })
            .mockResolvedValueOnce({
                output: 'I could not run the command.'
            });
        toolBox.callTool.mockRejectedValueOnce(failure);

        const result = await agentEngine.executeTask('run tests', 'task-log-1', undefined, {
            projectId: '/tmp/project'
        });

        expect(result).toBe('I could not run the command.');
        expect(logger.error).toHaveBeenCalledWith('agent_tool_failed', failure, expect.objectContaining({
            taskId: 'task-log-1',
            projectId: '/tmp/project',
            tool: 'executeCommand',
            userAction: 'agent_tool_call'
        }));
    });

    test('should stop after maxIterations without a final answer', async () => {
        agentEngine.maxIterations = 2;
        contextEngine.ask.mockResolvedValue({
            output: '<tool_call>{"name":"readFile","parameters":{"filePath":"README.md"}}</tool_call>'
        });
        toolBox.callTool.mockResolvedValue({ content: '# YodaMan' });

        const result = await agentEngine.executeTask('Loop forever', 'task-6');

        expect(result).toBe('I reached the maximum number of steps without finishing. Please try breaking the task into smaller parts.');
        expect(contextEngine.ask).toHaveBeenCalledTimes(2);
        expect(toolBox.callTool).toHaveBeenCalledTimes(2);
    });

    // ── Prompt economics ──
    //
    // ctx keeps no session, so every iteration re-sends the conversation. The old
    // loop appended to a plain string, which made iteration N pay for iterations
    // 1..N-1 and could eventually exceed ARG_MAX. These tests hold that line.

    test('scopes retrieval to the workspace instead of every indexed project', async () => {
        contextEngine.ask.mockResolvedValueOnce({ output: 'Done.' });

        await agentEngine.executeTask('What does this do?', 'task-scope', undefined, {
            projectId: '/tmp/project'
        });

        expect(contextEngine.ask).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ project: '/tmp/project' })
        );
    });

    test('clips a large tool result instead of re-sending it whole every iteration', async () => {
        agentEngine.maxIterations = 4;
        const huge = 'x'.repeat(200_000);
        contextEngine.ask.mockResolvedValue({
            output: '<tool_call>{"name":"readFile","parameters":{"filePath":"big.js"}}</tool_call>'
        });
        toolBox.callTool.mockResolvedValue({ content: huge });

        await agentEngine.executeTask('Read the big file', 'task-big');

        const prompts = contextEngine.ask.mock.calls.map(([prompt]) => prompt);
        expect(prompts.length).toBe(4);
        for (const prompt of prompts) {
            // Four unbounded 200KB results would be 800KB — past ARG_MAX, where the
            // spawn stops failing gracefully and starts failing with E2BIG.
            expect(prompt.length).toBeLessThan(60_000);
            expect(prompt).not.toContain(huge);
        }
    });

    // ctx 1.4.0 can exit non-zero partway through streaming an answer — reliably so
    // when the model begins emitting a tool call. ContextEngine.ask salvages the
    // bytes already written; the loop must not pass that off as a finished answer.
    test('marks a truncated answer as incomplete rather than presenting it as final', async () => {
        contextEngine.ask.mockResolvedValueOnce({
            output: "I'll analyze server/networking.py using the impactOf tool",
            partial: true,
            error: 'Error: Failed to connect to Ollama server: Cannot read properties of undefined',
        });

        const events = [];
        const result = await agentEngine.executeTask('Check that file', 'task-partial', (event) => {
            events.push(event);
        });

        expect(result).toContain('impactOf tool');
        expect(result).toContain('This answer is incomplete');
        expect(events.some(event => event.type === 'response_truncated')).toBe(true);
    });

    // `ctx ask` prints its RAG citation block whether or not the model generated
    // anything. A bare citation list is a non-empty string, so it used to be
    // accepted as the final answer and the user's reply was a list of filenames.
    test('retries when the model returns citations but no answer', async () => {
        contextEngine.ask
            .mockResolvedValueOnce({ output: 'Sources:\n[1] client/game_client.py (1.00)\n[2] README.md (0.88)' })
            .mockResolvedValueOnce({ output: 'server/networking.py has 2 dependents and no tests.' });

        const result = await agentEngine.executeTask('Is it safe to change?', 'task-empty');

        expect(contextEngine.ask).toHaveBeenCalledTimes(2);
        expect(result).toBe('server/networking.py has 2 dependents and no tests.');
        // The retry has to tell the model what went wrong, or it repeats itself.
        expect(contextEngine.ask.mock.calls[1][0]).toContain('only citations and no answer');
    });

    test('reports plainly when every attempt returns citations only', async () => {
        agentEngine.maxIterations = 2;
        contextEngine.ask.mockResolvedValue({ output: 'Sources:\n[1] README.md (1.00)' });

        const result = await agentEngine.executeTask('Anything', 'task-always-empty');

        expect(result).toMatch(/no generated answer/);
        expect(result).not.toMatch(/^Sources:/);
    });

    test('an answer that merely mentions its sources is not treated as empty', async () => {
        contextEngine.ask.mockResolvedValueOnce({
            output: 'It is risky.\n\nSources:\n[1] server/networking.py (1.00)'
        });

        const result = await agentEngine.executeTask('Is it risky?', 'task-cited');

        expect(contextEngine.ask).toHaveBeenCalledTimes(1);
        expect(result).toContain('It is risky.');
    });

    test('does not add an incomplete warning to a clean answer', async () => {
        contextEngine.ask.mockResolvedValueOnce({ output: 'A complete answer.' });

        const result = await agentEngine.executeTask('Ask something', 'task-clean');

        expect(result).toBe('A complete answer.');
        expect(result).not.toContain('incomplete');
    });

    test('prompt size plateaus instead of growing with every iteration', async () => {
        agentEngine.maxIterations = 10;
        contextEngine.ask.mockResolvedValue({
            output: '<tool_call>{"name":"readFile","parameters":{"filePath":"a.js"}}</tool_call>'
        });
        toolBox.callTool.mockResolvedValue({ content: 'z'.repeat(8000) });

        await agentEngine.executeTask('Read repeatedly', 'task-plateau');

        const sizes = contextEngine.ask.mock.calls.map(([prompt]) => prompt.length);
        // Once the history budget is reached, compaction holds the prompt steady:
        // the last iterations must cost about the same as each other, not N times
        // the first. Unbounded concatenation would make these strictly increasing.
        const tail = sizes.slice(-4);
        const spread = Math.max(...tail) - Math.min(...tail);
        expect(spread).toBeLessThan(6000);
        expect(Math.max(...sizes)).toBeLessThan(45_000);
    });

    test('collapses older steps rather than dropping them silently', async () => {
        agentEngine.maxIterations = 8;
        contextEngine.ask.mockResolvedValue({
            output: '<tool_call>{"name":"readFile","parameters":{"filePath":"a.js"}}</tool_call>'
        });
        toolBox.callTool.mockResolvedValue({ content: 'y'.repeat(9000) });

        await agentEngine.executeTask('Keep reading', 'task-collapse');

        const last = contextEngine.ask.mock.calls.at(-1)[0];
        expect(last).toContain('Earlier steps in this task');
        // The digest keeps the fact that the tool ran, so the model does not repeat it.
        expect(last).toMatch(/readFile → ok/);
        // And the original task survives every round of compaction.
        expect(last).toContain('User Task: Keep reading');
    });
});
