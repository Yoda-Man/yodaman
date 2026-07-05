const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize Infrastructure & Services
process.env.DOTENVX_QUIET = 'true';
const watcherService = require('./backend/infrastructure/FileSystemWatcher');
const queueService = require('./backend/core/QueueService');
const contextEngine = require('./backend/infrastructure/ContextEngine');
const apiRoutes = require('./backend/interfaces/RestController');
const logger = require('./backend/infrastructure/Logger');
const graphifyService = require('./backend/infrastructure/GraphifyService');
const dependencyChecker = require('./backend/infrastructure/DependencyChecker');

// ─────────────────────────────────────────────────────────────────────────
//  HEALTH — shared state populated by initialize() and queried by
//  the /api/health endpoint. Every dependency check stores its status
//  here rather than crashing the process.
// ─────────────────────────────────────────────────────────────────────────
const healthState = {
    started: false,
    graphify: { ok: null, message: 'not checked' },
    ollama: { ok: null, message: 'not checked' },
    ctx: { ok: null, message: 'not checked' },
    openspec: { ok: null, message: 'not checked' },
    config: { ok: null, message: 'not checked' },
    projects: 0,
    indexed: 0,
    syncComplete: false
};

const app = express();
const PORT = Number(process.env.YODAMAN_PORT || 3090);
const CONFIG_PATH = process.env.YODAMAN_CONFIG_PATH || path.join(__dirname, 'config.json');

app.use(cors());
app.use(express.json());
app.use(logger.requestId);
app.use(logger.requestLogger);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:*"
    );
    next();
});

// --- Static File Serving ---
const DIST_PATH = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_PATH)) {
    app.use(express.static(DIST_PATH));
    logger.info('serving_production_frontend');
}

// Expose health state for the RestController
app.set('healthState', healthState);

// --- API Routes ---
app.use('/api', apiRoutes);

app.use((err, req, res, next) => {
    logger.error('http_unhandled_error', err, {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        userAction: 'http_request',
        severity: 'critical'
    });
    res.status(500).json({ error: err.message, requestId: req.id, code: 'http_unhandled_error' });
});

// --- SPA Catch-all ---
app.get('*', (req, res) => {
    const indexPath = path.join(DIST_PATH, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Frontend not built. Run npm run build.');
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  STARTUP SYNC — graceful degradation: every check is wrapped so a
//  single missing dependency never kills the process.
// ─────────────────────────────────────────────────────────────────────────
async function initialize() {
    logger.info('startup_sync_started');

    // 1. Graphify
    try {
        await graphifyService.assertAvailable();
        healthState.graphify = { ok: true, message: 'available' };
    } catch (err) {
        healthState.graphify = { ok: false, message: err.message };
        logger.error('startup_graphify_unavailable', err);
    }

    // 2. Ollama — check via DependencyChecker (handles PATH gaps)
    try {
        const ollamaCheck = await dependencyChecker.check('ollama');
        healthState.ollama = {
            ok: ollamaCheck.found,
            version: ollamaCheck.version || null,
            message: ollamaCheck.found
                ? `v${ollamaCheck.version} at ${ollamaCheck.path}${ollamaCheck.running ? ' (running)' : ' (not running)'}`
                : ollamaCheck.error
        };
    } catch (err) {
        healthState.ollama = { ok: false, message: `Ollama check failed: ${err.message}` };
    }

    // 3. ctx CLI — check via DependencyChecker
    try {
        const ctxCheck = await dependencyChecker.check('ctx');
        healthState.ctx = {
            ok: ctxCheck.found,
            version: ctxCheck.version || null,
            message: ctxCheck.found
                ? `v${ctxCheck.version} at ${ctxCheck.path}`
                : ctxCheck.error
        };
    } catch (err) {
        healthState.ctx = { ok: false, message: `ctx check failed: ${err.message}` };
    }

    // 4. OpenSpec CLI — check via DependencyChecker
    try {
        const openspecCheck = await dependencyChecker.check('openspec');
        healthState.openspec = {
            ok: openspecCheck.found,
            version: openspecCheck.version || null,
            message: openspecCheck.found
                ? `v${openspecCheck.version} at ${openspecCheck.path}`
                : openspecCheck.error
        };
    } catch (err) {
        healthState.openspec = { ok: false, message: `openspec check failed: ${err.message}` };
    }

    // 5. Config file
    try {
        const cfg = fs.existsSync(CONFIG_PATH)
            ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
            : { watchedDirectories: [], removedDirectories: [] };
        healthState.config = { ok: true, message: `loaded (${cfg.watchedDirectories?.length || 0} dirs)` };
    } catch (err) {
        healthState.config = { ok: false, message: `config load failed: ${err.message}` };
    }

    // 5. Project sync (ctx index) — non-fatal
    try {
        const cliData = await contextEngine.executeJson(['list']);
        const cliPaths = cliData.projects.map(p => p.path);

        let config = { watchedDirectories: [], removedDirectories: [] };
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            } catch (_) {
                config = { watchedDirectories: [], removedDirectories: [] };
            }
        }
        config.watchedDirectories = Array.isArray(config.watchedDirectories) ? config.watchedDirectories : [];
        config.removedDirectories = Array.isArray(config.removedDirectories) ? config.removedDirectories : [];

        // Merge ctx projects into watched directories — ctx is the source of truth.
        // New ctx projects are auto-added and queued for indexing.
        let changed = false;
        const newProjects = [];
        for (const ctxPath of cliPaths) {
            if (config.removedDirectories.includes(ctxPath)) continue;
            if (!config.watchedDirectories.includes(ctxPath)) {
                config.watchedDirectories.push(ctxPath);
                newProjects.push(ctxPath);
                changed = true;
            }
        }

        const activeCliPaths = new Set(cliPaths.filter(p => !config.removedDirectories.includes(p)));
        const watchedDirectories = config.watchedDirectories.filter(p => !apiRoutes.isGeneratedTempWorkspace(p));
        watchedDirectories.forEach(p => watcherService.setupWatcher(p));

        if (changed || watchedDirectories.length !== config.watchedDirectories.length) {
            config.watchedDirectories = watchedDirectories;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
            logger.info('config_synced_from_ctx', { projects: watchedDirectories.length, new: newProjects.length });
        }

        // Auto-index newly discovered ctx projects (non-blocking — runs in parallel)
        for (const p of newProjects) {
            queueService.addToQueue(p);
            graphifyService.build(p, { update: true }).catch(err =>
                logger.error('startup_graphify_build_failed', err, { path: p }));
        }

        healthState.projects = watchedDirectories.length;
        healthState.indexed = watchedDirectories.filter(p => activeCliPaths.has(p)).length;
        healthState.syncComplete = true;

        logger.info('startup_sync_completed', {
            projects: healthState.projects,
            indexedMatches: healthState.indexed,
            ignoredCtxOnlyProjects: Math.max(cliPaths.length - healthState.indexed, 0)
        });
    } catch (err) {
        logger.error('startup_sync_failed', err);
    }

    healthState.started = true;
}

app.listen(PORT, async () => {
    logger.info('runtime_started', { url: `http://localhost:${PORT}` });
    // Non-fatal: initialize() stores results in healthState, never exits.
    await initialize().catch(err => logger.error('startup_initialize_error', err));
});

// --- Graceful Shutdown ---
function gracefulShutdown() {
    logger.info('runtime_shutdown_started');
    queueService.killActive();
    watcherService.closeAll();
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error('runtime_unhandled_rejection', err, {
        userAction: 'runtime',
        severity: 'critical'
    });
});
process.on('uncaughtException', (err) => {
    logger.error('runtime_uncaught_exception', err, {
        userAction: 'runtime',
        severity: 'critical'
    });
    process.exit(1);
});
