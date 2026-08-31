/**
 * Cross-tool Stardust endpoints — compose, change-impact and spec.
 *
 * These are the routes that make the three mandatory tools feed each other, so
 * the cases worth pinning are the ones that were silently returning nothing:
 * a repo-relative path resolving against the graph, and ImpactAnalyzer's real
 * field names reaching the response.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const router = require('../../backend/interfaces/RestController');

const { findRouteHandler } = require('../helpers/routeHandler');

/**
 * These routes shell out to graphify and openspec, so a test here is bounded by
 * subprocess start-up, not by the code under test. Jest's 5s default was never
 * chosen for that: the suite passes alone and fails under coverage
 * instrumentation, which is a property of the harness rather than the product.
 *
 * Set explicitly so the reason is visible, instead of the whole chain failing on
 * a number nobody picked.
 */
jest.setTimeout(30000);

function routeHandler(method, routePath) {
    return findRouteHandler(router, method, routePath);
}

async function invoke(method, routePath, { query = {}, params = {} } = {}) {
    const req = { body: {}, query, params, id: 'test-request-id', get: jest.fn() };
    const res = {
        statusCode: 200,
        status: jest.fn(function status(code) { this.statusCode = code; return this; }),
        json: jest.fn(function json(payload) { this.payload = payload; return this; }),
        send: jest.fn(function send(payload) { this.payload = payload; return this; }),
    };
    await routeHandler(method, routePath)(req, res);
    return res;
}

/**
 * A workspace with specs, a change and a hand-written graph.
 *
 *   server.js ──┐
 *   handlers.js ├──→ router.js ──→ store.js
 *   router.test.js ─┘
 *   server.js, handlers.js, router.js ──→ hub.js   (no spec describes hub.js)
 */
function buildWorkspace(root) {
    fs.mkdirSync(path.join(root, 'openspec', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'openspec', 'changes', 'add-rate-limit', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });

    fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), 'version: 1\n');
    fs.writeFileSync(
        path.join(root, 'openspec', 'specs', 'api.md'),
        '# API Spec\n\n### Request handling\nRequests pass through src/router.js.\n\n' +
        '### Legacy gateway\nNormalization used to live in src/legacy-gateway.js.\n'
    );
    fs.writeFileSync(
        path.join(root, 'openspec', 'changes', 'add-rate-limit', 'specs', 'api.md'),
        '## ADDED Requirements\n\n### Rate limiting\n' +
        'Enforcement lives in src/router.js and shares state through src/store.js.\n\n' +
        '## MODIFIED Requirements\n\n### Request handling\nsrc/router.js consults the limiter.\n'
    );

    const nodes = [
        { id: 'n1', source_file: 'src/router.js' },
        { id: 'n2', source_file: 'src/store.js' },
        { id: 'n3', source_file: 'src/server.js' },
        { id: 'n4', source_file: 'src/handlers.js' },
        { id: 'n5', source_file: 'tests/router.test.js' },
        { id: 'n6', source_file: 'src/hub.js' },
    ];
    const links = [
        { source: 'n3', target: 'n1', relation: 'imports' },
        { source: 'n4', target: 'n1', relation: 'imports' },
        { source: 'n5', target: 'n1', relation: 'imports' },
        { source: 'n1', target: 'n2', relation: 'imports' },
        { source: 'n3', target: 'n6', relation: 'imports' },
        { source: 'n4', target: 'n6', relation: 'imports' },
        { source: 'n1', target: 'n6', relation: 'imports' },
    ];
    fs.writeFileSync(path.join(root, 'graphify-out', 'graph.json'), JSON.stringify({ nodes, links }));
}

describe('Stardust cross-tool endpoints', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-cross-'));
        buildWorkspace(root);
    });

    afterEach(() => {
        if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    describe('GET /stardust/compose', () => {
        test('resolves a repo-relative path against the graph', async () => {
            // The path arrives already relative. Running it through path.relative
            // produced a ../ chain that matched nothing, so every structural
            // number came back zero.
            const res = await invoke('get', '/stardust/compose', {
                query: { projectRoot: root, file: 'src/router.js' },
            });

            expect(res.payload.graphify.available).toBe(true);
            expect(res.payload.graphify.inGraph).toBe(true);
            expect(res.payload.graphify.dependents).toBe(3);
            expect(res.payload.graphify.centrality).toBeGreaterThan(0);
        });

        test('reports blast radius and test coverage from ImpactAnalyzer', async () => {
            const res = await invoke('get', '/stardust/compose', {
                query: { projectRoot: root, file: 'src/router.js' },
            });

            // These read hasTestCoverage/testFiles/dependents before — names
            // ImpactAnalyzer has never returned — so they were always empty.
            expect(res.payload.graphify.blastRadius).toBe(2);
            expect(res.payload.graphify.coveredByTests).toBe(true);
            expect(res.payload.graphify.testFiles).toContain('tests/router.test.js');
            expect(res.payload.graphify.nearestDependents).toEqual(
                expect.arrayContaining(['src/server.js', 'src/handlers.js'])
            );
            expect(res.payload.graphify.risk).toBeTruthy();
        });

        test('accepts an absolute path for the same file', async () => {
            const res = await invoke('get', '/stardust/compose', {
                query: { projectRoot: root, file: path.join(root, 'src', 'router.js') },
            });

            expect(res.payload.file).toBe('src/router.js');
            expect(res.payload.graphify.dependents).toBe(3);
        });

        test('matches a spec that cites the file, and only that file', async () => {
            const cited = await invoke('get', '/stardust/compose', {
                query: { projectRoot: root, file: 'src/router.js' },
            });
            expect(cited.payload.openspec.available).toBe(true);
            expect(cited.payload.openspec.mentionedIn.map(entry => entry.spec)).toEqual(['api.md']);

            const uncited = await invoke('get', '/stardust/compose', {
                query: { projectRoot: root, file: 'src/hub.js' },
            });
            expect(uncited.payload.openspec.mentionedIn).toEqual([]);
        });

        test('each tool reports availability independently', async () => {
            const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-bare-'));
            try {
                const res = await invoke('get', '/stardust/compose', {
                    query: { projectRoot: bare, file: 'src/router.js' },
                });
                // No specs and no graph: both say so, and neither throws.
                expect(res.payload.openspec.available).toBe(false);
                expect(res.payload.openspec.reason).toBeTruthy();
                expect(res.payload.graphify.available).toBe(false);
                expect(res.payload.graphify.reason).toBeTruthy();
            } finally {
                fs.rmSync(bare, { recursive: true, force: true });
            }
        });

        test('requires a file', async () => {
            const res = await invoke('get', '/stardust/compose', { query: { projectRoot: root } });
            expect(res.statusCode).toBe(400);
        });
    });

    describe('GET /stardust/change-impact/:name', () => {
        test('resolves the files a change cites and reports their reach', async () => {
            const res = await invoke('get', '/stardust/change-impact/:name', {
                query: { projectRoot: root },
                params: { name: 'add-rate-limit' },
            });

            expect(res.payload.available).toBe(true);
            expect(res.payload.deltaCount).toBe(2);
            expect(res.payload.citedCount).toBe(2);

            const router_ = res.payload.files.find(entry => entry.file === 'src/router.js');
            expect(router_.inGraph).toBe(true);
            expect(router_.blastRadius).toBe(2);
            expect(router_.coveredByTests).toBe(true);
            // Cited by both the ADDED and the MODIFIED requirement.
            expect(router_.requirements).toEqual(expect.arrayContaining(['Rate limiting', 'Request handling']));

            expect(res.payload.totals.stale).toBe(0);
            expect(res.payload.totals.blastRadius).toBeGreaterThan(0);
        });

        test('reports a cited file the graph has never seen as stale', async () => {
            fs.writeFileSync(
                path.join(root, 'openspec', 'changes', 'add-rate-limit', 'specs', 'api.md'),
                '## ADDED Requirements\n\n### Ghost\nHandled by src/deleted-module.js.\n'
            );

            const res = await invoke('get', '/stardust/change-impact/:name', {
                query: { projectRoot: root },
                params: { name: 'add-rate-limit' },
            });

            const ghost = res.payload.files.find(entry => entry.reference === 'src/deleted-module.js');
            expect(ghost.stale).toBe(true);
            expect(ghost.file).toBeNull();
            expect(res.payload.totals.stale).toBe(1);
        });

        test('says which tool is missing rather than failing', async () => {
            fs.rmSync(path.join(root, 'graphify-out'), { recursive: true, force: true });

            const res = await invoke('get', '/stardust/change-impact/:name', {
                query: { projectRoot: root },
                params: { name: 'add-rate-limit' },
            });

            expect(res.payload.available).toBe(false);
            expect(res.payload.reason).toMatch(/graph/i);
            expect(res.payload.files).toEqual([]);
        });
    });

    describe('GET /stardust/spec', () => {
        test('returns the published spec text', async () => {
            const res = await invoke('get', '/stardust/spec', {
                query: { projectRoot: root, spec: 'api' },
            });

            expect(res.payload.available).toBe(true);
            expect(res.payload.path).toBe('openspec/specs/api.md');
            expect(res.payload.text).toContain('Request handling');
        });

        test('an unpublished spec is reported, not an error', async () => {
            const res = await invoke('get', '/stardust/spec', {
                query: { projectRoot: root, spec: 'not-written-yet' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.payload.available).toBe(false);
            expect(res.payload.reason).toBeTruthy();
        });

        test('refuses a spec id that escapes the specs directory', async () => {
            const res = await invoke('get', '/stardust/spec', {
                query: { projectRoot: root, spec: '../../../../etc/passwd' },
            });

            expect(res.statusCode).toBe(400);
            expect(res.payload.error).toMatch(/outside/i);
        });

        test('requires a spec id', async () => {
            const res = await invoke('get', '/stardust/spec', { query: { projectRoot: root } });
            expect(res.statusCode).toBe(400);
        });
    });
});
