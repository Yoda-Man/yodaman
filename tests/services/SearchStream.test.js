/**
 * GET /api/search/stream: the Search view's results first, then the local
 * model's summary of those same results.
 */
jest.mock('../../backend/infrastructure/Logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock('../../backend/core/SearchPipeline', () => ({ search: jest.fn(), resolveProject: jest.fn((p) => p), MODES: new Set(['unified']) }));
jest.mock('../../backend/core/SearchSummary', () => ({ summarize: jest.fn(), localModel: jest.fn(async () => 'qwen3.5:9b') }));

const pipeline = require('../../backend/core/SearchPipeline');
const searchSummary = require('../../backend/core/SearchSummary');
const router = require('../../backend/services/searchRouter');

const handler = router.stack.find((layer) => layer.route?.path === '/stream').route.stack[0].handle;

async function stream(query) {
    const events = [];
    const listeners = {};
    const res = {
        headers: {},
        setHeader(name, value) { this.headers[name] = value; },
        write(chunk) {
            const [, event, data] = /^event: (\w+)\ndata: (.*)\n\n$/.exec(chunk);
            events.push([event, JSON.parse(data)]);
        },
        end: jest.fn(),
        on(type, fn) { listeners[type] = fn; },
        status: jest.fn(function status() { return this; }),
        send: jest.fn()
    };
    const done = handler({ query, id: 'r1' }, res);
    return { events, res, listeners, done };
}

const RESULTS = { results: [{ filePath: 'a.js', content: 'x' }], graphRanked: true, pillars: { contextExpert: true, graphify: true, openspec: false } };

beforeEach(() => jest.clearAllMocks());

test('results go out before the model starts, then the summary, then done', async () => {
    pipeline.search.mockResolvedValue(RESULTS);
    searchSummary.summarize.mockImplementation(async function* fake() { yield 'Ranked in '; yield 'the pipeline [1].'; });
    const { events, res, done } = await stream({ query: 'ranking', project: '/w' });
    await done;

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(events.map(([name]) => name)).toEqual(['results', 'summary_start', 'summary', 'summary', 'done']);
    expect(events[0][1]).toEqual(RESULTS);
    expect(events[1][1]).toEqual({ model: 'qwen3.5:9b' });
    // The summary reads the very results that were sent, through the pipeline.
    expect(pipeline.search).toHaveBeenCalledWith(expect.objectContaining({ query: 'ranking', project: '/w', mode: 'unified' }));
    expect(searchSummary.summarize).toHaveBeenCalledWith(expect.objectContaining({ query: 'ranking', results: RESULTS.results }));
    expect(res.end).toHaveBeenCalled();
});

test('a failed summary leaves the results standing and says why', async () => {
    pipeline.search.mockResolvedValue(RESULTS);
    searchSummary.summarize.mockImplementation(async function* fake() { yield* []; throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); });
    const { events, done } = await stream({ query: 'q' });
    await done;
    expect(events.map(([name]) => name)).toEqual(['results', 'summary_start', 'summary_error', 'done']);
    expect(events[2][1].error).toMatch(/ECONNREFUSED/);
});

test('no results, no model call', async () => {
    pipeline.search.mockResolvedValue({ ...RESULTS, results: [] });
    const { events, done } = await stream({ query: 'q' });
    await done;
    expect(events.map(([name]) => name)).toEqual(['results', 'done']);
    expect(searchSummary.summarize).not.toHaveBeenCalled();
});

test('a failed search is reported as such, with no summary', async () => {
    pipeline.search.mockRejectedValue(Object.assign(new Error('Workspace folder not found'), { code: 'workspace_missing' }));
    const { events, done } = await stream({ query: 'q', project: '/gone' });
    await done;
    expect(events).toEqual([['search_error', { error: 'Workspace folder not found', code: 'workspace_missing', requestId: 'r1' }]]);
});

test('leaving mid-summary stops the model and sends nothing more about it', async () => {
    pipeline.search.mockResolvedValue(RESULTS);
    let signal;
    let leave;
    searchSummary.summarize.mockImplementation(async function* fake(input) {
        signal = input.signal;
        yield 'First words';
        leave();
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    const { events, listeners, done } = await stream({ query: 'q' });
    leave = () => listeners.close();
    await done;
    expect(signal.aborted).toBe(true);
    expect(events.map(([name]) => name)).toEqual(['results', 'summary_start', 'summary', 'done']);
});

test('a query is required', async () => {
    const { res, events, done } = await stream({});
    await done;
    expect(res.status).toHaveBeenCalledWith(400);
    expect(events).toEqual([]);
});
