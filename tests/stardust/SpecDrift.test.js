const fs = require('fs');
const os = require('os');
const path = require('path');
const specDrift = require('../../backend/stardust/SpecDrift');

function makeWorkspace(specs = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-drift-'));
    const specsDir = path.join(root, 'openspec', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), 'version: 1\n');
    for (const [name, body] of Object.entries(specs)) {
        fs.writeFileSync(path.join(specsDir, name), body);
    }
    return root;
}

/** Stand-in for GraphFacts.load(), so tests never depend on a built graph. */
function fakeFacts(files, dependents = {}) {
    return {
        files: new Set(files),
        dependedOnBy: new Map(Object.entries(dependents).map(([file, list]) => [file, new Set(list)])),
        dependsOn: new Map(),
        degree: new Map(),
        nodeCount: files.length,
        linkCount: 0
    };
}

describe('SpecDrift', () => {
    const workspaces = [];
    afterAll(() => workspaces.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
    const workspace = (specs) => { const dir = makeWorkspace(specs); workspaces.push(dir); return dir; };

    describe('extractReferences', () => {
        test('finds paths in backticks, plain prose, and lists', () => {
            const refs = specDrift.extractReferences(
                'Auth lives in `src/services/auth.js` and routes in src/routes/index.js.\n- lib/util.ts'
            );
            expect(refs).toContain('src/services/auth.js');
            expect(refs).toContain('src/routes/index.js');
            expect(refs).toContain('lib/util.ts');
        });

        test('ignores prose that merely looks pathish', () => {
            const refs = specDrift.extractReferences('We use e.g. version 1.2 and the word auth.');
            expect(refs).toEqual([]);
        });

        test('ignores boilerplate that every spec cites', () => {
            const refs = specDrift.extractReferences('See README.md and package.json, plus node_modules/foo/index.js');
            expect(refs).toEqual([]);
        });

        test('handles empty and nullish input', () => {
            expect(specDrift.extractReferences('')).toEqual([]);
            expect(specDrift.extractReferences(null)).toEqual([]);
        });
    });

    describe('findOpenSpecRoot / readSpecs', () => {
        test('locates an initialized OpenSpec directory', () => {
            const root = workspace({ 'a.md': '# A' });
            expect(specDrift.findOpenSpecRoot(root)).toBe(path.join(root, 'openspec'));
        });

        test('returns null when OpenSpec is absent', () => {
            const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-bare-'));
            workspaces.push(bare);
            expect(specDrift.findOpenSpecRoot(bare)).toBeNull();
            expect(specDrift.readSpecs(bare)).toEqual([]);
        });

        test('reads nested spec files', () => {
            const root = workspace({ 'top.md': '# Top' });
            const nested = path.join(root, 'openspec', 'specs', 'area');
            fs.mkdirSync(nested, { recursive: true });
            fs.writeFileSync(path.join(nested, 'deep.md'), '# Deep');

            expect(specDrift.readSpecs(root).map(s => s.id).sort()).toEqual(['area/deep.md', 'top.md']);
        });
    });

    describe('detectDrift', () => {
        test('flags a spec citing a file the graph has never seen', () => {
            // The real case this was built for: a file is deleted and the spec
            // that describes it silently becomes a lie about the codebase.
            const root = workspace({ 'runtime.md': 'Defined in server.js. Removed: old/gone.js' });
            const report = specDrift.detectDrift(root, { facts: fakeFacts(['server.js']) });

            expect(report.available).toBe(true);
            expect(report.staleReferences).toEqual([{ spec: 'runtime.md', reference: 'old/gone.js' }]);
            expect(report.inSync).toBe(false);
        });

        test('accepts a reference cited by basename alone', () => {
            // Specs often say "Logger.js", not the full path. Calling that stale
            // would make the report noise.
            const root = workspace({ 'log.md': 'Logging goes through Logger.js.' });
            const report = specDrift.detectDrift(root, {
                facts: fakeFacts(['backend/infrastructure/Logger.js'])
            });

            expect(report.staleReferences).toEqual([]);
        });

        test('flags load-bearing modules no spec describes', () => {
            const root = workspace({ 'a.md': 'Only mentions server.js.' });
            const report = specDrift.detectDrift(root, {
                facts: fakeFacts(['server.js', 'src/hub.js'], { 'src/hub.js': ['a', 'b', 'c'] })
            });

            expect(report.undocumented).toEqual([{ file: 'src/hub.js', dependents: 3 }]);
        });

        test('ignores modules below the dependent threshold', () => {
            const root = workspace({ 'a.md': 'Only server.js.' });
            const report = specDrift.detectDrift(root, {
                facts: fakeFacts(['server.js', 'src/leaf.js'], { 'src/leaf.js': ['a'] }),
                minDependents: 2
            });

            expect(report.undocumented).toEqual([]);
        });

        test('reports in sync when specs and code agree', () => {
            const root = workspace({ 'a.md': 'Everything is in server.js.' });
            const report = specDrift.detectDrift(root, { facts: fakeFacts(['server.js']) });

            expect(report.inSync).toBe(true);
            expect(specDrift.formatDrift(report)).toMatch(/Specs and code agree/);
        });

        test('ranks undocumented modules by how much depends on them', () => {
            const root = workspace({ 'a.md': 'Nothing relevant.' });
            const report = specDrift.detectDrift(root, {
                facts: fakeFacts(['big.js', 'small.js'], { 'big.js': ['a', 'b', 'c'], 'small.js': ['a', 'b'] })
            });

            expect(report.undocumented[0].file).toBe('big.js');
        });
    });

    describe('graceful degradation', () => {
        test('explains that OpenSpec is not initialized', () => {
            const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-noospec-'));
            workspaces.push(bare);
            const report = specDrift.detectDrift(bare, { facts: fakeFacts(['server.js']) });

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/not initialized/);
            expect(report.reason).toContain('openspec init');
        });

        test('explains that OpenSpec has no specs yet', () => {
            const root = workspace({});
            const report = specDrift.detectDrift(root, { facts: fakeFacts(['server.js']) });

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/no specs have been written/);
        });

        test('explains a missing graph without throwing', () => {
            const root = workspace({ 'a.md': '# A' });
            // No facts supplied and no real graph on disk for a temp dir.
            const report = specDrift.detectDrift(root);

            expect(report.available).toBe(false);
            expect(report.reason).toMatch(/no knowledge graph/);
            expect(specDrift.formatDrift(report)).toMatch(/unavailable/);
        });
    });
});
