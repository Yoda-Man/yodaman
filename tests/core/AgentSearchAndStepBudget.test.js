/**
 * A simple search must never end in "I reached the maximum number of steps".
 *
 * WHAT THE USER SAW:
 *
 * "find where user login is handled", typed into Chat on a large workspace,
 * came back as "I reached the maximum number of steps without finishing.
 * Please try breaking the task into smaller parts." Nothing else: no files, no
 * results, after many minutes of work.
 *
 * WHY (measured on an 8,255-file workspace):
 *
 *   1. A one-line search went through the full reasoning loop. Each step is a
 *      `ctx ask` of two to three minutes; three steps took ten minutes and had
 *      not answered. Ten steps is the budget.
 *   2. When the budget ran out, everything gathered was discarded and a fixed
 *      sentence was returned.
 *
 * The existing test for the step limit asserted that fixed sentence, so the
 * suite was guaranteeing the defect rather than catching it. These tests pin
 * the opposite: searches route directly, and running out of steps reports what
 * was found.
 */
jest.mock('../../backend/infrastructure/ContextEngine', () => ({
    execute: jest.fn(),
    ask: jest.fn(),
    projectName: jest.fn(async (p) => p)
}));

jest.mock('../../backend/infrastructure/ToolBox', () => ({
    getToolDefinitions: jest.fn(() => '1. readFile(filePath: string (path)): Returns the content of a file.'),
    getBriefToolDefinitions: jest.fn(() => 'readFile(filePath), searchCode(query, project)'),
    getFileContent: jest.fn(),
    callTool: jest.fn()
}));

jest.mock('../../backend/infrastructure/Logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

jest.mock('../../backend/infrastructure/GraphifyService', () => ({
    query: jest.fn(async () => ''),
    readReport: jest.fn(() => '')
}));

jest.mock('../../backend/core/StardustBrief', () => ({
    build: jest.fn(async () => ({ text: '' }))
}));

// The Chat shortcut runs the search pipeline. Its three-pillar behaviour is
// tested in tests/core/SearchPipeline.test.js; here it only needs to return hits.
jest.mock('../../backend/core/SearchPipeline', () => ({
    search: jest.fn(async () => ({ results: [], pillars: { contextExpert: true, graphify: false, openspec: false } }))
}));

const contextEngine = require('../../backend/infrastructure/ContextEngine');
const toolBox = require('../../backend/infrastructure/ToolBox');
const agentEngine = require('../../backend/core/AgentReasoningEngine');
const { search: unifiedSearch } = require('../../backend/core/SearchPipeline');

// A real folder: the engine refuses a workspace that does not exist.
const WORKSPACE = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'yodaman-search-agent-'));
afterAll(() => require('fs').rmSync(WORKSPACE, { recursive: true, force: true }));

const HITS = [
    { filePath: 'auth/login.py', lineStart: 12, content: 'def login(user, password):\n    ...', score: 0.97, metadata: { path: 'auth/login.py', line: 12 } },
    { filePath: 'main.py', lineStart: 21, content: 'def main() -> None:', score: 0.8, metadata: { path: 'main.py', line: 21 } }
];

beforeEach(() => {
    agentEngine.tasks.clear();
    agentEngine.cancelledTasks.clear();
    agentEngine.pendingApprovals.clear();
    agentEngine.maxIterations = 10;
    contextEngine.ask.mockReset();
    toolBox.callTool.mockReset();
    unifiedSearch.mockReset();
    unifiedSearch.mockResolvedValue({ results: [], pillars: { contextExpert: true, graphify: false, openspec: false } });
});

describe('which requests count as a plain search', () => {
    test.each([
        ['find where user login is handled', 'user login is handled'],
        ['search for where the main entry point is', 'the main entry point is'],
        ['Search for database connection', 'database connection'],
        ['where is the config loaded?', 'the config loaded'],
        ['locate the payment webhook', 'the payment webhook'],
        ['look for retry logic', 'retry logic']
    ])('%s -> searches for "%s"', (task, query) => {
        expect(agentEngine.resolveDirectSearch(task)).toEqual({ query });
    });

    test.each([
        'find and fix the login bug',
        'explain how search works',
        'how does authentication work',
        'find the login handler and rename it',
        'Run CodeTrooper',
        'refactor the search module',
        'search for X\nthen write a summary',
        `find ${'x'.repeat(200)}`
    ])('%s -> takes the full agent loop', (task) => {
        // The safe direction: anything that asks for reasoning or a change is
        // never answered with a list of search hits.
        expect(agentEngine.resolveDirectSearch(task)).toBeNull();
    });
});

describe('a plain search typed into Chat', () => {
    test('runs one search and never calls the model', async () => {
        unifiedSearch.mockResolvedValue({ results: HITS, pillars: { contextExpert: true, graphify: true, openspec: true } });
        const events = [];

        const answer = await agentEngine.executeTask(
            'find where user login is handled', 'search-1', (e) => events.push(e), { projectId: WORKSPACE }
        );

        expect(contextEngine.ask).not.toHaveBeenCalled();
        expect(unifiedSearch).toHaveBeenCalledTimes(1);
        expect(unifiedSearch).toHaveBeenCalledWith(expect.objectContaining({
            query: 'user login is handled', project: WORKSPACE
        }));
        expect(toolBox.callTool).not.toHaveBeenCalled();
        expect(answer).not.toMatch(/maximum number of steps/);
        expect(events.map((e) => e.type)).toEqual(['tool_start', 'tool_end']);
        expect(answer).toMatch(/ranked with the Graphify knowledge graph, tagged with the OpenSpec specs/);
    });

    test('answers with clickable file:line references', async () => {
        unifiedSearch.mockResolvedValue({ results: HITS, pillars: { contextExpert: true, graphify: true, openspec: true } });

        const answer = await agentEngine.executeTask(
            'find where user login is handled', 'search-2', undefined, { projectId: WORKSPACE }
        );

        expect(answer).toContain('auth/login.py:12');
        // A root-level file needs "./" or the chat cannot turn it into a link.
        expect(answer).toContain('./main.py:21');
    });

    test('names only the pillars that actually applied', async () => {
        unifiedSearch.mockResolvedValue({ results: HITS, pillars: { contextExpert: true, graphify: true, openspec: false } });
        const answer = await agentEngine.executeTask('find where user login is handled', 'search-pillars', undefined, { projectId: WORKSPACE });
        expect(answer).toMatch(/ranked with the Graphify knowledge graph/);
        expect(answer).toMatch(/not tagged by OpenSpec \(no specs in this workspace\)/);

        unifiedSearch.mockResolvedValue({ results: HITS, pillars: { contextExpert: true, graphify: false, openspec: true } });
        const unranked = await agentEngine.executeTask('find where user login is handled', 'search-pillars-2', undefined, { projectId: WORKSPACE });
        expect(unranked).toMatch(/not ranked by Graphify/);
        expect(unranked).toMatch(/tagged with the OpenSpec specs/);

        unifiedSearch.mockResolvedValue({ results: HITS, pillars: { contextExpert: false, graphify: false, openspec: false } });
        const scanned = await agentEngine.executeTask('find where user login is handled', 'search-pillars-3', undefined, { projectId: WORKSPACE });
        expect(scanned).toMatch(/plain text scan \(Context Expert has not indexed this workspace/);
    });

    test('says plainly when nothing matched', async () => {
        unifiedSearch.mockResolvedValue({ results: [], pillars: { contextExpert: true, graphify: false, openspec: false } });

        const answer = await agentEngine.executeTask(
            'find the quantum flux capacitor', 'search-3', undefined, { projectId: WORKSPACE }
        );

        expect(answer).toMatch(/No matches/);
        expect(contextEngine.ask).not.toHaveBeenCalled();
    });

    test('needs a workspace, otherwise it takes the normal loop', async () => {
        contextEngine.ask.mockResolvedValue({ output: 'Which workspace do you mean?' });

        await agentEngine.executeTask('find where user login is handled', 'search-4');

        expect(contextEngine.ask).toHaveBeenCalled();
        expect(unifiedSearch).not.toHaveBeenCalled();
    });
});

describe('running out of steps', () => {
    test('answers from what was gathered when the model can summarise', async () => {
        agentEngine.maxIterations = 3;
        // Three steps of reading, then a real prose answer on the synthesis turn.
        contextEngine.ask
            .mockResolvedValueOnce({ output: 'TOOL_CALL {"name":"readFile","parameters":{"filePath":"auth/login.py"}}' })
            .mockResolvedValueOnce({ output: 'TOOL_CALL {"name":"readFile","parameters":{"filePath":"auth/session.py"}}' })
            .mockResolvedValueOnce({ output: 'TOOL_CALL {"name":"readFile","parameters":{"filePath":"auth/tokens.py"}}' })
            .mockResolvedValueOnce({ output: 'Login is handled in auth/login.py, which validates the password and creates a session in auth/session.py.' });
        toolBox.callTool.mockResolvedValue({ content: 'def login(): ...' });

        const answer = await agentEngine.executeTask('trace the login flow end to end', 'steps-1', undefined, { projectId: WORKSPACE });

        expect(answer).toContain('Login is handled in auth/login.py');
        expect(answer).toMatch(/Stopped after 3 steps/);
        // The synthesis prompt forbids tools; check it was actually said.
        const lastPrompt = contextEngine.ask.mock.calls.at(-1)[0];
        expect(lastPrompt).toMatch(/Do NOT call any tool/);
    });

    test('lists the files it examined when the summary fails', async () => {
        agentEngine.maxIterations = 2;
        contextEngine.ask
            .mockResolvedValueOnce({ output: 'TOOL_CALL {"name":"readFile","parameters":{"filePath":"auth/login.py"}}' })
            .mockResolvedValueOnce({ output: 'TOOL_CALL {"name":"searchCode","parameters":{"query":"session"}}' })
            .mockRejectedValueOnce(new Error('ctx timed out'));
        toolBox.callTool
            .mockResolvedValueOnce({ content: 'def login(): ...' })
            .mockResolvedValueOnce(HITS);

        const answer = await agentEngine.executeTask('trace the login flow end to end', 'steps-2', undefined, { projectId: WORKSPACE });

        expect(answer).not.toBe(agentEngine.MAX_STEPS_FALLBACK);
        expect(answer).toContain('auth/login.py');
        expect(answer).toContain('./main.py:21');
    });

    test('a synthesis that is still a tool call is not presented as an answer', async () => {
        agentEngine.maxIterations = 1;
        contextEngine.ask.mockResolvedValue({ output: 'TOOL_CALL {"name":"readFile","parameters":{"filePath":"a.py"}}' });
        toolBox.callTool.mockResolvedValue({ content: 'x' });

        const answer = await agentEngine.executeTask('trace everything', 'steps-3', undefined, { projectId: WORKSPACE });

        expect(answer).not.toMatch(/TOOL_CALL/);
        expect(answer).toContain('./a.py');
    });

    test('with nothing gathered, it still ends and says so', async () => {
        agentEngine.maxIterations = 1;
        contextEngine.ask
            .mockResolvedValueOnce({ output: 'TOOL_CALL {"name":"readFile","parameters":{"filePath":"missing.py"}}' })
            .mockResolvedValueOnce({ output: '' });
        toolBox.callTool.mockResolvedValue({ error: 'File not found' });

        const answer = await agentEngine.executeTask('trace everything', 'steps-4', undefined, { projectId: WORKSPACE });

        // A failed read is not evidence, so the honest fallback is the only answer left.
        expect(answer).toBe(agentEngine.MAX_STEPS_FALLBACK);
    });
});
