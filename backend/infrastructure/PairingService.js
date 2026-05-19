const crypto = require('crypto');
const os = require('os');

class PairingService {
    constructor() {
        this.tokens = new Map();
        this.ttlMs = 24 * 60 * 60 * 1000;
    }

    createPairing(baseUrl) {
        const runtimeUrl = baseUrl || this.getLanRuntimeUrl();
        const token = crypto.randomBytes(24).toString('base64url');
        const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();

        this.tokens.set(token, {
            createdAt: new Date().toISOString(),
            expiresAt
        });

        const link = `yodaman://pair?url=${encodeURIComponent(runtimeUrl)}&token=${encodeURIComponent(token)}`;
        return {
            runtimeUrl,
            token,
            expiresAt,
            link,
            deepLink: link
        };
    }

    validate(token) {
        if (!token) return false;
        const entry = this.tokens.get(token);
        if (!entry) return false;
        if (Date.parse(entry.expiresAt) < Date.now()) {
            this.tokens.delete(token);
            return false;
        }
        return true;
    }

    list() {
        const now = Date.now();
        for (const [token, entry] of this.tokens.entries()) {
            if (Date.parse(entry.expiresAt) < now) {
                this.tokens.delete(token);
            }
        }

        return Array.from(this.tokens.values());
    }

    revoke(token) {
        return this.tokens.delete(token);
    }

    getLanRuntimeUrl(port = 3090) {
        const interfaces = os.networkInterfaces();
        for (const entries of Object.values(interfaces)) {
            for (const entry of entries || []) {
                if (entry.family === 'IPv4' && !entry.internal) {
                    return `http://${entry.address}:${port}`;
                }
            }
        }
        return `http://127.0.0.1:${port}`;
    }
}

module.exports = new PairingService();
