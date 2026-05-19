const fs = require('fs');
const path = require('path');

const AUDIT_FILE = path.join(__dirname, '../../audit-log.json');
const AUDIT_JSONL_FILE = path.join(__dirname, '../../audit-log.jsonl');
const MAX_ENTRIES = 500;

class AuditLog {
    constructor() {
        this.entries = [];
        this.load();
    }

    load() {
        if (fs.existsSync(AUDIT_JSONL_FILE)) {
            try {
                this.entries = fs.readFileSync(AUDIT_JSONL_FILE, 'utf8')
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => JSON.parse(line))
                    .slice(-MAX_ENTRIES);
                return;
            } catch (err) {
                console.error('[AuditLog] Failed to load append-only audit log:', err.message);
                this.entries = [];
            }
        }

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

    append(item) {
        fs.appendFileSync(AUDIT_JSONL_FILE, `${JSON.stringify(item)}\n`);
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
        this.append(item);
        this.save();
        return item;
    }

    list(limit = 100) {
        return this.entries.slice(-Number(limit || 100)).reverse();
    }

    clear() {
        this.entries = [];
        fs.writeFileSync(AUDIT_JSONL_FILE, '');
        this.save();
    }
}

module.exports = new AuditLog();
