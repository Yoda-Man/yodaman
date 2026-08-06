const fs = require('fs');
const os = require('os');
const path = require('path');
const router = require('../../backend/interfaces/RestController');
const { findRouteHandler } = require('../helpers/routeHandler');
const agentEngine = require('../../backend/core/AgentReasoningEngine');
const auditLog = require('../../backend/infrastructure/AuditLog');
const contextEngine = require('../../backend/infrastructure/ContextEngine');
const graphifyService = require('../../backend/infrastructure/GraphifyService');
const watcherService = require('../../backend/infrastructure/FileSystemWatcher');
const logger = require('../../backend/infrastructure/Logger');
const gitService = require('../../backend/services/gitService');

describe('RestController Integration', () => {
    let testConfigDir;
    let previousConfigPath;

    beforeAll(() => {
        previousConfigPath = process.env.YODAMAN_CONFIG_PATH;
        testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-rest-config-'));
        process.env.YODAMAN_CONFIG_PATH = path.join(testConfigDir, 'config.json');
        fs.writeFileSync(process.env.YODAMAN_CONFIG_PATH, JSON.stringify({
            watchedDirectories: [],
            removedDirectories: []
        }, null, 2));
        router.loadConfig();
    });

    afterAll(() => {
        if (previousConfigPath === undefined) {
            delete process.env.YODAMAN_CONFIG_PATH;
        } else {
            process.env.YODAMAN_CONFIG_PATH = previousConfigPath;
        }
        router.loadConfig();
        fs.rmSync(testConfigDir, { recursive: true, force: true });
    });

    function configPath() {
        return router.getConfigPath();
    }

    function routeHandler(method, routePath) {
        return findRouteHandler(router, method, routePath);
    }

    async function invoke(method, routePath, { body = {}, query = {}, params = {} } = {}) {
        const appSettings = new Map();
        const req = {
            body,
            query,
            params,
            id: 'test-request-id',
            get: jest.fn(),
            app: {
                get: jest.fn((key) => appSettings.get(key)),
                set: jest.fn((key, value) => appSettings.set(key, value))
            }
        };
        const res = {
            statusCode: 200,
            headers: {},
            setHeader: jest.fn(function setHeader(name, value) {
                this.headers[name] = value;
            }),
            removeHeader: jest.fn(function removeHeader(name) {
                delete this.headers[name];
            }),
            status: jest.fn(function status(code) {
                this.statusCode = code;
                return this;
            }),
            json: jest.fn(function json(payload) {
                this.payload = payload;
                return this;
            }),
            send: jest.fn(function send(payload) {
                this.payload = payload;
                return this;
            }),
            sendFile: jest.fn(function sendFile(filePath) {
                this.filePath = filePath;
                return this;
            })
        };

        await routeHandler(method, routePath)(req, res);
        return res;
    }

    async function invokeWithAppSettings(method, routePath, settings, options = {}) {
        const req = {
            body: options.body || {},
            query: options.query || {},
            params: options.params || {},
            id: 'test-request-id',
            get: jest.fn(),
            app: {
                get: jest.fn((key) => settings[key]),
                set: jest.fn()
            }
        };
        const res = {
            statusCode: 200,
            headers: {},
            setHeader: jest.fn(function setHeader(name, value) {
                this.headers[name] = value;
            }),
            removeHeader: jest.fn(function removeHeader(name) {
                delete this.headers[name];
            }),
            status: jest.fn(function status(code) {
                this.statusCode = code;
                return this;
            }),
            json: jest.fn(function json(payload) {
                this.payload = payload;
                return this;
            }),
            send: jest.fn(function send(payload) {
                this.payload = payload;
                return this;
            }),
            sendFile: jest.fn(function sendFile(filePath) {
                this.filePath = filePath;
                return this;
            })
        };

        await routeHandler(method, routePath)(req, res);
        return res;
    }

    test('DELETE /agent/tasks should clear task history', async () => {
        agentEngine.recordTask('test-task-id', { task: 'test task' });
        expect(agentEngine.getTasks().length).toBeGreaterThan(0);

        const response = await invoke('delete', '/agent/tasks');
        expect(response.statusCode).toBe(200);
        expect(response.payload.message).toBe('Task history cleared');
        expect(agentEngine.getTasks()).toHaveLength(0);
    });

    test('DELETE /audit should clear audit logs', async () => {
        auditLog.record({ type: 'test-audit' });
        expect(auditLog.list().length).toBeGreaterThan(0);

        const response = await invoke('delete', '/audit');
        expect(response.statusCode).toBe(200);
        expect(response.payload.message).toBe('Audit logs cleared');
        expect(auditLog.list()).toHaveLength(0);
    });

    test('GET /logs returns filtered live diagnostic errors', async () => {
        logger.clear();
        logger.info('startup_completed', { userAction: 'startup' });
        logger.error('search_failed', new Error('ctx unavailable'), {
            userAction: 'code_search',
            severity: 'high'
        });

        const response = await invoke('get', '/logs', {
            query: {
                level: 'error',
                userAction: 'code_search',
                query: 'ctx unavailable',
                severity: 'high'
            }
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload.logs).toHaveLength(1);
        expect(response.payload.logs[0]).toEqual(expect.objectContaining({
            level: 'error',
            message: 'search_failed',
            userAction: 'code_search'
        }));
    });

    test('POST /logs/client-error transmits frontend failures to live logs', async () => {
        logger.clear();

        const response = await invoke('post', '/logs/client-error', {
            body: {
                message: 'Search failed in UI',
                stack: 'Error: Search failed in UI\n    at SearchWindow',
                userAction: 'code_search',
                component: 'SearchWindow',
                severity: 'high',
                context: { query: 'menu', project: 'Anchor' }
            }
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload).toEqual({ ok: true });
        expect(logger.list(10, { message: 'client_error', userAction: 'code_search' })[0]).toEqual(expect.objectContaining({
            level: 'error',
            message: 'client_error',
            component: 'SearchWindow',
            severity: 'high',
            context: { query: 'menu', project: 'Anchor' },
            error: expect.objectContaining({
                message: 'Search failed in UI',
                stack: expect.stringContaining('SearchWindow')
            })
        }));
    });


    test('GET /health reports unchecked startup dependencies as pending, not failed', async () => {
        const response = await invokeWithAppSettings('get', '/health', {
            healthState: {
                started: false,
                graphify: { ok: false, message: 'not checked' },
                ollama: { ok: false, message: 'not checked' },
                ctx: { ok: false, message: 'not checked' },
                openspec: { ok: false, message: 'not checked' },
                config: { ok: false, message: 'not checked' },
                projects: 0,
                indexed: 0,
                syncComplete: false
            },
            port: 3090
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload.status).toBe('starting');
        expect(response.payload.checks.runtime.ok).toBe(true);
        expect(response.payload.checks.graphify.ok).toBeNull();
        expect(response.payload.checks.ollama.ok).toBeNull();
        expect(response.payload.checks.ctx.ok).toBeNull();
        expect(response.payload.checks.openspec.ok).toBeNull();
        expect(response.payload.checks.config.ok).toBeNull();
        expect(response.payload.degraded).toEqual([]);
        expect(response.payload.pending).toEqual(
            expect.arrayContaining(['graphify', 'ollama', 'ctx', 'openspec', 'config'])
        );
    });

    test('GET /health preserves failed dependency checks after startup completes', async () => {
        const response = await invokeWithAppSettings('get', '/health', {
            healthState: {
                started: true,
                graphify: { ok: false, message: 'graphify not found' },
                ollama: { ok: false, message: 'ollama not found' },
                ctx: { ok: true, message: 'available' },
                openspec: { ok: true, message: 'v1.5.0 at /usr/local/bin/openspec' },
                config: { ok: true, message: 'loaded (0 dirs)' },
                projects: 0,
                indexed: 0,
                syncComplete: true
            },
            port: 3090
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload.status).toBe('degraded');
        expect(response.payload.checks.graphify.ok).toBe(false);
        expect(response.payload.checks.ollama.ok).toBe(false);
        expect(response.payload.checks.ctx.ok).toBe(true);
        expect(response.payload.checks.openspec.ok).toBe(true);
        expect(response.payload.checks.config.ok).toBe(true);
        expect(response.payload.degraded).toEqual(['graphify', 'ollama']);
    });

    test('GET /health reports a missing openspec install as degraded', async () => {
        const response = await invokeWithAppSettings('get', '/health', {
            healthState: {
                started: true,
                graphify: { ok: true, message: 'available' },
                ollama: { ok: true, message: 'v0.30.8 (running)' },
                ctx: { ok: true, message: 'available' },
                openspec: { ok: false, message: 'openspec not found' },
                config: { ok: true, message: 'loaded (0 dirs)' },
                projects: 0,
                indexed: 0,
                syncComplete: true
            },
            port: 3090
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload.status).toBe('degraded');
        expect(response.payload.degraded).toEqual(['openspec']);
        expect(response.payload.checks.openspec.ok).toBe(false);
    });

    test('GET /health reports ok once every dependency passes', async () => {
        const response = await invokeWithAppSettings('get', '/health', {
            healthState: {
                started: true,
                graphify: { ok: true, message: 'available' },
                ollama: { ok: true, message: 'v0.30.8 (running)' },
                ctx: { ok: true, message: 'v1.4.0' },
                openspec: { ok: true, message: 'v1.5.0' },
                config: { ok: true, message: 'loaded (1 dirs)' },
                projects: 1,
                indexed: 1,
                syncComplete: true
            },
            port: 3090
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload.status).toBe('ok');
        expect(response.payload.degraded).toEqual([]);
        expect(response.payload.pending).toEqual([]);
    });

    test('GET /git endpoints expose local history, heatmap, branch, and commit diff', async () => {
        const originalHistory = gitService.getCommitHistory;
        const originalHeatmap = gitService.getHeatmapData;
        const originalBranch = gitService.getBranchInfo;
        const originalDiff = gitService.getCommitDiff;

        gitService.getCommitHistory = jest.fn(async () => [{ hash: 'abc123', filesChanged: 2 }]);
        gitService.getHeatmapData = jest.fn(async () => [{ filePath: 'src/App.jsx', changeCount: 4 }]);
        gitService.getBranchInfo = jest.fn(async () => ({ currentBranch: 'main', ahead: 0, behind: 0 }));
        gitService.getCommitDiff = jest.fn(async () => ({ hash: 'abc123', files: [{ filePath: 'src/App.jsx' }] }));

        try {
            const history = await invoke('get', '/git/history', {
                query: { path: '/workspace', file: 'src/App.jsx', limit: '25' }
            });
            expect(history.statusCode).toBe(200);
            expect(history.payload.commits[0].hash).toBe('abc123');
            expect(gitService.getCommitHistory).toHaveBeenCalledWith('/workspace', 'src/App.jsx', 25);

            const heatmap = await invoke('get', '/git/heatmap', {
                query: { path: '/workspace' }
            });
            expect(heatmap.payload.files[0].changeCount).toBe(4);

            const branch = await invoke('get', '/git/branch', {
                query: { path: '/workspace' }
            });
            expect(branch.payload.currentBranch).toBe('main');

            const commit = await invoke('get', '/git/commit', {
                query: { path: '/workspace', hash: 'abc123' }
            });
            expect(commit.payload.files[0].filePath).toBe('src/App.jsx');
            expect(gitService.getCommitDiff).toHaveBeenCalledWith('/workspace', 'abc123');
        } finally {
            gitService.getCommitHistory = originalHistory;
            gitService.getHeatmapData = originalHeatmap;
            gitService.getBranchInfo = originalBranch;
            gitService.getCommitDiff = originalDiff;
        }
    });

    test('POST /ask rejects malformed payloads before reaching ctx', async () => {
        const response = await invoke('post', '/ask', { body: { question: '' } });
        expect(response.statusCode).toBe(400);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'invalid_request'
        }));
    });

    test('POST /plugins/:name/open invokes a loaded plugin for the selected workspace', async () => {
        const toolBox = require('../../backend/infrastructure/ToolBox');
        const execute = jest.fn(async ({ _action, project }) => ({ opened: true, _action, project }));
        toolBox.plugins.set('holocron-vr', {
            name: 'holocron-vr',
            permissions: [],
            execute
        });

        try {
            const response = await invoke('post', '/plugins/:name/open', {
                params: { name: 'holocron-vr' },
                body: { project: '/workspace/yodaman' }
            });

            expect(response.statusCode).toBe(200);
            expect(execute).toHaveBeenCalledWith({
                _action: 'open',
                project: '/workspace/yodaman'
            });
            expect(response.payload).toEqual(expect.objectContaining({
                ok: true,
                project: '/workspace/yodaman'
            }));
        } finally {
            toolBox.plugins.delete('holocron-vr');
        }
    });

    test('POST /plugins/:name/open rejects an unavailable plugin', async () => {
        const response = await invoke('post', '/plugins/:name/open', {
            params: { name: 'missing-plugin' },
            body: { project: '/workspace/yodaman' }
        });

        expect(response.statusCode).toBe(404);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'plugin_not_found'
        }));
    });

    test('POST /ask returns a local fallback answer when ctx ask fails', async () => {
        const originalExecute = contextEngine.execute;
        const originalQuery = graphifyService.query;
        const originalReadReport = graphifyService.readReport;
        const originalSaveResult = graphifyService.saveResult;
        const originalSearchCode = require('../../backend/infrastructure/ToolBox').searchCode;
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-rest-chat-workspace-'));

        try {
            fs.writeFileSync(configPath(), JSON.stringify({
                watchedDirectories: [workspace],
                removedDirectories: []
            }, null, 2));
            router.loadConfig();
            contextEngine.execute = jest.fn(async () => {
                throw new Error('ctx ask unavailable');
            });
            graphifyService.query = jest.fn(async () => 'Graph node: publishMenu connects menu routes.');
            graphifyService.readReport = jest.fn(() => [
                'Architecture summary mentions menu publishing.',
                '',
                '## Community Hubs (Navigation)',
                '- [[_COMMUNITY_Community 1|Community 1]]',
                '- [[_COMMUNITY_Community 2|Community 2]]',
                '',
                '## Top Nodes',
                '- MenuScreen()'
            ].join('\n'));
            graphifyService.saveResult = jest.fn(async () => ({ skipped: true }));
            require('../../backend/infrastructure/ToolBox').searchCode = jest.fn(async () => [
                {
                    content: 'function publishMenu() {}',
                    score: 0.9,
                    metadata: { path: path.join(workspace, 'menu.js') }
                }
            ]);

            const response = await invoke('post', '/ask', {
                body: {
                    question: 'menu',
                    projectId: workspace,
                }
            });

            expect(response.statusCode).toBe(200);
            expect(contextEngine.execute).toHaveBeenCalledWith(
                expect.arrayContaining(['ask', '--']),
                expect.objectContaining({ timeoutMs: expect.any(Number) })
            );
            expect(response.payload.answer).toContain('YodaMan could not reach ctx ask');
            expect(response.payload.answer).toContain('publishMenu');
            expect(response.payload.answer).toContain('Graph node');
            expect(response.payload.answer).toContain('Top Nodes');
            expect(response.payload.answer).not.toContain('Community Hubs');
            expect(response.payload.answer).not.toContain('_COMMUNITY_Community');
        } finally {
            contextEngine.execute = originalExecute;
            graphifyService.query = originalQuery;
            graphifyService.readReport = originalReadReport;
            graphifyService.saveResult = originalSaveResult;
            require('../../backend/infrastructure/ToolBox').searchCode = originalSearchCode;
            router.loadConfig();
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    test('GET /sessions returns structured errors for missing project id', async () => {
        const response = await invoke('get', '/sessions');
        expect(response.statusCode).toBe(400);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'invalid_project_id'
        }));
    });

    test('POST /reindex rejects missing workspace paths with a useful error', async () => {
        const response = await invoke('post', '/reindex', {
            body: { path: '/definitely/not/a/yodaman/workspace' }
        });

        expect(response.statusCode).toBe(404);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'workspace_not_registered',
            error: expect.stringContaining('Workspace is not registered')
        }));
    });

    test('GET /projects does not promote ctx-only temp projects into saved workspaces', async () => {
        const originalExecuteJson = contextEngine.executeJson;
        const originalConfig = fs.existsSync(configPath()) ? fs.readFileSync(configPath(), 'utf8') : undefined;
        // Portable stand-in for a registered workspace — never a real home path,
        // which would leak the developer's username into the public repository.
        const anchorPath = path.join(os.tmpdir(), 'yodaman-registered-Anchor');
        const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graph-studio-'));

        try {
            fs.writeFileSync(configPath(), JSON.stringify({
                watchedDirectories: [anchorPath],
                removedDirectories: []
            }, null, 2));
            router.loadConfig();
            contextEngine.executeJson = jest.fn(async () => ({
                projects: [
                    { name: 'Anchor', path: anchorPath, id: anchorPath },
                    { name: path.basename(tempWorkspace), path: tempWorkspace, id: tempWorkspace }
                ]
            }));

            const response = await invoke('get', '/projects');
            const savedConfig = JSON.parse(fs.readFileSync(configPath(), 'utf8'));

            expect(response.statusCode).toBe(200);
            expect(response.payload.map(project => project.path)).toContain(anchorPath);
            expect(response.payload.map(project => project.path)).not.toContain(tempWorkspace);
            expect(savedConfig.watchedDirectories).toEqual([anchorPath]);
        } finally {
            contextEngine.executeJson = originalExecuteJson;
            if (originalConfig === undefined) {
                fs.rmSync(configPath(), { force: true });
            } else {
                fs.writeFileSync(configPath(), originalConfig);
            }
            router.loadConfig();
            fs.rmSync(tempWorkspace, { recursive: true, force: true });
        }
    });

    test('DELETE /plugins/:name refuses to remove mandatory Graphify plugin', async () => {
        const response = await invoke('delete', '/plugins/:name', {
            params: { name: 'graphify' }
        });

        expect(response.statusCode).toBe(403);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'mandatory_plugin'
        }));
    });

    test('security defaults require remote pairing tokens', () => {
        const original = process.env.YODAMAN_REQUIRE_PAIRING_TOKEN;
        delete process.env.YODAMAN_REQUIRE_PAIRING_TOKEN;

        try {
            expect(router.isPairingRequiredByDefault()).toBe(true);
        } finally {
            if (original === undefined) {
                delete process.env.YODAMAN_REQUIRE_PAIRING_TOKEN;
            } else {
                process.env.YODAMAN_REQUIRE_PAIRING_TOKEN = original;
            }
        }
    });

    test('plugin uploads are disabled by default and filenames are restricted', () => {
        const original = process.env.YODAMAN_ALLOW_PLUGIN_UPLOADS;
        delete process.env.YODAMAN_ALLOW_PLUGIN_UPLOADS;

        try {
            expect(router.arePluginUploadsEnabled()).toBe(false);
            expect(() => router.safePluginFilename('../evil.js')).toThrow('Invalid plugin filename');
            expect(() => router.safePluginFilename('evil.txt')).toThrow('Plugin upload must be a .js or .zip file');
            expect(router.safePluginFilename('good-plugin.js')).toBe('good-plugin.js');
        } finally {
            if (original === undefined) {
                delete process.env.YODAMAN_ALLOW_PLUGIN_UPLOADS;
            } else {
                process.env.YODAMAN_ALLOW_PLUGIN_UPLOADS = original;
            }
        }
    });

    describe('Graphify artifact routes', () => {
        let workspace;
        let originalConfig;

        beforeEach(() => {
            workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-rest-graph-workspace-'));
            fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
            originalConfig = fs.existsSync(configPath())
                ? fs.readFileSync(configPath(), 'utf8')
                : undefined;
            fs.writeFileSync(configPath(), JSON.stringify({
                watchedDirectories: [workspace],
                removedDirectories: []
            }, null, 2));
            router.loadConfig();
        });

        afterEach(() => {
            if (originalConfig === undefined) {
                fs.rmSync(configPath(), { force: true });
            } else {
                fs.writeFileSync(configPath(), originalConfig);
            }
            router.loadConfig();
            watcherService.removeWatcher?.(workspace);
            fs.rmSync(workspace, { recursive: true, force: true });
        });

        test('GET /graphify/artifact serves a known generated artifact', async () => {
            const artifactPath = path.join(workspace, 'graphify-out', 'graph.html');
            fs.writeFileSync(artifactPath, '<html><body>graph</body></html>');

            const response = await invoke('get', '/graphify/artifact', {
                query: { path: workspace, type: 'mindmap' }
            });

            expect(response.statusCode).toBe(200);
            expect(response.payload).toContain('<html><body>graph</body></html>');
            // 'unsafe-inline' is still required: Graphify writes the graph data
            // and its init call as inline <script> blocks we do not control.
            expect(response.headers['Content-Security-Policy']).toContain("'unsafe-inline'");
            // But the CDN and 'unsafe-eval' are gone — vis-network is served from
            // /vendor now (GraphifyService.localizeVendorScripts).
            expect(response.headers['Content-Security-Policy']).not.toContain('unpkg.com');
            expect(response.headers['Content-Security-Policy']).not.toContain("'unsafe-eval'");
        });

        test('GET /graphify/artifact allows same-origin embedding in Graph Studio', async () => {
            const artifactPath = path.join(workspace, 'graphify-out', 'graph.html');
            fs.writeFileSync(artifactPath, '<html><body>graph</body></html>');

            const response = await invoke('get', '/graphify/artifact', {
                query: { path: workspace, type: 'mindmap' }
            });

            expect(response.statusCode).toBe(200);
            expect(response.headers['X-Frame-Options']).toBe('SAMEORIGIN');
            expect(response.headers['X-Frame-Options']).not.toBe('DENY');
        });

        test('GET /graphify/artifact rejects unknown artifact types', async () => {
            const response = await invoke('get', '/graphify/artifact', {
                query: { path: workspace, type: 'passwd' }
            });

            expect(response.statusCode).toBe(400);
            expect(response.payload).toEqual(expect.objectContaining({
                code: 'invalid_graphify_artifact'
            }));
        });

        test('GET /graphify/artifact reports missing generated artifacts', async () => {
            const response = await invoke('get', '/graphify/artifact', {
                query: { path: workspace, type: 'visualizer' }
            });

            expect(response.statusCode).toBe(404);
            expect(response.payload).toEqual(expect.objectContaining({
                code: 'graphify_artifact_missing'
            }));
        });

        test('GET /graphify/artifact rejects non-file generated artifacts', async () => {
            fs.mkdirSync(path.join(workspace, 'graphify-out', 'graph.html'));

            const response = await invoke('get', '/graphify/artifact', {
                query: { path: workspace, type: 'mindmap' }
            });

            expect(response.statusCode).toBe(404);
            expect(response.payload).toEqual(expect.objectContaining({
                code: 'graphify_artifact_missing'
            }));
        });

        test('GET /graphify/artifact rejects symlinked generated artifacts', async () => {
            const externalFile = path.join(os.tmpdir(), `yodaman-graph-artifact-${Date.now()}.html`);
            const artifactPath = path.join(workspace, 'graphify-out', 'graph.html');
            fs.writeFileSync(externalFile, '<html><body>outside</body></html>');

            try {
                fs.symlinkSync(externalFile, artifactPath);
            } catch (_err) {
                fs.rmSync(externalFile, { force: true });
                return;
            }

            try {
                const response = await invoke('get', '/graphify/artifact', {
                    query: { path: workspace, type: 'mindmap' }
                });

                expect(response.statusCode).toBe(404);
                expect(response.payload).toEqual(expect.objectContaining({
                    code: 'graphify_artifact_missing'
                }));
            } finally {
                fs.rmSync(externalFile, { force: true });
            }
        });

        test('GET /graphify/artifact rejects symlinked graphify output directories', async () => {
            const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graph-out-'));
            fs.writeFileSync(path.join(externalDir, 'graph.html'), '<html><body>outside</body></html>');
            fs.rmSync(path.join(workspace, 'graphify-out'), { recursive: true, force: true });

            try {
                fs.symlinkSync(externalDir, path.join(workspace, 'graphify-out'), 'dir');
            } catch (_err) {
                fs.rmSync(externalDir, { recursive: true, force: true });
                fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
                return;
            }

            try {
                const response = await invoke('get', '/graphify/artifact', {
                    query: { path: workspace, type: 'mindmap' }
                });

                expect(response.statusCode).toBe(404);
                expect(response.payload).toEqual(expect.objectContaining({
                    code: 'graphify_artifact_missing'
                }));
            } finally {
                fs.rmSync(externalDir, { recursive: true, force: true });
            }
        });

        test('GET /graphify/report returns markdown report text', async () => {
            fs.writeFileSync(path.join(workspace, 'graphify-out', 'graph_report.md'), '# Report\n\nHello graph.');

            const response = await invoke('get', '/graphify/report', {
                query: { path: workspace }
            });

            expect(response.statusCode).toBe(200);
            expect(response.payload).toEqual({
                path: workspace,
                report: '# Report\n\nHello graph.',
                reportPath: path.join(workspace, 'graphify-out', 'graph_report.md')
            });
        });

        test('GET /graphify/report rejects symlinked graphify output directories', async () => {
            const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graph-out-'));
            fs.writeFileSync(path.join(externalDir, 'graph_report.md'), '# Outside report');
            fs.rmSync(path.join(workspace, 'graphify-out'), { recursive: true, force: true });

            try {
                fs.symlinkSync(externalDir, path.join(workspace, 'graphify-out'), 'dir');
            } catch (_err) {
                fs.rmSync(externalDir, { recursive: true, force: true });
                fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
                return;
            }

            try {
                const response = await invoke('get', '/graphify/report', {
                    query: { path: workspace }
                });

                expect(response.statusCode).toBe(404);
                expect(response.payload).toEqual(expect.objectContaining({
                    code: 'graphify_report_missing'
                }));
            } finally {
                fs.rmSync(externalDir, { recursive: true, force: true });
            }
        });

        test('GET /graphify/report rejects symlinked reports', async () => {
            const externalFile = path.join(os.tmpdir(), `yodaman-graph-report-${Date.now()}.md`);
            const reportPath = path.join(workspace, 'graphify-out', 'graph_report.md');
            fs.writeFileSync(externalFile, '# Outside report');

            try {
                fs.symlinkSync(externalFile, reportPath);
            } catch (_err) {
                fs.rmSync(externalFile, { force: true });
                return;
            }

            try {
                const response = await invoke('get', '/graphify/report', {
                    query: { path: workspace }
                });

                expect(response.statusCode).toBe(404);
                expect(response.payload).toEqual(expect.objectContaining({
                    code: 'graphify_report_missing'
                }));
            } finally {
                fs.rmSync(externalFile, { force: true });
            }
        });

        test('GET /graphify/report rejects non-file reports', async () => {
            fs.mkdirSync(path.join(workspace, 'graphify-out', 'graph_report.md'));

            const response = await invoke('get', '/graphify/report', {
                query: { path: workspace }
            });

            expect(response.statusCode).toBe(404);
            expect(response.payload).toEqual(expect.objectContaining({
                code: 'graphify_report_missing'
            }));
        });

        test('POST /graphify/build queues a build and exposes job status', async () => {
            const originalBuild = graphifyService.build;
            graphifyService.build = jest.fn(async () => ({ graphPath: path.join(workspace, 'graphify-out', 'graph.json'), output: 'ok' }));

            try {
                const queued = await invoke('post', '/graphify/build', {
                    body: { path: workspace }
                });

                expect(queued.statusCode).toBe(202);
                expect(queued.payload).toEqual(expect.objectContaining({
                    message: 'Graphify build queued',
                    jobId: expect.any(String),
                    path: workspace
                }));

                await new Promise(resolve => setImmediate(resolve));

                const status = await invoke('get', '/graphify/build/status', {
                    query: { path: workspace, jobId: queued.payload.jobId }
                });

                expect(status.statusCode).toBe(200);
                expect(status.payload.job).toEqual(expect.objectContaining({
                    id: queued.payload.jobId,
                    state: 'succeeded'
                }));
                expect(graphifyService.build).toHaveBeenCalledWith(workspace, { update: true });
            } finally {
                graphifyService.build = originalBuild;
            }
        });
    });
});
