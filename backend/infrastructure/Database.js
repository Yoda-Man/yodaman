const fs = require('fs');
const path = require('path');

let db = null;
let useSqlite = false;

// Overridable so tests can use a throwaway database. Without this the suite
// wrote into the live `yodaman.db`, leaving fake `test-task-*` rows in the
// user's real task history and failing whenever the app held the file open.
// Mirrors the existing YODAMAN_CONFIG_PATH convention.
const DB_PATH = process.env.YODAMAN_DB_PATH || path.join(__dirname, '../../yodaman.db');

try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(DB_PATH);
    useSqlite = true;

    // Initialize tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
            taskId TEXT PRIMARY KEY,
            task TEXT,
            projectId TEXT,
            status TEXT,
            createdAt TEXT,
            updatedAt TEXT,
            pendingApproval TEXT,
            finalAnswer TEXT,
            error TEXT,
            events TEXT
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT,
            entry TEXT
        );
    `);
} catch (err) {
    console.warn('[Database] SQLite not supported or failed to initialize, falling back to JSON storage:', err.message);
    db = null;
    useSqlite = false;
}

module.exports = {
    db,
    useSqlite,
    dbPath: DB_PATH
};
