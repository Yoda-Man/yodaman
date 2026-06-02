const fs = require('fs');
const os = require('os');
const path = require('path');
const router = require('../../backend/interfaces/RestController');
const agentEngine = require('../../backend/core/AgentReasoningEngine');
const auditLog = require('../../backend/infrastructure/AuditLog');

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
    });
});
