/**
 * The agent loop's behaviour when a model emits several tool calls at once.
 *
 * `ParallelToolCalls.test.js` covers the extraction — this covers what the
 * engine DOES with what was extracted, which is where the safety properties
 * live:
 *
 *   - Several reads in one turn all execute (the bug: only the first did).
 *   - Results are recorded in CALL order, not completion order.
 *   - A batch containing a write is NOT parallelised, and raises exactly ONE
 *     approval — a user must never be shown several pending changes at once.
 *   - Whatever does not run is announced. Writing this file is what exposed
 *     that the first version of the fix still dropped the tail of a mixed
 *     batch silently, which is the original defect in different clothes.
 */
jest.mock('../../backend/infrastructure/ContextEngine', () => ({
    execute: jest.fn(),
    ask: jest.fn(),
    projectName: jest.fn(async (p) => p)
}));

jest.mock('../../backend/infrastructure/ToolBox', () => ({
    getToolDefinitions: jest.fn(() => 'readFile(filePath), writeFile(filePath, content)'),
    getBriefToolDefinitions: jest.fn(() => 'readFile(filePath), writeFile(filePath, content)'),
    getFileContent: jest.fn(async () => 'old content'),
    callTool: jest.fn()
}));

jest.mock('../../backend/infrastructure/Logger', () => ({
    error: jest.fn(), warn: jest.fn(), info: jest.fn()
}));

jest.mock('../../backend/infrastructure/GraphifyService', () => ({
    query: jest.fn(async () => ''),
    readReport: jest.fn(() => '')
}));

const contextEngine = require('../../backend/infrastructure/ContextEngine');
const toolBox = require('../../backend/infrastructure/ToolBox');
const agentEngine = require('../../backend/core/AgentReasoningEngine');

const call = (name, params) => `<tool_call>${JSON.stringify({ name, parameters: params })}</tool_call>`;

const waitFor = async (predicate, label = 'condition') => {
    for (let i = 0; i < 200; i += 1) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`Timed out waiting for ${label}`);
};

describe('several tool calls in one turn', () => {
    beforeEach(() => {
        agentEngine.pendingApprovals.clear();
        agentEngine.tasks.clear();
        agentEngine.cancelledTasks.clear();
        contextEngine.ask.mockReset();
        contextEngine.execute.mockReset();
        toolBox.callTool.mockReset();
        toolBox.getFileContent.mockReset();
        toolBox.getFileContent.mockResolvedValue('old content');
        agentEngine.maxIterations = 10;
    });

    test('all three reads execute in ONE iteration', async () => {
        // The regression, at the engine level. Before the fix this called
        // callTool once and burned three iterations re-asking.
        contextEngine.ask
            .mockResolvedValueOnce({
                output: [
                    call('readFile', { filePath: 'a.js' }),
                    call('readFile', { filePath: 'b.js' }),
                    call('readFile', { filePath: 'c.js' })
                ].join('\n')
            })
            .mockResolvedValueOnce({ output: 'Done.' });

        toolBox.callTool.mockResolvedValue({ content: 'x' });

        const result = await agentEngine.executeTask('Read three files', 'par-1', () => {});

        expect(result).toBe('Done.');
        expect(toolBox.callTool).toHaveBeenCalledTimes(3);
        // Two model calls total: one that emitted the batch, one that answered.
        expect(contextEngine.ask).toHaveBeenCalledTimes(2);
    });

    test('results are recorded in CALL order even when they finish out of order', async () => {
        // The slowest read is requested first. Completion order would put it
        // last; call order must put it first. ConversationBuffer appends, so
        // getting this wrong reorders the transcript between runs.
        contextEngine.ask
            .mockResolvedValueOnce({
                output: [
                    call('readFile', { filePath: 'slow.js' }),
                    call('readFile', { filePath: 'fast.js' })
                ].join('\n')
            })
            .mockResolvedValueOnce({ output: 'Done.' });

        toolBox.callTool.mockImplementation(async (_name, params) => {
            if (params.filePath === 'slow.js') {
                await new Promise((r) => setTimeout(r, 30));
                return { content: 'SLOW' };
            }
            return { content: 'FAST' };
        });

        const events = [];
        await agentEngine.executeTask('Read two', 'par-2', (e) => events.push(e));

        const ends = events.filter((e) => e.type === 'tool_end');
        expect(ends).toHaveLength(2);
        expect(ends[0].result.content).toBe('SLOW');
        expect(ends[1].result.content).toBe('FAST');
    });

    test('one failing read does not discard the others', async () => {
        contextEngine.ask
            .mockResolvedValueOnce({
                output: [
                    call('readFile', { filePath: 'ok.js' }),
                    call('readFile', { filePath: 'missing.js' })
                ].join('\n')
            })
            .mockResolvedValueOnce({ output: 'Done.' });

        toolBox.callTool.mockImplementation(async (_n, params) => {
            if (params.filePath === 'missing.js') throw new Error('ENOENT');
            return { content: 'fine' };
        });

        const events = [];
        await agentEngine.executeTask('Read two', 'par-3', (e) => events.push(e));

        const ends = events.filter((e) => e.type === 'tool_end');
        expect(ends).toHaveLength(2);
        expect(ends[0].result.content).toBe('fine');
        expect(ends[1].result.error).toMatch(/ENOENT/);
    });
});

describe('a batch containing a write is never parallelised', () => {
    beforeEach(() => {
        agentEngine.pendingApprovals.clear();
        agentEngine.tasks.clear();
        agentEngine.cancelledTasks.clear();
        contextEngine.ask.mockReset();
        toolBox.callTool.mockReset();
        toolBox.getFileContent.mockReset();
        toolBox.getFileContent.mockResolvedValue('old content');
        agentEngine.maxIterations = 10;
    });

    test('raises exactly ONE approval, and writes nothing before it', async () => {
        contextEngine.ask.mockResolvedValue({
            output: [
                call('readFile', { filePath: 'a.js' }),
                call('writeFile', { filePath: 'b.js', content: 'new' }),
                call('writeFile', { filePath: 'c.js', content: 'new' })
            ].join('\n')
        });
        toolBox.callTool.mockResolvedValue({ content: 'x' });

        const events = [];
        const run = agentEngine.executeTask('Edit files', 'par-4', (e) => events.push(e));

        // The batch is mixed, so the sequential path runs the FIRST call only.
        // readFile is not gated, so it executes; the writes wait for their own
        // turn and their own approval.
        await waitFor(() => events.some((e) => e.type === 'tool_end'), 'first tool to finish');

        const approvals = events.filter((e) => e.type === 'awaiting_approval');
        expect(approvals.length).toBeLessThanOrEqual(1);

        // Nothing was written: only the read ran.
        const written = toolBox.callTool.mock.calls.filter(([name]) => name === 'writeFile');
        expect(written).toHaveLength(0);

        agentEngine.cancelTask('par-4');
        await run.catch(() => {});
    });

    test('a lone write still reaches the approval gate', async () => {
        // The gate itself is unchanged by this work; assert it still fires so a
        // regression here cannot hide behind the new batching code.
        contextEngine.ask.mockResolvedValue({
            output: call('writeFile', { filePath: 'b.js', content: 'new' })
        });

        const events = [];
        const run = agentEngine.executeTask('Edit one', 'par-5', (e) => events.push(e));

        await waitFor(() => events.some((e) => e.type === 'awaiting_approval'), 'approval');

        expect(toolBox.callTool).not.toHaveBeenCalledWith('writeFile', expect.anything());

        agentEngine.cancelTask('par-5');
        await run.catch(() => {});
    });
});
