const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Infrastructure Layer
const contextEngine = require('../infrastructure/ContextEngine');
const watcherService = require('../infrastructure/FileSystemWatcher');
const toolBox = require('../infrastructure/ToolBox');
const searchRouter = require('../services/searchRouter');
const chatHandler = require('../services/chatHandler');
const auditLog = require('../infrastructure/AuditLog');
const pairingService = require('../infrastructure/PairingService');
const logger = require('../infrastructure/Logger');
const graphifyService = require('../infrastructure/GraphifyService');

const multer = require('multer');

// Core Layer
const queueService = require('../core/QueueService');
const agentEngine = require('../core/AgentReasoningEngine');

const router = express.Router();
const CONFIG_PATH = path.join(__dirname, '../../config.json');
const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');
const ALLOWED_MODES = new Set(['code', 'doc']);

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, PLUGINS_DIR);
    },
    filename: (req, file, cb) => {
        try {
            cb(null, safePluginFilename(file.originalname));
        } catch (err) {
            cb(err);
        }
    }
});
const upload = multer({ storage });


/**
 * RestController (Interface Layer)
 * 
 * Maps HTTP endpoints to business logic and infrastructure actions.
 */

let config = { watchedDirectories: [], removedDirectories: [] };
const graphifyBuildJobs = new Map();

function jsonError(res, status, message, code) {
    return res.status(status).json({ error: message, code });
}

function setGraphifyArtifactHeaders(res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' data: blob: https://unpkg.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; connect-src 'self' http://localhost:* http://127.0.0.1:* https://unpkg.com"
    );
}

function publicBuildJob(job) {
    if (!job) return null;
    return {
        id: job.id,
        path: job.path,
        state: job.state,
        message: job.message,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        durationMs: job.durationMs,
        error: job.error
    };
}

function latestBuildJobForPath(dirPath) {
    return Array.from(graphifyBuildJobs.values())
        .filter(job => job.path === dirPath)
        .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0] || null;
}

function startGraphifyBuildJob(dirPath) {
    const runningJob = Array.from(graphifyBuildJobs.values())
        .find(job => job.path === dirPath && (job.state === 'queued' || job.state === 'running'));
    if (runningJob) return runningJob;

    const job = {
        id: crypto.randomUUID(),
        path: dirPath,
        state: 'queued',
        message: 'Graphify build queued',
        startedAt: new Date().toISOString()
    };
    graphifyBuildJobs.set(job.id, job);

    Promise.resolve().then(async () => {
        const startedAt = new Date();
        job.state = 'running';
        job.message = 'Graphify build running';
        job.startedAt = startedAt.toISOString();
        try {
            const result = await graphifyService.build(dirPath, { update: true });
            const buildState = result.build?.state === 'partial' ? 'partial' : 'succeeded';
            job.state = buildState;
            job.message = result.build?.message || 'Graphify build completed';
            job.completedAt = new Date().toISOString();
            job.durationMs = new Date(job.completedAt).getTime() - startedAt.getTime();
        } catch (err) {
            job.state = 'failed';
            job.message = err.message;
            job.error = err.message;
            job.completedAt = new Date().toISOString();
            job.durationMs = new Date(job.completedAt).getTime() - startedAt.getTime();
            logger.error('graphify_build_job_failed', err, { path: dirPath, jobId: job.id });
        }
    });

    return job;
}

function validateString(value, name, { required = true, max = 4000 } = {}) {
    if (!required && (value === undefined || value === null || value === '')) return undefined;
    if (typeof value !== 'string' || value.trim() === '') {
        const err = new Error(`${name} must be a non-empty string`);
        err.status = 400;
        throw err;
    }
    const trimmed = value.trim();
    if (trimmed.length > max) {
        const err = new Error(`${name} must be ${max} characters or fewer`);
        err.status = 400;
        throw err;
    }
    return trimmed;
}

function validateMode(mode, { required = false } = {}) {
    const value = validateString(mode, 'mode', { required, max: 20 });
    if (!value) return undefined;
    if (!ALLOWED_MODES.has(value)) {
        const err = new Error('mode must be one of: code, doc');
        err.status = 400;
        throw err;
    }
    return value;
}

function resolveUserPath(value, name = 'path') {
    const inputPath = validateString(value, name, { max: 4096 });
    if (inputPath.includes('\0')) {
        const err = new Error(`${name} cannot contain null bytes`);
        err.status = 400;
        throw err;
    }
    const resolved = path.resolve(inputPath);
    if (!path.isAbsolute(resolved)) {
        const err = new Error(`${name} must resolve to an absolute path`);
        err.status = 400;
        throw err;
    }
    return resolved;
}

function validateProjectId(projectId) {
    return validateString(projectId, 'projectId', { required: false, max: 4096 });
}

function isLocalRequest(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isPairingRequiredByDefault() {
    return process.env.YODAMAN_REQUIRE_PAIRING_TOKEN !== 'false';
}

function arePluginUploadsEnabled() {
    return process.env.YODAMAN_ALLOW_PLUGIN_UPLOADS === 'true';
}

function safePluginFilename(originalName) {
    const filename = path.basename(validateString(originalName, 'plugin filename', { max: 200 }));
    if (filename !== originalName || filename.includes('..')) {
        throw new Error('Invalid plugin filename');
    }
    if (!/^[a-zA-Z0-9._-]+\.js$/.test(filename)) {
        throw new Error('Plugin upload must be a JavaScript file with a safe filename');
    }
    return filename;
}

function requirePluginUploadsEnabled(req, res, next) {
    if (!arePluginUploadsEnabled()) {
        return jsonError(res, 403, 'Plugin uploads are disabled. Set YODAMAN_ALLOW_PLUGIN_UPLOADS=true only for trusted local support sessions.', 'plugin_uploads_disabled');
    }
    return next();
}

router.use((req, res, next) => {
    if (req.path.startsWith('/pairing')) return next();
    if (!isPairingRequiredByDefault()) return next();
    if (isLocalRequest(req)) return next();

    const token = req.get('X-YodaMan-Token');
    if (!pairingService.validate(token)) {
        return res.status(401).json({ error: 'Valid YodaMan pairing token is required' });
    }

    return next();
});

router.post('/mode', (req, res) => {
    try {
        const mode = validateMode(req.body?.mode, { required: true });
        const projectId = validateProjectId(req.body?.projectId);
        chatHandler.setMode(mode);
        res.json({ ok: true, mode, projectId });
    } catch (err) {
        logger.warn('mode_update_rejected', { requestId: req.id, error: err.message });
        jsonError(res, err.status || 400, err.message, 'invalid_mode');
    }
});

function loadConfig() {
    config = { watchedDirectories: [], removedDirectories: [] };
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
    return config;
}

loadConfig();

function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function projectNameForPath(dirPath) {
    return path.basename(dirPath) || dirPath;
}

async function removeFromCtxIndex(dirPath) {
    const candidates = Array.from(new Set([dirPath, projectNameForPath(dirPath)]));
    for (const candidate of candidates) {
        try {
            await contextEngine.execute(['remove', candidate]);
            logger.info('ctx_project_removed', { path: dirPath, target: candidate });
            return true;
        } catch (err) {
            logger.warn('ctx_project_remove_failed', { path: dirPath, target: candidate, error: err.message });
        }
    }
    return false;
}

function validateIndexableDirectory(dirPath) {
    let stat;
    try {
        stat = fs.statSync(dirPath);
    } catch (err) {
        const error = new Error(`Workspace path does not exist: ${dirPath}`);
        error.status = 404;
        error.code = 'workspace_missing';
        throw error;
    }

    if (!stat.isDirectory()) {
        const error = new Error(`Workspace path is not a directory: ${dirPath}`);
        error.status = 400;
        error.code = 'workspace_not_directory';
        throw error;
    }
}

function resolveProjectPath(projectId) {
    if (!projectId) return undefined;
    const resolved = path.resolve(projectId);
    if (path.isAbsolute(resolved)) return resolved;

    loadConfig();
    return config.watchedDirectories.find(dir => (
        dir === projectId ||
        path.basename(dir) === projectId
    ));
}

function buildGraphAugmentedQuestion(question, graphInsights) {
    if (!graphInsights) return question;
    return [
        'Use these Graphify knowledge graph insights when answering. Treat them as structural context from code, docs, and diagrams, and cite concrete files or entities when useful.',
        '',
        graphInsights,
        '',
        'User question:',
        question
    ].join('\n');
}

function resolveRegisteredProjectPath(value) {
    const resolved = resolveUserPath(value);
    loadConfig();
    if (!config.watchedDirectories.includes(resolved)) {
        const err = new Error(`Workspace is not registered: ${resolved}`);
        err.status = 404;
        err.code = 'workspace_not_registered';
        throw err;
    }
    return resolved;
}

// --- Project Management ---

router.get('/projects', async (req, res) => {
    loadConfig();
    try {
        const cliData = await contextEngine.executeJson(['list']);
        const cliProjects = cliData.projects.map(p => ({
            name: p.name,
            path: p.path,
            id: p.id || p.path
        })).filter(p => !config.removedDirectories.includes(p.path));

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
        logger.warn('projects_list_ctx_failed', { requestId: req.id, error: err.message });
        res.json(config.watchedDirectories.map(d => ({ name: path.basename(d), path: d, id: d })));
    }
});

router.post('/projects', (req, res) => {
    let resolvedPath;
    try {
        resolvedPath = resolveUserPath(req.body?.path);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_path');
    }

    loadConfig();
    if (!config.watchedDirectories.includes(resolvedPath)) {
        config.watchedDirectories.push(resolvedPath);
        config.removedDirectories = config.removedDirectories.filter(p => p !== resolvedPath);
        saveConfig();
        watcherService.setupWatcher(resolvedPath);
        queueService.addToQueue(resolvedPath);
        res.status(201).json({ message: 'Project added', path: resolvedPath });
    } else {
        res.status(200).json({ message: 'Already exists' });
    }
});

router.delete('/projects', async (req, res) => {
    let resolvedPath;
    try {
        resolvedPath = resolveUserPath(req.body?.path);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_path');
    }
    
    loadConfig();
    const wasWatched = config.watchedDirectories.includes(resolvedPath);
    config.watchedDirectories = config.watchedDirectories.filter(p => p !== resolvedPath);
    if (!config.removedDirectories.includes(resolvedPath)) {
        config.removedDirectories.push(resolvedPath);
    }
    saveConfig();
    
    watcherService.removeWatcher(resolvedPath);
    const ctxRemoved = await removeFromCtxIndex(resolvedPath);
    logger.info('project_removed', { requestId: req.id, path: resolvedPath, wasWatched, ctxRemoved });
    res.json({ message: 'Project removed', path: resolvedPath, wasWatched, ctxRemoved });
});

router.put('/projects', (req, res) => {
    let resolvedPath;
    let nextResolvedPath;
    try {
        resolvedPath = resolveUserPath(req.body?.path);
        nextResolvedPath = resolveUserPath(req.body?.nextPath, 'nextPath');
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_path');
    }

    loadConfig();
    if (!config.watchedDirectories.includes(resolvedPath)) {
        return jsonError(res, 404, 'Project path is not being watched', 'project_not_found');
    }

    if (resolvedPath === nextResolvedPath) {
        return res.status(200).json({ message: 'Project path unchanged', path: resolvedPath });
    }

    if (config.watchedDirectories.includes(nextResolvedPath)) {
        return jsonError(res, 409, 'Target project path is already being watched', 'project_exists');
    }

    config.watchedDirectories = config.watchedDirectories.map(p => (
        p === resolvedPath ? nextResolvedPath : p
    ));
    config.removedDirectories = config.removedDirectories.filter(p => p !== nextResolvedPath);
    saveConfig();

    watcherService.removeWatcher(resolvedPath);
    removeFromCtxIndex(resolvedPath).catch(err => {
        logger.warn('ctx_project_remove_after_update_failed', { path: resolvedPath, error: err.message });
    });
    watcherService.setupWatcher(nextResolvedPath);
    queueService.addToQueue(nextResolvedPath);

    res.json({ message: 'Project path updated', path: nextResolvedPath, previousPath: resolvedPath });
});

const sessionStore = require('../infrastructure/SessionStore');

// --- AI & Intelligence ---

router.get('/sessions', (req, res) => {
    let projectId;
    try {
        projectId = validateString(req.query.projectId, 'projectId', { max: 4096 });
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_project_id');
    }
    res.json(sessionStore.getMessages(projectId));
});

router.delete('/sessions', (req, res) => {
    let projectId;
    try {
        projectId = validateString(req.query.projectId, 'projectId', { max: 4096 });
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_project_id');
    }
    sessionStore.clearSession(projectId);
    res.json({ message: 'Session cleared' });
});



router.post('/ask', async (req, res) => {
    let question;
    let projectId;
    let mode;
    let projectPath;
    try {
        question = validateString(req.body?.question, 'question', { max: 20000 });
        projectId = validateProjectId(req.body?.projectId);
        mode = validateMode(req.body?.mode);
        projectPath = resolveProjectPath(projectId);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_request');
    }

    if (mode) {
        chatHandler.setMode(mode);
    }
    
    if (projectId) {
        sessionStore.saveMessage(projectId, { role: 'user', content: question, timestamp: new Date() });
    }

    try {
        let graphInsights = '';
        if (projectPath) {
            const report = graphifyService.readReport(projectPath, { maxChars: 4000 });
            const queryInsights = await graphifyService.query(question, projectPath);
            graphInsights = [
                'Graph report summary:',
                report || '(No Graphify report generated yet.)',
                '',
                'Question-specific graph traversal:',
                queryInsights
            ].join('\n');
        }
        const augmentedQuestion = buildGraphAugmentedQuestion(question, graphInsights);
        const { output } = await contextEngine.execute(['ask', '--', augmentedQuestion]);
        const answer = output.trim();
        if (projectPath && answer) {
            graphifyService.saveResult(projectPath, {
                question,
                answer,
                type: 'query'
            }).catch(err => {
                logger.warn('graphify_save_answer_failed', {
                    requestId: req.id,
                    path: projectPath,
                    userAction: 'chat_ask',
                    severity: 'medium',
                    error: err.message
                });
            });
        }
        
        if (projectId) {
            sessionStore.saveMessage(projectId, { role: 'ai', content: answer, timestamp: new Date() });
        }
        
        res.json({ answer });
    } catch (err) {
        logger.error('ask_failed', err, {
            requestId: req.id,
            projectId,
            projectPath,
            mode,
            userAction: 'chat_ask',
            severity: 'high'
        });
        res.status(500).json({ error: err.message, requestId: req.id });
    }
});

router.post('/agent/task', async (req, res) => {
    let task;
    let projectId;
    try {
        task = validateString(req.body?.task, 'task', { max: 20000 });
        projectId = validateProjectId(req.body?.projectId);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_request');
    }

    if (projectId) {
        sessionStore.saveMessage(projectId, { role: 'user', content: task, timestamp: new Date() });
    }

    const taskId = Math.random().toString(36).substring(7);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify({ taskId, ...data })}\n\n`);
    };

    try {
        sendEvent({ type: 'task_started', projectId });

        const steps = [];
        const finalAnswer = await agentEngine.executeTask(task, taskId, (step) => {
            steps.push(step);
            sendEvent(step);
        }, { projectId });

        if (finalAnswer === null) {
            res.end();
            return;
        }
        
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
        logger.error('agent_task_failed', err, { requestId: req.id, taskId, projectId });
        sendEvent({ type: 'error', message: err.message });
        res.end();
    }
});



router.post('/agent/approve', (req, res) => {
    const { taskId, approved } = req.body;
    if (!taskId) return jsonError(res, 400, 'taskId is required', 'invalid_task_id');
    
    agentEngine.signalApproval(taskId, approved);
    res.json({ message: 'Signal sent' });
});

router.post('/agent/cancel', (req, res) => {
    const { taskId } = req.body;
    if (!taskId) return jsonError(res, 400, 'taskId is required', 'invalid_task_id');

    agentEngine.cancelTask(taskId);
    res.json({ message: 'Cancellation requested', taskId });
});

router.get('/agent/tasks', (req, res) => {
    res.json(agentEngine.getTasks());
});

router.get('/agent/tasks/:taskId/events', (req, res) => {
    res.json(agentEngine.getTaskEvents(req.params.taskId));
});

router.get('/agent/pending-approvals', (req, res) => {
    res.json(agentEngine.getPendingApprovals());
});

// --- Plugin Management ---

router.get('/plugins', (req, res) => {
const plugins = Array.from(toolBox.plugins.values()).map(p => ({
        name: p.name,
        description: p.description,
        parameters: p.parameters,
        permissions: p.permissions,
        restricted: !p.permissions.includes('unrestricted')
    }));
    res.json(plugins);
});

router.post('/plugins', requirePluginUploadsEnabled, upload.single('plugin'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    try {
        const pluginFilename = safePluginFilename(req.file.originalname);
        const pluginPath = path.join(PLUGINS_DIR, pluginFilename);
        delete require.cache[require.resolve(pluginPath)];
        const plugin = require(pluginPath);
        toolBox.validatePlugin(plugin, { requireExplicitPermissions: true });
        toolBox.loadPlugins();
        res.json({ message: 'Plugin uploaded and loaded', name: pluginFilename });
    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(400).json({ error: err.message });
    }
});

router.delete('/plugins/:name', (req, res) => {
    const { name } = req.params;
    if (name === 'graphify') {
        return jsonError(res, 403, 'Graphify is mandatory and cannot be removed', 'mandatory_plugin');
    }

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


router.use('/search', searchRouter);

// --- System Status ---

router.get('/status', async (req, res) => {
    try {
        const data = await contextEngine.executeJson(['status']);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/policy', (req, res) => {
    res.json(toolBox.getPolicy());
});

router.get('/audit', (req, res) => {
    const { limit = 100 } = req.query;
    res.json(auditLog.list(limit));
});

router.get('/logs', (req, res) => {
    const {
        limit = 200,
        level,
        severity,
        query,
        userAction,
        message,
        since,
        until
    } = req.query;
    res.json({
        logs: logger.list(limit, {
            level,
            severity,
            query,
            userAction,
            message,
            since,
            until
        }),
        queue: queueService.getStatus()
    });
});

router.post('/logs/client-error', (req, res) => {
    let message;
    let userAction;
    let component;
    let severity;
    try {
        message = validateString(req.body?.message, 'message', { max: 4000 });
        userAction = validateString(req.body?.userAction, 'userAction', { required: false, max: 100 }) || 'client';
        component = validateString(req.body?.component, 'component', { required: false, max: 100 });
        severity = validateString(req.body?.severity, 'severity', { required: false, max: 20 }) || 'medium';
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_request');
    }

    const error = new Error(message);
    if (typeof req.body?.stack === 'string') {
        error.stack = req.body.stack.slice(0, 12000);
    }

    logger.error('client_error', error, {
        requestId: req.id,
        userAction,
        component,
        severity,
        context: typeof req.body?.context === 'object' && req.body.context ? req.body.context : undefined
    });
    res.json({ ok: true });
});

router.get('/desktop/diagnostics', (req, res) => {
    res.json({
        runtime: {
            pid: process.pid,
            uptimeSeconds: Math.round(process.uptime()),
            nodeVersion: process.version,
            platform: process.platform,
            cwd: process.cwd(),
            memory: process.memoryUsage()
        },
        host: {
            hostname: os.hostname(),
            release: os.release(),
            arch: os.arch()
        },
        tasks: {
            total: agentEngine.getTasks().length,
            pendingApprovals: agentEngine.getPendingApprovals().length
        },
        plugins: toolBox.getPolicy().plugins
    });
});

router.get('/graphify/status', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.query.path);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, err.code || 'invalid_path');
    }

    res.json(graphifyService.freshness(dirPath, { scanSources: false }));
});

router.post('/graphify/build', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.body?.path);
        validateIndexableDirectory(dirPath);
        const job = startGraphifyBuildJob(dirPath);
        res.status(202).json({
            message: job.state === 'queued' ? 'Graphify build queued' : 'Graphify build already running',
            path: dirPath,
            jobId: job.id,
            job: publicBuildJob(job),
            build: graphifyService.readBuildStatus(dirPath)
        });
    } catch (err) {
        logger.error('graphify_build_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_build_failed');
    }
});

router.get('/graphify/build/status', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.query.path);
        const jobId = validateString(req.query.jobId, 'jobId', { required: false, max: 100 });
        const job = jobId ? graphifyBuildJobs.get(jobId) : latestBuildJobForPath(dirPath);
        if (jobId && (!job || job.path !== dirPath)) {
            return jsonError(res, 404, `Graphify build job not found: ${jobId}`, 'graphify_build_job_missing');
        }
        res.json({
            path: dirPath,
            job: publicBuildJob(job),
            build: graphifyService.readBuildStatus(dirPath),
            graph: graphifyService.freshness(dirPath, { scanSources: false })
        });
    } catch (err) {
        logger.error('graphify_build_status_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_build_status_failed');
    }
});

router.get('/graphify/artifact', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.query.path);
        const type = validateString(req.query.type, 'type', { max: 100 });
        const artifact = graphifyService.artifact(dirPath, type);
        setGraphifyArtifactHeaders(res);
        res.sendFile(artifact.artifactPath);
    } catch (err) {
        logger.error('graphify_artifact_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_artifact_failed');
    }
});

router.get('/graphify/report', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.query.path);
        const report = graphifyService.readReport(dirPath, { maxChars: 120000 });
        if (!report) {
            return jsonError(res, 404, `Graphify report not found: ${graphifyService.reportPath(dirPath)}`, 'graphify_report_missing');
        }
        res.json({
            path: dirPath,
            report,
            reportPath: graphifyService.reportPath(dirPath)
        });
    } catch (err) {
        logger.error('graphify_report_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_report_failed');
    }
});

router.post('/graphify/query', async (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.body?.path);
        const query = validateString(req.body?.query, 'query', { max: 20000 });
        const insights = await graphifyService.query(query, dirPath);
        res.json({ path: dirPath, insights, graphPath: graphifyService.graphPath(dirPath) });
    } catch (err) {
        logger.error('graphify_query_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_query_failed');
    }
});

router.post('/graphify/explain', async (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.body?.path);
        const node = validateString(req.body?.node, 'node', { max: 1000 });
        const explanation = await graphifyService.explain(node, dirPath);
        res.json({ path: dirPath, node, explanation, graphPath: graphifyService.graphPath(dirPath) });
    } catch (err) {
        logger.error('graphify_explain_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_explain_failed');
    }
});

router.post('/graphify/path', async (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.body?.path);
        const source = validateString(req.body?.source, 'source', { max: 1000 });
        const target = validateString(req.body?.target, 'target', { max: 1000 });
        const graphPathResult = await graphifyService.pathBetween(source, target, dirPath);
        res.json({ path: dirPath, source, target, graphPath: graphifyService.graphPath(dirPath), result: graphPathResult });
    } catch (err) {
        logger.error('graphify_path_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_path_failed');
    }
});

router.post('/graphify/affected', async (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.body?.path);
        const node = validateString(req.body?.node, 'node', { max: 1000 });
        const depth = Number(req.body?.depth || 2);
        const relations = Array.isArray(req.body?.relations)
            ? req.body.relations.map(relation => validateString(relation, 'relation', { max: 100 }))
            : [];
        const impact = await graphifyService.affected(node, dirPath, { depth, relations });
        res.json({ path: dirPath, node, depth, relations, graphPath: graphifyService.graphPath(dirPath), impact });
    } catch (err) {
        logger.error('graphify_affected_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_affected_failed');
    }
});

router.get('/graphify/map', async (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.query.path);
        const limit = Number(req.query.limit || 80);
        res.json(await graphifyService.map(dirPath, { limit }));
    } catch (err) {
        logger.error('graphify_map_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_map_failed');
    }
});

router.post('/graphify/tree', async (req, res) => {
    let dirPath;
    try {
        dirPath = resolveRegisteredProjectPath(req.body?.path);
        res.json(await graphifyService.tree(dirPath));
    } catch (err) {
        logger.error('graphify_tree_request_failed', err, { requestId: req.id, path: dirPath });
        jsonError(res, err.status || 500, err.message, err.code || 'graphify_tree_failed');
    }
});

router.post('/pairing', (req, res) => {
    const host = req.get('host');
    const protocol = req.protocol || 'http';
    const baseUrl = req.body?.runtimeUrl || (host ? `${protocol}://${host}` : undefined);
    res.status(201).json(pairingService.createPairing(baseUrl));
});

router.get('/pairing', (req, res) => {
    res.json(pairingService.list());
});

router.post('/pairing/revoke', (req, res) => {
    const { token } = req.body;
    if (!token) return jsonError(res, 400, 'token is required', 'invalid_token');
    res.json({ revoked: pairingService.revoke(token) });
});

router.get('/check', async (req, res) => {
    let dirPath;
    try {
        dirPath = resolveUserPath(req.query.path);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_path');
    }
    try {
        const data = await contextEngine.executeJson(['check', dirPath]);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reindex', (req, res) => {
    let dirPath;
    try {
        dirPath = resolveUserPath(req.body?.path);
        loadConfig();
        if (!config.watchedDirectories.includes(dirPath)) {
            const err = new Error(`Workspace is not registered: ${dirPath}`);
            err.status = 404;
            err.code = 'workspace_not_registered';
            throw err;
        }
        validateIndexableDirectory(dirPath);
    } catch (err) {
        logger.warn('reindex_rejected', { requestId: req.id, path: dirPath, error: err.message, code: err.code || 'invalid_path' });
        return jsonError(res, err.status || 400, err.message, err.code || 'invalid_path');
    }
    logger.info('reindex_requested', { requestId: req.id, path: dirPath });
    queueService.addToQueue(dirPath);
    res.json({ message: 'Indexing and Graphify graph update queued' });
});

router.delete('/agent/tasks', (req, res) => {
    agentEngine.clearTasks();
    res.json({ message: 'Task history cleared' });
});

router.delete('/audit', (req, res) => {
    auditLog.clear();
    res.json({ message: 'Audit logs cleared' });
});

router.loadConfig = loadConfig;
router.isPairingRequiredByDefault = isPairingRequiredByDefault;
router.arePluginUploadsEnabled = arePluginUploadsEnabled;
router.safePluginFilename = safePluginFilename;

module.exports = router;
