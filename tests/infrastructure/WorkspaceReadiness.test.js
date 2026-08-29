const graphifyService = require('../../backend/infrastructure/GraphifyService');
const queueService = require('../../backend/core/QueueService');
const readiness = require('../../backend/infrastructure/WorkspaceReadiness');
const specDrift = require('../../backend/stardust/SpecDrift');

const PROJECT = '/workspace/demo';

describe('WorkspaceReadiness', () => {
    const originalFreshness = graphifyService.freshness;
    const originalGetStatus = queueService.getStatus;

    const setGraph = (freshness) => { graphifyService.freshness = jest.fn(() => freshness); };
    const setQueue = (status) => { queueService.getStatus = jest.fn(() => status); };

    beforeEach(() => {
        setGraph({ graphExists: true, stale: false, graphUpdatedAt: '2026-08-01T00:00:00Z' });
        setQueue({ isProcessing: false, queue: [], active: null });
    });

    afterEach(() => {
        graphifyService.freshness = originalFreshness;
        queueService.getStatus = originalGetStatus;
    });

    test('reports ready and trustworthy when every layer is current', () => {
        const report = readiness.forWorkspace(PROJECT);

        expect(report.state).toBe('ready');
        expect(report.trustworthy).toBe(true);
        expect(report.action).toBeNull();
    });

    test('a stale graph makes the workspace untrustworthy with an action', () => {
        setGraph({ graphExists: true, stale: true });
        const report = readiness.forWorkspace(PROJECT);

        expect(report.state).toBe('stale');
        expect(report.trustworthy).toBe(false);
        expect(report.action).toMatch(/Sync Repository/);
        expect(readiness.summarize(report)).toMatch(/may miss recent changes/);
    });

    test('a missing graph reports unindexed, not merely stale', () => {
        setGraph({ graphExists: false, stale: true });
        expect(readiness.forWorkspace(PROJECT).state).toBe('unindexed');
    });

    test('an in-flight graph build reports building, so the user waits', () => {
        setGraph({ graphExists: true, stale: true, build: { state: 'running' } });
        const report = readiness.forWorkspace(PROJECT);

        expect(report.state).toBe('building');
        expect(report.action).toMatch(/in flight/);
    });

    test('a queued reindex reports building even when the graph is current', () => {
        setQueue({ isProcessing: false, queue: [PROJECT], active: null });
        const report = readiness.forWorkspace(PROJECT);

        expect(report.layers.index.state).toBe('building');
        expect(report.state).toBe('building');
    });

    test('another workspace being queued does not degrade this one', () => {
        setQueue({ isProcessing: false, queue: ['/workspace/other'], active: null });
        expect(readiness.forWorkspace(PROJECT).state).toBe('ready');
    });

    test('the verdict is the weakest layer, never an average', () => {
        expect(readiness.weakest(['ready', 'stale'])).toBe('stale');
        expect(readiness.weakest(['stale', 'unindexed'])).toBe('unindexed');
        expect(readiness.weakest(['ready', 'building'])).toBe('building');
        expect(readiness.weakest(['ready', 'ready'])).toBe('ready');
    });

    test('handles a missing workspace without throwing', () => {
        const report = readiness.forWorkspace(null);
        expect(report.state).toBe('unindexed');
        expect(report.reason).toMatch(/no workspace/);
    });

    test('survives a graph service that throws', () => {
        graphifyService.freshness = jest.fn(() => { throw new Error('graph exploded'); });
        const report = readiness.forWorkspace(PROJECT);

        expect(report.state).toBe('unindexed');
        expect(report.layers.graph.detail).toMatch(/graph exploded/);
    });

    describe('across many workspaces', () => {
        test('overall is the weakest workspace', () => {
            setGraph({ graphExists: true, stale: false });
            const allReady = readiness.forWorkspaces([PROJECT, '/workspace/two']);
            expect(allReady.overall).toBe('ready');
            expect(allReady.trustworthy).toBe(true);
            expect(allReady.workspaces).toHaveLength(2);

            setQueue({ isProcessing: false, queue: ['/workspace/two'], active: null });
            const oneBuilding = readiness.forWorkspaces([PROJECT, '/workspace/two']);
            expect(oneBuilding.overall).toBe('building');
            expect(oneBuilding.trustworthy).toBe(false);
        });

        test('no workspaces reports unindexed rather than falsely ready', () => {
            expect(readiness.forWorkspaces([]).overall).toBe('unindexed');
        });
    });

    describe('coverage — the finding a new user gets on first index', () => {
        const originalDetect = specDrift.detectDrift;
        afterEach(() => { specDrift.detectDrift = originalDetect; });

        const setDrift = (report) => { specDrift.detectDrift = jest.fn(() => report); };

        test('turns "ready, nothing to do" into the coverage finding', () => {
            // The moment that matters. Indexing has finished, so there is no
            // setup step left to name — and readiness used to say nothing at
            // exactly the point the product finally had something to say.
            setDrift({
                available: true, covered: false, specCount: 0,
                staleCount: 0, undocumentedCount: 4,
                undocumented: [
                    { file: 'server/entities.py', dependents: 3 },
                    { file: 'shared/messages.py', dependents: 3 }
                ]
            });

            const report = readiness.forWorkspace(PROJECT, { withCoverage: true });

            expect(report.state).toBe('ready');
            expect(report.action).toMatch(/load-bearing module\(s\) carry this codebase/);
            expect(report.coverage.hubs).toHaveLength(2);
            expect(report.coverage.covered).toBe(false);
        });

        test('does not compute coverage for the polled list', () => {
            // ~160ms per workspace on a large graph, and the dashboard polls
            // the list. One at a time is the budget this fits in.
            setDrift({ available: true, covered: false, undocumentedCount: 4, undocumented: [] });

            const list = readiness.forWorkspaces([PROJECT, '/workspace/other']);

            expect(specDrift.detectDrift).not.toHaveBeenCalled();
            expect(list.workspaces.every((w) => w.coverage === null)).toBe(true);
        });

        test('does not measure a workspace with no graph yet', () => {
            // Nothing to measure against, and the setup hint is the right thing
            // to show at that point.
            setGraph({ graphExists: false, stale: false });
            setDrift({ available: true, covered: false, undocumentedCount: 9, undocumented: [] });

            const report = readiness.forWorkspace(PROJECT, { withCoverage: true });

            expect(specDrift.detectDrift).not.toHaveBeenCalled();
            expect(report.coverage).toBeNull();
            expect(report.action).toMatch(/Sync Repository/);
        });

        test('never lets a drift failure break readiness', () => {
            specDrift.detectDrift = jest.fn(() => { throw new Error('graph unreadable'); });

            const report = readiness.forWorkspace(PROJECT, { withCoverage: true });

            expect(report.state).toBe('ready');
            expect(report.coverage).toBeNull();
        });

        test('reports drift normally once specs exist', () => {
            setDrift({
                available: true, covered: true, specCount: 3,
                staleCount: 1, undocumentedCount: 2, undocumented: []
            });

            const report = readiness.forWorkspace(PROJECT, { withCoverage: true });

            expect(report.action).toMatch(/1 stale spec reference/);
            expect(report.coverage.covered).toBe(true);
        });
    });
});
