/**
 * YodaMan Core - Web GUI for Context Expert (ctx)
 * Professional AI Code Intelligence Platform
 * Version 0.1.0
 */

const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;
const CONFIG_PATH = path.join(__dirname, 'config.json');

app.use(cors());
app.use(express.json());

// --- Static File Serving (Production) ---
const DIST_PATH = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_PATH)) {
    app.use(express.static(DIST_PATH));
    console.log('📦 Serving production frontend from /dist');
}

// --- Configuration Persistence ---
let config = { watchedDirectories: [] };

async function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            config = JSON.parse(data);
            console.log('📅 Configuration loaded from file.');
        }

        // Synchronize with CLI on startup
        console.log('🔍 Syncing with YodaMan Engine...');
        const proc = spawn('ctx', ['list', '--json']);
        let output = '';
        proc.stdout.on('data', (data) => output += data.toString());
        
        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const cliData = JSON.parse(output);
                    const cliPaths = cliData.projects.map(p => p.path);
                    const allPaths = Array.from(new Set([...config.watchedDirectories, ...cliPaths]));
                    
                    if (allPaths.length > config.watchedDirectories.length) {
                        config.watchedDirectories = allPaths;
                        saveConfig();
                    }
                    
                    // Setup watchers for all merged paths
                    config.watchedDirectories.forEach(setupWatcher);
                    console.log(`✅ Synced ${config.watchedDirectories.length} projects.`);
                } catch (e) {
                    config.watchedDirectories.forEach(setupWatcher);
                }
            } else {
                config.watchedDirectories.forEach(setupWatcher);
            }
        });
    } catch (err) {
        console.error('❌ Failed to load config:', err);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log('💾 Configuration saved.');
    } catch (err) {
        console.error('❌ Failed to save config:', err);
    }
}

// --- Queue System ---
const indexQueue = [];
let isProcessingQueue = false;
let activeProcess = null;

function addToQueue(directoryPath) {
    if (!indexQueue.includes(directoryPath)) {
        indexQueue.push(directoryPath);
        processQueue();
    }
}

async function processQueue() {
    if (isProcessingQueue || indexQueue.length === 0) return;
    
    isProcessingQueue = true;
    const targetDir = indexQueue.shift();
    
    console.log(`🏗️  Starting index for: ${targetDir}`);
    
    activeProcess = spawn('ctx', ['index', targetDir]);

    activeProcess.stdout.on('data', (data) => {
        process.stdout.write(`[ctx]: ${data}`);
    });

    activeProcess.stderr.on('data', (data) => {
        process.stderr.write(`[ctx error]: ${data}`);
    });

    activeProcess.on('close', (code) => {
        console.log(`✅ Finished indexing ${targetDir} (code ${code})`);
        activeProcess = null;
        isProcessingQueue = false;
        processQueue();
    });
}

// --- File Watcher Management ---
const watchers = new Map();

function setupWatcher(dirPath) {
    if (watchers.has(dirPath)) return;

    try {
        const watcher = chokidar.watch(dirPath, {
            ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/dist/**'],
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
        });

        watcher
            .on('change', filePath => {
                console.log(`📝 Change: ${path.basename(filePath)}. Re-indexing...`);
                addToQueue(dirPath);
            })
            .on('error', error => {
                console.error(`🔴 Watcher error for ${dirPath}:`, error);
                watcher.close();
                watchers.delete(dirPath);
                setTimeout(() => setupWatcher(dirPath), 10000);
            });

        watchers.set(dirPath, watcher);
        console.log(`👀 Watching: ${dirPath}`);
    } catch (err) {
        console.error(`❌ Watcher setup failed for ${dirPath}:`, err);
    }
}

// --- API Endpoints ---

app.get('/api/projects', async (req, res) => {
    try {
        // Fetch projects from ctx CLI
        const proc = spawn('ctx', ['list', '--json']);
        let output = '';
        proc.stdout.on('data', (data) => output += data.toString());
        
        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const cliData = JSON.parse(output);
                    const cliPaths = cliData.projects.map(p => p.path);
                    
                    // Merge with config paths to ensure we don't miss anything
                    // and keep it unique
                    const allPaths = Array.from(new Set([...config.watchedDirectories, ...cliPaths]));
                    
                    // Update config if we found new ones from CLI
                    if (allPaths.length > config.watchedDirectories.length) {
                        config.watchedDirectories = allPaths;
                        saveConfig();
                    }

                    res.json(allPaths);
                } catch (e) {
                    res.json(config.watchedDirectories);
                }
            } else {
                res.json(config.watchedDirectories);
            }
        });
    } catch (err) {
        res.json(config.watchedDirectories);
    }
});

app.post('/api/projects', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).send('Path is required');
    const resolvedPath = path.resolve(dirPath);

    if (!config.watchedDirectories.includes(resolvedPath)) {
        config.watchedDirectories.push(resolvedPath);
        saveConfig();
        setupWatcher(resolvedPath);
        addToQueue(resolvedPath);
        res.status(201).json({ message: 'Project added', path: resolvedPath });
    } else {
        res.status(200).json({ message: 'Already exists' });
    }
});

app.delete('/api/projects', (req, res) => {
    const { path: dirPath } = req.body;
    const resolvedPath = path.resolve(dirPath);
    config.watchedDirectories = config.watchedDirectories.filter(p => p !== resolvedPath);
    saveConfig();
    
    if (watchers.has(resolvedPath)) {
        watchers.get(resolvedPath).close();
        watchers.delete(resolvedPath);
    }
    res.json({ message: 'Project removed' });
});

app.post('/api/reindex', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).send('Path is required');
    addToQueue(path.resolve(dirPath));
    res.json({ message: 'Indexing queued' });
});

app.post('/api/ask', async (req, res) => {
    const { question, projects } = req.body;
    if (!question) return res.status(400).send('Question is required');
    
    console.log(`💬 Asking: ${question}`);
    
    try {
        // Build args for 'ctx ask'
        // If projects are provided, we can pass them if the CLI supports it.
        // Based on the CLI's help or previous context, we might need to specify projects.
        // For now, we'll just pass the question.
        const args = ['ask', '--', question];
        
        const proc = spawn('ctx', args);
        let output = '';
        let error = '';

        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.stderr.on('data', (data) => {
            error += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                res.json({ answer: output.trim() });
            } else {
                console.error(`❌ ctx ask failed with code ${code}: ${error}`);
                res.status(500).json({ error: error || 'CLI command failed' });
            }
        });
    } catch (err) {
        console.error('❌ Failed to run ctx ask:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/check', async (req, res) => {
    const { path } = req.query;
    if (!path) return res.status(400).send('Path is required');

    try {
        const proc = spawn('ctx', ['check', path, '--json']);
        let output = '';
        proc.stdout.on('data', (data) => output += data.toString());
        
        proc.on('close', (code) => {
            try {
                const jsonStr = output.substring(output.indexOf('{'));
                res.json(JSON.parse(jsonStr));
            } catch (e) {
                res.json({ status: code === 0 ? 'healthy' : 'error', raw: output.trim() });
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/config', async (req, res) => {
    try {
        const proc = spawn('ctx', ['config', 'list']);
        let output = '';
        proc.stdout.on('data', (data) => output += data.toString());
        
        proc.on('close', (code) => {
            const lines = output.split('\n').filter(l => l.includes('='));
            const configMap = {};
            lines.forEach(line => {
                const [key, val] = line.split('=').map(s => s.trim());
                configMap[key] = val;
            });
            res.json(configMap);
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config', async (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined) return res.status(400).send('Key and Value are required');

    try {
        const proc = spawn('ctx', ['config', 'set', key, value]);
        proc.on('close', (code) => {
            res.json({ success: code === 0 });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        const proc = spawn('ctx', ['status', '--json']);
        let output = '';
        proc.stdout.on('data', (data) => output += data.toString());
        
        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const jsonStr = output.substring(output.indexOf('{'));
                    res.json(JSON.parse(jsonStr));
                } catch (e) {
                    res.status(500).json({ error: 'Failed to parse status JSON' });
                }
            } else {
                res.status(500).json({ error: `CLI failed with code ${code}` });
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/search', async (req, res) => {
    const { query, project, top = 10 } = req.query;
    if (!query) return res.status(400).send('Query is required');

    try {
        const args = ['search', query, '-k', top];
        if (project) args.push('-p', project);
        args.push('--json'); // Try JSON first

        const proc = spawn('ctx', args);
        let output = '';
        proc.stdout.on('data', (data) => output += data.toString());
        
        proc.on('close', (code) => {
            try {
                // Remove dotenvx header if present
                const jsonStr = output.substring(output.indexOf('[')) || output.substring(output.indexOf('{'));
                res.json(JSON.parse(jsonStr));
            } catch (e) {
                // Fallback to plain text if JSON parsing fails
                res.json({ results: output.trim(), isText: true });
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Initialization ---

loadConfig();

// --- Catch-all for SPA ---
app.get('*', (req, res) => {
    if (fs.existsSync(path.join(DIST_PATH, 'index.html'))) {
        res.sendFile(path.join(DIST_PATH, 'index.html'));
    } else {
        res.status(404).send('Not Found');
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Server running at http://localhost:${PORT}`);
});

// --- Graceful Shutdown ---

function gracefulShutdown() {
    console.log('\n🛑 Shutting down...');
    if (activeProcess) activeProcess.kill();
    for (const [p, w] of watchers) w.close();
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
