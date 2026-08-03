const path = require('path');
const graphifyService = require('../../backend/infrastructure/GraphifyService');
const graphFacts = require('../../backend/infrastructure/GraphFacts');

const PROJECT = path.join(path.sep, 'workspace', 'demo');

const GRAPH = {
    nodes: [
        { id: 'server', source_file: 'server.js' },
        { id: 'core', source_file: 'src/core.js' },
        { id: 'helper', source_file: 'src/helper.js' },
        { id: 'orphan', source_file: 'src/abandoned.js' },
        { id: 'readme', source_file: 'README.md' },
        { id: 'coretest', source_file: 'tests/core.test.js' },
        { id: 'electronmain', source_file: 'electron/main.js' },
        { id: 'vscode', source_file: 'extensions/vscode-yodaman/src/extension.js' }
    ],
    links: [
        { source: 'server', target: 'core', relation: 'imports_from' },
        { source: 'core', target: 'helper', relation: 'imports_from' },
        { source: 'coretest', target: 'core', relation: 'imports_from' },
        // abandoned.js imports something but nothing imports it
        { source: 'orphan', target: 'helper', relation: 'imports_from' },
        { source: 'core', target: 'core', relation: 'contains' }
    ]
};

describe('GraphFacts', () => {
    const originalReadGraph = graphifyService.readGraph;

    beforeEach(() => { graphifyService.readGraph = jest.fn(() => GRAPH); });
    afterEach(() => { graphifyService.readGraph = originalReadGraph; });

    describe('load', () => {
        test('builds file-level adjacency in both directions', () => {
            const facts = graphFacts.load(PROJECT);

            expect(facts.dependsOn.get('server.js')).toContain('src/core.js');
            expect(facts.dependedOnBy.get('src/core.js')).toContain('server.js');
            expect(facts.files.has('src/helper.js')).toBe(true);
        });

        test('returns null rather than throwing when there is no graph', () => {
            graphifyService.readGraph = jest.fn(() => { throw new Error('no graph'); });
            expect(graphFacts.load(PROJECT)).toBeNull();
        });
    });

    describe('orphanFiles', () => {
        test('finds files nothing imports', () => {
            const orphans = graphFacts.orphanFiles(PROJECT).map(o => o.file);
            expect(orphans).toContain('src/abandoned.js');
        });

        test('never reports a file that something imports', () => {
            const orphans = graphFacts.orphanFiles(PROJECT).map(o => o.file);
            expect(orphans).not.toContain('src/core.js');
            expect(orphans).not.toContain('src/helper.js');
        });

        test('excludes host-launched entry points', () => {
            // Nothing in the repo imports these — Electron and VS Code launch
            // them — so reporting them as dead code is a false positive.
            const orphans = graphFacts.orphanFiles(PROJECT).map(o => o.file);
            expect(orphans).not.toContain('server.js');
            expect(orphans).not.toContain('electron/main.js');
            expect(orphans).not.toContain('extensions/vscode-yodaman/src/extension.js');
        });

        test('excludes tests by default, since a runner loads them', () => {
            expect(graphFacts.orphanFiles(PROJECT).map(o => o.file)).not.toContain('tests/core.test.js');
            expect(graphFacts.orphanFiles(PROJECT, { includeTests: true }).map(o => o.file))
                .toContain('tests/core.test.js');
        });

        test('honours an extension filter so docs are not reported as dead code', () => {
            const codeOnly = graphFacts.orphanFiles(PROJECT, { extensions: ['.js', '.jsx'] }).map(o => o.file);
            expect(codeOnly).not.toContain('README.md');
            expect(codeOnly).toContain('src/abandoned.js');
        });

        test('ranks files that still import things first — real abandoned work', () => {
            const orphans = graphFacts.orphanFiles(PROJECT, { extensions: ['.js'] });
            expect(orphans[0].file).toBe('src/abandoned.js');
            expect(orphans[0].imports).toBe(1);
        });
    });

    describe('coverageByFile', () => {
        test('maps a source file to the tests that reach it', () => {
            const coverage = graphFacts.coverageByFile(PROJECT);
            expect(coverage.get('src/core.js')).toEqual(['tests/core.test.js']);
        });

        test('follows transitive imports up to the depth limit', () => {
            // The test imports core, which imports helper — so helper is covered.
            expect(graphFacts.coverageByFile(PROJECT).get('src/helper.js')).toEqual(['tests/core.test.js']);
        });

        test('reports nothing for a file no test reaches', () => {
            expect(graphFacts.coverageByFile(PROJECT).has('src/abandoned.js')).toBe(false);
        });

        test('does not record test files as covered by themselves', () => {
            expect(graphFacts.coverageByFile(PROJECT).has('tests/core.test.js')).toBe(false);
        });
    });

    describe('centralFiles', () => {
        test('ranks by connection count', () => {
            const central = graphFacts.centralFiles(PROJECT, { limit: 3 });
            expect(central[0].file).toBe('src/core.js'); // 3 edges
            expect(central[0].connections).toBeGreaterThanOrEqual(central[1].connections);
        });

        test('reports how many files depend on each', () => {
            const core = graphFacts.centralFiles(PROJECT).find(c => c.file === 'src/core.js');
            expect(core.dependents).toBe(2); // server.js and the test
        });
    });

    describe('containment edges', () => {
        test('are never treated as dependencies', () => {
            // `contains` links a file to its own symbols; counting it would make
            // every file depend on itself and inflate all centrality figures.
            const facts = graphFacts.load(PROJECT);
            expect(facts.dependsOn.get('src/core.js')).not.toContain('src/core.js');
        });
    });
});
