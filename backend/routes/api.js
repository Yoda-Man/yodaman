const express = require('express');
const path = require('path');
const fs = require('fs');
const cliService = require('../services/cli.service');
const queueService = require('../services/queue.service');
const watcherService = require('../services/watcher.service');

const router = express.Router();
const CONFIG_PATH = path.join(__dirname, '../../config.json');

let config = { watchedDirectories: [] };

// Helper to save config
function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// Load config helper
function loadLocalConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
}

router.get('/projects', async (req, res) => {
    try {
        const cliData = await cliService.runJson(['list']);
        const cliProjects = cliData.projects.map(p => ({
            name: p.name,
            path: p.path,
            id: p.id || p.path
        }));

        loadLocalConfig();
        const cliPaths = cliProjects.map(p => p.path);
        let hasNew = false;
        
        cliPaths.forEach(p => {
            if (!config.watchedDirectories.includes(p)) {
                config.watchedDirectories.push(p);
                watcherService.setupWatcher(p);
                hasNew = true;
            }
        });

        if (hasNew) saveConfig();

        const result = [...cliProjects];
        config.watchedDirectories.forEach(dir => {
            if (!cliPaths.includes(dir)) {
                result.push({
                    name: path.basename(dir),
                    path: dir,
                    id: dir
                });
            }
        });

        res.json(result);
    } catch (err) {
        res.json(config.watchedDirectories.map(d => ({ name: path.basename(d), path: d, id: d })));
    }
});

router.post('/projects', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).send('Path is required');
    const resolvedPath = path.resolve(dirPath);

    loadLocalConfig();
    if (!config.watchedDirectories.includes(resolvedPath)) {
        config.watchedDirectories.push(resolvedPath);
        saveConfig();
        watcherService.setupWatcher(resolvedPath);
        queueService.addToQueue(resolvedPath);
        res.status(201).json({ message: 'Project added', path: resolvedPath });
    } else {
        res.status(200).json({ message: 'Already exists' });
    }
});

router.delete('/projects', (req, res) => {
    const { path: dirPath } = req.body;
    const resolvedPath = path.resolve(dirPath);
    
    loadLocalConfig();
    config.watchedDirectories = config.watchedDirectories.filter(p => p !== resolvedPath);
    saveConfig();
    
    watcherService.removeWatcher(resolvedPath);
    res.json({ message: 'Project removed' });
});

router.post('/reindex', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).send('Path is required');
    queueService.addToQueue(path.resolve(dirPath));
    res.json({ message: 'Indexing queued' });
});

router.post('/ask', async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).send('Question is required');
    
    try {
        const { output } = await cliService.run(null, ['ask', '--', question]);
        res.json({ answer: output.trim() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/search', async (req, res) => {
    const { query, project, top = 10 } = req.query;
    if (!query) return res.status(400).send('Query is required');

    try {
        const args = ['search', query, '-k', top];
        if (project) args.push('-p', project);
        const data = await cliService.runJson(args);
        res.json(data);
    } catch (err) {
        // Text fallback handled by CLI service's run if runJson fails, 
        // but here we just return error or fallback
        res.status(500).json({ error: err.message });
    }
});

router.get('/status', async (req, res) => {
    try {
        const data = await cliService.runJson(['status']);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/check', async (req, res) => {
    const { path: dirPath } = req.query;
    try {
        const data = await cliService.runJson(['check', dirPath]);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
