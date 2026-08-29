const path = require('path');
const graphifyService = require('../../backend/infrastructure/GraphifyService');
const specDrift = require('../../backend/stardust/SpecDrift');
const stardustBrief = require('../../backend/core/StardustBrief');

const PROJECT = path.join(path.sep, 'workspace', 'demo');

// Same shape as the real graph: repo-relative `source_file`, `imports_from`
// dependency edges. ToolBox.js is the hub — three files import it — and it has
// one covering test.
const GRAPH = {
    nodes: [
        { id: 'toolbox', source_file: 'backend/infrastructure/ToolBox.js' },
        { id: 'engine', source_file: 'backend/core/AgentReasoningEngine.js' },
        { id: 'rest', source_file: 'backend/interfaces/RestController.js' },
        { id: 'server', source_file: 'server.js' },
        { id: 'toolbox_test', source_file: 'tests/infrastructure/ToolBox.test.js' },
        { id: 'lonely', source_file: 'backend/utils/lonely.js' }
    ],
    links: [
        { source: 'engine', target: 'toolbox', relation: 'imports_from' },
        { source: 'rest', target: 'toolbox', relation: 'imports_from' },
        { source: 'server', target: 'rest', relation: 'imports_from' },
        { source: 'toolbox_test', target: 'toolbox', relation: 'imports_from' }
    ]
};

describe('StardustBrief', () => {
    const originalReadGraph = graphifyService.readGraph;
    const originalFreshness = graphifyService.freshness;
    const originalReadReport = graphifyService.readReport;
    const originalReadSpecs = specDrift.readSpecs;

    beforeEach(() => {
        graphifyService.readGraph = jest.fn(() => GRAPH);
        graphifyService.freshness = jest.fn(() => ({ stale: false }));
        graphifyService.readReport = jest.fn(() => '');
        specDrift.readSpecs = jest.fn(() => []);
    });

    afterEach(() => {
        graphifyService.readGraph = originalReadGraph;
        graphifyService.freshness = originalFreshness;
        graphifyService.readReport = originalReadReport;
        specDrift.readSpecs = originalReadSpecs;
    });

    test('is empty without a workspace', async () => {
        const brief = await stardustBrief.build('', 'do something');
        expect(brief.text).toBe('');
        expect(brief.available).toBe(false);
    });

    test('reports the graph shape and the busiest modules', async () => {
        const { text } = await stardustBrief.build(PROJECT, 'explain the architecture');

        expect(text).toContain('STARDUST BRIEF');
        expect(text).toMatch(/Graphify: 6 files, 4 dependency edges/);
        expect(text).toContain('backend/infrastructure/ToolBox.js (3 dependents)');
    });

    test('warns when the graph is stale rather than presenting it as current', async () => {
        graphifyService.freshness = jest.fn(() => ({ stale: true }));

        const { text } = await stardustBrief.build(PROJECT, 'anything');
        expect(text).toContain('GRAPH IS STALE');
    });

    test('says so when there is no graph, instead of implying nothing depends on anything', async () => {
        graphifyService.readGraph = jest.fn(() => { throw new Error('no graph'); });

        const { text } = await stardustBrief.build(PROJECT, 'anything');
        expect(text).toContain('no knowledge graph for this workspace yet');
    });

    // The point of the brief: a file named in the task arrives already analyzed,
    // so the model is not planning blind and does not have to spend a turn asking.
    test('resolves a file named by basename and reports its blast radius up front', async () => {
        const { text, focusCount } = await stardustBrief.build(PROJECT, 'refactor ToolBox.js to be smaller');

        expect(focusCount).toBe(1);
        expect(text).toContain('backend/infrastructure/ToolBox.js');
        // engine and rest import it directly; server reaches it through rest.
        // The covering test is counted separately, not as a dependent.
        expect(text).toMatch(/3 dependents within 2 hops/);
        expect(text).toMatch(/1 covering test/);
    });

    test('resolves a file named by path suffix', async () => {
        const { text } = await stardustBrief.build(PROJECT, 'look at infrastructure/ToolBox.js');
        expect(text).toContain('backend/infrastructure/ToolBox.js');
    });

    test('flags a named file with no covering tests', async () => {
        const { text } = await stardustBrief.build(PROJECT, 'change backend/utils/lonely.js');
        expect(text).toMatch(/NO covering tests/);
    });

    test('does not invent files the graph has never seen', async () => {
        const { text, focusCount } = await stardustBrief.build(PROJECT, 'fix imaginary/nowhere.js');
        expect(focusCount).toBe(0);
        expect(text).not.toContain('imaginary/nowhere.js');
    });

    test('names the specs describing a file, and reports drift, when OpenSpec has specs', async () => {
        specDrift.readSpecs = jest.fn(() => [
            { id: 'tooling', file: 'openspec/specs/tooling.md', text: 'The runtime loads backend/infrastructure/ToolBox.js at startup.' }
        ]);

        const { text } = await stardustBrief.build(PROJECT, 'refactor ToolBox.js');
        expect(text).toMatch(/OpenSpec: 1 spec \(tooling\)/);
        expect(text).toContain('described by tooling');
        // Drift is reported because the pre-read specs are handed to detectDrift;
        // reading them a second time from disk would find nothing here.
        expect(text).toMatch(/Drift: 0 stale reference\(s\), 0 load-bearing module\(s\)/);
    });

    test('names undocumented hubs so the model does not add a second implementation', async () => {
        specDrift.readSpecs = jest.fn(() => [
            { id: 'unrelated', file: 'openspec/specs/unrelated.md', text: 'Nothing to do with the hub.' }
        ]);

        const { text } = await stardustBrief.build(PROJECT, 'add a feature');
        expect(text).toMatch(/Undocumented hubs[^\n]*backend\/infrastructure\/ToolBox\.js \(3 dependents\)/);
    });

    test('gives a brand-new user the coverage finding, not a setup chore', async () => {
        // The first-use case, and the one that matters most. A workspace with
        // no specs used to get one sentence — "no specs written" — and nothing
        // else. That withheld the product's most distinctive output from
        // exactly the people who had set nothing up, and left them a chore
        // instead of a finding.
        specDrift.readSpecs = jest.fn(() => []);

        const { text } = await stardustBrief.build(PROJECT, 'add a feature');

        // Still says specs are absent — that is true and worth knowing.
        expect(text).toMatch(/no specs written/);
        // But leads to the measurement, and names the modules by hand.
        expect(text).toMatch(/load-bearing module\(s\) carry this codebase/);
        expect(text).toMatch(/Undocumented hubs[^\n]*backend\/infrastructure\/ToolBox\.js \(3 dependents\)/);
    });

    test('reads the specs once, not once per consumer', async () => {
        specDrift.readSpecs = jest.fn(() => [
            { id: 'tooling', file: 'openspec/specs/tooling.md', text: 'ToolBox.js' }
        ]);

        await stardustBrief.build(PROJECT, 'refactor ToolBox.js');
        expect(specDrift.readSpecs).toHaveBeenCalledTimes(1);
    });

    test('says nothing constrains the change when no specs exist', async () => {
        const { text } = await stardustBrief.build(PROJECT, 'anything');
        expect(text).toContain('no specs written for this workspace');
    });

    // The old context was a blind 4,000-character head slice of GRAPH_REPORT.md.
    // On a real report that is mostly the Obsidian navigation index — 300 lines of
    // [[_COMMUNITY_Community N]] links — so the budget bought nothing.
    test('keeps the report sections that say something and drops the navigation index', async () => {
        graphifyService.readReport = jest.fn(() => [
            '# Graph Report - /workspace/demo',
            '',
            '## Corpus Check',
            '- cluster-only mode — file stats not available',
            '',
            '## Community Hubs (Navigation)',
            ...Array.from({ length: 300 }, (_, i) => `- [[_COMMUNITY_Community ${i}|Community ${i}]]`),
            '',
            '## God Nodes (most connected - your core abstractions)',
            '1. `GameState` - 52 edges',
            '',
            '## Surprising Connections (you probably didn\'t know these)',
            '- `bool` --uses--> `MessageBuffer`  [INFERRED]',
        ].join('\n'));

        const { text } = await stardustBrief.build(PROJECT, 'anything');

        expect(text).toContain('God Nodes');
        expect(text).toContain('GameState` - 52 edges');
        expect(text).toContain('Surprising Connections');
        expect(text).not.toContain('_COMMUNITY_Community');
        expect(text).not.toContain('Corpus Check');
    });

    test('falls back to a head slice if the report headings ever change', async () => {
        graphifyService.readReport = jest.fn(() => 'A totally different report format.\n'.repeat(200));

        const { text } = await stardustBrief.build(PROJECT, 'anything');
        expect(text).toContain('A totally different report format.');
        expect(text.length).toBeLessThan(4000);
    });

    test('omits the background section entirely when there is no report', async () => {
        graphifyService.readReport = jest.fn(() => '');

        const { text } = await stardustBrief.build(PROJECT, 'anything');
        expect(text).not.toContain('Graph findings');
    });

    test('tells the model to check impact for files the brief does not cover', async () => {
        const { text } = await stardustBrief.build(PROJECT, 'anything');
        expect(text).toContain('Call impactOf(file, project)');
    });
});
