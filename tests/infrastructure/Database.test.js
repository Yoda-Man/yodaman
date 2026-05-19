const TaskStore = require('../../backend/infrastructure/TaskStore');
const AuditLog = require('../../backend/infrastructure/AuditLog');
const { db, useSqlite } = require('../../backend/infrastructure/Database');

describe('Database Infrastructure (SQLite)', () => {
    it('should initialize and support SQLite when available', () => {
        expect(typeof useSqlite).toBe('boolean');
        if (useSqlite) {
            expect(db).not.toBeNull();
        }
    });

    if (useSqlite) {
        it('should read/write tasks to/from SQLite', () => {
            const taskId = `test-task-${Date.now()}`;
            const testTask = {
                taskId,
                task: 'Verify SQLite',
                status: 'completed',
                events: [{ type: 'task_started', message: 'Starting...' }]
            };

            TaskStore.upsert(taskId, testTask);

            // Read directly from DB to verify it's persisted in SQLite
            const stmt = db.prepare('SELECT * FROM tasks WHERE taskId = ?');
            const row = stmt.get(taskId);
            expect(row).toBeDefined();
            expect(row.task).toBe('Verify SQLite');
            expect(JSON.parse(row.events)[0].type).toBe('task_started');

            // Read via TaskStore
            const retrieved = TaskStore.get(taskId);
            expect(retrieved).toBeDefined();
            expect(retrieved.task).toBe('Verify SQLite');
        });

        it('should read/write audit logs to/from SQLite', () => {
            const auditEntry = {
                action: 'user_login',
                details: { ip: '127.0.0.1' }
            };

            const recorded = AuditLog.record(auditEntry);
            expect(recorded.id).toBeDefined();

            // Read directly from DB to verify persistence
            const stmt = db.prepare('SELECT * FROM audit_logs WHERE id = ?');
            const row = stmt.get(recorded.id);
            expect(row).toBeDefined();
            
            const parsedEntry = JSON.parse(row.entry);
            expect(parsedEntry.action).toBe('user_login');
            expect(parsedEntry.details.ip).toBe('127.0.0.1');
        });
    }
});
