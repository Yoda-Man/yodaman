const fs = require('fs');
const os = require('os');
const path = require('path');
const router = require('../../backend/interfaces/RestController');
const agentEngine = require('../../backend/core/AgentReasoningEngine');
const auditLog = require('../../backend/infrastructure/AuditLog');
const graphifyService = require('../../backend/infrastructure/GraphifyService');
const logger = require('../../backend/infrastructure/Logger');

describe('RestController Integration', () => {
    function routeHandler(method, routePath) {
        const layer = router.stack.find((item) => item.route?.path === routePath && item.route?.methods[method]);
        return layer.route.stack[0].handle;
    }

    async function invoke(method, routePath, { body = {}, query = {}, params = {} } = {}) {
        const req = {
            body,
            query,
            params,
            id: 'test-request-id',
            get: jest.fn()
        };
        const res = {
            statusCode: 200,
            headers: {},
            setHeader: jest.fn(function setHeader(name, value) {
                this.headers[name] = value;
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

    test('POST /mode validates query mode values', async () => {
        const ok = await invoke('post', '/mode', { body: { mode: 'doc' } });
        expect(ok.statusCode).toBe(200);
        expect(ok.payload.mode).toBe('doc');

        const rejected = await invoke('post', '/mode', { body: { mode: 'everything' } });
        expect(rejected.statusCode).toBe(400);
        expect(rejected.payload).toEqual(expect.objectContaining({
            code: 'invalid_mode'
        }));
    });

    test('POST /ask rejects malformed payloads before reaching ctx', async () => {
        const response = await invoke('post', '/ask', { body: { question: '', mode: 'code' } });
        expect(response.statusCode).toBe(400);
        expect(response.payload).toEqual(expect.objectContaining({
            code: 'invalid_request'
        }));
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
            expect(() => router.safePluginFilename('evil.txt')).toThrow('Plugin upload must be a JavaScript file');
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
            workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-graph-studio-'));
            fs.mkdirSync(path.join(workspace, 'graphify-out'), { recursive: true });
            originalConfig = fs.existsSync('config.json')
                ? fs.readFileSync('config.json', 'utf8')
                : undefined;
            fs.writeFileSync('config.json', JSON.stringify({
                watchedDirectories: [workspace],
                removedDirectories: []
            }, null, 2));
            router.loadConfig();
        });

        afterEach(() => {
            if (originalConfig === undefined) {
                fs.rmSync('config.json', { force: true });
            } else {
                fs.writeFileSync('config.json', originalConfig);
            }
            router.loadConfig();
            fs.rmSync(workspace, { recursive: true, force: true });
        });

        test('GET /graphify/artifact serves a known generated artifact', async () => {
            const artifactPath = path.join(workspace, 'graphify-out', 'graph.html');
            fs.writeFileSync(artifactPath, '<html><body>graph</body></html>');

            const response = await invoke('get', '/graphify/artifact', {
                query: { path: workspace, type: 'mindmap' }
            });

            expect(response.statusCode).toBe(200);
            expect(response.filePath).toBe(artifactPath);
            expect(response.headers['Content-Security-Policy']).toContain("'unsafe-inline'");
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
            } catch (err) {
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
            } catch (err) {
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
            } catch (err) {
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
            } catch (err) {
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
