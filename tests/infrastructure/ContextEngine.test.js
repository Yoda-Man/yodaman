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

    /** Spawn stub that emits stdout/stderr then closes with `code`. */
    function mockCtx({ stdout = '', stderr = '', code = 0 }) {
        const proc = {
            stdout: { on: jest.fn((event, cb) => { if (event === 'data' && stdout) cb(Buffer.from(stdout)); }) },
            stderr: { on: jest.fn((event, cb) => { if (event === 'data' && stderr) cb(Buffer.from(stderr)); }) },
            on: jest.fn((event, cb) => { if (event === 'close') cb(code); }),
            kill: jest.fn(),
        };
        spawn.mockReturnValue(proc);
        return proc;
    }

    describe('ask', () => {
        beforeEach(() => {
            // projectName caches a ctx list result; clear it so each test controls spawn.
            contextEngine._projectCache = { at: Date.now(), byPath: new Map() };
        });

        test('scopes to the ctx project NAME, not the workspace path', async () => {
            contextEngine._projectCache = {
                at: Date.now(),
                byPath: new Map([['/Users/me/Documents/DidiPlex', 'DidiPlex']]),
            };
            mockCtx({ stdout: 'answer' });

            await contextEngine.ask('question', { project: '/Users/me/Documents/DidiPlex' });

            const args = spawn.mock.calls.at(-1)[1];
            // `ctx -p <path>` answers "Project not found" and silently degrades the
            // caller to a substring grep, so the name matters.
            expect(args).toContain('-p');
            expect(args[args.indexOf('-p') + 1]).toBe('DidiPlex');
            expect(args).not.toContain('/Users/me/Documents/DidiPlex');
        });

        test('never borrows a same-named project for a workspace ctx has not indexed', async () => {
            // This test used to require the basename fallback, which is how a
            // registered Documents/yodaman was searched as ctx's other "yodaman"
            // project. Names are not unique; paths are.
            contextEngine._projectCache = {
                at: Date.now(),
                byPath: new Map([['/Users/me/Documents/old/yodaman', 'yodaman']]),
                listed: true,
            };
            mockCtx({ stdout: 'answer' });

            await contextEngine.ask('question', { project: '/Users/me/Documents/yodaman' });

            expect(spawn.mock.calls.at(-1)[1]).not.toContain('yodaman');
            expect(await contextEngine.projectName('/Users/me/Documents/yodaman')).toBeNull();
        });

        test('uses the basename only when ctx list could not be read', async () => {
            contextEngine._projectCache = { at: Date.now(), byPath: new Map(), listed: false };
            mockCtx({ stdout: 'answer' });

            await contextEngine.ask('question', { project: '/Users/me/Documents/Unindexed' });

            const args = spawn.mock.calls.at(-1)[1];
            expect(args[args.indexOf('-p') + 1]).toBe('Unindexed');
        });

        describe('indexNameFor', () => {
            // A second folder named like an indexed one failed every Sync with
            // "UNIQUE constraint failed: projects.name", so Context Expert could
            // never index it. Observed with Documents/yodaman.
            const listing = (projects) => { contextEngine.executeJson = jest.fn(async () => ({ projects })); };
            const original = contextEngine.executeJson;
            afterEach(() => { contextEngine.executeJson = original; });

            test('keeps the name a workspace is already indexed under', async () => {
                listing([{ name: 'yodaman-a1b2c3', path: '/Users/me/Documents/yodaman' }]);
                expect(await contextEngine.indexNameFor('/Users/me/Documents/yodaman')).toBe('yodaman-a1b2c3');
            });

            test('uses the folder name when it is free', async () => {
                listing([{ name: 'legacy', path: '/Users/me/Documents/legacy' }]);
                expect(await contextEngine.indexNameFor('/Users/me/Documents/coruscant')).toBe('coruscant');
            });

            test('never reuses a name another folder holds', async () => {
                listing([{ name: 'yodaman', path: '/Users/me/Documents/production/yodaman' }]);
                const name = await contextEngine.indexNameFor('/Users/me/Documents/yodaman');
                expect(name).toMatch(/^yodaman-[0-9a-f]{6}$/);
                // Stable: the same folder gets the same name every time.
                expect(await contextEngine.indexNameFor('/Users/me/Documents/yodaman')).toBe(name);
                // And a different folder gets a different one.
                expect(await contextEngine.indexNameFor('/Users/me/Work/yodaman')).not.toBe(name);
            });

            test('falls back to the folder name when ctx list cannot be read', async () => {
                contextEngine.executeJson = jest.fn(async () => { throw new Error('ctx missing'); });
                expect(await contextEngine.indexNameFor('/Users/me/Documents/yodaman')).toBe('yodaman');
            });
        });

        test('omits -p entirely when no workspace is given', async () => {
            mockCtx({ stdout: 'answer' });

            await contextEngine.ask('question');

            expect(spawn.mock.calls.at(-1)[1]).not.toContain('-p');
        });

        test('refuses a prompt too large for a single invocation', async () => {
            await expect(contextEngine.ask('x'.repeat(200_000))).rejects.toThrow(/over the .* limit/);
        });

        // ctx 1.4.0 can crash partway through streaming an answer and exit 1 — seen
        // when the model starts emitting a tool call. Discarding the bytes already
        // written turns a partial answer into a total failure.
        test('salvages a partial answer when ctx exits non-zero mid-stream', async () => {
            mockCtx({
                stdout: "I'll read that file for you.",
                stderr: 'Error: Failed to connect to Ollama server: Cannot read properties of undefined',
                code: 1,
            });

            const result = await contextEngine.ask('question');

            expect(result.output).toBe("I'll read that file for you.");
            expect(result.partial).toBe(true);
            expect(result.error).toMatch(/Failed to connect to Ollama server/);
        });

        test('still throws when the failure produced no output at all', async () => {
            mockCtx({ stdout: '', stderr: 'ctx: command not found', code: 127 });

            await expect(contextEngine.ask('question')).rejects.toThrow('ctx: command not found');
        });

        test('does not mark a clean answer as partial', async () => {
            mockCtx({ stdout: 'a complete answer', code: 0 });

            const result = await contextEngine.ask('question');
            expect(result.output).toBe('a complete answer');
            expect(result.partial).toBeUndefined();
        });
    });
});
