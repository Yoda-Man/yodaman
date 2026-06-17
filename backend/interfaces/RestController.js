const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Infrastructure Layer
const contextEngine = require('../infrastructure/ContextEngine');
const watcherService = require('../infrastructure/FileSystemWatcher');
const toolBox = require('../infrastructure/ToolBox');
const searchRouter = require('../services/searchRouter');
const chatHandler = require('../services/chatHandler');
const fileUploadService = require('../services/fileUploadService');
const gitService = require('../services/gitService');
const auditLog = require('../infrastructure/AuditLog');
const pairingService = require('../infrastructure/PairingService');
const logger = require('../infrastructure/Logger');
const graphifyService = require('../infrastructure/GraphifyService');
const dependencyChecker = require('../infrastructure/DependencyChecker');

const multer = require('multer');

// Core Layer
const queueService = require('../core/QueueService');
const agentEngine = require('../core/AgentReasoningEngine');

const router = express.Router();
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config.json');
const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');
const ALLOWED_MODES = new Set(['code', 'doc']);
const DEFAULT_PLUGINS = new Set(['graphify', 'Grand-Inquisitor', 'CodeTrooper', 'Droid-Sweep', 'lightsaber']);

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

function getConfigPath() {
    return process.env.YODAMAN_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

function jsonError(res, status, message, code) {
    return res.status(status).json({ error: message, code });
}

function setGraphifyArtifactHeaders(res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
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

function runGit(dirPath, args) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd: dirPath, timeout: 5000 }, (err, stdout, stderr) => {
            if (err) {
                err.message = (stderr || err.message || '').trim() || err.message;
                reject(err);
                return;
            }
            resolve(String(stdout || '').trim());
        });
    });
}

async function readGitContext(dirPath) {
    const [branch, status, commits] = await Promise.all([
        runGit(dirPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
        runGit(dirPath, ['status', '--porcelain=v2', '--branch']),
        runGit(dirPath, ['log', '--pretty=format:%h%x09%s%x09%cr', '-n', '8']).catch(() => '')
    ]);

    const branchLine = status.split('\n').find(line => line.startsWith('# branch.ab '));
    const [, ahead = '+0', behind = '-0'] = branchLine?.match(/# branch\.ab (\+\d+) (-\d+)/) || [];

    return {
        branch,
        ahead: Number(ahead.replace('+', '')) || 0,
        behind: Math.abs(Number(behind.replace('-', ''))) || 0,
        recentCommits: commits
            .split('\n')
            .filter(Boolean)
            .map(line => {
                const [hash, subject, relativeTime] = line.split('\t');
                return { hash, subject, relativeTime };
            })
    };
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
    const settings = require('../infrastructure/SettingsProvider');
    return settings.get('requirePairingToken');
}

function arePluginUploadsEnabled() {
    const settings = require('../infrastructure/SettingsProvider');
    return settings.get('allowPluginUploads');
}

function safePluginFilename(originalName) {
    const filename = path.basename(validateString(originalName, 'plugin filename', { max: 200 }));
    if (filename !== originalName || filename.includes('..')) {
        throw new Error('Invalid plugin filename');
    }
    if (!/^[a-zA-Z0-9._-]+\.(js|zip)$/.test(filename)) {
        throw new Error('Plugin upload must be a .js or .zip file with a safe filename');
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

router.use('/upload', fileUploadService.router);

function loadConfig() {
    config = { watchedDirectories: [], removedDirectories: [] };
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (err) {
            logger.error('config_load_failed', err, { path: configPath });
            config = { watchedDirectories: [], removedDirectories: [] };
        }
    }
    config.watchedDirectories = Array.isArray(config.watchedDirectories) ? config.watchedDirectories : [];
    config.removedDirectories = Array.isArray(config.removedDirectories) ? config.removedDirectories : [];
    const originalWatchedCount = config.watchedDirectories.length;
    config.watchedDirectories = config.watchedDirectories.filter(dir => !isGeneratedTempWorkspace(dir));
    if (config.watchedDirectories.length !== originalWatchedCount && fs.existsSync(configPath)) {
        saveConfig();
    }
    return config;
}

loadConfig();

function saveConfig() {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

function projectNameForPath(dirPath) {
    return path.basename(dirPath) || dirPath;
}

function isGeneratedTempWorkspace(dirPath) {
    const resolved = path.resolve(String(dirPath || ''));
    const relativeToTmp = path.relative(os.tmpdir(), resolved);
    const insideTmp = relativeToTmp && !relativeToTmp.startsWith('..') && !path.isAbsolute(relativeToTmp);
    return insideTmp && /^yodaman-(graph-studio|graphify-service|graph-doctor|docs|audit-test|test)-/.test(path.basename(resolved));
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

function sanitizeGraphReportForChat(report) {
    return String(report || '')
        .replace(/\n## Community Hubs \(Navigation\)[\s\S]*?(?=\n## |\s*$)/, '\n')
        .trim();
}

function formatSearchResult(result, index) {
    const filePath = result.metadata?.path || result.path || 'unknown file';
    const line = result.metadata?.line ? `:${result.metadata.line}` : '';
    const snippet = result.content || result.text || result.snippet || '';
    return `${index + 1}. ${filePath}${line}\n${snippet}`.trim();
}

async function buildLocalAskFallbackAnswer({ question, projectPath, graphInsights, cause }) {
    const searchResults = projectPath
        ? await toolBox.searchCode({ query: question, project: projectPath, top: 5 }).catch(() => [])
        : [];
    const snippets = searchResults.slice(0, 5).map(formatSearchResult).join('\n\n');
    return [
        `YodaMan could not reach ctx ask (${cause.message}), so it answered from local workspace context instead.`,
        '',
        graphInsights ? `Graph context:\n${graphInsights}` : 'Graph context: no graph context was available.',
        '',
        snippets ? `Matching code snippets:\n${snippets}` : 'Matching code snippets: no local search matches were found.',
        '',
        `Question: ${question}`
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

        const cliByPath = new Map(cliProjects.map(project => [project.path, project]));

        const result = config.watchedDirectories.map(dir => {
            const cliProject = cliByPath.get(dir);
            return cliProject || { name: path.basename(dir), path: dir, id: dir };
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
            const report = sanitizeGraphReportForChat(graphifyService.readReport(projectPath, { maxChars: 4000 }));
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
        let answer;
        try {
            const timeoutMs = Number(process.env.YODAMAN_CTX_ASK_TIMEOUT_MS || 12000);
            const { output } = await contextEngine.execute(['ask', '--', augmentedQuestion], { timeoutMs });
            answer = output.trim();
        } catch (ctxErr) {
            logger.warn('ask_ctx_fallback_started', {
                requestId: req.id,
                projectId,
                projectPath,
                mode,
                error: ctxErr.message,
                userAction: 'chat_ask',
                severity: 'medium'
            });
            answer = await buildLocalAskFallbackAnswer({
                question,
                projectPath,
                graphInsights,
                cause: ctxErr
            });
        }
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

router.get('/git/context', async (req, res) => {
    let dirPath;
    try {
        dirPath = validateString(req.query?.path, 'path', { max: 2000 });
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_request');
    }

    try {
        const gitState = await readGitContext(dirPath);
        res.json(gitState);
    } catch (err) {
        res.status(200).json({
            branch: 'Unavailable',
            ahead: 0,
            behind: 0,
            recentCommits: [],
            error: err.message
        });
    }
});

router.get('/git/history', async (req, res) => {
    try {
        const workspacePath = validateString(req.query?.path, 'path', { max: 4096 });
        const filePath = validateString(req.query?.file, 'file', { required: false, max: 4096 });
        const limit = Math.max(1, Math.min(Number(req.query?.limit) || 100, 500));
        const commits = await gitService.getCommitHistory(workspacePath, filePath, limit);
        res.json({ commits });
    } catch (err) {
        jsonError(res, err.status || 500, err.message, 'git_history_failed');
    }
});

router.get('/git/heatmap', async (req, res) => {
    try {
        const workspacePath = validateString(req.query?.path, 'path', { max: 4096 });
        const files = await gitService.getHeatmapData(workspacePath);
        res.json({ files });
    } catch (err) {
        jsonError(res, err.status || 500, err.message, 'git_heatmap_failed');
    }
});

router.get('/git/branch', async (req, res) => {
    try {
        const workspacePath = validateString(req.query?.path, 'path', { max: 4096 });
        const branch = await gitService.getBranchInfo(workspacePath);
        res.json(branch);
    } catch (err) {
        jsonError(res, err.status || 500, err.message, 'git_branch_failed');
    }
});

router.get('/git/commit', async (req, res) => {
    try {
        const workspacePath = validateString(req.query?.path, 'path', { max: 4096 });
        const commitHash = validateString(req.query?.hash, 'hash', { max: 80 });
        const diff = await gitService.getCommitDiff(workspacePath, commitHash);
        res.json(diff);
    } catch (err) {
        jsonError(res, err.status || 500, err.message, 'git_commit_failed');
    }
});

router.post('/agent/task', async (req, res) => {
    let task;
    let projectId;
    let fileIds = [];
    try {
        task = validateString(req.body?.task, 'task', { max: 20000 });
        projectId = validateProjectId(req.body?.projectId);
        fileIds = Array.isArray(req.body?.fileIds)
            ? req.body.fileIds.filter(fileId => typeof fileId === 'string' && fileId.trim()).slice(0, 20)
            : [];
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
        const uploadedFiles = [];
        for (const fileId of fileIds) {
            try {
                uploadedFiles.push(fileUploadService.attachTempFileToTask(taskId, fileId));
            } catch (err) {
                sendEvent({ type: 'upload_error', fileId, message: err.message });
            }
        }

        sendEvent({ type: 'task_started', projectId });

        const steps = [];
        const finalAnswer = await agentEngine.executeTask(task, taskId, (step) => {
            steps.push(step);
            sendEvent(step);
        }, { projectId, uploadedFiles });

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
    logger.info('plugin_upload_received', { filename: req.file?.originalname, size: req.file?.size, mime: req.file?.mimetype, tempPath: req.file?.path });
    if (!req.file) {
        logger.error('plugin_upload_no_file', new Error('No file in request'), { userAction: 'plugin_upload', severity: 'high' });
        return res.status(400).send('No file uploaded');
    }
    const startTime = Date.now();

    try {
        let pluginFilename = req.file.originalname;
        let pluginPath = req.file.path;
        logger.info('plugin_upload_start', { filename: pluginFilename, path: pluginPath, size: req.file.size });

        // Extract zip files using system unzip (no npm dependency needed)
        if (pluginFilename.endsWith('.zip')) {
            logger.info('plugin_upload_extract_begin', { filename: pluginFilename, size: req.file?.size });
            const { execSync } = require('child_process');
            const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-extract-'));
            execSync(`unzip -o "${pluginPath}" -d "${extractDir}"`, { stdio: 'pipe' });

            // Find the main .js file (prefer main.js, then any .js at root)
            const walkDir = (dir) => { let r=[]; try{fs.readdirSync(dir).forEach(e=>{const p=path.join(dir,e);const s=fs.statSync(p);if(s.isDirectory()&&!e.startsWith('__MACOSX')&&!e.startsWith('.'))r=r.concat(walkDir(p));else if(e.endsWith('.js')&&!e.startsWith('._'))r.push(p);})}catch{} return r; };
            const jsFiles = walkDir(extractDir);
            // Prefer main.js at root level
            const mainEntry = jsFiles.find(f => path.basename(f) === 'main.js') || jsFiles[0];
            if (!mainEntry) throw new Error('No .js plugin file found in the zip archive');

            const safeName = safePluginFilename(path.basename(mainEntry));
            const targetPath = path.join(PLUGINS_DIR, safeName);
            fs.copyFileSync(mainEntry, targetPath);

            // Merge plugin.json fields into the plugin if present
            logger.info('plugin_merge_looking_for_json', { extractDir });
            const walkAll = (d) => { let r=[]; try{fs.readdirSync(d).forEach(e=>{const p=path.join(d,e);const s=fs.statSync(p);if(s.isDirectory()&&!e.startsWith('__MACOSX')&&!e.startsWith('.'))r=r.concat(walkAll(p));else if(!e.startsWith('._'))r.push(p);})}catch{} return r; };
            const jsonFiles = walkAll(extractDir).filter(f => path.basename(f) === 'plugin.json');
            logger.info('plugin_merge_json_found', { count: jsonFiles.length, files: jsonFiles });
            let mergedPermissions = null;
            for (const jf of jsonFiles) {
                try {
                    const meta = JSON.parse(fs.readFileSync(jf, 'utf8'));
                    if (Array.isArray(meta.permissions)) mergedPermissions = meta.permissions;
                    // Also copy plugin.json to plugins dir for reference
                    const jsonTarget = path.join(PLUGINS_DIR, path.basename(jf));
                    if (!fs.existsSync(jsonTarget)) fs.copyFileSync(jf, jsonTarget);
                } catch (e) { logger.warn('plugin_json_parse_failed', { file: jf, error: e.message }); }
            }
            // Apply merged permissions by appending to the plugin source
            if (mergedPermissions) {
                let content = fs.readFileSync(targetPath, 'utf8');
                const permStr = JSON.stringify(mergedPermissions);
                // Inject permissions after name field
                content = content.replace(/name:\s*['"][^'"]+['"]/, `$&,permissions:${permStr}`);
                fs.writeFileSync(targetPath, content, 'utf8');
                logger.info('plugin_merge_permissions', { permissions: mergedPermissions });
            }

            // Cleanup
            fs.rmSync(extractDir, { recursive: true, force: true });
            fs.unlinkSync(pluginPath);
            pluginFilename = safeName;
            pluginPath = targetPath;
        }

        const validatedName = safePluginFilename(pluginFilename);
        if (!pluginFilename.endsWith('.zip')) {
            // Only re-validate path if we didn't already extract
            pluginPath = path.join(PLUGINS_DIR, validatedName);
        }

        logger.info('plugin_upload_require', { pluginPath });
        delete require.cache[require.resolve(pluginPath)];
        const plugin = require(pluginPath);
        logger.info('plugin_upload_validate', { name: plugin.name, file: pluginFilename });
        toolBox.validatePlugin(plugin, { requireExplicitPermissions: true });
        logger.info('plugin_upload_loading', { name: pluginFilename });
        toolBox.loadPlugins();
        const elapsed = Date.now() - startTime;
        logger.info('plugin_upload_success', { name: validatedName || pluginFilename, file: pluginFilename, durationMs: elapsed });
        res.json({ message: 'Plugin uploaded and loaded', name: validatedName || pluginFilename });
    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        logger.error('plugin_upload_failed', err, { filename: req.file?.originalname, step: 'extract/validate', userAction: 'plugin_upload', severity: 'high' });
        res.status(400).json({ error: err.message });
    }
});

router.delete('/plugins/:name', (req, res) => {
    const { name } = req.params;
    if (DEFAULT_PLUGINS.has(name)) {
        return jsonError(res, 403, `${name} is a default plugin and cannot be removed`, 'mandatory_plugin');
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

// --- Plugin Enable/Disable ---

router.get('/plugins/:name/status', (req, res) => {
    const { name } = req.params;
    const plugin = toolBox.plugins.get(name);
    const isDisabled = toolBox.disabledPlugins.has(name);
    res.json({
        name,
        loaded: !!plugin,
        enabled: !isDisabled,
        disabled: isDisabled
    });
});

router.post('/plugins/:name/enable', (req, res) => {
    const { name } = req.params;
    if (!toolBox.plugins.has(name) && !toolBox.disabledPlugins.has(name)) {
        return jsonError(res, 404, 'Plugin not found', 'plugin_not_found');
    }
    toolBox.enablePlugin(name);
    res.json({ message: `Plugin ${name} enabled`, name, enabled: true });
});

router.post('/plugins/:name/disable', (req, res) => {
    const { name } = req.params;
    if (DEFAULT_PLUGINS.has(name)) {
        return jsonError(res, 403, `${name} is a default plugin and cannot be disabled`, 'mandatory_plugin');
    }
    if (!toolBox.plugins.has(name) && !toolBox.disabledPlugins.has(name)) {
        return jsonError(res, 404, 'Plugin not found', 'plugin_not_found');
    }
    toolBox.disablePlugin(name);
    res.json({ message: `Plugin ${name} disabled`, name, disabled: true });
});


router.use('/search', searchRouter);

// --- System Status ---

router.get('/status', async (req, res) => {
    try {
        const data = await contextEngine.executeJson(['status']);
        res.json({
            version: data.version || 'ctx',
            llm: data.llm || { model: 'n/a' },
            projects: data.projects || [],
            ok: true
        });
    } catch (err) {
        // ctx CLI may not be available — return degraded status
        res.json({
            version: 'ctx-unavailable',
            llm: { model: 'Not Available' },
            projects: [],
            ok: false,
            error: err.message,
            hint: 'Install ctx: npm install -g @context-expert/cli'
        });
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
        const html = graphifyService.readArtifact(dirPath, type);
        setGraphifyArtifactHeaders(res);
        res.send(html);
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

// --- Settings API ---

router.get('/settings', (req, res) => {
    const settings = require('../infrastructure/SettingsProvider');
    res.json(settings.getAll());
});

router.put('/settings', (req, res) => {
    const settings = require('../infrastructure/SettingsProvider');
    const allowed = ['allowPluginUploads', 'allowUnrestrictedPlugins', 'allowAgentCommands', 'requirePairingToken'];
    const updates = {};
    for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = Boolean(req.body[key]);
    }
    if (Object.keys(updates).length === 0) return jsonError(res, 400, 'No valid settings provided', 'invalid_settings');
    settings.save(updates);
    // Reload ToolBox to pick up permission changes
    const toolBox = require('../infrastructure/ToolBox');
    toolBox.loadPluginPermissions();
    res.json(settings.getAll());
});

router.loadConfig = loadConfig;
router.getConfigPath = getConfigPath;
router.isGeneratedTempWorkspace = isGeneratedTempWorkspace;
// ─────────────────────────────────────────────────────────────────────────
//  HEALTH & SELF-HEALING ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/health — Full health report.
 *
 * Returns status of every dependency the runtime needs. The Electron
 * recovery page polls this on load to render the diagnostic dashboard.
 */
router.get('/health', async (req, res) => {
    const healthState = req.app ? req.app.get('healthState') : null;
    const checks = healthState || {
        started: false,
        graphify: { ok: false, message: 'runtime not initialized' },
        ollama: { ok: false, message: 'runtime not initialized' },
        ctx: { ok: false, message: 'runtime not initialized' },
        config: { ok: false, message: 'runtime not initialized' },
        projects: 0,
        indexed: 0,
        syncComplete: false
    };

    const ollamaRunning = await dependencyChecker.checkRunning('ollama')
        .catch(() => ({ running: null, reason: 'check failed' }));

    // Normalize each check to include a `version` field if not already set
    const enrich = (c) => c ? { ...c, version: c.version || null } : c;

    res.json({
        status: checks.started ? 'degraded' : 'starting',
        started: checks.started,
        uptimeSeconds: Math.round(process.uptime()),
        checks: {
            node: {
                ok: true,
                version: process.version,
                message: `${process.version} on ${process.platform} ${process.arch}`
            },
            runtime: {
                ok: true,
                version: null,
                message: `PID ${process.pid}, listening on port ${req.app?.get('port') || 3090}`
            },
            graphify: enrich(checks.graphify),
            ollama: enrich(checks.ollama),
            ctx: enrich(checks.ctx),
            config: enrich(checks.config)
        },
        services: { ollama: ollamaRunning },
        projects: { total: checks.projects, indexed: checks.indexed, synced: checks.syncComplete },
        memory: process.memoryUsage(),
        platform: { hostname: os.hostname(), release: os.release(), arch: os.arch() },
        tasks: {
            total: agentEngine.getTasks().length,
            pendingApprovals: agentEngine.getPendingApprovals().length
        },
        plugins: toolBox.getPolicy().plugins
    });
});

/**
 * POST /api/health/install — Self-heal a missing dependency.
 *
 * Body: { component: "ollama" | "ctx" }
 *
 * Tries to auto-install the requested component. Returns success/failure.
 */
router.post('/health/install', (req, res) => {
    const { component } = req.body;

    switch (component) {
        case 'ollama': {
            const installScript = process.platform === 'darwin'
                ? 'curl -fsSL https://ollama.com/install.sh | sh'
                : process.platform === 'win32'
                    ? 'winget install Ollama.Ollama'
                    : 'curl -fsSL https://ollama.com/install.sh | sh';

            logger.info('health_install_started', { component, command: installScript });

            execFile('/bin/sh', ['-c', installScript], { timeout: 120000 }, (err, stdout) => {
                if (err) {
                    logger.error('health_install_failed', err, { component });
                    res.json({
                        ok: false,
                        component,
                        message: `Installation failed: ${err.message}. Install manually from https://ollama.com`,
                        stdout: stdout || ''
                    });
                    return;
                }
                logger.info('health_install_completed', { component });
                res.json({ ok: true, component, message: 'Ollama installed. Restart the runtime.' });
            });
            break;
        }

        case 'ctx': {
            const installScript = process.platform === 'darwin'
                ? 'npm install -g @context-expert/cli'
                : 'npm install -g @context-expert/cli';

            logger.info('health_install_started', { component, command: installScript });

            execFile('/bin/sh', ['-c', installScript], { timeout: 120000 }, (err, stdout) => {
                if (err) {
                    res.json({
                        ok: false,
                        component,
                        message: `Installation failed: ${err.message}. Install manually: npm install -g @context-expert/cli`,
                        stdout: stdout || ''
                    });
                    return;
                }
                res.json({ ok: true, component, message: 'Context Expert installed. Restart the runtime.' });
            });
            break;
        }

        default:
            res.status(400).json({ ok: false, message: `Unknown component: ${component}` });
    }
});

router.isPairingRequiredByDefault = isPairingRequiredByDefault;
router.arePluginUploadsEnabled = arePluginUploadsEnabled;
router.safePluginFilename = safePluginFilename;
router.isGeneratedTempWorkspace = isGeneratedTempWorkspace;

module.exports = router;
