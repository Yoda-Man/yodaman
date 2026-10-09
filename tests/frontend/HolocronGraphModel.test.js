/**
 * Holocron's data rules: what a node is, which nodes the filters keep, how
 * search ranks, and how git history becomes heat. Pure functions over the
 * GET /api/graphify/map payload.
 */
const { buildModel, neighborhood, visibleNodes, searchNodes, heatValues, timeAgo } = require('../../src/holocron/graphModel');

const MAP = {
    totalNodes: 40,
    nodes: [
        { id: 'db', label: 'DatabaseManager', community: 7, sourceFile: 'app/core/database.py', sourceLocation: 'L41' },
        { id: 'conn', label: 'connect()', community: 7, sourceFile: 'app/core/database.py', sourceLocation: 'L60' },
        { id: 'win', label: 'MainWindow', community: 2, sourceFile: 'app/ui/main_window.py', sourceLocation: '12' },
        { id: 'test', label: 'test_database.py', community: 7, sourceFile: 'tests/test_database.py' },
        { id: 'readme', label: 'README.md', community: 2, sourceFile: 'README.md', fileType: 'document' },
        { id: 'vis', label: 'vis-network.min.js', community: 9, sourceFile: 'public/vendor/vis-network.min.js' },
        { id: 'g', label: 'g', community: 9, sourceFile: 'public/vendor/vis-network.min.js' }
    ],
    links: [
        { source: 'db', target: 'conn' },
        { source: 'db', target: 'conn' },      // repeated: one edge
        { source: 'win', target: 'db' },
        { source: 'test', target: 'db' },
        { source: 'db', target: 'db' },        // self-link: dropped
        { source: 'db', target: 'missing' }    // not in view: dropped
    ]
};

const model = buildModel(MAP);
const byId = (id) => model.nodes.find((n) => n.id === id);

describe('building the model', () => {
    test('one edge per connected pair, no self-links, nothing out of view', () => {
        expect(model.edges.length / 2).toBe(3);
        expect(model.outgoing[byId('db').index]).toEqual([byId('conn').index]);
        expect(model.incoming[byId('db').index].sort()).toEqual([byId('win').index, byId('test').index].sort());
        expect(byId('db').degree).toBe(3);
    });

    test('kind, language and line come from the label and file', () => {
        expect(byId('db')).toEqual(expect.objectContaining({ kind: 'symbol', language: 'Python', line: 41 }));
        expect(byId('conn').kind).toBe('function');
        expect(byId('test').kind).toBe('file');
        expect(byId('readme')).toEqual(expect.objectContaining({ kind: 'doc', language: 'Markdown', isDoc: true }));
        expect(byId('win').line).toBe(12);
    });

    test('tests, docs and third-party code (including minified bundles) are recognised', () => {
        expect(byId('test').isTest).toBe(true);
        expect(byId('db').isTest).toBe(false);
        expect(byId('vis').isThirdParty).toBe(true);
        expect(byId('g').isThirdParty).toBe(true);
        expect(byId('db').isThirdParty).toBe(false);
    });

    test('clusters are numbered by size and named after their best-connected member', () => {
        expect(model.clusters[0]).toEqual(expect.objectContaining({ key: '7', name: 'DatabaseManager' }));
        expect(model.clusters[0].members).toHaveLength(3);
        expect(model.clusters.map((c) => c.color)).toEqual([...new Set(model.clusters.map((c) => c.color))]);
        expect(model.totalNodes).toBe(40);
    });

    test('a node\'s neighbourhood is itself plus everything it links to or from', () => {
        expect([...neighborhood(model, byId('db').index)].sort()).toEqual(['db', 'conn', 'win', 'test'].map((id) => byId(id).index).sort());
    });
});

describe('filters', () => {
    const count = (mask) => mask.reduce((a, b) => a + b, 0);

    test('everything is visible with no filters', () => {
        expect(count(visibleNodes(model))).toBe(MAP.nodes.length);
    });

    test('each visibility toggle hides exactly its kind', () => {
        expect(visibleNodes(model, { hideTests: true })[byId('test').index]).toBe(0);
        expect(visibleNodes(model, { hideDocs: true })[byId('readme').index]).toBe(0);
        const noVendor = visibleNodes(model, { hideThirdParty: true });
        expect([noVendor[byId('vis').index], noVendor[byId('g').index], noVendor[byId('db').index]]).toEqual([0, 0, 1]);
    });

    test('language chips keep only those languages', () => {
        const python = visibleNodes(model, { languages: new Set(['Python']) });
        expect(model.nodes.filter((n) => python[n.index]).every((n) => n.language === 'Python')).toBe(true);
    });

    test('"recent changes only" needs heat, and keeps only changed nodes', () => {
        const heat = new Float32Array(model.nodes.length);
        heat[byId('win').index] = 1;
        const recent = visibleNodes(model, { recentOnly: true }, heat);
        expect(count(recent)).toBe(1);
        expect(recent[byId('win').index]).toBe(1);
    });
});

describe('search', () => {
    test('exact name beats prefix beats contains beats path', () => {
        const results = searchNodes(model, 'database');
        // "DatabaseManager" (prefix) before "test_database.py" (contains) before a path-only match.
        expect(results.map((n) => n.id).slice(0, 2)).toEqual(['db', 'test']);
        expect(searchNodes(model, 'MainWindow')[0].id).toBe('win');
        expect(searchNodes(model, '')).toEqual([]);
    });
});

describe('heat from git history', () => {
    test('matches git paths to nodes even when the workspace is a subfolder of the repo', () => {
        const { heat, changes } = heatValues(model, [
            { filePath: 'core/app/core/database.py', changeCount: 9, lastChangeDate: '2026-10-08T10:00:00Z' },
            { filePath: 'core/app/ui/main_window.py', changeCount: 1, lastChangeDate: '2026-10-01T10:00:00Z' }
        ]);
        expect(heat[byId('db').index]).toBe(1);                 // the hottest file
        expect(heat[byId('win').index]).toBeGreaterThan(0);
        expect(heat[byId('win').index]).toBeLessThan(1);
        expect(heat[byId('readme').index]).toBe(0);
        expect(changes[byId('db').index]).toEqual({ count: 9, last: '2026-10-08T10:00:00Z' });
    });

    test('no history means no heat, not an error', () => {
        expect(heatValues(model, []).heat.every((v) => v === 0)).toBe(true);
        expect(heatValues(model, undefined).heat.every((v) => v === 0)).toBe(true);
    });

    test('ages read naturally', () => {
        const now = Date.parse('2026-10-09T12:00:00Z');
        expect(timeAgo('2026-10-09T11:30:00Z', now)).toBe('30m ago');
        expect(timeAgo('2026-10-09T07:00:00Z', now)).toBe('5h ago');
        expect(timeAgo('2026-10-05T12:00:00Z', now)).toBe('4 days ago');
    });
});

describe('readable names', () => {
    const { isReadableLabel } = require('../../src/holocron/graphModel');

    test('one- and two-letter names are not titles', () => {
        for (const label of ['n', 'l', 'g()', 'Ze()', 'fs', '']) expect(isReadableLabel(label)).toBe(false);
        for (const label of ['api', 'ToolBox', 'run()', 'SearchPipeline.js']) expect(isReadableLabel(label)).toBe(true);
    });

    test('a cluster whose hub is minified is named after a readable member, or its file', () => {
        const model = buildModel({
            nodes: [
                { id: 'n', label: 'n', community: 1, sourceFile: 'frontend/bundle.js' },
                { id: 'a', label: 'a', community: 1, sourceFile: 'frontend/bundle.js' },
                { id: 'panel', label: 'createPanel()', community: 1, sourceFile: 'frontend/bundle.js' },
                { id: 'x', label: 'x', community: 2, sourceFile: 'frontend/other.js' },
                { id: 'y', label: 'y', community: 2, sourceFile: 'frontend/other.js' }
            ],
            links: [{ source: 'n', target: 'a' }, { source: 'n', target: 'panel' }, { source: 'x', target: 'y' }]
        });
        const byKey = Object.fromEntries(model.clusters.map((c) => [c.key, c]));
        expect(model.nodes[byKey['1'].hub].label).toBe('n');   // still the layout anchor
        expect(byKey['1'].name).toBe('createPanel');
        expect(byKey['2'].name).toBe('other.js');
    });
});
