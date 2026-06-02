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


const app = express();
const PORT = Number(process.env.YODAMAN_PORT || 3090);
const CONFIG_PATH = path.join(__dirname, 'config.json');

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

// --- Startup Sync ---
async function initialize() {
    logger.info('startup_sync_started');
    await graphifyService.assertAvailable();
    try {
        const cliData = await contextEngine.executeJson(['list']);

        const cliPaths = cliData.projects.map(p => p.path);
        
        let config = { watchedDirectories: [], removedDirectories: [] };
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            } catch (err) {
                logger.error('config_load_failed', err, { path: CONFIG_PATH });
                config = { watchedDirectories: [], removedDirectories: [] };
            }
        }
        config.watchedDirectories = Array.isArray(config.watchedDirectories) ? config.watchedDirectories : [];
        config.removedDirectories = Array.isArray(config.removedDirectories) ? config.removedDirectories : [];

        const activeCliPaths = cliPaths.filter(p => !config.removedDirectories.includes(p));
        const allPaths = Array.from(new Set([...config.watchedDirectories, ...activeCliPaths]));
        allPaths.forEach(p => watcherService.setupWatcher(p));
        
        if (allPaths.length > config.watchedDirectories.length) {
            config.watchedDirectories = allPaths;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        }
        logger.info('startup_sync_completed', { projects: allPaths.length });
    } catch (err) {
        logger.error('startup_sync_failed', err);
    }
}

app.listen(PORT, async () => {
    logger.info('runtime_started', { url: `http://localhost:${PORT}` });
    try {
        await initialize();
    } catch (err) {
        logger.error('runtime_startup_failed', err);
        process.exit(1);
    }
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
