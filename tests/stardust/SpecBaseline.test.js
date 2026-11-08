/**
 * Baseline spec drafting: grouping by the graph, retrieval through the
 * pipeline, and a draft OpenSpec accepts. Drafting must never write a file;
 * the engine's approval gate does that (tests/core/SpecDraftRoute.test.js).
 */
jest.mock('../../backend/core/SearchPipeline', () => ({ search: jest.fn() }));
jest.mock('../../backend/infrastructure/ContextEngine', () => ({ ask: jest.fn() }));
jest.mock('../../backend/infrastructure/GraphFacts', () => ({ load: jest.fn() }));
jest.mock('../../backend/infrastructure/Logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const searchPipeline = require('../../backend/core/SearchPipeline');
const contextEngine = require('../../backend/infrastructure/ContextEngine');
const graphFacts = require('../../backend/infrastructure/GraphFacts');
const { groupCapabilities, parseRequirements, draftSpecs } = require('../../backend/stardust/SpecBaseline');

/** A minimal GraphFacts shape: files plus who depends on each. */
function facts(dependents) {
    return {
        files: new Set(Object.keys(dependents)),
        dependedOnBy: new Map(Object.entries(dependents).map(([file, n]) => [file, new Set(Array.from({ length: n }, (_, i) => `x${i}`))])),
    };
}

const GOOD_ANSWER = [
    '```markdown',
    '### Requirement: Rank results',
    'The system SHALL rank every search with the knowledge graph.',
    '',
    '#### Scenario: Ranked search',
    '- **WHEN** a user searches',
    '- **THEN** results are ordered by the blended score',
    '```',
].join('\n');

describe('groupCapabilities', () => {
    const graph = facts({
        'backend/core/Search.js': 2,
        'backend/core/Brief.js': 0,
        'src/components/App.jsx': 5,       // outweighs backend/core, though it sorts after it by name
        'src/components/Button.jsx': 1,
        'tests/core/Search.test.js': 9,    // tests describe nothing a spec promises
        'backend/core/README.md': 9,       // not code
        'server.js': 9,                    // root file: no module
    });

    test('groups by top-level module, most depended-on first', () => {
        expect(groupCapabilities(graph)).toEqual([
            { capability: 'src-components', module: 'src/components', weight: 6, files: ['src/components/App.jsx', 'src/components/Button.jsx'] },
            { capability: 'backend-core', module: 'backend/core', weight: 2, files: ['backend/core/Search.js', 'backend/core/Brief.js'] },
        ]);
    });

    test('caps the number of capabilities', () => {
        expect(groupCapabilities(graph, { maxGroups: 1 }).map(g => g.capability)).toEqual(['src-components']);
    });

    test('returns nothing without a graph', () => {
        expect(groupCapabilities(null)).toEqual([]);
    });
});

describe('parseRequirements', () => {
    test('keeps blocks with SHALL and a scenario, and strips code fences', () => {
        const kept = parseRequirements(GOOD_ANSWER);
        expect(kept).toHaveLength(1);
        expect(kept[0]).toMatch(/^### Requirement: Rank results\nThe system SHALL/);
        expect(kept[0]).not.toContain('```');
    });

    // Shape captured from qwen3.5:9b through ctx: no space after the colons, a
    // "Code:" section after each scenario, and the last block cut off by ctx's timeout.
    test('handles a real local-model answer', () => {
        const text = [
            'Searching core...',
            '',
            '### Requirement:StructuredLogging',
            'The system SHALL log structured JSON with correlation IDs.',
            '',
            '#### Scenario:RequestTracing',
            '- **WHEN** an operation is logged',
            '- **THEN** it reaches both file and console',
            '',
            'Code:',
            '```javascript',
            '// Logger.js provides structured logging',
            '```',
            '',
            '### Requirement:CLIWrapperOperations',
            'The system SHALL wrap the `ctx` CLI for search, ask',
        ].join('\n');
        expect(parseRequirements(text)).toEqual([[
            '### Requirement: StructuredLogging',
            'The system SHALL log structured JSON with correlation IDs.',
            '',
            '#### Scenario: RequestTracing',
            '- **WHEN** an operation is logged',
            '- **THEN** it reaches both file and console',
        ].join('\n')]);
    });

    test('drops blocks OpenSpec would reject', () => {
        const text = [
            '### Requirement: No shall',
            'The system ranks results.',
            '#### Scenario: S',
            '- **WHEN** x',
            '- **THEN** y',
            '### Requirement: No scenario',
            'The system SHALL do something.',
        ].join('\n');
        expect(parseRequirements(text)).toEqual([]);
    });

    test('cuts a block at a higher-level heading so prose cannot open a section', () => {
        const [block] = parseRequirements(`${GOOD_ANSWER}\n## Notes\nThe system SHALL be ignored here.`);
        expect(block).not.toContain('## Notes');
    });
});

describe('draftSpecs', () => {
    let root;

    beforeEach(() => {
        jest.clearAllMocks();
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-baseline-'));
        graphFacts.load.mockReturnValue(facts({ 'backend/core/Search.js': 3, 'src/ui/App.jsx': 1 }));
        searchPipeline.search.mockResolvedValue({ results: [{ filePath: 'backend/core/Search.js', content: 'function search() {}' }] });
        contextEngine.ask.mockResolvedValue({ output: GOOD_ANSWER });
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('drafts one marked spec per capability and writes nothing', async () => {
        const result = await draftSpecs(root);

        expect(result.available).toBe(true);
        expect(result.openSpecInitialized).toBe(false);
        expect(result.drafts.map(d => d.relativePath)).toEqual([
            'openspec/specs/backend-core/spec.md',
            'openspec/specs/src-ui/spec.md',
        ]);
        const [draft] = result.drafts;
        expect(draft.filePath).toBe(path.join(root, 'openspec', 'specs', 'backend-core', 'spec.md'));
        expect(draft.content).toMatch(/^# backend-core Specification\n\n## Purpose\nDRAFT/);
        expect(draft.content).toContain('## Requirements\n### Requirement: Rank results');
        expect(draft.sources).toEqual(['backend/core/Search.js']);
        expect(fs.existsSync(path.join(root, 'openspec'))).toBe(false);
    });

    test('retrieves through the search pipeline, scoped to the workspace', async () => {
        await draftSpecs(root, { maxCapabilities: 1 });
        expect(searchPipeline.search).toHaveBeenCalledTimes(1);
        expect(searchPipeline.search).toHaveBeenCalledWith(expect.objectContaining({ project: root, mode: 'code', query: 'backend/core Search' }));
        expect(contextEngine.ask).toHaveBeenCalledWith(expect.stringContaining('function search() {}'), expect.objectContaining({ project: root }));
    });

    test('never replaces a spec that already exists', async () => {
        const existing = path.join(root, 'openspec', 'specs', 'backend-core', 'spec.md');
        fs.mkdirSync(path.dirname(existing), { recursive: true });
        fs.writeFileSync(existing, 'mine');

        const result = await draftSpecs(root);

        expect(result.drafts.map(d => d.capability)).toEqual(['src-ui']);
        expect(result.skipped).toEqual([{ capability: 'backend-core', reason: 'a spec already exists' }]);
        expect(fs.readFileSync(existing, 'utf8')).toBe('mine');
    });

    test('skips a capability the model could not describe', async () => {
        contextEngine.ask.mockResolvedValue({ output: 'I am not sure what this code does.' });
        const result = await draftSpecs(root);
        expect(result.drafts).toEqual([]);
        expect(result.skipped.map(s => s.reason)).toEqual([
            'the local model returned no usable requirements',
            'the local model returned no usable requirements',
        ]);
    });

    test('says why when there is no graph', async () => {
        graphFacts.load.mockReturnValue(null);
        const result = await draftSpecs(root);
        expect(result).toMatchObject({ available: false, drafts: [] });
        expect(result.reason).toMatch(/no knowledge graph/);
        expect(searchPipeline.search).not.toHaveBeenCalled();
    });
});
