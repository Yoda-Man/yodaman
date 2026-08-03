const path = require('path');
const graphifyService = require('../../backend/infrastructure/GraphifyService');
const impactAnalyzer = require('../../backend/infrastructure/ImpactAnalyzer');

const PROJECT = path.join(path.sep, 'workspace', 'demo');

// Mirrors the real graph shape: `source_file` is repo-relative, dependency
// edges are `imports_from`/`calls`, and containment uses `contains`/`method`.
const GRAPH = {
    nodes: [
        { id: 'core', source_file: 'src/core.js' },
        { id: 'core_fn', source_file: 'src/core.js' },
        { id: 'api', source_file: 'src/api.js' },
        { id: 'ui', source_file: 'src/ui.js' },
        { id: 'deep', source_file: 'src/deep.js' },
        { id: 'core_test', source_file: 'tests/core.test.js' },
        { id: 'sibling', source_file: 'src/core.js' },
        { id: 'unrelated', source_file: 'src/other.js' }
    ],
    links: [
        // api and the test depend directly on core (1 hop)
        { source: 'api', target: 'core_fn', relation: 'imports_from' },
        { source: 'core_test', target: 'core_fn', relation: 'imports_from' },
        // ui depends on api (2 hops from core)
        { source: 'ui', target: 'api', relation: 'calls' },
        // deep depends on ui (3 hops — outside the default depth)
        { source: 'deep', target: 'ui', relation: 'imports_from' },
        // containment must NOT count as a dependency
        { source: 'core', target: 'sibling', relation: 'contains' },
        { source: 'core', target: 'core_fn', relation: 'method' }
    ]
};

describe('ImpactAnalyzer', () => {
    const originalReadGraph = graphifyService.readGraph;
    const originalFreshness = graphifyService.freshness;

    beforeEach(() => {
        graphifyService.readGraph = jest.fn(() => GRAPH);
        graphifyService.freshness = jest.fn(() => ({ stale: false }));
    });

    afterEach(() => {
        graphifyService.readGraph = originalReadGraph;
        graphifyService.freshness = originalFreshness;
    });

    test('finds direct and transitive dependents within the depth limit', () => {
        const report = impactAnalyzer.analyzeFile(PROJECT, 'src/core.js');

        expect(report.available).toBe(true);
        const files = report.dependentFiles.map(entry => entry.file);
        expect(files).toContain('src/api.js');   // 1 hop
        expect(files).toContain('src/ui.js');    // 2 hops
        expect(files).not.toContain('src/deep.js'); // 3 hops — beyond depth 2
    });

    test('does not treat containment as a dependency', () => {
        const report = impactAnalyzer.analyzeFile(PROJECT, 'src/core.js');
        // `sibling` lives in the changed file itself and is only reachable via
        // `contains`; counting it would inflate every blast radius.
        expect(report.dependentFiles.map(e => e.file)).not.toContain('src/core.js');
        expect(report.impactedCount).toBe(2);
    });

    test('separates covering tests from impacted source files', () => {
        const report = impactAnalyzer.analyzeFile(PROJECT, 'src/core.js');

        expect(report.coveringTests).toEqual(['tests/core.test.js']);
        expect(report.testCount).toBe(1);
        expect(report.impactedCount).toBe(2);
        expect(report.topDependents).not.toContain('tests/core.test.js');
    });

    test('ignores files with no dependents', () => {
        const report = impactAnalyzer.analyzeFile(PROJECT, 'src/other.js');
        expect(report.available).toBe(true);
        expect(report.impactedCount).toBe(0);
        expect(report.risk).toBe('low');
    });

    test('accepts an absolute path and normalizes it', () => {
        const absolute = path.join(PROJECT, 'src', 'core.js');
        const report = impactAnalyzer.analyzeFile(PROJECT, absolute);
        expect(report.targetFile).toBe('src/core.js');
        expect(report.available).toBe(true);
    });

    test('honours a custom depth', () => {
        const shallow = impactAnalyzer.analyzeFile(PROJECT, 'src/core.js', { depth: 1 });
        expect(shallow.dependentFiles.map(e => e.file)).not.toContain('src/ui.js');

        const deep = impactAnalyzer.analyzeFile(PROJECT, 'src/core.js', { depth: 3 });
        expect(deep.dependentFiles.map(e => e.file)).toContain('src/deep.js');
    });

    test('degrades gracefully when no graph exists', () => {
        graphifyService.readGraph = jest.fn(() => { throw new Error('graph not found'); });
        const report = impactAnalyzer.analyzeFile(PROJECT, 'src/core.js');

        expect(report.available).toBe(false);
        expect(report.reason).toMatch(/no graph/i);
        // Must never throw — the approval prompt has to render regardless.
        expect(impactAnalyzer.summarize(report)).toMatch(/impact unknown/);
    });

    test('reports a file the graph has never seen', () => {
        const report = impactAnalyzer.analyzeFile(PROJECT, 'src/brand-new.js');
        expect(report.available).toBe(false);
        expect(report.reason).toMatch(/not represented/);
    });

    test('flags a stale graph so the number is not trusted blindly', () => {
        graphifyService.freshness = jest.fn(() => ({ stale: true }));
        const report = impactAnalyzer.analyzeFile(PROJECT, 'src/core.js');
        expect(report.stale).toBe(true);
        expect(impactAnalyzer.summarize(report)).toMatch(/graph stale/);
    });

    describe('risk assessment', () => {
        test('wide reach with no tests is the case a reviewer must not miss', () => {
            expect(impactAnalyzer.assessRisk(6, 0)).toBe('high');
        });

        test('narrow reach with no tests is moderate', () => {
            expect(impactAnalyzer.assessRisk(2, 0)).toBe('moderate');
        });

        test('covered changes stay low until reach gets large', () => {
            expect(impactAnalyzer.assessRisk(3, 2)).toBe('low');
            expect(impactAnalyzer.assessRisk(20, 2)).toBe('moderate');
        });

        test('a change nothing depends on is low risk', () => {
            expect(impactAnalyzer.assessRisk(0, 0)).toBe('low');
        });
    });

    describe('test-file detection', () => {
        test.each([
            'tests/core.test.js',
            'test/core.js',
            '__tests__/core.js',
            'src/core.spec.ts',
            'app/models_test.py',
            'app/test_models.py'
        ])('%s is a test file', (file) => {
            expect(impactAnalyzer.isTestFile(file)).toBe(true);
        });

        test.each(['src/core.js', 'lib/latest.js', 'src/contest.js'])('%s is not a test file', (file) => {
            expect(impactAnalyzer.isTestFile(file)).toBe(false);
        });
    });
});
