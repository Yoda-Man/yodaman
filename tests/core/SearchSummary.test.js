/**
 * The AI summary is built from the pipeline's results only, and streams the
 * local model's answer as it is written.
 */
jest.mock('../../backend/infrastructure/ContextEngine', () => ({ executeJson: jest.fn() }));

const contextEngine = require('../../backend/infrastructure/ContextEngine');

function fresh() {
    jest.resetModules();
    jest.doMock('../../backend/infrastructure/ContextEngine', () => contextEngine);
    return require('../../backend/core/SearchSummary');
}

const HITS = [
    { filePath: 'backend/core/SearchPipeline.js', lineStart: 195, content: 'async function search({ query, project })', specFlag: { covered: true, specs: ['search-pipeline'] } },
    { metadata: { path: 'shared/searchHits.js', line: 15 }, text: 'function hitPath(hit)', specFlag: { covered: false } }
];

/** A fetch whose body arrives in the given network chunks. */
function ollama(chunks, { ok = true, status = 200 } = {}) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        return {
            ok,
            status,
            text: async () => chunks.join(''),
            body: (async function* body() { for (const c of chunks) yield new TextEncoder().encode(c); })()
        };
    };
    return { fetchImpl, calls };
}

async function collect(iterator) {
    const out = [];
    for await (const piece of iterator) out.push(piece);
    return out;
}

beforeEach(() => {
    contextEngine.executeJson.mockReset();
    contextEngine.executeJson.mockResolvedValue({ llm: { provider: 'ollama', model: 'qwen3.5:9b' } });
});

describe('the prompt', () => {
    const { buildPrompt, MAX_HITS } = fresh();

    test('numbers each hit with where it is, what it says, and its spec coverage', () => {
        const prompt = buildPrompt('where is search ranked?', HITS);
        expect(prompt).toContain('Question: where is search ranked?');
        expect(prompt).toContain('[1] backend/core/SearchPipeline.js:195 (described in specs: search-pipeline)\nasync function search');
        expect(prompt).toContain('[2] shared/searchHits.js:15\nfunction hitPath(hit)');
    });

    test('is bounded: at most MAX_HITS hits and a trimmed snippet each', () => {
        const many = Array.from({ length: 20 }, (_, i) => ({ filePath: `f${i}.js`, content: 'x'.repeat(5000) }));
        const prompt = buildPrompt('q', many);
        expect(prompt).toContain(`[${MAX_HITS}] `);
        expect(prompt).not.toContain(`[${MAX_HITS + 1}] `);
        expect(prompt.length).toBeLessThan(MAX_HITS * 800);
    });
});

describe('streaming the answer', () => {
    test('yields text as Ollama writes it, even when a line is split across chunks', async () => {
        const { summarize } = fresh();
        const { fetchImpl, calls } = ollama([
            '{"message":{"content":"Search is ranked "}}\n{"message":{"con',
            'tent":"in the pipeline [1]."}}\n',
            '{"done":true}\n'
        ]);
        expect(await collect(summarize({ query: 'q', results: HITS, fetchImpl }))).toEqual(['Search is ranked ', 'in the pipeline [1].']);

        // The model Context Expert uses, the pipeline's hits, and no thinking preamble.
        const { url, body } = calls[0];
        expect(url).toBe('http://127.0.0.1:11434/api/chat');
        expect(body).toMatchObject({ model: 'qwen3.5:9b', stream: true, think: false });
        expect(body.messages[1].content).toContain('[1] backend/core/SearchPipeline.js:195');
        expect(body.messages[0].content).toMatch(/only the numbered search results/);
    });

    test('a model error mid-stream is raised, not swallowed', async () => {
        const { summarize } = fresh();
        const { fetchImpl } = ollama(['{"message":{"content":"Part"}}\n{"error":"model unloaded"}\n']);
        await expect(collect(summarize({ query: 'q', results: HITS, fetchImpl }))).rejects.toThrow('model unloaded');
    });

    test('an HTTP failure names the model and the status', async () => {
        const { summarize } = fresh();
        const { fetchImpl } = ollama(['model "qwen3.5:9b" not found'], { ok: false, status: 404 });
        await expect(collect(summarize({ query: 'q', results: HITS, fetchImpl }))).rejects.toThrow(/qwen3\.5:9b answered 404: model "qwen3\.5:9b" not found/);
    });

    test('says plainly when Context Expert has no local Ollama model, and asks again next time', async () => {
        const { localModel } = fresh();
        contextEngine.executeJson.mockResolvedValueOnce({ llm: { provider: 'openai', model: 'gpt' } });
        await expect(localModel()).rejects.toThrow(/not set up with a local Ollama model \(found openai\)/);
        await expect(localModel()).resolves.toBe('qwen3.5:9b');
        // And a good answer is remembered: ctx is not asked for every search.
        await localModel();
        expect(contextEngine.executeJson).toHaveBeenCalledTimes(2);
    });
});
