const fs = require('fs');
const path = require('path');

const SESSIONS_FILE = path.join(__dirname, '../../sessions.json');

/**
 * SessionStore (Infrastructure Layer)
 * 
 * Simple JSON-based persistence for chat sessions.
 */
class SessionStore {
    constructor() {
        this.sessions = {};
        this.load();
    }

    load() {
        if (fs.existsSync(SESSIONS_FILE)) {
            try {
                this.sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            } catch (err) {
                console.error('[SessionStore] Failed to load sessions:', err.message);
                this.sessions = {};
            }
        }
    }

    save() {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(this.sessions, null, 2));
    }

    getMessages(projectId) {
        return this.sessions[projectId] || [];
    }

    saveMessage(projectId, message) {
        if (!this.sessions[projectId]) {
            this.sessions[projectId] = [];
        }
        // message can now include { role, content, timestamp, isAgent, steps }
        this.sessions[projectId].push(message);
        this.save();
    }


    clearSession(projectId) {
        this.sessions[projectId] = [];
        this.save();
    }
}

module.exports = new SessionStore();
