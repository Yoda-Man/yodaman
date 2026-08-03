const path = require('path');
const graphifyService = require('../../backend/infrastructure/GraphifyService');
const graphRanker = require('../../backend/infrastructure/GraphRanker');

const PROJECT = path.join(path.sep, 'workspace', 'demo');

// logger is depended on by three files; noise.json is in no graph edge at all.
const GRAPH = {
    nodes: [
        { id: 'logger', source_file: 'src/logger.js' },
        { id: 'engine', source_file: 'src/engine.js' },
        { id: 'queue', source_file: 'src/queue.js' },
        { id: 'api', source_file: 'src/api.js' },
        { id: 'far', source_file: 'src/far.js' },
        { id: 'noise', source_file: 'vendor/noise.json' }
    ],
    links: [
        { source: 'engine', target: 'logger', relation: 'imports_from' },
        { source: 'queue', target: 'logger', relation: 'imports_from' },
        { source: 'api', target: 'logger', relation: 'calls' },
        { source: 'api', target: 'engine', relation: 'imports_from' },
        { source: 'far', target: 'noise', relation: 'contains' }
    ]
};

/** ctx's filesystem fallback returns an identical score for every hit. */
function flatResults(files) {
    return files.map(file => ({
        content: `snippet from ${file}`,
        score: 0.65,
        metadata: { path: path.join(PROJECT, file), line: 1 }
    }));
}

function files(results) {
    return results.map(r => path.relative(PROJECT, r.metadata.path).split(path.sep).join('/'));
}

describe('GraphRanker', () => {
    const originalReadGraph = graphifyService.readGraph;

    beforeEach(() => {
        graphifyService.readGraph = jest.fn(() => GRAPH);
    });

    afterEach(() => {
        graphifyService.readGraph = originalReadGraph;
    });

    test('promotes a central file that flat semantic scoring buried', () => {
        // Real observed failure: every ctx score ties, so ordering collapses to
        // alphabetical and the file you actually wanted lands last.
        const input = flatResults(['README.md', 'vendor/noise.json', 'src/engine.js', 'src/logger.js']);
        const ranked = files(graphRanker.rerank(PROJECT, input));

        expect(ranked[0]).toBe('src/logger.js');
        expect(ranked.indexOf('vendor/noise.json')).toBeGreaterThan(ranked.indexOf('src/engine.js'));
    });

    test('ranks files near the active file above unrelated ones', () => {
        const input = flatResults(['README.md', 'src/far.js', 'src/queue.js']);
        const ranked = files(graphRanker.rerank(PROJECT, input, { activeFile: 'src/logger.js' }));

        // queue.js is one hop from logger.js; README is not in the graph.
        expect(ranked.indexOf('src/queue.js')).toBeLessThan(ranked.indexOf('README.md'));
    });

    test('accepts an absolute active file path', () => {
        const input = flatResults(['README.md', 'src/queue.js']);
        const absolute = path.join(PROJECT, 'src', 'logger.js');
        const ranked = files(graphRanker.rerank(PROJECT, input, { activeFile: absolute }));

        expect(ranked[0]).toBe('src/queue.js');
    });

    test('a strong semantic score is not buried by structure', () => {
        const input = [
            { score: 1.0, metadata: { path: path.join(PROJECT, 'README.md') } },
            { score: 0.1, metadata: { path: path.join(PROJECT, 'src/logger.js') } }
        ];
        const ranked = files(graphRanker.rerank(PROJECT, input));

        // Semantic weight (0.6) must dominate centrality (0.15).
        expect(ranked[0]).toBe('README.md');
    });

    test('attaches the graph signal for observability', () => {
        const ranked = graphRanker.rerank(PROJECT, flatResults(['src/logger.js', 'README.md']), {
            activeFile: 'src/logger.js'
        });
        const logger = ranked.find(r => r.metadata.path.endsWith('logger.js'));

        expect(logger.graphSignal).toEqual(expect.objectContaining({ inGraph: true, hops: 0 }));
        expect(typeof logger.graphRank).toBe('number');
    });

    test('never drops or duplicates results', () => {
        const input = flatResults(['a.js', 'src/logger.js', 'src/api.js', 'b.js']);
        const ranked = graphRanker.rerank(PROJECT, input);

        expect(ranked).toHaveLength(input.length);
        expect(new Set(files(ranked)).size).toBe(input.length);
    });

    describe('graceful degradation', () => {
        test('returns input untouched when no graph exists', () => {
            graphifyService.readGraph = jest.fn(() => { throw new Error('no graph'); });
            const input = flatResults(['README.md', 'src/logger.js']);

            expect(graphRanker.rerank(PROJECT, input)).toBe(input);
        });

        test('returns input untouched when the graph knows none of the hits', () => {
            const input = flatResults(['totally/unknown.js', 'another/unknown.js']);
            // Reordering on zero signal would be noise, not ranking.
            expect(graphRanker.rerank(PROJECT, input)).toBe(input);
        });

        test('handles empty, single and non-array input', () => {
            expect(graphRanker.rerank(PROJECT, [])).toEqual([]);
            const one = flatResults(['src/logger.js']);
            expect(graphRanker.rerank(PROJECT, one)).toBe(one);
            expect(graphRanker.rerank(PROJECT, null)).toEqual([]);
        });

        test('requires a project path', () => {
            const input = flatResults(['src/logger.js', 'README.md']);
            expect(graphRanker.rerank(undefined, input)).toBe(input);
        });

        test('tolerates results with no path metadata', () => {
            const input = [
                { score: 0.5, metadata: {} },
                { score: 0.4, metadata: { path: path.join(PROJECT, 'src/logger.js') } }
            ];
            expect(() => graphRanker.rerank(PROJECT, input)).not.toThrow();
            expect(graphRanker.rerank(PROJECT, input)).toHaveLength(2);
        });
    });

    describe('buildIndex', () => {
        test('counts degree only across dependency edges', () => {
            const index = graphRanker.buildIndex(PROJECT);
            // logger has three dependents; containment edges are excluded so
            // vendor/noise.json contributes no degree at all.
            expect(index.degreeByFile.get('src/logger.js')).toBe(3);
            expect(index.degreeByFile.has('vendor/noise.json')).toBe(false);
        });

        test('returns null when the graph cannot be read', () => {
            graphifyService.readGraph = jest.fn(() => { throw new Error('nope'); });
            expect(graphRanker.buildIndex(PROJECT)).toBeNull();
        });
    });
});
