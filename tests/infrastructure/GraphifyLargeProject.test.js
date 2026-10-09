/**
 * Large projects got stuck on "Graph build in progress" forever.
 *
 * WHAT THE USER SAW:
 *
 * Graph Studio on a big workspace sat on the spinner reading "Graph build in
 * progress" / "Build Running" / "Graphify build running" and never moved, while
 * `ps` showed no graphify process running at all. Small workspaces were fine.
 *
 * WHAT WAS ACTUALLY HAPPENING — measured, not guessed:
 *
 * Opening Graph Studio calls `GET /api/graphify/map`, which asked for the first
 * 90 nodes of the graph. `map()` began with `ensureGraph()`, and `ensureGraph()`
 * rebuilt the ENTIRE graph whenever any source file was newer than graph.json:
 *
 *     const currentFreshness = this.freshness(projectPath);   // full mtime scan
 *     if (hasGraph(projectPath) && !currentFreshness.stale) return ...;
 *     const result = await this.build(projectPath);           // full rebuild
 *
 * On a real workspace here — 8255 files, 141,869 nodes, a 208 MB graph.json —
 * that one preview request took **106 seconds**, because it ran a complete
 * rebuild inline inside the HTTP handler. On a small workspace the same rebuild
 * takes 3-6 seconds and nobody ever noticed it happening.
 *
 * The rebuild's first act is `writeBuildStatus({ state: 'running' })`. So merely
 * LOOKING at a large graph wrote "a build is running" to disk. When the request
 * was abandoned (the frontend gives up, the view is closed, the child process is
 * killed at the 5-minute execFile timeout) nothing ever wrote a terminal state
 * over it, and `/api/graphify/build/status` returned that orphaned `running`
 * verbatim — so the UI showed a build in progress that did not exist, for the
 * full 30-minute stale window.
 *
 * Three separate things had to be true for the freeze, and each is asserted
 * below so no one of them can come back on its own:
 *
 *   1. reading a preview triggered a write-heavy rebuild
 *   2. a stale-but-present graph counted as "no graph"
 *   3. an orphaned `running` status was reported as live
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const graphifyService = require('../../backend/infrastructure/GraphifyService');

/** A workspace with a real graph on disk and a source file NEWER than it —
 *  exactly the state every actively-edited project is in. */
function makeStaleWorkspace() {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graphify-large-'));
    fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({
        nodes: [
            { id: 'a', label: 'a.js', community: 1, file_type: 'code', source_file: 'a.js' },
            { id: 'b', label: 'b.js', community: 1, file_type: 'code', source_file: 'b.js' }
        ],
        links: [{ source: 'a', target: 'b', relation: 'imports', confidence: 1 }]
    }));

    // A source edit one hour in the future guarantees `stale`, with no sleeping
    // and no dependence on filesystem timestamp granularity.
    // Both files the graph names exist: map() leaves out nodes of deleted files.
    fs.writeFileSync(path.join(workspace, 'b.js'), 'module.exports = 2;\n');
    const source = path.join(workspace, 'a.js');
    fs.writeFileSync(source, 'module.exports = 1;\n');
    const future = new Date(Date.now() + 3600 * 1000);
    fs.utimesSync(source, future, future);

    return workspace;
}

describe('reading a large graph never triggers a build', () => {
    let workspace;
    let buildSpy;

    beforeEach(() => {
        workspace = makeStaleWorkspace();
        // The assertion is not "it was fast" — that would measure the machine.
        // It is that `build` is never REACHED, which is deterministic.
        buildSpy = jest.spyOn(graphifyService, 'build');
    });

    afterEach(() => {
        buildSpy.mockRestore();
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('the workspace really is stale, or everything below passes vacuously', () => {
        expect(graphifyService.freshness(workspace).stale).toBe(true);
    });

    test('map() returns the preview without building', async () => {
        const result = await graphifyService.map(workspace, { limit: 90 });

        expect(buildSpy).not.toHaveBeenCalled();
        expect(result.totalNodes).toBe(2);
        expect(result.nodes).toHaveLength(2);
    });

    test('map() does not write a build status', async () => {
        await graphifyService.map(workspace, { limit: 90 });

        // The orphaned `running` that pinned the UI was written by exactly this
        // path. A read must leave no trace on disk.
        expect(fs.existsSync(graphifyService.buildStatusPath(workspace))).toBe(false);
    });

    test('ensureGraph uses a stale graph rather than rebuilding it', async () => {
        const result = await graphifyService.ensureGraph(workspace);

        expect(buildSpy).not.toHaveBeenCalled();
        expect(result.built).toBe(false);
        // Staleness is still REPORTED — it is the user's cue to press Build.
        // Silently hiding it would be a different bug.
        expect(result.stale).toBe(true);
    });

    test('ensureGraph still builds when there is genuinely no graph', async () => {
        fs.rmSync(path.join(workspace, 'graphify-out', 'graph.json'));
        buildSpy.mockResolvedValue({ graphPath: 'x', output: '', build: { state: 'succeeded' } });

        await graphifyService.ensureGraph(workspace);

        // The protection above must not turn into "never build". With no graph
        // there is nothing to serve, so building is the only correct answer.
        expect(buildSpy).toHaveBeenCalledWith(workspace);
    });
});

describe('an orphaned running status is never reported as a live build', () => {
    let workspace;

    beforeEach(() => {
        workspace = makeStaleWorkspace();
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    test('a running status older than any build could last is reconciled', () => {
        graphifyService.writeBuildStatus(workspace, {
            state: 'running',
            message: 'Graphify build running',
            startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString()
        });
        // writeBuildStatus stamps updatedAt with now, so age it by hand: this is
        // the exact on-disk shape left behind by a runtime that was killed.
        const statusFile = graphifyService.buildStatusPath(workspace);
        const aged = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        aged.updatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        fs.writeFileSync(statusFile, JSON.stringify(aged));

        const status = graphifyService.status(workspace);

        expect(status.build.state).not.toBe('running');
        expect(status.build.staleRunning).toBe(true);
    });

    test('the reconciliation window is bounded by how long a build can run', () => {
        // 30 minutes was picked from nowhere and left the UI frozen for half an
        // hour. A build cannot outlive two runGraphify timeouts, so that — not a
        // round number — is what the window has to follow.
        const timeoutMs = Number(process.env.YODAMAN_GRAPHIFY_TIMEOUT_MS || 300000);
        expect(graphifyService.staleRunningBuildMs()).toBeLessThanOrEqual(timeoutMs * 2 + 120000);
        // And long enough that a real build is never cut off mid-flight.
        expect(graphifyService.staleRunningBuildMs()).toBeGreaterThanOrEqual(timeoutMs * 2);
    });
});

describe('a build stopped by the timeout says so', () => {
    let workspace;

    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graphify-timeout-'));
    });

    afterEach(() => {
        fs.rmSync(workspace, { recursive: true, force: true });
        jest.resetModules();
    });

    test('names the timeout instead of "Command failed"', async () => {
        // /bin/sleep stands in for a graphify run that outlasts the limit. The
        // point is the shape of the failure, not which binary produced it: a
        // killed child leaves stderr EMPTY, so the old code fell through to
        // err.message and reported "Command failed: ...", which reads as the
        // tool rejecting the project rather than as us stopping it. On a large
        // workspace this is the single most likely way a build ends.
        // A stand-in that ignores its arguments and simply outlives the limit.
        // /bin/sleep cannot be used directly: it parses `update <path> --force`
        // and exits with a usage error, which is a different failure entirely.
        const stub = path.join(workspace, 'slow-graphify');
        fs.writeFileSync(stub, '#!/bin/sh\nsleep 5\n');
        fs.chmodSync(stub, 0o755);

        jest.resetModules();
        process.env.YODAMAN_GRAPHIFY_BIN = stub;
        process.env.YODAMAN_GRAPHIFY_TIMEOUT_MS = '300';

        let service;
        try {
            service = require('../../backend/infrastructure/GraphifyService');
            await expect(service.build(workspace)).rejects.toThrow(/stopped after 0s|stopped after \d+s/);
        } finally {
            delete process.env.YODAMAN_GRAPHIFY_BIN;
            delete process.env.YODAMAN_GRAPHIFY_TIMEOUT_MS;
        }

        // And the failure is durable: a build that died must leave a terminal
        // state on disk, never the `running` that froze the view.
        const written = JSON.parse(fs.readFileSync(service.buildStatusPath(workspace), 'utf8'));
        expect(written.state).toBe('failed');
        expect(written.message).toMatch(/YODAMAN_GRAPHIFY_TIMEOUT_MS/);
    }, 20000);
});

describe('map: which nodes a large graph shows', () => {
    let workspace;
    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-map-rank-'));
        fs.mkdirSync(path.join(workspace, 'graphify-out'));
        // "leaf" nodes first in file order; "hub" is last but linked to all.
        const nodes = [...Array.from({ length: 5 }, (_, i) => ({ id: `leaf${i}` })), { id: 'hub' }, { id: 'loner' }];
        const links = Array.from({ length: 5 }, (_, i) => ({ source: 'hub', target: `leaf${i}` }));
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({ nodes, links }));
    });
    afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

    test('by default keeps file order (Graph Studio preview)', async () => {
        const out = await graphifyService.map(workspace, { limit: 3 });
        expect(out.nodes.map((n) => n.id)).toEqual(['leaf0', 'leaf1', 'leaf2']);
    });

    test('rank=degree shows the most connected nodes, hubs first', async () => {
        // The file's first N nodes are an arbitrary slice on a big workspace;
        // the VR view asks for the structure instead.
        const out = await graphifyService.map(workspace, { limit: 3, rank: 'degree' });
        expect(out.nodes[0].id).toBe('hub');
        expect(out.nodes.map((n) => n.id)).not.toContain('loner');
        expect(out.links).toHaveLength(2);
        expect(out.totalNodes).toBe(7);
    });

    test('a request cannot ask for an unbounded map', async () => {
        const out = await graphifyService.map(workspace, { limit: 1e9, rank: 'degree' });
        expect(out.nodes.length).toBeLessThanOrEqual(7);
    });
});

describe('map: files that no longer exist', () => {
    let workspace;
    beforeEach(() => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-map-missing-'));
        fs.mkdirSync(path.join(workspace, 'graphify-out'));
        fs.mkdirSync(path.join(workspace, 'src'));
        fs.writeFileSync(path.join(workspace, 'src', 'alive.js'), 'module.exports = 1;\n');
        // Graphify's incremental update keeps nodes for deleted files; this
        // graph still lists a minified bundle that was removed.
        const nodes = [
            { id: 'alive', label: 'Alive', source_file: 'src/alive.js' },
            { id: 'n', label: 'n', source_file: 'frontend/UIPanel.js' },
            { id: 'l', label: 'l', source_file: 'frontend/UIPanel.js' },
            { id: 'concept', label: 'Architecture' }
        ];
        const links = [{ source: 'alive', target: 'n' }, { source: 'n', target: 'l' }, { source: 'alive', target: 'concept' }];
        fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph.json'), JSON.stringify({ nodes, links }));
    });
    afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

    test('are left out, with their links, and counted', async () => {
        const out = await graphifyService.map(workspace, { limit: 100, rank: 'degree' });
        expect(out.nodes.map((n) => n.id).sort()).toEqual(['alive', 'concept']);
        expect(out.links).toEqual([expect.objectContaining({ source: 'alive', target: 'concept' })]);
        expect(out.missingFileNodes).toBe(2);
        expect(out.totalNodes).toBe(2);
    });

    test('the graph file itself is not rewritten: a map is a read', async () => {
        const before = fs.readFileSync(path.join(workspace, 'graphify-out', 'graph.json'), 'utf8');
        await graphifyService.map(workspace, { limit: 100 });
        expect(fs.readFileSync(path.join(workspace, 'graphify-out', 'graph.json'), 'utf8')).toBe(before);
    });
});
