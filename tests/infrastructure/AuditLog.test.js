const auditLog = require('../../backend/infrastructure/AuditLog');
const toolBox = require('../../backend/infrastructure/ToolBox');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('AuditLog', () => {
    let tempDir;

    beforeEach(() => {
        auditLog.clear();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-audit-test-'));
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        auditLog.clear();
    });

    test('callTool should record successful tool calls', async () => {
        const filePath = path.join(tempDir, 'audit.txt');

        await toolBox.callTool('writeFile', {
            filePath,
            content: 'audit me'
        });

        const entries = auditLog.list();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            type: 'tool_call',
            tool: 'writeFile',
            status: 'success'
        });
        expect(entries[0].parameters.content).toBe('[8 chars]');
    });

    test('callTool should record failed tool calls', async () => {
        await expect(toolBox.callTool('readFile', {
            filePath: '/not/allowed/file.txt'
        })).rejects.toThrow();

        const entries = auditLog.list();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            type: 'tool_call',
            tool: 'readFile',
            status: 'error'
        });
    });

    test('list should return the newest entries first and respect limits', () => {
        auditLog.record({ type: 'first' });
        auditLog.record({ type: 'second' });
        auditLog.record({ type: 'third' });

        expect(auditLog.list(2).map((entry) => entry.type)).toEqual(['third', 'second']);
    });
});
