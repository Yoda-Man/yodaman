jest.mock('../../backend/infrastructure/ContextEngine', () => ({
    execute: jest.fn()
}));

jest.mock('../../backend/infrastructure/ToolBox', () => ({
    getToolDefinitions: jest.fn(() => '1. readFile(filePath): Returns the content of a file.'),
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
        expect(contextEngine.execute).not.toHaveBeenCalled();
        expect(events).toEqual([
            { type: 'task_cancelled', taskId: 'task-1', message: 'Task cancelled.' }
        ]);
    });

    test('should include taskId in tool events', async () => {
        const events = [];
        contextEngine.execute
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
        contextEngine.execute
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
        contextEngine.execute
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
        contextEngine.execute
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
        contextEngine.execute.mockResolvedValue({
            output: '<tool_call>{"name":"readFile","parameters":{"filePath":"README.md"}}</tool_call>'
        });
        toolBox.callTool.mockResolvedValue({ content: '# YodaMan' });

        const result = await agentEngine.executeTask('Loop forever', 'task-6');

        expect(result).toBe('I reached the maximum number of steps without finishing. Please try breaking the task into smaller parts.');
        expect(contextEngine.execute).toHaveBeenCalledTimes(2);
        expect(toolBox.callTool).toHaveBeenCalledTimes(2);
    });
});
