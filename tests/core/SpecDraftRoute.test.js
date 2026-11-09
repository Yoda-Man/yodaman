/**
 * "Draft baseline specs" — the Stardust button's task. The drafting is
 * read-only; every write (openspec init, then one spec per capability) must
 * stop at the approval gate, and a rejected one must never reach disk.
 */
jest.mock('../../backend/infrastructure/ContextEngine', () => ({ ask: jest.fn(), execute: jest.fn(), projectName: jest.fn() }));
jest.mock('../../backend/infrastructure/ToolBox', () => ({
    getFileContent: jest.fn(async () => ''),
    callTool: jest.fn(),
    getToolDefinitions: jest.fn(() => ''),
    getBriefToolDefinitions: jest.fn(() => ''),
}));
jest.mock('../../backend/infrastructure/Logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../backend/core/QueueService', () => ({ addToQueue: jest.fn() }));
// The normal loop asks ctx which model it serves; keep this test off the real machine.
jest.mock('../../backend/infrastructure/DependencyChecker', () => ({ detectCtxModel: jest.fn(async () => 'test'), isWeakModel: jest.fn(() => true), detectOllamaContext: jest.fn(async () => null) }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const contextEngine = require('../../backend/infrastructure/ContextEngine');
const toolBox = require('../../backend/infrastructure/ToolBox');
const agentEngine = require('../../backend/core/AgentReasoningEngine');
const { resolveDirectSpecDraft } = agentEngine;

const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-specdraft-'));
afterAll(() => fs.rmSync(PROJECT, { recursive: true, force: true }));

const draft = (capability) => ({
    capability,
    filePath: path.join(PROJECT, 'openspec', 'specs', capability, 'spec.md'),
    relativePath: `openspec/specs/${capability}/spec.md`,
    content: `# ${capability} Specification\n`,
});

/** Resolve the gate's next pending approval once it is waiting. */
async function nextApproval(taskId) {
    for (let i = 0; i < 50 && !agentEngine.pendingApprovals.has(taskId); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!agentEngine.pendingApprovals.has(taskId)) throw new Error('no approval was requested');
    return agentEngine.tasks.get(taskId).pendingApproval;
}

const calledTools = () => toolBox.callTool.mock.calls.map(([name]) => name);

describe('resolveDirectSpecDraft', () => {
    test.each(['Draft baseline specs', 'draft baseline spec', 'Draft baseline specs for this workspace.'])('routes "%s"', (task) => {
        expect(resolveDirectSpecDraft(task)).toBe(true);
    });

    test.each(['', 'draft specs', 'Draft baseline specs and delete the tests', 'how do I draft baseline specs?', 'Do not draft baseline specs'])('leaves "%s" to the model', (task) => {
        expect(resolveDirectSpecDraft(task)).toBe(false);
    });
});

describe('Draft baseline specs task', () => {
    beforeEach(() => {
        agentEngine.pendingApprovals.clear();
        agentEngine.tasks.clear();
        agentEngine.cancelledTasks.clear();
        toolBox.callTool.mockReset();
        contextEngine.ask.mockReset();
    });

    test('initializes and writes only what the user approves', async () => {
        toolBox.callTool.mockImplementation(async (name) => (name === 'specDraft'
            ? { available: true, openSpecInitialized: false, drafts: [draft('backend-core'), draft('src-ui')], skipped: [], message: '2 drafts' }
            : { success: true }));

        const run = agentEngine.executeTask('Draft baseline specs', 'sd-1', undefined, { projectId: PROJECT });

        expect((await nextApproval('sd-1')).tool).toBe('specInit');
        expect(calledTools()).toEqual(['specDraft']);
        agentEngine.signalApproval('sd-1', true);

        const first = await nextApproval('sd-1');
        expect(first).toMatchObject({ tool: 'writeFile', params: { filePath: draft('backend-core').filePath, oldContent: '', newContent: '# backend-core Specification\n' } });
        expect(calledTools()).toEqual(['specDraft', 'specInit']);
        agentEngine.signalApproval('sd-1', false);

        await nextApproval('sd-1');
        agentEngine.signalApproval('sd-1', true);
        const answer = await run;

        expect(calledTools()).toEqual(['specDraft', 'specInit', 'writeFile']);
        expect(toolBox.callTool).toHaveBeenLastCalledWith('writeFile', { filePath: draft('src-ui').filePath, content: '# src-ui Specification\n' });
        expect(answer).toContain('Wrote 1 draft spec(s)');
        expect(answer).toContain('openspec/specs/backend-core/spec.md: rejected, not written');
        expect(contextEngine.ask).not.toHaveBeenCalled();
    });

    test('writes nothing when initialization is rejected', async () => {
        toolBox.callTool.mockResolvedValueOnce({ available: true, openSpecInitialized: false, drafts: [draft('backend-core')], skipped: [], message: '1 draft' });

        const run = agentEngine.executeTask('Draft baseline specs', 'sd-2', undefined, { projectId: PROJECT });
        await nextApproval('sd-2');
        agentEngine.signalApproval('sd-2', false);

        expect(await run).toMatch(/^Nothing written/);
        expect(calledTools()).toEqual(['specDraft']);
    });

    test('skips init when OpenSpec already exists, and reports why nothing was drafted', async () => {
        toolBox.callTool.mockResolvedValueOnce({
            available: true, openSpecInitialized: true, drafts: [],
            skipped: [{ capability: 'backend-core', reason: 'a spec already exists' }], message: '0 drafts',
        });

        const answer = await agentEngine.executeTask('Draft baseline specs', 'sd-3', undefined, { projectId: PROJECT });

        expect(answer).toContain('- backend-core: skipped, a spec already exists');
        expect(agentEngine.pendingApprovals.size).toBe(0);
        expect(calledTools()).toEqual(['specDraft']);
    });

    test('is not routed without a workspace', async () => {
        contextEngine.ask.mockResolvedValue({ output: 'Pick a workspace first.' });
        await agentEngine.executeTask('Draft baseline specs', 'sd-4', undefined, {});
        expect(calledTools()).not.toContain('specDraft');
    });
});
