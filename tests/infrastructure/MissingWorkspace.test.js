/**
 * A registered workspace whose folder was moved or deleted.
 *
 * What the user hit: their largest workspace folder had moved. YodaMan still
 * listed it, Context Expert still held its index, and readiness said
 * "unindexed: Run Sync Repository". A simple search typed into Chat then went
 * after files that no longer existed, failed to read each one, and ended on
 * "I reached the maximum number of steps". Nothing it found could be opened.
 *
 * Every layer now names the real problem instead.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../backend/infrastructure/Logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const readiness = require('../../backend/infrastructure/WorkspaceReadiness');

const gone = path.join(os.tmpdir(), `yodaman-moved-${process.pid}`);

beforeAll(() => fs.rmSync(gone, { recursive: true, force: true }));

describe('readiness', () => {
    test('says the folder is missing, rather than "run Sync Repository"', () => {
        const report = readiness.forWorkspace(gone);
        expect(report.state).toBe('missing');
        expect(report.trustworthy).toBe(false);
        expect(report.action).toMatch(/moved or deleted/);
        expect(report.action).not.toMatch(/Sync Repository/);
        expect(readiness.summarize(report)).toBe('folder not found');
        // The same shape as every other report; clients read these directly.
        expect(report.layers.graph.state).toBe('missing');
        expect(report.layers.index.state).toBe('missing');
    });

    test('missing is the worst state, so it is what the overall verdict shows', () => {
        expect(readiness.weakest(['ready', 'stale', 'missing', 'unindexed'])).toBe('missing');
        expect(readiness.SEVERITY[0]).toBe('missing');
    });
});

describe('the agent', () => {
    beforeEach(() => jest.resetModules());

    test('stops before spending a single step, and says why', async () => {
        jest.doMock('../../backend/infrastructure/ContextEngine', () => ({ ask: jest.fn(), execute: jest.fn(), projectName: jest.fn() }));
        jest.doMock('../../backend/infrastructure/ToolBox', () => ({ callTool: jest.fn(), getToolDefinitions: () => '', getBriefToolDefinitions: () => '' }));
        jest.doMock('../../backend/core/SearchPipeline', () => ({ search: jest.fn() }));
        const contextEngine = require('../../backend/infrastructure/ContextEngine');
        const pipeline = require('../../backend/core/SearchPipeline');
        const agent = require('../../backend/core/AgentReasoningEngine');

        for (const task of ['find where user login is handled', 'explain the login flow']) {
            const answer = await agent.executeTask(task, `missing-${task.length}`, undefined, { projectId: gone });
            expect(answer).toMatch(/was not found/);
            expect(answer).not.toMatch(/maximum number of steps/);
        }
        expect(contextEngine.ask).not.toHaveBeenCalled();
        expect(pipeline.search).not.toHaveBeenCalled();
    });
});

describe('the graph build', () => {
    test('refuses a missing workspace instead of recreating it', async () => {
        // writeBuildStatus used mkdir -p on <workspace>/graphify-out, so a build
        // for a deleted folder brought the folder back as an empty shell, which
        // then read as a healthy workspace.
        jest.resetModules();
        const graphify = require('../../backend/infrastructure/GraphifyService');
        await expect(graphify.build(gone)).rejects.toMatchObject({ code: 'workspace_missing' });
        expect(() => graphify.writeBuildStatus(gone, { state: 'running' })).toThrow(/not found/);
        expect(fs.existsSync(gone)).toBe(false);
    });
});
