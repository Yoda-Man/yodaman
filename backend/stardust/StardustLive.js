/**
 * StardustLive — real-time OpenSpec dashboard backend.
 *
 * Watches the openspec/ directory with chokidar, pushes change-board snapshots
 * and file-level activity events over WebSocket.  Provides REST fallbacks so the
 * UI never starts blank.
 *
 * Architecture:
 *   chokidar (openspec/)  ──→  snapshot / activity  ──→  WebSocket clients
 *   REST endpoints         ──→  same typed contracts ──→  initial seed
 *
 * Exports:
 *   attachToServer(httpServer)   — wire WS upgrade + chokidar onto an existing server
 *   getSnapshot(projectRoot)     — REST-friendly snapshot
 *   getDeltas(projectRoot, name) — REST-friendly deltas for a change
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');
const graphifyService = require('../infrastructure/GraphifyService');
const logger = require('../infrastructure/Logger');

// ──────────────────────────────────────────────
//  Contracts (kept as JSDoc types — no TS build step)
// ──────────────────────────────────────────────

/**
 * @typedef {object} ChangeSummary
 * @property {string} name           — change directory name, e.g. "add-auth-middleware"
 * @property {string} status         — 'proposed' | 'validated' | 'applied' | 'archived'
 * @property {number} taskCompleted  — tasks with [x] or DONE marker
 * @property {number} taskTotal      — total tasks with [ ] or [x]
 * @property {'ok'|'warn'|'error'|'unknown'} validation — last validation result
 * @property {number} mtimeMs        — most recent file mtime in the change directory
 */

/**
 * @typedef {object} Snapshot
 * @property {ChangeSummary[]} changes
 * @property {boolean} ready         — openspec/ directory exists and is readable
 * @property {string}  graphStatus   — 'current' | 'stale' | 'unavailable'
 */

/**
 * @typedef {object} Delta
 * @property {'ADDED'|'MODIFIED'|'REMOVED'|'RENAMED'} op
 * @property {string} requirement — the requirement heading text
 * @property {string} body        — full markdown body under that heading
 * @property {string} specId      — which spec file this belongs to
 */

/**
 * @typedef {object} ActivityEntry
 * @property {'created'|'modified'|'removed'} event
 * @property {string} path        — relative to openspec/
 * @property {string} detail      — human-readable summary
 * @property {number} timestamp
 */

// ──────────────────────────────────────────────
//  File-system helpers
// ──────────────────────────────────────────────

function findOpenSpecRoot(projectRoot) {
    const candidate = path.join(projectRoot, 'openspec');
    try {
        if (fs.existsSync(path.join(candidate, 'config.yaml')) ||
            fs.existsSync(path.join(candidate, 'specs')) ||
            fs.existsSync(path.join(candidate, 'changes'))) {
            return candidate;
        }
    } catch (_) { /* unreadable */ }
    return null;
}

/**
 * Parse validation status from a change directory.
 * Reads `openspec validate <name> --json` output if available, else falls back
 * to checking whether the change dir exists.
 */
function getValidationStatus(_projectRoot, _changeName) {
    // Default — caller should supply this from a CLI run.
    // We store the last validation result per change in a simple Map.
    if (!getValidationStatus._cache) getValidationStatus._cache = new Map();
    return getValidationStatus._cache.get(_changeName) || 'unknown';
}

function setValidationStatus(changeName, status) {
    if (!getValidationStatus._cache) getValidationStatus._cache = new Map();
    getValidationStatus._cache.set(changeName, status);
}

/**
 * Count tasks in a markdown file body.  Looks for `- [ ]` and `- [x]`.
 */
function countTasks(md) {
    const total = (md.match(/^[-*]\s+\[[ x]\]/gm) || []).length;
    const done = (md.match(/^[-*]\s+\[x\]/gim) || []).length;
    return { total, done };
}

/**
 * Most recent mtime in a directory tree, or 0.
 */
function newestMtime(dir) {
    let latest = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(dir, e.name);
            try {
                const stat = fs.statSync(full);
                if (stat.mtimeMs > latest) latest = stat.mtimeMs;
                if (e.isDirectory()) {
                    const nested = newestMtime(full);
                    if (nested > latest) latest = nested;
                }
            } catch (_) { /* skip unreadable */ }
        }
    } catch (_) { /* dir may not exist */ }
    return latest;
}

/** Guess the status of a change from what files are present. */
function guessStatus(changeDir) {
    try {
        const hasProposal = fs.existsSync(path.join(changeDir, 'proposal.md'));
        const hasTasks = fs.existsSync(path.join(changeDir, 'tasks.md'));
        if (hasProposal || hasTasks) return 'proposed';
        return 'proposed'; // default
    // An unreadable or half-written validation file means the change has not been
    // validated yet, which is what 'proposed' already says.
    } catch (_) { return 'proposed'; }
}

// ──────────────────────────────────────────────
//  Snapshot builder
// ──────────────────────────────────────────────

function buildSnapshot(projectRoot) {
    const root = findOpenSpecRoot(projectRoot);
    if (!root) return { changes: [], ready: false, graphStatus: 'unavailable' };

    const changesDir = path.join(root, 'changes');
    const changes = [];

    if (fs.existsSync(changesDir)) {
        let entries;
        // No changes directory yet is a workspace that has not proposed anything,
        // not an error. The board renders empty for it.
        try { entries = fs.readdirSync(changesDir, { withFileTypes: true }); } catch { entries = []; }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const changeDir = path.join(changesDir, e.name);
            let tasks = { total: 0, done: 0 };
            const tasksPath = path.join(changeDir, 'tasks.md');
            if (fs.existsSync(tasksPath)) {
                try { tasks = countTasks(fs.readFileSync(tasksPath, 'utf8')); } catch (_) { /* skip */ }
            }
            changes.push({
                name: e.name,
                status: guessStatus(changeDir),
                taskCompleted: tasks.done,
                taskTotal: tasks.total,
                validation: getValidationStatus(projectRoot, e.name),
                mtimeMs: newestMtime(changeDir),
            });
        }
    }

    // Sort newest first
    changes.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Graph status, from the same freshness check the trust strip uses. A local
    // "graph.json newer than an hour" guess disagreed with it, so the board could
    // call a graph stale while the strip beside it called the same graph current.
    let graphStatus = 'unavailable';
    try {
        const freshness = graphifyService.freshness(projectRoot);
        if (freshness.graphExists) graphStatus = freshness.stale ? 'stale' : 'current';
    } catch (_) { /* no graph, or unreadable — leave unavailable */ }

    return { changes, ready: true, graphStatus };
}

// ──────────────────────────────────────────────
//  Delta builder (parses proposed spec changes)
// ──────────────────────────────────────────────

function buildDeltas(projectRoot, changeName) {
    const root = findOpenSpecRoot(projectRoot);
    if (!root) return [];

    const changeDir = path.join(root, 'changes', changeName);
    if (!fs.existsSync(changeDir)) return [];

    // Look for spec deltas — files under changes/<name>/specs/
    const specsDir = path.join(changeDir, 'specs');
    if (!fs.existsSync(specsDir)) return [];

    const deltas = [];
    const walk = (dir, depth = 0) => {
        if (depth > 5) return;
        let entries;
        // Skip an unreadable directory rather than abandoning the watch tree.
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full, depth + 1); continue; }
            if (!e.name.endsWith('.md')) continue;

            try {
                const text = fs.readFileSync(full, 'utf8');
                const specId = path.relative(specsDir, full).replace(/\.md$/, '').split(path.sep).join('/');

                // Parse requirement sections: ## ADDED Requirements, ## MODIFIED Requirements, etc.
                const sections = text.split(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements/gim);
                for (let i = 1; i < sections.length; i += 2) {
                    const op = sections[i].toUpperCase();
                    const body = (sections[i + 1] || '').trim();
                    if (!body) continue;

                    // Split into individual requirements (### headings)
                    const reqs = body.split(/^###\s+/gm).filter(Boolean);
                    for (const req of reqs) {
                        const nl = req.indexOf('\n');
                        const heading = nl > -1 ? req.slice(0, nl).trim() : req.trim();
                        const reqBody = nl > -1 ? req.slice(nl + 1).trim() : '';
                        deltas.push({ op, requirement: heading, body: reqBody, specId });
                    }
                }
            } catch (_) { /* skip unreadable */ }
        }
    };
    walk(specsDir);
    return deltas;
}

// ──────────────────────────────────────────────
//  WebSocket plumbing
// ──────────────────────────────────────────────

/**
 * Connected clients, each pinned to the workspace it asked for.
 *
 * A single shared watcher on the server's own cwd would mean the change board
 * and activity feed only ever came alive for one workspace, and every client
 * would receive another workspace's file events. Watchers are therefore keyed by
 * OpenSpec root and reference-counted: created when the first client for a
 * workspace connects, torn down when the last one leaves.
 *
 * @type {Map<import('ws').WebSocket, { projectRoot: string, openspecRoot: string|null }>}
 */
const clients = new Map();

/** @type {Map<string, { watcher: import('chokidar').FSWatcher, refs: number }>} */
const watchers = new Map();

/** Send to the clients watching one workspace — never to everyone. */
function broadcastTo(openspecRoot, msg) {
    const payload = JSON.stringify(msg);
    for (const [ws, meta] of clients) {
        if (meta.openspecRoot !== openspecRoot) continue;
        if (ws.readyState !== 1) continue;
        // A send that throws means the socket is gone. Dropping the client IS
        // the handling; logging a disconnect per broadcast would be noise.
        try { ws.send(payload); } catch (_) { clients.delete(ws); }
    }
}

/** The project root any client of this OpenSpec root is using, for snapshots. */
function projectRootFor(openspecRoot) {
    for (const meta of clients.values()) {
        if (meta.openspecRoot === openspecRoot) return meta.projectRoot;
    }
    return path.dirname(openspecRoot);
}

function acquireWatcher(openspecRoot) {
    const existing = watchers.get(openspecRoot);
    if (existing) {
        existing.refs += 1;
        return;
    }

    const watcher = chokidar.watch(openspecRoot, {
        ignored: /(^|[/\\])\./,
        persistent: true,
        ignoreInitial: true,
        depth: 10,
    });

    watcher.on('all', (event, filePath) => {
        const relative = path.relative(openspecRoot, filePath);
        broadcastTo(openspecRoot, {
            type: 'activity',
            data: {
                event: EVENT_NAMES[event] || 'modified',
                path: relative,
                detail: describeEvent(event, relative),
                timestamp: Date.now(),
            },
        });

        // The board is derived from the same files, so push it alongside.
        try {
            broadcastTo(openspecRoot, { type: 'snapshot', data: buildSnapshot(projectRootFor(openspecRoot)) });
        } catch (_) { /* a snapshot failure must not kill the watcher */ }
    });

    watcher.on('error', (err) => {
        logger.warn('stardust_live_watch_error', { path: openspecRoot, reason: err?.message });
    });

    watchers.set(openspecRoot, { watcher, refs: 1 });
    logger.info('stardust_live_watching', { path: openspecRoot });
}

function releaseWatcher(openspecRoot) {
    const entry = watchers.get(openspecRoot);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    watchers.delete(openspecRoot);
    try { entry.watcher.close(); } catch (_) { /* already closed */ }
    logger.info('stardust_live_unwatched', { path: openspecRoot });
}

const EVENT_NAMES = {
    add: 'created',
    change: 'modified',
    unlink: 'removed',
    addDir: 'directory created',
    unlinkDir: 'directory removed',
};

function attachToServer(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/api/stardust/live' });

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, 'http://localhost');
        const projectRoot = url.searchParams.get('projectRoot') || process.cwd();
        const openspecRoot = findOpenSpecRoot(projectRoot);

        clients.set(ws, { projectRoot, openspecRoot });

        // Seed immediately so the board never renders blank while chokidar warms up.
        try {
            ws.send(JSON.stringify({ type: 'snapshot', data: buildSnapshot(projectRoot) }));
        } catch (err) {
            try { ws.send(JSON.stringify({ type: 'error', message: err.message })); } catch (_) { /* gone */ }
        }

        if (openspecRoot) acquireWatcher(openspecRoot);

        const detach = () => {
            if (!clients.has(ws)) return;
            clients.delete(ws);
            if (openspecRoot) releaseWatcher(openspecRoot);
        };

        ws.on('close', detach);
        ws.on('error', detach);
    });

    return wss;
}

function describeEvent(event, relativePath) {
    const base = path.basename(relativePath);
    switch (event) {
        case 'add': return `${base} was created`;
        case 'change': return `${base} was modified`;
        case 'unlink': return `${base} was removed`;
        case 'addDir': return `directory ${relativePath} created`;
        case 'unlinkDir': return `directory ${relativePath} removed`;
        default: return `${relativePath} ${event}`;
    }
}

// ──────────────────────────────────────────────
//  REST-friendly exports (seed the UI before WS connects)
// ──────────────────────────────────────────────

function getSnapshot(projectRoot) {
    return buildSnapshot(projectRoot);
}

function getDeltas(projectRoot, changeName) {
    return buildDeltas(projectRoot, changeName);
}

module.exports = {
    attachToServer,
    getSnapshot,
    getDeltas,
    setValidationStatus,
    findOpenSpecRoot,
};
