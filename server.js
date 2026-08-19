const express = require('express');
const http = require('http');
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
const stardustLive = require('./backend/stardust/StardustLive');
const originPolicy = require('./backend/infrastructure/OriginPolicy');
const settings = require('./backend/infrastructure/SettingsProvider');

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
// Loopback by default. Binding 0.0.0.0 exposed the API to every device on the
// network; mobile pairing is the only reason to widen it, so that now has to be
// an explicit opt-in via YODAMAN_HOST=0.0.0.0.
const HOST = process.env.YODAMAN_HOST || '127.0.0.1';
const CONFIG_PATH = process.env.YODAMAN_CONFIG_PATH || path.join(__dirname, 'config.json');

// Reflect loopback origins only. `cors()` sent Access-Control-Allow-Origin: *,
// which let any website read API responses. See OriginPolicy for the rationale.
app.use(cors({ origin: originPolicy.corsOrigin, credentials: true }));
app.use(express.json());
app.use(logger.requestId);
app.use(logger.requestLogger);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:*"
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

app.use((err, req, res, _next) => {
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
// Express 5 removed the bare '*' path. '/*splat' is the v5 spelling for
// "match everything", with `splat` naming the captured segments.
app.get('/*splat', (req, res) => {
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
        logger.info('startup_dependency_ok', { dependency: 'graphify' });
    } catch (err) {
        healthState.graphify = { ok: false, message: err.message };
        logger.error('startup_graphify_unavailable', err);
    }

    // 2. CLI dependencies — checked via DependencyChecker, which handles the
    //    Electron PATH gap. `includeRunning` is set for tools that expose a
    //    health endpoint, so the message reports reachability too.
    const CLI_DEPENDENCIES = [
        { name: 'ollama', label: 'Ollama', includeRunning: true },
        { name: 'ctx', label: 'ctx', includeRunning: false },
        { name: 'openspec', label: 'openspec', includeRunning: false }
    ];

    for (const dep of CLI_DEPENDENCIES) {
        try {
            const result = await dependencyChecker.check(dep.name);
            const version = result.version ? `v${result.version}` : 'unknown version';
            const runningSuffix = dep.includeRunning
                ? (result.running ? ' (running)' : ' (not running)')
                : '';

            healthState[dep.name] = {
                ok: result.found,
                version: result.version || null,
                message: result.found
                    ? `${version} at ${result.path}${runningSuffix}`
                    : result.error
            };

            if (result.found) {
                logger.info('startup_dependency_ok', {
                    dependency: dep.name,
                    version: result.version || null,
                    path: result.path,
                    running: dep.includeRunning ? result.running : null
                });
            } else {
                // Missing dependencies degrade features but never stop startup —
                // warn (not error) so the runtime log distinguishes the two.
                logger.warn('startup_dependency_missing', {
                    dependency: dep.name,
                    reason: result.error,
                    installHint: result.installHint || result.installUrl || null
                });
            }
        } catch (err) {
            healthState[dep.name] = { ok: false, message: `${dep.label} check failed: ${err.message}` };
            logger.error('startup_dependency_check_failed', err, { dependency: dep.name });
        }
    }

    // 3. Config file
    try {
        const cfg = fs.existsSync(CONFIG_PATH)
            ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
            : { watchedDirectories: [], removedDirectories: [] };
        healthState.config = { ok: true, message: `loaded (${cfg.watchedDirectories?.length || 0} dirs)` };
    } catch (err) {
        healthState.config = { ok: false, message: `config load failed: ${err.message}` };
        logger.error('startup_config_load_failed', err, { configPath: CONFIG_PATH });
    }

    // 4. Project sync (ctx index) — non-fatal
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

    // Single summary line so a support log shows the whole dependency picture
    // without having to correlate the individual startup entries above.
    const DEPENDENCY_KEYS = ['graphify', 'ollama', 'ctx', 'openspec', 'config'];
    const degraded = DEPENDENCY_KEYS.filter(key => healthState[key] && healthState[key].ok !== true);

    logger.info('startup_health_summary', {
        healthy: degraded.length === 0,
        degraded,
        versions: DEPENDENCY_KEYS.reduce((acc, key) => {
            acc[key] = (healthState[key] && healthState[key].version) || null;
            return acc;
        }, {}),
        projects: healthState.projects,
        indexed: healthState.indexed
    });
}

const server = http.createServer(app);
stardustLive.attachToServer(server);

server.listen(PORT, HOST, async () => {
    logger.info('runtime_started', { url: `http://localhost:${PORT}`, host: HOST });
    if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
        logger.warn('runtime_bound_non_loopback', {
            host: HOST,
            detail: 'API is reachable from other devices on this network. Pairing tokens are the only control.'
        });
    }
    // Announce any security setting that differs from its secure default, so
    // drift shows up in runtime.log rather than waiting for the next audit.
    for (const item of settings.drift()) {
        logger.warn('security_setting_non_default', {
            setting: item.key,
            value: item.value,
            expected: item.expected,
            source: item.source,
            severity: 'medium'
        });
    }
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
    // A taken port is the one startup failure with an obvious cause and an
    // obvious fix, and it deserves to say so. Reported as a generic uncaught
    // exception it read as a crash — and to anyone launching the desktop app it
    // read as nothing at all, because the shell simply showed a black window
    // with no runtime behind it. Name it, and say what to do.
    if (err && err.code === 'EADDRINUSE') {
        const port = err.port || PORT;
        logger.error('runtime_port_in_use', err, {
            port,
            userAction: 'runtime',
            severity: 'critical',
            hint: `Port ${port} is already in use — another YodaMan runtime is probably running. `
                + `Find it with "lsof -nP -iTCP:${port} -sTCP:LISTEN" and stop it, or set YODAMAN_PORT to a free port.`
        });
        process.stderr.write(
            `\nYodaMan cannot start: port ${port} is already in use.\n`
            + `Another runtime is probably already running.\n\n`
            + `  lsof -nP -iTCP:${port} -sTCP:LISTEN   # find it\n`
            + `  YODAMAN_PORT=3091 yodaman             # or use another port\n\n`
        );
        process.exit(2);
    }

    logger.error('runtime_uncaught_exception', err, {
        userAction: 'runtime',
        severity: 'critical'
    });
    process.exit(1);
});
