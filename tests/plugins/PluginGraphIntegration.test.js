const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(rootDir, relative), 'utf8');

describe('shipped plugins use the knowledge graph', () => {
    describe('lightsaber health scoring', () => {
        const source = read('plugins/lightsaber.js');

        test('healthScore receives testCoverage, not just change and complexity', () => {
            // The only call site used to pass changeFrequency and complexityScore
            // alone, so fd.testCoverage was always undefined — always below the
            // 50 threshold — giving every file an identical 20-point penalty.
            expect(source).toContain('testCoverage:');
            expect(source).toContain('todoCount:');
            expect(source).not.toMatch(
                /healthScore\(\{\s*changeFrequency: f\.changeFrequency,\s*complexityScore: cd\.complexityScore\s*\}\)/
            );
        });

        test('coverage comes from resolved graph edges', () => {
            expect(source).toContain("require('../backend/infrastructure/GraphFacts')");
            expect(source).toContain('graphFacts.coverageByFile(');
        });

        test('per-file coverage is reported alongside the score', () => {
            expect(source).toContain('coveringTests');
            expect(source).toContain('uncoveredFiles');
        });

        test('test-coverage measures what tests reach, not a file-count ratio', () => {
            expect(source).toContain('percentCovered');
            expect(source).toContain('leastCoveredHighTraffic');
            // `ratio` is retained so existing consumers keep working.
            expect(source).toContain('ratio: percentCovered');
        });

        test('the TODO scan skips dependencies', () => {
            // Unfiltered, node_modules produced 500 hits and crowded real
            // project TODOs out past the head -500 cap entirely.
            const grepCalls = source.match(/grep -rn "TODO/g) || [];
            expect(grepCalls.length).toBeGreaterThan(0);
            const excludeCount = (source.match(/--exclude-dir=node_modules/g) || []).length;
            expect(excludeCount).toBe(grepCalls.length);
        });
    });

    describe('Droid-Sweep dead-code detection', () => {
        const source = read('plugins/Droid-Sweep.js');

        test('asks the graph rather than matching basenames', () => {
            expect(source).toContain("require('../backend/infrastructure/GraphFacts')");
            expect(source).toContain('graphFacts.orphanFiles(');
        });

        test('reports which method produced the answer', () => {
            // A regex guess and a resolved-graph answer deserve different trust,
            // so the response says which one it is.
            expect(source).toContain("method: 'knowledge-graph'");
            expect(source).toContain("method: 'text-scan-fallback'");
            expect(source).toContain("confidence: 'high'");
            expect(source).toContain("confidence: 'low'");
        });

        test('keeps the text scan only as a fallback', () => {
            // The graph answer must be returned before the text scan is reached,
            // so a workspace with a graph never falls back to regex guessing.
            const graphResult = source.indexOf("method: 'knowledge-graph'");
            const fallbackResult = source.indexOf("method: 'text-scan-fallback'");
            expect(graphResult).toBeGreaterThan(-1);
            expect(fallbackResult).toBeGreaterThan(graphResult);
            // And the fallback is guarded by the absence of a graph.
            expect(source).toMatch(/if \(facts\) \{/);
        });

        test('still reports the fields callers expect', () => {
            expect(source).toContain('totalFiles');
            expect(source).toContain('unusedCount');
            expect(source).toContain('unusedFiles');
            expect(source).toContain('filePath');
        });
    });
});

describe('Droid-Sweep against this repository', () => {
    let plugin;
    beforeAll(() => { plugin = require(path.join(rootDir, 'plugins/Droid-Sweep.js')); });

    test('uses the graph when one exists and finds no false positives among entry points', async () => {
        const result = await plugin.execute({ workspacePath: rootDir });

        expect(['knowledge-graph', 'text-scan-fallback']).toContain(result.method);
        if (result.method !== 'knowledge-graph') return; // no graph in this environment

        const flagged = result.unusedFiles.map(f => f.filePath);
        // Every one of these is launched by a host rather than imported.
        expect(flagged).not.toContain('server.js');
        expect(flagged).not.toContain('electron/main.js');
        expect(flagged).not.toContain('electron/preload.js');
        expect(flagged).not.toContain('extensions/vscode-yodaman/src/extension.js');
    });
});
