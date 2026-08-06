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
const fileUploadService = require('../services/fileUploadService');
const auditLog = require('../infrastructure/AuditLog');
const pairingService = require('../infrastructure/PairingService');
const originPolicy = require('../infrastructure/OriginPolicy');
const logger = require('../infrastructure/Logger');
const graphifyService = require('../infrastructure/GraphifyService');
const dependencyChecker = require('../infrastructure/DependencyChecker');
const workspaceReadiness = require('../infrastructure/WorkspaceReadiness');

const multer = require('multer');

// Core Layer
const queueService = require('../core/QueueService');
const agentEngine = require('../core/AgentReasoningEngine');

const router = express.Router();
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config.json');
const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');
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
    // vis-network is served from /vendor (see GraphifyService.localizeVendorScripts),
    // so this no longer needs to allow unpkg.com or 'unsafe-eval'.
    // 'unsafe-inline' for scripts remains required: Graphify writes the graph
    // data and init call as inline <script> blocks we do not control, and they
    // cannot be nonced without rewriting third-party output.
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
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

/**
 * Recursively lists files under `dir`, skipping macOS archive noise
 * (`__MACOSX/`, dotfile directories, `._` resource forks).
 *
 * Unreadable entries are logged and skipped rather than silently aborting the
 * walk: an uploaded zip can legitimately contain something we cannot stat, and
 * the previous `catch {}` turned that into an empty result with no explanation.
 *
 * @param {string} dir - Directory to walk.
 * @param {(entryName: string) => boolean} [accept] - Filter applied to files only.
 * @returns {string[]} Absolute paths of matching files.
 */
function walkArchiveFiles(dir, accept = () => true) {
    let found = [];
    let entries;

    try {
        entries = fs.readdirSync(dir);
    } catch (err) {
        logger.warn('plugin_archive_walk_skipped', { dir, reason: err.message });
        return found;
    }

    for (const entry of entries) {
        if (entry.startsWith('._')) continue;

        const entryPath = path.join(dir, entry);
        let stats;
        try {
            stats = fs.statSync(entryPath);
        } catch (err) {
            logger.warn('plugin_archive_stat_skipped', { path: entryPath, reason: err.message });
            continue;
        }

        if (stats.isDirectory()) {
            if (entry.startsWith('__MACOSX') || entry.startsWith('.')) continue;
            found = found.concat(walkArchiveFiles(entryPath, accept));
        } else if (accept(entry)) {
            found.push(entryPath);
        }
    }

    return found;
}

function requirePluginUploadsEnabled(req, res, next) {
    if (!arePluginUploadsEnabled()) {
        return jsonError(res, 403, 'Plugin uploads are disabled. Set YODAMAN_ALLOW_PLUGIN_UPLOADS=true only for trusted local support sessions.', 'plugin_uploads_disabled');
    }
    return next();
}

// FIRST GATE — reject browser-initiated cross-site requests.
//
// This must run before everything else. The loopback check below trusts the TCP
// source address, which cannot tell the user's own UI apart from a malicious
// page the user happens to have open: both arrive from 127.0.0.1. Without this
// guard any website could call PUT /settings, enable allowAgentCommands, and
// reach shell execution. See backend/infrastructure/OriginPolicy.js.
router.use(originPolicy.crossSiteGuard);

// SECOND GATE — pairing token for non-local callers.
//
// Reaching this point means the request is either same-origin from a local UI or
// from a non-browser client. A local *process* is still trusted deliberately: it
// already runs with the user's privileges, so gating it would buy nothing. What
// is no longer trusted is a remote *page* that merely reaches us over loopback.
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
    } catch (_err) {
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
            id: p.id || p.path,
            files: p.files || 0,
            chunks: p.chunks || 0,
            indexed: true
        })).filter(p => !config.removedDirectories.includes(p.path) && !isGeneratedTempWorkspace(p.path));

        // Merge ctx projects with watched directories.
        // ctx is the source of truth; config.watchedDirectories may have
        // manually-added paths not yet indexed by ctx.
        const cliByPath = new Map(cliProjects.map(p => [p.path, p]));
        const result = [...cliProjects];

        // Add any watched directories not in ctx (pending / not yet indexed)
        for (const dir of config.watchedDirectories) {
            if (!cliByPath.has(dir)) {
                result.push({ name: path.basename(dir), path: dir, id: dir, files: 0, chunks: 0, indexed: false });
            }
        }

        res.json(result);
    } catch (err) {
        logger.warn('projects_list_ctx_failed', { requestId: req.id, error: err.message });
        res.json(config.watchedDirectories.map(d => ({ name: path.basename(d), path: d, id: d, files: 0, chunks: 0, indexed: false })));
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
    let projectPath;
    try {
        question = validateString(req.body?.question, 'question', { max: 20000 });
        projectId = validateProjectId(req.body?.projectId);
        projectPath = resolveProjectPath(projectId);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, 'invalid_request');
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
            answer = contextEngine.stripCliNoise(output);
        } catch (ctxErr) {
            logger.warn('ask_ctx_fallback_started', {
                requestId: req.id,
                projectId,
                projectPath,
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
            userAction: 'chat_ask',
            severity: 'high'
        });
        res.status(500).json({ error: err.message, requestId: req.id });
    }
});

// Git routes — see routes/gitRoutes.js
router.use(require('./routes/gitRoutes'));
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
            const { execFileSync } = require('child_process');
            const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-extract-'));
            // argv form, not a shell string: paths reach unzip as literal
            // arguments, so quoting and metacharacters can never be reinterpreted.
            execFileSync('unzip', ['-o', pluginPath, '-d', extractDir], { stdio: 'pipe' });

            // Find the main .js file (prefer main.js, then any .js at root)
            const jsFiles = walkArchiveFiles(extractDir, (entry) => entry.endsWith('.js'));
            // Prefer main.js at root level
            const mainEntry = jsFiles.find(f => path.basename(f) === 'main.js') || jsFiles[0];
            if (!mainEntry) throw new Error('No .js plugin file found in the zip archive');

            const safeName = safePluginFilename(path.basename(mainEntry));
            const targetPath = path.join(PLUGINS_DIR, safeName);
            fs.copyFileSync(mainEntry, targetPath);

            // Merge plugin.json fields into the plugin if present
            logger.info('plugin_merge_looking_for_json', { extractDir });
            const jsonFiles = walkArchiveFiles(extractDir).filter(f => path.basename(f) === 'plugin.json');
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

router.post('/plugins/:name/open', async (req, res) => {
    const { name } = req.params;
    const plugin = toolBox.plugins.get(name);
    if (!plugin || toolBox.disabledPlugins.has(name)) {
        return jsonError(res, 404, 'Plugin not found or disabled', 'plugin_not_found');
    }

    try {
        logger.info('plugin_open_requested', {
            plugin: name,
            project: req.body?.project,
            diagnostics: req.body?.diagnostics,
            userAction: 'open_plugin'
        });
        const result = await plugin.execute({ _action: 'open', project: req.body?.project });
        if (!result?.opened) {
            const error = new Error('Plugin completed without opening a viewer. The installed plugin does not implement the open action.');
            logger.error('plugin_open_not_confirmed', error, {
                plugin: name,
                project: req.body?.project,
                diagnostics: req.body?.diagnostics,
                result,
                userAction: 'open_plugin',
                severity: 'high'
            });
            return res.status(501).json({ error: error.message, code: 'plugin_open_not_implemented', result });
        }
        logger.info('plugin_open_confirmed', { plugin: name, project: req.body?.project, diagnostics: req.body?.diagnostics });
        res.json({ ok: true, name, project: req.body?.project, result });
    } catch (err) {
        logger.error('plugin_open_failed', err, {
            plugin: name,
            project: req.body?.project,
            userAction: 'open_plugin',
            severity: 'high'
        });
        res.status(500).json({ error: err.message, code: 'plugin_open_failed' });
    }
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
            nodeVersion: data.nodeVersion || process.version,
            platform: data.platform || process.platform,
            database: data.database || { sizeFormatted: '—', path: '—' },
            totalChunks: typeof data.totalChunks === 'number' ? data.totalChunks : 0,
            projects: data.projects || 0,
            embedding: data.embedding || { provider: '—', model: '—' },
            llm: data.llm || { model: 'n/a', provider: 'none' },
            ok: true
        });
    } catch (err) {
        // ctx CLI may not be available — return degraded status
        res.json({
            version: 'ctx-unavailable',
            nodeVersion: process.version,
            platform: process.platform,
            database: { sizeFormatted: '—', path: '—' },
            totalChunks: 0,
            projects: 0,
            embedding: { provider: '—', model: '—' },
            llm: { model: 'Not Available', provider: 'none' },
            ok: false,
            error: err.message,
            hint: 'Install ctx: npm install -g @contextexpert/cli'
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
    const healthState = req.app ? req.app.get('healthState') : {};
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
        plugins: toolBox.getPolicy().plugins,
        dependencies: {
            ollama: healthState.ollama || null,
            ctx: healthState.ctx || null,
            graphify: healthState.graphify || null,
            openspec: healthState.openspec || null,
        }
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
        // ctx check expects a project name, not a path. Resolve from the project list.
        const cliData = await contextEngine.executeJson(['list']);
        const project = cliData.projects.find(p => p.path === dirPath);

        if (!project) {
            // Not a ctx-managed project — check if directory exists at least
            const fs = require('fs');
            if (fs.existsSync(dirPath)) {
                return res.json({ status: 'healthy', name: dirPath.split('/').pop(), path: dirPath, ctxManaged: false });
            }
            return res.status(404).json({ error: 'Path not found', status: 'missing' });
        }

        const data = await contextEngine.executeJson(['check', project.name]);
        res.json({ ...data, name: project.name, path: dirPath });
    } catch (err) {
        // Fallback: return basic health based on directory existence
        const fs = require('fs');
        if (fs.existsSync(dirPath)) {
            return res.json({ status: 'healthy', path: dirPath, ctxManaged: true, note: err.message });
        }
        res.status(500).json({ status: 'error', error: err.message });
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
    const booleanKeys = [
        'allowPluginUploads',
        'allowUnrestrictedPlugins',
        'allowAgentCommands',
        'requirePairingToken',
        'allowSelfHealInstall'
    ];
    const updates = {};
    for (const key of booleanKeys) {
        if (req.body[key] !== undefined) updates[key] = Boolean(req.body[key]);
    }
    // allowedCommands extends the agent's executable allowlist, so it is a list
    // of bare names — reject paths and anything with shell metacharacters.
    if (req.body.allowedCommands !== undefined) {
        if (!Array.isArray(req.body.allowedCommands)) {
            return jsonError(res, 400, 'allowedCommands must be an array of executable names', 'invalid_settings');
        }
        const invalid = req.body.allowedCommands.filter(
            (entry) => typeof entry !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(entry)
        );
        if (invalid.length) {
            return jsonError(res, 400, `Invalid executable names: ${invalid.join(', ')}`, 'invalid_settings');
        }
        updates.allowedCommands = req.body.allowedCommands;
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
//  CTX CONFIG ENDPOINTS — wrapper around ctx config list/set
// ─────────────────────────────────────────────────────────────────────────

router.get('/ctx/config', async (req, res) => {
    try {
        const data = await contextEngine.executeJson(['config', 'list']);
        res.json({ ok: true, config: data });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

router.post('/ctx/config', async (req, res) => {
    const { key, value } = req.body || {};
    if (!key || value === undefined) {
        return res.status(400).json({ ok: false, error: 'key and value are required' });
    }
    try {
        await contextEngine.execute(['config', 'set', key, String(value)]);
        res.json({ ok: true, key, value });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  HEALTH & SELF-HEALING ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────

// Last reported "<status>:<degraded keys>" signature, used to log health
// transitions once instead of on every poll.
let lastHealthSignature = null;

/**
 * GET /api/health — Full health report.
 *
 * Returns status of every dependency the runtime needs, plus `degraded` and
 * `pending` arrays naming the checks that need attention. The Electron
 * recovery page polls this on load to render the diagnostic dashboard.
 */
router.get('/health', async (req, res) => {
    const healthState = req.app ? req.app.get('healthState') : null;
    const checks = healthState || {
        started: false,
        graphify: { ok: null, message: 'runtime not initialized' },
        ollama: { ok: null, message: 'runtime not initialized' },
        ctx: { ok: null, message: 'runtime not initialized' },
        openspec: { ok: null, message: 'runtime not initialized' },
        config: { ok: null, message: 'runtime not initialized' },
        projects: 0,
        indexed: 0,
        syncComplete: false
    };

    const ollamaRunning = await dependencyChecker.checkRunning('ollama')
        .catch(() => ({ running: null, reason: 'check failed' }));

    // Normalize each check to include a `version` field if not already set.
    // During startup, "not checked" means pending. Reporting it as a failure
    // makes the Electron diagnostics page show a false startup error.
    const enrich = (c) => {
        if (!c) return c;
        const ok = checks.started === false && c.ok === false && c.message === 'not checked'
            ? null
            : c.ok;
        return { ...c, ok, version: c.version || null };
    };

    const reportedChecks = {
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
        openspec: enrich(checks.openspec),
        config: enrich(checks.config)
    };

    // Report the state we actually observed. Previously this always said
    // "degraded" once startup finished, which hid genuine failures behind a
    // permanent warning and gave the diagnostics page nothing to act on.
    const degraded = Object.entries(reportedChecks)
        .filter(([, check]) => check && check.ok === false)
        .map(([name]) => name);
    const pending = Object.entries(reportedChecks)
        .filter(([, check]) => check && check.ok === null)
        .map(([name]) => name);

    const status = !checks.started
        ? 'starting'
        : degraded.length > 0 ? 'degraded' : 'ok';

    // The diagnostics page polls this endpoint on a timer, so only log when the
    // picture actually changes — otherwise the runtime log fills with repeats.
    const signature = `${status}:${degraded.join(',')}`;
    if (signature !== lastHealthSignature) {
        lastHealthSignature = signature;
        if (status === 'degraded') {
            logger.warn('health_report_degraded', { degraded, pending });
        } else {
            logger.info('health_report_changed', { status, pending });
        }
    }

    res.json({
        status,
        started: checks.started,
        uptimeSeconds: Math.round(process.uptime()),
        checks: reportedChecks,
        degraded,
        pending,
        services: { ollama: ollamaRunning },
        projects: { total: checks.projects, indexed: checks.indexed, synced: checks.syncComplete },
        // One trust verdict per workspace, so a client never has to reconcile
        // index staleness against graph build state itself.
        readiness: workspaceReadiness.forWorkspaces(config.watchedDirectories || []),
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
 * GET /api/readiness — Can this workspace's answers be trusted right now?
 *
 * Query: ?projectId=<absolute path>  (omit for every watched workspace)
 *
 * Collapses Context Expert index state and the Graphify build state into one
 * verdict, so a client does not have to reconcile them itself.
 */
router.get('/readiness', (req, res) => {
    try {
        const projectId = req.query.projectId;
        if (projectId) {
            return res.json(workspaceReadiness.forWorkspace(projectId));
        }
        return res.json(workspaceReadiness.forWorkspaces(config.watchedDirectories || []));
    } catch (err) {
        logger.error('readiness_check_failed', err, { requestId: req.id });
        return jsonError(res, 500, err.message, 'readiness_failed');
    }
});

/**
 * Installers for POST /api/health/install.
 *
 * Every entry is an argv array executed with execFile — never a shell string.
 * The previous implementation ran `execFile('/bin/sh', ['-c', script])` where the
 * script for Ollama was `curl -fsSL https://ollama.com/install.sh | sh`, i.e. an
 * unauthenticated endpoint that downloaded and executed a remote script. That
 * path is gone: Ollama now installs through the platform package manager, and if
 * none is available the caller is told to install it manually.
 *
 * `manual` is returned when no safe automated path exists on this platform.
 */
const SELF_HEAL_INSTALLERS = {
    ollama: () => {
        if (process.platform === 'darwin') return { argv: ['brew', ['install', 'ollama']], needs: 'brew' };
        if (process.platform === 'win32') return { argv: ['winget', ['install', 'Ollama.Ollama']], needs: 'winget' };
        return { manual: 'Install Ollama from https://ollama.com/download' };
    },
    ctx: () => ({ argv: ['npm', ['install', '-g', '@contextexpert/cli']], needs: 'npm' }),
    openspec: () => ({ argv: ['npm', ['install', '-g', '@fission-ai/openspec@latest']], needs: 'npm' })
};

/**
 * POST /api/health/install — Self-heal a missing dependency.
 *
 * Body: { component: "ollama" | "ctx" | "openspec" }
 *
 * Disabled by default. Installing software is a privileged action, so it now
 * requires `allowSelfHealInstall` to be enabled in Settings rather than being
 * reachable by anything that can reach the port.
 */
router.post('/health/install', (req, res) => {
    const settings = require('../infrastructure/SettingsProvider');
    if (!settings.get('allowSelfHealInstall')) {
        return jsonError(
            res,
            403,
            'Automatic dependency installation is disabled. Enable "allowSelfHealInstall" in Settings, or install the component manually.',
            'self_heal_install_disabled'
        );
    }

    const { component } = req.body || {};
    const build = Object.prototype.hasOwnProperty.call(SELF_HEAL_INSTALLERS, component)
        ? SELF_HEAL_INSTALLERS[component]
        : null;

    if (!build) {
        return res.status(400).json({ ok: false, message: `Unknown component: ${component}` });
    }

    const plan = build();
    if (plan.manual) {
        return res.json({ ok: false, component, message: plan.manual });
    }

    const [bin, args] = plan.argv;
    logger.info('health_install_started', { component, bin, args });

    return execFile(bin, args, { timeout: 120000 }, (err, stdout) => {
        if (err) {
            logger.error('health_install_failed', err, { component, bin });
            const hint = err.code === 'ENOENT'
                ? `${plan.needs} is not installed or not on PATH.`
                : err.message;
            return res.json({
                ok: false,
                component,
                message: `Installation failed: ${hint}`,
                stdout: stdout || ''
            });
        }
        logger.info('health_install_completed', { component });
        return res.json({ ok: true, component, message: `${component} installed. Restart the runtime.` });
    });
});

// Stardust routes — see routes/stardustRoutes.js
router.use(require('./routes/stardustRoutes'));

// Test-facing handles. These belong on the top-level router, not on any
// sub-router: tests/interfaces/RestController.test.js reaches for them.
router.isPairingRequiredByDefault = isPairingRequiredByDefault;
router.arePluginUploadsEnabled = arePluginUploadsEnabled;
router.safePluginFilename = safePluginFilename;
router.isGeneratedTempWorkspace = isGeneratedTempWorkspace;

module.exports = router;
