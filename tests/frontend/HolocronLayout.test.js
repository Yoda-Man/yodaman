/**
 * Holocron's layout: the WASM engine when it can run, the spiral when it cannot.
 *
 * Until 0.5.8 the viewer only placed nodes on a spiral per cluster, ignoring
 * the relationships, and the compiled engine was never called by anything.
 * These tests cover each half and the hand-off between them:
 *
 *   - the pure pieces (spiral, engine input, validation, fitting);
 *   - every route to the fallback (no worker, worker error, timeout, bad output);
 *   - the REAL compiled engine, run in Node through the same runner the worker
 *     uses, on a graph with structure it should recover;
 *   - the vendored engine files match their manifest and, where Holocron is
 *     checked out beside core, Holocron's build.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const VENDOR = path.join(ROOT, 'public', 'vendor', 'holocron-layout');

const {
    spiralLayout, engineInput, isUsableLayout, fitToRadius, arrangeConstellation
} = require('../../src/holocron/forceLayout');

/** Two clusters of three, each a triangle, joined by one bridge. */
function smallGraph() {
    const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => ({ id }));
    const links = [
        { source: 'a1', target: 'a2' }, { source: 'a2', target: 'a3' }, { source: 'a3', target: 'a1' },
        { source: 'b1', target: 'b2' }, { source: 'b2', target: 'b3' }, { source: 'b3', target: 'b1' },
        { source: 'a1', target: 'b1' },
        { source: 'a1', target: 'a1' },          // self-link: dropped
        { source: 'a2', target: 'not-in-view' }  // dangling: dropped
    ];
    const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const groups = [['7001', [0, 1, 2]], ['42', [3, 4, 5]]];
    return { nodes, links, nodeIndex, groups };
}

/** A stand-in Worker that answers with whatever `reply` produces. */
function fakeWorker(reply) {
    const worker = {
        terminated: false,
        terminate() { this.terminated = true; },
        postMessage(input) {
            setTimeout(() => {
                const outcome = reply(input);
                if (outcome === 'error-event') this.onerror({ message: 'worker crashed' });
                else if (outcome !== 'silence') this.onmessage({ data: outcome });
            }, 0);
        }
    };
    return worker;
}

describe('the pure layout pieces', () => {
    test('the spiral is deterministic, and every node gets a finite position', () => {
        const { nodes, groups } = smallGraph();
        const first = spiralLayout(nodes.length, groups);
        expect(Array.from(first)).toEqual(Array.from(spiralLayout(nodes.length, groups)));
        expect(isUsableLayout(first, nodes.length)).toBe(true);
    });

    test('engine input: dense cluster ids, seed positions, and only real links', () => {
        const { nodes, links, nodeIndex, groups } = smallGraph();
        const seed = spiralLayout(nodes.length, groups);
        const input = engineInput({ nodeCount: nodes.length, links, nodeIndex, groups, seed });

        expect(input.nodes).toHaveLength(nodes.length * 7);
        // Graphify's community ids (7001, 42) become 0 and 1.
        expect([0, 1, 2, 3, 4, 5].map((i) => input.nodes[i * 7 + 4])).toEqual([0, 0, 0, 1, 1, 1]);
        expect(input.nodes[0]).toBe(seed[0]);
        // 7 real links; the self-link and the dangling one are gone.
        expect(input.edgeCount).toBe(7);
        expect(input.edges).toHaveLength(21);
    });

    test('unusable positions are recognised', () => {
        expect(isUsableLayout(new Float32Array([0, 0, 0, NaN, 1, 1]), 2)).toBe(false);
        expect(isUsableLayout(new Float32Array([1, 1, 1, 1, 1, 1]), 2)).toBe(false);   // collapsed
        expect(isUsableLayout(new Float32Array([0, 0, 0]), 2)).toBe(false);            // wrong length
        expect(isUsableLayout(new Float32Array([0, 0, 0, 3, 0, 0]), 2)).toBe(true);
    });

    test('fitting centres the layout and scales it to the radius the camera expects', () => {
        const fitted = fitToRadius(new Float32Array([100, 0, 0, 300, 0, 0]), 10);
        expect(Array.from(fitted)).toEqual([-10, 0, 0, 10, 0, 0]);
    });
});

describe('placing whole clusters', () => {
    const { arrangeClusters } = require('../../src/holocron/forceLayout');

    /** Clusters of `sizes`, all piled at the origin, each a small ring. */
    function piled(sizes) {
        const groups = [];
        const coords = [];
        let n = 0;
        sizes.forEach((size, c) => {
            const members = [];
            for (let i = 0; i < size; i++, n++) {
                members.push(n);
                coords.push(Math.cos(i) * 2, Math.sin(i) * 2, 0);
            }
            groups.push([String(c), members]);
        });
        return { groups, positions: Float32Array.from(coords) };
    }
    const centreOf = (p, members) => [0, 1, 2].map((k) => members.reduce((s, m) => s + p[m * 3 + k], 0) / members.length);

    test('separates clusters the engine stacked on top of each other', () => {
        const { groups, positions } = piled([12, 9, 7, 5, 4]);
        const out = arrangeClusters(positions, groups, new Int32Array(0));
        const centres = groups.map(([, m]) => centreOf(out, m));
        for (let a = 0; a < centres.length; a++) {
            for (let b = a + 1; b < centres.length; b++) {
                // Each cluster has radius ~2, opened to ~4.4; centres stay clear of each other.
                expect(Math.hypot(...centres[a].map((v, k) => v - centres[b][k]))).toBeGreaterThan(6);
            }
        }
    });

    test('keeps the shape the engine gave each cluster, opened up evenly', () => {
        const { groups, positions } = piled([6, 6]);
        const out = arrangeClusters(positions, groups, new Int32Array(0), { spread: 2 });
        const [, members] = groups[1];
        const d = (p, a, b) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
        // Every distance inside the cluster scales by the same factor.
        expect(d(out, members[0], members[3])).toBeCloseTo(2 * d(positions, members[0], members[3]), 4);
        expect(d(out, members[1], members[4])).toBeCloseTo(2 * d(positions, members[1], members[4]), 4);
    });

    test('centres each cluster on its hub', () => {
        const { groups, positions } = piled([5, 5]);
        const [, members] = groups[1];
        // members[2] is cluster 1's hub: linked to every other member.
        const edges = members.filter((m) => m !== members[2]).flatMap((m) => [members[2], m, 1]);
        const out = arrangeClusters(positions, groups, Int32Array.from(edges));
        const hub = [0, 1, 2].map((k) => out[members[2] * 3 + k]);
        const others = members.filter((m) => m !== members[2]);
        const meanDist = others.reduce((s, m) => s + Math.hypot(...[0, 1, 2].map((k) => out[m * 3 + k] - hub[k])), 0) / others.length;
        // The ring of members surrounds the hub at a steady distance.
        others.forEach((m) => expect(Math.hypot(...[0, 1, 2].map((k) => out[m * 3 + k] - hub[k]))).toBeLessThan(meanDist * 2.5));
    });

    test('puts the cluster most linked to the centre next to it', () => {
        const { groups, positions } = piled([10, 6, 6, 6]);
        // Cluster 3 links to cluster 0 a lot; 1 and 2 not at all.
        const edges = [];
        for (let i = 0; i < 5; i++) edges.push(groups[0][1][i], groups[3][1][i], 1);
        const out = arrangeClusters(positions, groups, Int32Array.from(edges));
        const c0 = centreOf(out, groups[0][1]);
        const dist = (c) => Math.hypot(...centreOf(out, groups[c][1]).map((v, k) => v - c0[k]));
        expect(dist(3)).toBeLessThan(dist(1));
        expect(dist(3)).toBeLessThan(dist(2));
    });

    test('is deterministic', () => {
        const { groups, positions } = piled([8, 5, 3]);
        expect(Array.from(arrangeClusters(positions, groups, new Int32Array(0)))).toEqual(Array.from(arrangeClusters(positions, groups, new Int32Array(0))));
    });
});

describe('choosing between the engine and the spiral', () => {
    const graph = smallGraph();
    const spreadOut = (input) => {
        const positions = new Float32Array(input.nodeCount * 3);
        for (let i = 0; i < positions.length; i++) positions[i] = (i * 7) % 11;
        return { ok: true, positions };
    };

    test('asks the engine for a scene that grows with the cluster count', async () => {
        // A fixed radius overlapped clusters into one ball on large workspaces.
        const { sceneRadiusFor } = require('../../src/holocron/forceLayout');
        let sent;
        await arrangeConstellation({ ...graph, createWorker: () => fakeWorker((input) => { sent = input; return spreadOut(input); }) });
        expect(sent.config.sceneRadius).toBe(sceneRadiusFor(graph.groups.length));
        expect(sceneRadiusFor(335)).toBeGreaterThan(sceneRadiusFor(56));
        expect(sceneRadiusFor(56)).toBeGreaterThan(20);
    });

    test('uses the engine when it answers with a usable layout', async () => {
        const worker = fakeWorker(spreadOut);
        const out = await arrangeConstellation({ ...graph, createWorker: () => worker });
        expect(out.engine).toBe('wasm');
        expect(isUsableLayout(out.positions, graph.nodes.length)).toBe(true);
        expect(worker.terminated).toBe(true);
    });

    test.each([
        ['the worker cannot be created', () => { throw new Error('Worker is not defined'); }, /Worker is not defined/],
        ['the engine reports an error', () => fakeWorker(() => ({ ok: false, error: 'init failed' })), /init failed/],
        ['the worker crashes', () => fakeWorker(() => 'error-event'), /worker crashed/],
        ['the engine returns NaN', () => fakeWorker((i) => ({ ok: true, positions: new Float32Array(i.nodeCount * 3).fill(NaN) })), /unusable/],
        ['the engine never answers', () => fakeWorker(() => 'silence'), /longer than/]
    ])('falls back to the spiral when %s', async (_case, createWorker, reason) => {
        const out = await arrangeConstellation({ ...graph, createWorker, timeoutMs: 50 });
        expect(out.engine).toBe('fallback');
        expect(out.reason).toMatch(reason);
        expect(Array.from(out.positions)).toEqual(Array.from(spiralLayout(graph.nodes.length, graph.groups)));
    });
});

describe('the real compiled engine', () => {
    test('recovers structure: connected nodes end up closer than unconnected ones', () => {
        // Runs in a child Node process because the engine and runner are ES
        // modules. Same files the app serves, same runner the worker uses.
        const script = `
            import fs from 'fs';
            const V = ${JSON.stringify(VENDOR + '/')};
            const { runLayout } = await import(${JSON.stringify(path.join(ROOT, 'src', 'holocron', 'engineRunner.mjs'))});
            const { bindLayoutEngine } = await import(V + 'bindLayoutEngine.js');
            const create = (await import(V + 'layout_engine.mjs')).default;
            const bytes = fs.readFileSync(V + 'layout_engine.wasm');
            const engine = bindLayoutEngine(await create({ instantiateWasm(imports, done) {
                WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => done(instance, module)); return {};
            } }));
            // 4 clusters x 30 nodes; each cluster a ring, so neighbours are known.
            const N = 120, nodes = new Float32Array(N * 7), pairs = [];
            for (let i = 0; i < N; i++) {
                const c = Math.floor(i / 30);
                nodes.set([Math.cos(i) * 8, Math.sin(i) * 8, (i % 5) - 2, 1, c, 0, 0], i * 7);
                const next = c * 30 + ((i % 30) + 1) % 30;
                pairs.push(i, next, 1);
            }
            const p = runLayout(engine, { nodes, edges: Int32Array.from(pairs), nodeCount: N, edgeCount: pairs.length / 3 });
            const d = (a, b) => Math.hypot(p[a*3]-p[b*3], p[a*3+1]-p[b*3+1], p[a*3+2]-p[b*3+2]);
            let linked = 0; for (let k = 0; k < pairs.length; k += 3) linked += d(pairs[k], pairs[k+1]);
            linked /= pairs.length / 3;
            let other = 0, count = 0;
            for (let a = 0; a < N; a += 7) for (let b = 3; b < N; b += 11) if (Math.floor(a/30) !== Math.floor(b/30)) { other += d(a, b); count++; }
            console.log(JSON.stringify({ finite: p.every(Number.isFinite), linked, other: other / count, length: p.length }));
        `;
        const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 60000 });
        // Node may warn that the vendored engine files are ES modules in a
        // CommonJS package; only a real failure matters.
        expect(run.status).toBe(0);
        expect(run.stderr).not.toMatch(/Error|Aborted/);
        const result = JSON.parse(run.stdout.trim().split('\n').pop());
        expect(result.length).toBe(360);
        expect(result.finite).toBe(true);
        expect(result.linked * 2).toBeLessThan(result.other);
    }, 90000);
});

describe('the vendored engine files', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(VENDOR, 'MANIFEST.json'), 'utf8'));

    test('match their manifest byte for byte', () => {
        expect(manifest.files.map((f) => f.file).sort()).toEqual(['bindLayoutEngine.js', 'layout_engine.mjs', 'layout_engine.wasm']);
        for (const { file, bytes, sha256 } of manifest.files) {
            const data = fs.readFileSync(path.join(VENDOR, file));
            expect([file, data.length, crypto.createHash('sha256').update(data).digest('hex')]).toEqual([file, bytes, sha256]);
        }
    });

    test('are what the worker loads', () => {
        const worker = fs.readFileSync(path.join(ROOT, 'src', 'holocron', 'layoutWorker.js'), 'utf8');
        expect(worker).toContain("'/vendor/holocron-layout/'");
        for (const { file } of manifest.files.filter((f) => f.file !== 'layout_engine.wasm')) expect(worker).toContain(`'${file}'`);
    });

    const holocron = path.join(ROOT, '..', 'Holocron VR', 'frontend', 'layout_engine.wasm');
    (fs.existsSync(holocron) ? test : test.skip)('match the Holocron build beside core', () => {
        const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'sync-holocron-layout.js'), '--check'], { encoding: 'utf8' });
        expect(check.stdout + check.stderr).toMatch(/matches Holocron/);
        expect(check.status).toBe(0);
    });
});
