const fs = require('fs');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '../../audit-log.json');
const MAX_ENTRIES = 500;

class AuditLog {
    constructor() {
        this.entries = [];
        this.load();
    }

    load() {
        if (!fs.existsSync(AUDIT_FILE)) return;

        try {
            this.entries = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
        } catch (err) {
            console.error('[AuditLog] Failed to load audit log:', err.message);
            this.entries = [];
        }
    }

    save() {
        fs.writeFileSync(AUDIT_FILE, JSON.stringify(this.entries.slice(-MAX_ENTRIES), null, 2));
    }

    record(entry) {
        const item = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            timestamp: new Date().toISOString(),
            ...entry
        };

        this.entries.push(item);
        if (this.entries.length > MAX_ENTRIES) {
            this.entries = this.entries.slice(-MAX_ENTRIES);
        }
        this.save();
        return item;
    }

    list(limit = 100) {
        return this.entries.slice(-Number(limit || 100)).reverse();
    }

    clear() {
        this.entries = [];
        this.save();
    }
}

module.exports = new AuditLog();

