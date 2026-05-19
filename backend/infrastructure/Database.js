const fs = require('fs');
const path = require('path');

let db = null;
let useSqlite = false;

try {
    const { DatabaseSync } = require('node:sqlite');
    const dbPath = path.join(__dirname, '../../yodaman.db');
    db = new DatabaseSync(dbPath);
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
    useSqlite
};
