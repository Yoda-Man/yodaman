const path = require('path');
const toolBox = require('../../backend/infrastructure/ToolBox');
const graphifyService = require('../../backend/infrastructure/GraphifyService');
const specDrift = require('../../backend/stardust/SpecDrift');

// impactOf resolves the path through resolveAllowedPath, so the workspace has to
// be somewhere the policy accepts. The graph itself is stubbed.
const PROJECT = process.cwd();

const GRAPH = {
    nodes: [
        { id: 'hub', source_file: 'src/hub.js' },
        { id: 'a', source_file: 'src/a.js' },
        { id: 'b', source_file: 'src/b.js' },
        { id: 'c', source_file: 'src/c.js' },
        { id: 'quiet', source_file: 'src/quiet.js' },
        { id: 'hub_test', source_file: 'tests/hub.test.js' }
    ],
    links: [
        { source: 'a', target: 'hub', relation: 'imports_from' },
        { source: 'b', target: 'hub', relation: 'imports_from' },
        { source: 'c', target: 'b', relation: 'imports_from' },
        { source: 'hub_test', target: 'hub', relation: 'imports_from' }
    ]
};

describe('ToolBox.impactOf', () => {
    const originalReadGraph = graphifyService.readGraph;
    const originalFreshness = graphifyService.freshness;
    const originalReadSpecs = specDrift.readSpecs;

    beforeEach(() => {
        graphifyService.readGraph = jest.fn(() => GRAPH);
        graphifyService.freshness = jest.fn(() => ({ stale: false }));
        specDrift.readSpecs = jest.fn(() => []);
    });

    afterEach(() => {
        graphifyService.readGraph = originalReadGraph;
        graphifyService.freshness = originalFreshness;
        specDrift.readSpecs = originalReadSpecs;
    });

    test('requires a file', async () => {
        await expect(toolBox.impactOf({ project: PROJECT })).rejects.toThrow('file is required');
    });

    test('reports dependents, covering tests and risk for a hub', async () => {
        const result = await toolBox.impactOf({ file: 'src/hub.js', project: PROJECT });

        expect(result.available).toBe(true);
        expect(result.file).toBe('src/hub.js');
        expect(result.dependentCount).toBe(3);            // a, b, and c through b
        expect(result.dependents).toContain('src/a.js');
        expect(result.testCount).toBe(1);
        expect(result.coveringTests).toEqual(['tests/hub.test.js']);
        expect(result.summary).toBeTruthy();
    });

    test('honours depth and clamps it to the useful range', async () => {
        const oneHop = await toolBox.impactOf({ file: 'src/hub.js', project: PROJECT, depth: 1 });
        expect(oneHop.depth).toBe(1);
        expect(oneHop.dependentCount).toBe(2);            // c is two hops away

        const clamped = await toolBox.impactOf({ file: 'src/hub.js', project: PROJECT, depth: 99 });
        expect(clamped.depth).toBe(4);
    });

    // The reason this tool exists: the model should learn "dependents but no
    // tests" before it proposes a write, not after the human sees the diff.
    test('advises adding a test when dependents exist and nothing covers them', async () => {
        graphifyService.readGraph = jest.fn(() => ({
            nodes: [
                { id: 'hub', source_file: 'src/hub.js' },
                { id: 'a', source_file: 'src/a.js' }
            ],
            links: [{ source: 'a', target: 'hub', relation: 'imports_from' }]
        }));

        const result = await toolBox.impactOf({ file: 'src/hub.js', project: PROJECT });
        expect(result.testCount).toBe(0);
        expect(result.advice).toMatch(/add or extend a test/);
    });

    test('names the specs describing the file', async () => {
        specDrift.readSpecs = jest.fn(() => [
            { id: 'hub-spec', file: 'openspec/specs/hub.md', text: 'src/hub.js owns routing.' }
        ]);

        const result = await toolBox.impactOf({ file: 'src/hub.js', project: PROJECT });
        expect(result.describedBy).toEqual(['hub-spec']);
        expect(result.specCount).toBe(1);
    });

    test('degrades rather than throwing when there is no graph', async () => {
        graphifyService.readGraph = jest.fn(() => { throw new Error('no graph here'); });

        const result = await toolBox.impactOf({ file: 'src/hub.js', project: PROJECT });
        expect(result.available).toBe(false);
        expect(result.reason).toBeTruthy();
        expect(result.advice).toMatch(/cannot confirm/);
    });

    // The whole result is serialized into the model's context on every remaining
    // iteration, so its size is part of the contract.
    test('stays small enough to sit in the transcript', async () => {
        const result = await toolBox.impactOf({ file: 'src/hub.js', project: PROJECT });
        expect(JSON.stringify(result).length).toBeLessThan(2000);
        expect(result.coveringTests.length).toBeLessThanOrEqual(5);
    });
});

describe('ToolBox.getToolDefinitions', () => {
    test('gives the model types and requiredness, not bare parameter names', () => {
        const docs = toolBox.getToolDefinitions();

        // The old form was `readFile(filePath)` — no type, no hint at all.
        expect(docs).toMatch(/readFile\(filePath: string\)/);
        // Optional parameters are marked, so the model stops omitting `project`
        // and silently getting the runtime's cwd.
        expect(docs).toMatch(/project\?: string/);
        expect(docs).toMatch(/depth\?: number \(hops, 1-4, default 2\)/);
    });

    // The whole block is re-sent on every reasoning step, and the model's usable
    // prompt size is the binding constraint — so what `project` means is stated
    // once at the top rather than repeated on the nine tools that take it.
    test('states shared parameter conventions once instead of per tool', () => {
        const docs = toolBox.getToolDefinitions();

        expect(docs).toContain('Parameter conventions:');
        expect(docs).toMatch(/`project` takes an absolute workspace path/);

        const repeats = (docs.match(/absolute workspace path/g) || []).length;
        expect(repeats).toBe(1);
    });

    test('caps a long plugin description so one plugin cannot dominate the prompt', () => {
        toolBox.plugins.set('verbosePlugin', {
            name: 'verbosePlugin',
            description: 'W'.repeat(2000),
            permissions: ['read'],
            parameters: {},
            execute: async () => ({}),
        });

        try {
            const docs = toolBox.getToolDefinitions();
            expect(docs).toContain('verbosePlugin()');
            expect(docs).not.toContain('W'.repeat(400));
            expect(docs).toContain('…');
        } finally {
            toolBox.plugins.delete('verbosePlugin');
        }
    });

    test('advertises impactOf as the pre-edit check', () => {
        const docs = toolBox.getToolDefinitions();
        expect(docs).toContain('impactOf(');
        expect(docs).toMatch(/BEFORE editing any file/);
    });

    test('numbers every tool exactly once', () => {
        const numbers = toolBox.getToolDefinitions()
            .split('\n')
            .filter(line => /^\d+\. /.test(line))
            .map(line => Number(line.split('.')[0]));

        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
        expect(new Set(numbers).size).toBe(numbers.length);
        expect(numbers[0]).toBe(1);
    });

    test('renders a plugin parameter map using the author-facing shape', () => {
        toolBox.plugins.set('typedPlugin', {
            name: 'typedPlugin',
            description: 'Does a typed thing.',
            permissions: ['read'],
            parameters: {
                workspacePath: { type: 'string', required: true, description: 'Absolute project path' },
                limit: { type: 'number', required: false }
            },
            execute: async () => ({}),
        });

        try {
            const docs = toolBox.getToolDefinitions();
            expect(docs).toContain('typedPlugin(workspacePath: string (Absolute project path), limit?: number)');
        } finally {
            toolBox.plugins.delete('typedPlugin');
        }
    });
});
