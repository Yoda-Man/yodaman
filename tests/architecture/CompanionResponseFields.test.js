/**
 * The mobile app and the VS Code extension read the runtime's responses by
 * field name, and each read a name nothing sends:
 *
 *  - mobile Drift list: drift.drifts / drift.items (the route sends
 *    staleReferences and undocumented), so it was always empty;
 *  - mobile approvals: impact.covered (ImpactAnalyzer sends testCount), so every
 *    card said "no covering test";
 *  - extension drift: put stale-reference warnings on openspec/<id>.md, a file
 *    that never exists (spec ids are relative to openspec/specs/ and keep .md);
 *  - extension blast radius: joined mentionedIn objects into "[object Object]";
 *  - extension search: read hit.file/hit.path/hit.blended (ctx sends filePath,
 *    GraphRanker graphRank), so no pick could be opened or showed a score.
 *
 * Every check feeds the client code what the real backend produces for a real
 * workspace on disk, so a renamed field on either side fails here.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mockDiagnostics = new Map();
const mockMessages = [];
jest.mock('vscode', () => ({
    languages: {
        createDiagnosticCollection: () => ({
            set: (uri, list) => mockDiagnostics.set(uri.fsPath, list),
            clear: () => mockDiagnostics.clear()
        })
    },
    Uri: { file: (fsPath) => ({ fsPath }) },
    Range: class { constructor(...args) { this.args = args; } },
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    DiagnosticSeverity: { Warning: 1, Information: 2 },
    window: {
        showInformationMessage: async (message) => { mockMessages.push(message); },
        showWarningMessage: async (message, ...items) => {
            mockMessages.push(message);
            return items.includes('Approve') ? 'Approve' : undefined;
        },
        showErrorMessage: async (message) => { mockMessages.push(message); },
        showQuickPick: async (items) => items[0],
        withProgress: async (_options, task) => task(),
        activeTextEditor: null
    },
    ProgressLocation: { Notification: 15 },
    commands: { executeCommand: async () => {} }
}), { virtual: true });

const router = require('../../backend/interfaces/RestController');
const impactAnalyzer = require('../../backend/infrastructure/ImpactAnalyzer');
const graphRanker = require('../../backend/infrastructure/GraphRanker');
const { hitPath } = require('../../shared/searchHits');
const { findRouteHandler } = require('../helpers/routeHandler');
const { getConfigPath } = require('../../backend/interfaces/support/workspaces');
const { driftRows, testCoverage } = require('../../apps/mobile/src/stardustView');
const coreSurface = require('../../extensions/vscode-yodaman/src/coreSurface');
const vscode = require('vscode');
const express = require('express');
const stardustRoutes = require('../../backend/interfaces/routes/stardustRoutes');
const { createYodaManClient } = require('../../shared/yodamanClient');

jest.setTimeout(30000);

async function invoke(routePath, query) {
    const req = { body: {}, query, params: {}, id: 'test-request-id', get: jest.fn() };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; },
        send(payload) { this.payload = payload; return this; }
    };
    await findRouteHandler(router, 'get', routePath)(req, res);
    return res.payload;
}

/**
 *   server.js, handlers.js, router.test.js ──→ router.js ──→ store.js
 *   server.js, handlers.js, router.js ──→ hub.js   (no spec describes hub.js)
 *   openspec/specs/api.md cites src/router.js and the deleted src/legacy-gateway.js
 */
function buildWorkspace(root) {
    fs.mkdirSync(path.join(root, 'openspec', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'graphify-out'), { recursive: true });
    fs.writeFileSync(path.join(root, 'openspec', 'config.yaml'), 'version: 1\n');
    fs.writeFileSync(
        path.join(root, 'openspec', 'specs', 'api.md'),
        '# API\n\nRequests pass through src/router.js.\nNormalization used to live in src/legacy-gateway.js.\n'
    );
    const files = ['src/router.js', 'src/store.js', 'src/server.js', 'src/handlers.js', 'tests/router.test.js', 'src/hub.js'];
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), '// fixture\n');
    }
    const nodes = files.map((file, i) => ({ id: `n${i + 1}`, source_file: file }));
    const links = [
        ['n3', 'n1'], ['n4', 'n1'], ['n5', 'n1'], ['n1', 'n2'], ['n3', 'n6'], ['n4', 'n6'], ['n1', 'n6']
    ].map(([source, target]) => ({ source, target, relation: 'imports' }));
    fs.writeFileSync(path.join(root, 'graphify-out', 'graph.json'), JSON.stringify({ nodes, links }));
}

describe('companion clients read the fields the runtime sends', () => {
    let root;
    let savedConfig = null;
    const output = { lines: [], appendLine(line) { this.lines.push(line); }, show() {} };

    beforeAll(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'companion-fields-')));
        buildWorkspace(root);
        // Stardust routes serve registered workspaces only. The data folder is
        // shared by every suite in this Jest worker, so the old config is restored.
        if (fs.existsSync(getConfigPath())) savedConfig = fs.readFileSync(getConfigPath());
        fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true });
        fs.writeFileSync(getConfigPath(), JSON.stringify({ watchedDirectories: [root], removedDirectories: [] }));
        coreSurface.init({ subscriptions: [] });
    });
    afterAll(() => {
        if (savedConfig) fs.writeFileSync(getConfigPath(), savedConfig);
        else fs.rmSync(getConfigPath(), { force: true });
        fs.rmSync(root, { recursive: true, force: true });
    });
    beforeEach(() => { mockDiagnostics.clear(); mockMessages.length = 0; output.lines = []; });

    describe('GET /stardust/drift', () => {
        let drift;
        beforeAll(async () => { drift = await invoke('/stardust/drift', { projectRoot: root }); });

        test('the workspace really drifts (so the checks below measure something)', () => {
            expect(drift.staleCount).toBe(1);
            expect(drift.undocumentedCount).toBeGreaterThan(0);
        });

        test('mobile lists every stale reference and undocumented module', () => {
            const files = driftRows(drift).map((row) => row.file);
            expect(files).toEqual(expect.arrayContaining(['src/legacy-gateway.js', 'src/hub.js']));
            expect(files).toHaveLength(drift.staleCount + drift.undocumented.length);
        });

        test('the extension puts stale-reference warnings on the spec file that exists', async () => {
            await coreSurface.publishDrift({
                getClient: () => ({ stardustDrift: async () => drift }),
                getWorkspaceProjectId: () => root,
                ensureRuntimeAvailable: async () => true,
                output
            });
            const specFile = path.join(root, 'openspec', 'specs', 'api.md');
            expect(mockDiagnostics.get(specFile)?.[0].message).toMatch(/legacy-gateway\.js/);
            for (const fsPath of mockDiagnostics.keys()) expect(fs.existsSync(fsPath)).toBe(true);
        });
    });

    test('mobile approval cards read ImpactAnalyzer test coverage', () => {
        // AgentReasoningEngine.awaitApproval attaches analyzeFile() as approval.impact.
        const impact = impactAnalyzer.analyzeFile(root, 'src/router.js');
        expect(impact.testCount).toBe(1);
        expect(testCoverage(impact)).toEqual({ covered: true, label: '1 covering test' });
    });

    test('the extension names the specs that mention a file', async () => {
        const compose = await invoke('/stardust/compose', { projectRoot: root, file: 'src/router.js' });
        expect(compose.openspec.mentionedIn.length).toBe(1);
        coreSurface.renderCompose(compose, 'src/router.js', output);
        expect(output.lines).toContain('  specs          api.md');
        expect(output.lines).toContain('  tests          1 covering');
    });

    test('the extension opens and scores search hits of both shapes', () => {
        // ctx hits carry filePath; the filesystem fallback metadata.path.
        const hits = graphRanker.rerank(root, [
            { filePath: 'src/router.js', score: 0.9 },
            { metadata: { path: 'src/hub.js' }, score: 0.5 }
        ]);
        expect(hits.every((hit) => typeof hit.graphRank === 'number')).toBe(true);
        for (const hit of hits) {
            const item = coreSurface.searchPickItem(hit);
            expect(item.file).toBe(hitPath(hit));
            expect(item.file).not.toBe('');
            expect(item.description).toMatch(/^score \d/);
        }
    });

    test('the extension confirms an approval in plain English', async () => {
        await coreSurface.showPendingApprovals({
            getClient: () => ({
                pendingApprovals: async () => [{ taskId: 't1', task: 'edit', approval: { params: { filePath: 'src/router.js' } } }],
                approve: async () => ({})
            }),
            ensureRuntimeAvailable: async () => true,
            output
        });
        expect(mockMessages).toContain('YodaMan: approved src/router.js.');
    });
});

describe('a Stardust request for an unregistered workspace', () => {
    // Every /api/stardust/* route answers 404 workspace_not_registered for a
    // folder YodaMan was never given. That must read as an instruction, never
    // as an empty board or an offline runtime.
    let server;
    let client;
    let folder;
    const output = { lines: [], appendLine(line) { this.lines.push(line); }, show() {} };

    beforeAll(async () => {
        folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'companion-unregistered-')));
        fs.mkdirSync(path.join(folder, 'src'));
        fs.writeFileSync(path.join(folder, 'src', 'a.js'), '// fixture\n');
        server = await new Promise((resolve) => {
            const s = express().use(express.json()).use('/api', stardustRoutes).listen(0, '127.0.0.1', () => resolve(s));
        });
        client = createYodaManClient(`http://127.0.0.1:${server.address().port}`);
        coreSurface.init({ subscriptions: [] });
    });
    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(folder, { recursive: true, force: true });
    });
    beforeEach(() => { mockMessages.length = 0; output.lines = []; });

    test('the shared client says to add the folder, and keeps status and code', async () => {
        const error = await client.stardustDrift(folder).catch((e) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error.status).toBe(404);
        expect(error.code).toBe('workspace_not_registered');
        expect(error.message).toMatch(/not registered.*Add this folder to YodaMan first/);
    });

    const deps = () => ({
        getClient: () => client,
        getWorkspaceProjectId: () => folder,
        ensureRuntimeAvailable: async () => true,
        output
    });

    test.each([
        ['publishDrift', /^YodaMan drift failed: .*Add this folder to YodaMan first/],
        ['showStardustBoard', /^YodaMan Stardust board failed: .*Add this folder to YodaMan first/],
        ['impactForActiveFile', /^YodaMan impact failed: .*Add this folder to YodaMan first/]
    ])('extension %s shows the message', async (command, expected) => {
        vscode.window.activeTextEditor = { document: { uri: { fsPath: path.join(folder, 'src', 'a.js') } } };
        await coreSurface[command](deps());
        expect(mockMessages).toEqual(expect.arrayContaining([expect.stringMatching(expected)]));
    });

    test('extension runtime diagnostics prints the message', async () => {
        await coreSurface.runtimeDiagnostics(deps());
        expect(output.lines.join('\n')).toMatch(/openspec diagnose unavailable: .*Add this folder to YodaMan first/);
    });
});
