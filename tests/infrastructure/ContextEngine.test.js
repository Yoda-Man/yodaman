const contextEngine = require('../../backend/infrastructure/ContextEngine');
const { spawn } = require('child_process');

jest.mock('child_process');

describe('ContextEngine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('execute should return output on success', async () => {
        const mockProc = {
            stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('hello world')); }) },
            stderr: { on: jest.fn() },
            on: jest.fn((event, cb) => { if (event === 'close') cb(0); })
        };
        spawn.mockReturnValue(mockProc);

        const result = await contextEngine.execute(['test']);
        expect(result.output).toBe('hello world');
        expect(result.code).toBe(0);
    });

    test('executeJson should extract JSON from noisy output', async () => {
        const noisyOutput = `
        dotenvx: version 0.1.0
        Some random banner
        {
            "projects": [{"name": "test-project"}]
        }
        Footer message
        `;
        const mockProc = {
            stdout: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from(noisyOutput)); }) },
            stderr: { on: jest.fn() },
            on: jest.fn((event, cb) => { if (event === 'close') cb(0); })
        };
        spawn.mockReturnValue(mockProc);

        const result = await contextEngine.executeJson(['list']);
        expect(result.projects[0].name).toBe('test-project');
    });

    test('execute should throw error on non-zero exit code', async () => {
        const mockProc = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn((event, cb) => { if (event === 'data') cb(Buffer.from('execution failed')); }) },
            on: jest.fn((event, cb) => { if (event === 'close') cb(1); })
        };
        spawn.mockReturnValue(mockProc);

        await expect(contextEngine.execute(['bad-command'])).rejects.toThrow('execution failed');
    });

    test('execute should kill hung ctx processes after timeout', async () => {
        jest.useFakeTimers();
        const handlers = {};
        const mockProc = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn((event, cb) => { handlers[event] = cb; }),
            kill: jest.fn()
        };
        spawn.mockReturnValue(mockProc);

        const promise = contextEngine.execute(['ask', '--', 'menu'], { timeoutMs: 25 });
        jest.advanceTimersByTime(25);

        await expect(promise).rejects.toThrow('ctx command timed out after 25ms');
        expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
        jest.useRealTimers();
    });
});
