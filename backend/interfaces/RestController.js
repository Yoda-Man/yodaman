const express = require('express');
const path = require('path');
const fs = require('fs');

// Infrastructure Layer
const contextEngine = require('../infrastructure/ContextEngine');
const watcherService = require('../infrastructure/FileSystemWatcher');
const toolBox = require('../infrastructure/ToolBox');

const multer = require('multer');

// Core Layer
const queueService = require('../core/QueueService');
const agentEngine = require('../core/AgentReasoningEngine');

const router = express.Router();
const CONFIG_PATH = path.join(__dirname, '../../config.json');
const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, PLUGINS_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage });


/**
 * RestController (Interface Layer)
 * 
 * Maps HTTP endpoints to business logic and infrastructure actions.
 */

let config = { watchedDirectories: [] };

function loadLocalConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
}

function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// --- Project Management ---

router.get('/projects', async (req, res) => {
    try {
        const cliData = await contextEngine.executeJson(['list']);
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
                result.push({ name: path.basename(dir), path: dir, id: dir });
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

const sessionStore = require('../infrastructure/SessionStore');

// --- AI & Intelligence ---

router.get('/sessions', (req, res) => {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).send('projectId is required');
    res.json(sessionStore.getMessages(projectId));
});

router.delete('/sessions', (req, res) => {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).send('projectId is required');
    sessionStore.clearSession(projectId);
    res.json({ message: 'Session cleared' });
});



router.post('/ask', async (req, res) => {
    const { question, projectId } = req.body;
    if (!question) return res.status(400).send('Question is required');
    
    if (projectId) {
        sessionStore.saveMessage(projectId, { role: 'user', content: question, timestamp: new Date() });
    }

    try {
        const { output } = await contextEngine.execute(['ask', '--', question]);
        const answer = output.trim();
        
        if (projectId) {
            sessionStore.saveMessage(projectId, { role: 'ai', content: answer, timestamp: new Date() });
        }
        
        res.json({ answer });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/agent/task', async (req, res) => {
    const { task, projectId } = req.body;
    if (!task) return res.status(400).send('Task is required');

    if (projectId) {
        sessionStore.saveMessage(projectId, { role: 'user', content: task, timestamp: new Date() });
    }

    const taskId = Math.random().toString(36).substring(7);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const steps = [];
        const finalAnswer = await agentEngine.executeTask(task, taskId, (step) => {
            steps.push(step);
            sendEvent(step);
        });
        
        if (projectId) {
            sessionStore.saveMessage(projectId, { 
                role: 'ai', 
                content: finalAnswer, 
                timestamp: new Date(), 
                isAgent: true,
                steps: steps
            });
        }

        sendEvent({ type: 'final_answer', answer: finalAnswer });
        res.end();
    } catch (err) {
        sendEvent({ type: 'error', message: err.message });
        res.end();
    }
});



router.post('/agent/approve', (req, res) => {
    const { taskId, approved } = req.body;
    if (!taskId) return res.status(400).send('taskId is required');
    
    agentEngine.signalApproval(taskId, approved);
    res.json({ message: 'Signal sent' });
});

// --- Plugin Management ---

router.get('/plugins', (req, res) => {
    const plugins = Array.from(toolBox.plugins.values()).map(p => ({
        name: p.name,
        description: p.description,
        parameters: p.parameters
    }));
    res.json(plugins);
});

router.post('/plugins', upload.single('plugin'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');
    
    // Reload plugins in ToolBox
    toolBox.loadPlugins();
    res.json({ message: 'Plugin uploaded and loaded', name: req.file.originalname });
});

router.delete('/plugins/:name', (req, res) => {
    const { name } = req.params;
    const plugin = toolBox.plugins.get(name);
    
    if (plugin && plugin._filename) {
        const pluginPath = path.join(PLUGINS_DIR, plugin._filename);
        if (fs.existsSync(pluginPath)) {
            fs.unlinkSync(pluginPath);
        }
        toolBox.plugins.delete(name);
        res.json({ message: 'Plugin deleted' });
    } else {
        res.status(404).send('Plugin not found');
    }
});


router.get('/search', async (req, res) => {


    const { query, project, top = 10 } = req.query;
    if (!query) return res.status(400).send('Query is required');

    try {
        const results = await toolBox.searchCode({ query, project, top });
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- System Status ---

router.get('/status', async (req, res) => {
    try {
        const data = await contextEngine.executeJson(['status']);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/check', async (req, res) => {
    const { path: dirPath } = req.query;
    try {
        const data = await contextEngine.executeJson(['check', dirPath]);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reindex', (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) return res.status(400).send('Path is required');
    queueService.addToQueue(path.resolve(dirPath));
    res.json({ message: 'Indexing queued' });
});

module.exports = router;
