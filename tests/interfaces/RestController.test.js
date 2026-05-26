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
});
