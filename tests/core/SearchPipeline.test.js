/**
 * The search pipeline: YodaMan's core.
 *
 *   1. Context Expert retrieves
 *   2. Graphify ranks   (semantic 0.50 + proximity 0.20 + centrality 0.15 + spec coverage 0.15)
 *   3. OpenSpec tags
 *
 * Every search in the product goes through SearchPipeline.search. These tests
 * pin each stage, the order they run in, that no mode can skip one, that a
 * failing stage degrades without hiding it, and that only real files reach a
 * user. The boundary that keeps every caller on this path is enforced
 * separately, in tests/architecture/SearchPipelineBoundary.test.js.
 *
 * Context Expert (ctx) is mocked: it is an external process. Graphify ranking and OpenSpec tagging are mocked at their module
 * boundary so each stage's effect on the output can be asserted exactly.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../backend/infrastructure/ToolBox', () => ({ contextExpertSearch: jest.fn() }));
jest.mock('../../backend/infrastructure/Logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock('../../backend/infrastructure/GraphRanker', () => ({
    DEFAULT_WEIGHTS: { semantic: 0.5, proximity: 0.2, centrality: 0.15, specCoverage: 0.15 },
    rerank: jest.fn()
}));
jest.mock('../../backend/stardust/SpecDrift', () => ({ readSpecs: jest.fn(), extractReferences: jest.fn() }));

const toolBox = require('../../backend/infrastructure/ToolBox');
const logger = require('../../backend/infrastructure/Logger');
const graphRanker = require('../../backend/infrastructure/GraphRanker');
const specDrift = require('../../backend/stardust/SpecDrift');
const pipeline = require('../../backend/core/SearchPipeline');

const hit = (file, score, extra = {}) => ({ filePath: file, lineStart: 1, content: `// ${file}`, score, metadata: { path: file, line: 1 }, ...extra });

/** Graphify that puts auth/login.py first, as a central file would be. */
function graphThatPrefers(file) {
    graphRanker.rerank.mockImplementation((project, results) => results
        .map((r) => ({ ...r, graphSignal: { centrality: r.metadata.path === file ? 1 : 0 } }))
        .sort((a, b) => b.graphSignal.centrality - a.graphSignal.centrality));
}

/** OpenSpec with one spec, "auth-login", covering auth/login.py. */
function specsCovering(file) {
    specDrift.readSpecs.mockReturnValue([{ id: 'auth-login', text: `See ${file}.` }]);
    specDrift.extractReferences.mockReturnValue([file]);
}

let workspace;

beforeEach(() => {
    jest.clearAllMocks();
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-pipeline-')));
    for (const file of ['auth/login.py', 'util/misc.py', 'docs/guide.md', 'docs/intro.md']) {
        fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
        fs.writeFileSync(path.join(workspace, file), 'x\n');
    }
    // Semantically, misc.py is the closer match. Graphify should overrule that.
    toolBox.contextExpertSearch.mockResolvedValue([hit('util/misc.py', 0.95), hit('auth/login.py', 0.9)]);
    graphThatPrefers('auth/login.py');
    specsCovering('auth/login.py');
});

afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

describe('the three pillars, in order', () => {
    test('1. Context Expert retrieves, scoped to the workspace', async () => {
        await pipeline.search({ query: 'login', project: workspace, mode: 'code', top: 7 });
        expect(toolBox.contextExpertSearch).toHaveBeenCalledWith({ query: 'login', project: workspace, top: 7 });
    });

    test('2. Graphify ranks what Context Expert retrieved, with the active file', async () => {
        const out = await pipeline.search({ query: 'login', project: workspace, activeFile: 'auth/session.py' });
        expect(graphRanker.rerank).toHaveBeenCalledWith(workspace, expect.any(Array), { activeFile: 'auth/session.py' });
        // Structure overruled raw similarity.
        expect(out.results.map((r) => r.metadata.path)).toEqual(['auth/login.py', 'util/misc.py']);
        expect(out.graphRanked).toBe(true);
        expect(out.weights).toEqual(graphRanker.DEFAULT_WEIGHTS);
    });

    test('3. OpenSpec tags the ranked hits', async () => {
        const out = await pipeline.search({ query: 'login', project: workspace });
        expect(specDrift.readSpecs).toHaveBeenCalledWith(workspace);
        expect(out.results[0].specFlag).toEqual({ covered: true, specs: ['auth-login'] });
        expect(out.results[1].specFlag).toEqual({ covered: false });
    });

    test('ranking happens before tagging, and both after retrieval', async () => {
        await pipeline.search({ query: 'login', project: workspace });
        const order = [
            toolBox.contextExpertSearch.mock.invocationCallOrder[0],
            graphRanker.rerank.mock.invocationCallOrder[0],
            specDrift.readSpecs.mock.invocationCallOrder[0]
        ];
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    test('the result says which pillars contributed', async () => {
        const out = await pipeline.search({ query: 'login', project: workspace });
        expect(out.pillars).toEqual({ contextExpert: true, graphify: true, openspec: true });
    });
});

describe('no mode can skip a pillar', () => {
    // Callers choose WHAT to retrieve. They cannot choose to skip ranking or
    // tagging: SearchTrace and docs search each used to stop early.
    test.each(['unified', 'code', 'doc'])('%s mode is ranked by Graphify and tagged by OpenSpec', async (mode) => {
        toolBox.contextExpertSearch.mockResolvedValue([
            hit('util/misc.py', 0.95), hit('auth/login.py', 0.9), hit('docs/guide.md', 0.85), hit('docs/intro.md', 0.8)
        ]);
        const out = await pipeline.search({ query: 'login', project: workspace, mode });
        expect(graphRanker.rerank).toHaveBeenCalled();
        expect(specDrift.readSpecs).toHaveBeenCalled();
        expect(out.pillars).toEqual({ contextExpert: true, graphify: true, openspec: true });
    });

    test('every mode is ONE Context Expert query', async () => {
        // Unified used to query twice (code, then "docs" that were never
        // indexed), returning every hit twice.
        for (const mode of ['unified', 'code', 'doc']) {
            toolBox.contextExpertSearch.mockClear();
            await pipeline.search({ query: 'q', project: workspace, mode });
            expect(toolBox.contextExpertSearch).toHaveBeenCalledTimes(1);
        }
    });

    test('doc mode keeps documentation; every hit is tagged by kind', async () => {
        toolBox.contextExpertSearch.mockResolvedValue([hit('auth/login.py', 0.9), hit('docs/guide.md', 0.8)]);
        const unified = await pipeline.search({ query: 'q', project: workspace });
        expect(Object.fromEntries(unified.results.map((r) => [r.metadata.path, r._source])))
            .toEqual({ 'auth/login.py': 'code', 'docs/guide.md': 'docs' });
        const docs = await pipeline.search({ query: 'q', project: workspace, mode: 'doc' });
        expect(docs.results.map((r) => r.metadata.path)).toEqual(['docs/guide.md']);
    });

    test('a search never writes into the workspace', async () => {
        // The old docs path wrote thousands of chunk files into the user's
        // repository on every search, and rewrote a config.json inside it.
        const before = fs.readdirSync(workspace, { recursive: true }).sort();
        await pipeline.search({ query: 'q', project: workspace });
        await pipeline.search({ query: 'q', project: workspace, mode: 'doc' });
        expect(fs.readdirSync(workspace, { recursive: true }).sort()).toEqual(before);
    });

    test('an unknown mode is refused rather than quietly treated as one of the others', async () => {
        await expect(pipeline.search({ query: 'q', project: workspace, mode: 'fast' })).rejects.toThrow(/Unknown search mode/);
    });
});

describe('a stage that cannot run degrades visibly, never silently', () => {
    test('no graph: results still come back, and the result says Graphify did not rank them', async () => {
        graphRanker.rerank.mockImplementation((p, results) => results);
        const out = await pipeline.search({ query: 'login', project: workspace });
        expect(out.results).toHaveLength(2);
        expect(out.graphRanked).toBe(false);
        expect(out.pillars.graphify).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith('search_graph_ranking_inactive', expect.any(Object));
    });

    test('a graph that throws does not fail the search', async () => {
        graphRanker.rerank.mockImplementation(() => { throw new Error('graph.json corrupt'); });
        const out = await pipeline.search({ query: 'login', project: workspace });
        expect(out.results).toHaveLength(2);
        expect(out.pillars.graphify).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith('search_graph_rerank_skipped', expect.objectContaining({ reason: 'graph.json corrupt' }));
    });

    test('no specs: results come back untagged, and the result says so', async () => {
        specDrift.readSpecs.mockReturnValue([]);
        const out = await pipeline.search({ query: 'login', project: workspace });
        expect(out.pillars.openspec).toBe(false);
        expect(out.results.every((r) => r.specFlag === undefined)).toBe(true);
    });

    test('specs that throw do not fail the search', async () => {
        specDrift.readSpecs.mockImplementation(() => { throw new Error('bad spec'); });
        const out = await pipeline.search({ query: 'login', project: workspace });
        expect(out.results).toHaveLength(2);
        expect(out.pillars.openspec).toBe(false);
    });

    test('a filesystem fallback is not reported as Context Expert', async () => {
        // ctx unavailable or the workspace not indexed: ToolBox scans files
        // literally. That is a different pillar count and must say so.
        toolBox.contextExpertSearch.mockResolvedValue([
            hit('auth/login.py', 1, { metadata: { path: 'auth/login.py', line: 1, source: 'filesystem-fallback' } }),
            hit('util/misc.py', 1, { metadata: { path: 'util/misc.py', line: 1, source: 'filesystem-fallback' } })
        ]);
        const out = await pipeline.search({ query: 'login', project: workspace, mode: 'code' });
        expect(out.pillars.contextExpert).toBe(false);
    });

    test('a retrieval failure is the caller\'s to report', async () => {
        toolBox.contextExpertSearch.mockRejectedValueOnce(new Error('ctx down'));
        await expect(pipeline.search({ query: 'q', project: workspace })).rejects.toThrow('ctx down');
    });
});

describe('only real, user-owned files reach anyone', () => {
    test('YodaMan\'s own generated output is dropped before ranking', async () => {
        toolBox.contextExpertSearch.mockResolvedValue([
            hit('graphify-out/cache/ast/86c41b74.json', 0.99),
            hit('.yodaman-doc-chunks/README_root_0.doc-chunk', 0.98),
            hit('node_modules/lib/index.js', 0.97),
            hit('auth/login.py', 0.5)
        ]);
        const out = await pipeline.search({ query: 'q', project: workspace, mode: 'code' });
        expect(out.results.map((r) => r.metadata.path)).toEqual(['auth/login.py']);
        expect(out.dropped.generated).toBe(3);
    });

    test('hits for files no longer on disk are dropped', async () => {
        // The reported failure: a workspace folder had moved, ctx kept its old
        // index, and every hit pointed at a missing file. The agent spent its
        // whole step budget on "File not found" and nothing could be opened.
        toolBox.contextExpertSearch.mockResolvedValue([hit('gone/old.py', 0.99), hit('auth/login.py', 0.5), hit('util/misc.py', 0.4)]);
        const out = await pipeline.search({ query: 'q', project: workspace, mode: 'code' });
        expect(out.results.map((r) => r.metadata.path)).toEqual(['auth/login.py', 'util/misc.py']);
        expect(out.dropped.missing).toBe(1);
        // Dropped before ranking: Graphify never sees a file that does not exist.
        expect(graphRanker.rerank.mock.calls[0][1].map((r) => r.metadata.path)).not.toContain('gone/old.py');
    });

    test('the same location is listed once', async () => {
        toolBox.contextExpertSearch.mockResolvedValue([hit('auth/login.py', 0.9), hit('auth/login.py', 0.9), hit('util/misc.py', 0.8)]);
        const out = await pipeline.search({ query: 'q', project: workspace });
        expect(out.results.map((r) => r.metadata.path).sort()).toEqual(['auth/login.py', 'util/misc.py']);
        expect(out.dropped.duplicates).toBe(1);
    });

    test('a workspace given by its registered name resolves to its path', () => {
        expect(pipeline.resolveProject(workspace)).toBe(workspace);
        expect(pipeline.resolveProject(undefined)).toBeUndefined();
    });
});

describe('a workspace whose folder is gone', () => {
    test('is reported as missing, not searched', async () => {
        const gone = path.join(os.tmpdir(), 'yodaman-pipeline-moved-away');
        const err = await pipeline.search({ query: 'login', project: gone }).catch((e) => e);
        expect(err.code).toBe('workspace_missing');
        expect(err.status).toBe(404);
        expect(err.message).toMatch(/moved or deleted/);
        expect(toolBox.contextExpertSearch).not.toHaveBeenCalled();
    });
});
