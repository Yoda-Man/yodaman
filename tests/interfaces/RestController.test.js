const express = require('express');
const axios = require('axios');
const router = require('../../backend/interfaces/RestController');
const agentEngine = require('../../backend/core/AgentReasoningEngine');
const auditLog = require('../../backend/infrastructure/AuditLog');

describe('RestController Integration', () => {
    let app;
    let server;
    let baseUrl;

    beforeAll((done) => {
        app = express();
        app.use(express.json());
        app.use('/api', router);
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://localhost:${port}/api`;
            done();
        });
    });

    afterAll((done) => {
        server.close(done);
    });

    test('DELETE /agent/tasks should clear task history', async () => {
        agentEngine.recordTask('test-task-id', { task: 'test task' });
        expect(agentEngine.getTasks().length).toBeGreaterThan(0);

        const response = await axios.delete(`${baseUrl}/agent/tasks`);
        expect(response.status).toBe(200);
        expect(response.data.message).toBe('Task history cleared');
        expect(agentEngine.getTasks()).toHaveLength(0);
    });

    test('DELETE /audit should clear audit logs', async () => {
        auditLog.record({ type: 'test-audit' });
        expect(auditLog.list().length).toBeGreaterThan(0);

        const response = await axios.delete(`${baseUrl}/audit`);
        expect(response.status).toBe(200);
        expect(response.data.message).toBe('Audit logs cleared');
        expect(auditLog.list()).toHaveLength(0);
    });
});
