/**
 * Graphify routes — /api/graphify/*
 *
 * Extracted from RestController.js, following the split that already moved git
 * and stardust out. Every handler here delegates to GraphifyService; the file
 * holds no graph logic of its own, only request validation and error shaping.
 */
const express = require('express');
const crypto = require('crypto');

const logger = require('../../infrastructure/Logger');
const graphifyService = require('../../infrastructure/GraphifyService');
const { jsonError, validateString } = require('../support/http');
const {
    validateIndexableDirectory,
    resolveRegisteredProjectPath
} = require('../support/workspaces');

const router = express.Router();

/**
 * In-flight and completed Graphify builds, keyed by job id. In memory on
 * purpose: a build that was running when the runtime stopped did not finish,
 * and reporting it as still running after a restart would be a lie.
 */
const graphifyBuildJobs = new Map();

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

module.exports = router;
