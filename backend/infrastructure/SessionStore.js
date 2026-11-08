const fs = require('fs');
const logger = require('./Logger');

const { dataFile, prepareDataDir } = require('./DataPaths');

// The data folder, not the install folder: upgrades replace the install, and a
// signed macOS app cannot write inside itself. prepareDataDir copies an older
// install's sessions.json across first.
prepareDataDir();
const SESSIONS_FILE = dataFile('sessions.json');

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
                logger.error('sessionstore_load_failed', err);
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
        // Cap sessions at 200 messages per workspace to prevent unbounded growth.
        // The audit log is the permanent record; sessions can be ephemeral.
        if (this.sessions[projectId].length > 200) {
            this.sessions[projectId] = this.sessions[projectId].slice(-200);
        }
        this.save();
    }


    clearSession(projectId) {
        this.sessions[projectId] = [];
        this.save();
    }
}

module.exports = new SessionStore();
