const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Initialize Services
process.env.DOTENVX_QUIET = 'true';
const watcherService = require('./backend/services/watcher.service');
const queueService = require('./backend/services/queue.service');
const cliService = require('./backend/services/cli.service');
const apiRoutes = require('./backend/routes/api');

const app = express();
const PORT = 3090;
const CONFIG_PATH = path.join(__dirname, 'config.json');

app.use(cors());
app.use(express.json());

// --- Static File Serving ---
const DIST_PATH = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_PATH)) {
    app.use(express.static(DIST_PATH));
    console.log('📦 Serving production frontend');
}

// --- API Routes ---
app.use('/api', apiRoutes);

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
    console.log('🔍 Syncing with YodaMan Engine...');
    try {
        const cliData = await cliService.runJson(['list']);
        const cliPaths = cliData.projects.map(p => p.path);
        
        let config = { watchedDirectories: [] };
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }

        const allPaths = Array.from(new Set([...config.watchedDirectories, ...cliPaths]));
        allPaths.forEach(p => watcherService.setupWatcher(p));
        
        if (allPaths.length > config.watchedDirectories.length) {
            config.watchedDirectories = allPaths;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        }
        console.log(`✅ Synced ${allPaths.length} projects.`);
    } catch (err) {
        console.error('⚠️ Startup sync failed:', err.message);
    }
}

app.listen(PORT, async () => {
    console.log(`🌐 YodaMan Core running at http://localhost:${PORT}`);
    await initialize();
});

// --- Graceful Shutdown ---
function gracefulShutdown() {
    console.log('\n🛑 Shutting down...');
    queueService.killActive();
    watcherService.closeAll();
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
