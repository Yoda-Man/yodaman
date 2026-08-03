const fs = require('fs');
const os = require('os');
const path = require('path');

// Use a throwaway database: the suite used to write into the live yodaman.db,
// polluting real task history and failing whenever the app held the file open.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-db-test-'));
process.env.YODAMAN_DB_PATH = path.join(tempDir, 'test.db');

const TaskStore = require('../../backend/infrastructure/TaskStore');
const AuditLog = require('../../backend/infrastructure/AuditLog');
const { db, useSqlite, dbPath } = require('../../backend/infrastructure/Database');

afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Database Infrastructure (SQLite)', () => {
    it('never touches the real yodaman.db', () => {
        // A regression here means the suite is writing into the user's live
        // database again — the cause of both fake task rows and lock flakes.
        expect(dbPath).toBe(process.env.YODAMAN_DB_PATH);
        expect(dbPath).not.toMatch(/[/\\]yodaman\.db$/);
    });

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
