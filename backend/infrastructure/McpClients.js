/**
 * Which agents have read this workspace through MCP, and when.
 *
 * YodaMan's promise is that code never leaves the machine. Once other agents
 * can query it, the natural extension of that promise is being able to see who
 * looked — not just "nothing left", but "here is exactly who read it". No tool
 * that ships your code elsewhere can offer that.
 *
 * WHAT THIS DELIBERATELY DOES NOT HOLD:
 *
 * Queries, arguments, results, or file paths. A record of what an agent asked
 * about your codebase is a record of what YOU were working on, and that is
 * surveillance of the user's own work wearing a transparency badge. Identity,
 * a count, and a timestamp answer "is Cursor connected, and has it been
 * reading?" — which is the question people actually have — and nothing more.
 *
 * "LAST SEEN", NOT "CONNECTED":
 *
 * Each client spawns its own stdio `yodaman-mcp` process. Some hold it open,
 * some spawn per request, and a crashed client leaves nothing behind. There is
 * no connection to observe, only requests that have arrived. A green dot that
 * is wrong half the time is worse than no dot, so this reports the fact it has
 * — when a client was last heard from — and lets the UI phrase it honestly.
 *
 * In memory only. It is a live view, not an audit log; the audit log is a
 * separate feature with separate consequences.
 */
const logger = require('./Logger');

/** Header the MCP server sets. Identity only — see the note above. */
const CLIENT_HEADER = 'x-yodaman-mcp-client';

/**
 * Bounded so a misbehaving or spoofed client cannot grow this without limit.
 * Nobody runs twenty different agents; a number far above real use is still a
 * cap.
 */
const MAX_CLIENTS = 20;

/** Label length cap. The header is attacker-controllable in principle. */
const MAX_LABEL = 120;

/** @type {Map<string, {label: string, calls: number, firstSeen: number, lastSeen: number, seq: number}>} */
const clients = new Map();

/**
 * Monotonic tiebreak for "most recent".
 *
 * Date.now() has millisecond resolution, and two clients can easily be recorded
 * inside the same millisecond — a fresh runtime answering two agents at once
 * does it routinely. Sorting on the timestamp alone then leaves the order to
 * chance, which showed up as a test that passed alone and failed in a full run.
 * A counter makes "most recently seen" well defined regardless of clock
 * resolution.
 */
let sequence = 0;

/** Test seam. */
function reset() {
    clients.clear();
    sequence = 0;
}

/**
 * Record one request from an MCP client.
 *
 * @param {string} rawLabel - The header value, as sent.
 */
function record(rawLabel) {
    if (typeof rawLabel !== 'string') return null;

    // Control characters would corrupt a log line and could smuggle terminal
    // escapes into somebody's console.
    const label = rawLabel
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, MAX_LABEL);
    if (!label) return null;

    const now = Date.now();
    const existing = clients.get(label);

    if (existing) {
        existing.calls += 1;
        existing.lastSeen = now;
        existing.seq = ++sequence;
        return existing;
    }

    if (clients.size >= MAX_CLIENTS) {
        // Drop the least recently seen rather than refusing the new one: a
        // client that just arrived is more interesting than one silent for
        // hours.
        let oldest = null;
        for (const [key, value] of clients.entries()) {
            if (!oldest || value.lastSeen < oldest.value.lastSeen) oldest = { key, value };
        }
        if (oldest) clients.delete(oldest.key);
    }

    const entry = { label, calls: 1, firstSeen: now, lastSeen: now, seq: ++sequence };
    clients.set(label, entry);
    logger.info('mcp_client_seen', { client: label });
    return entry;
}

/**
 * Express middleware. Records the header when present and never blocks.
 */
function middleware(req, _res, next) {
    try {
        const label = req.headers?.[CLIENT_HEADER];
        if (label) record(label);
    } catch (err) {
        // Visibility must never be the reason a request fails.
        logger.warn('mcp_client_record_failed', { reason: err?.message });
    }
    next();
}

/**
 * Clients seen this runtime session, most recent first.
 *
 * `lastSeen` is an ISO timestamp so the caller can phrase the age itself —
 * "2 minutes ago" is a presentation decision, not a data one.
 */
function list() {
    return [...clients.values()]
        // seq, not lastSeen: same-millisecond arrivals must still order.
        .sort((a, b) => b.seq - a.seq)
        .map((entry) => ({
            label: entry.label,
            calls: entry.calls,
            firstSeen: new Date(entry.firstSeen).toISOString(),
            lastSeen: new Date(entry.lastSeen).toISOString()
        }));
}

module.exports = { middleware, record, list, reset, CLIENT_HEADER, MAX_CLIENTS, MAX_LABEL };
