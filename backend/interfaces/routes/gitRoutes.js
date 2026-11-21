/**
 * Git routes — /api/git/*
 *
 * Extracted from RestController.js during the W-6 split. Read endpoints delegate
 * to gitService; mutations use runGit directly so the exact argv is visible at
 * the call site.
 */
const express = require('express');

const gitService = require('../../services/gitService');
const { jsonError, validateString } = require('../support/http');
const { runGit, readGitContext, NETWORK_TIMEOUT_MS } = require('../support/git');
const { resolveRegisteredProjectPath } = require('../support/workspaces');

const router = express.Router();

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

router.get('/git/timeline', async (req, res) => {
    try {
        const workspacePath = validateString(req.query?.path, 'path', { max: 4096 });
        res.json(await gitService.getTimeline(workspacePath, { days: req.query?.days }));
    } catch (err) {
        jsonError(res, err.status || 500, err.message, 'git_timeline_failed');
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

// ── Git mutations ──
//
// Only registered workspaces may be changed, and request values never reach git
// where they could be read as options: files go after `--`, and a branch name
// may not start with `-`.

/** Runs a mutation, answering `{ ok: false, error, code }` on failure. */
function mutation(route, code, handler) {
    router.post(route, async (req, res) => {
        try {
            res.json({ ok: true, ...(await handler(resolveRegisteredProjectPath(req.body?.path), req.body || {})) });
        } catch (err) {
            // A git failure's err.code is its exit status, so only our own 4xx errors keep theirs.
            const own = Boolean(err.status);
            res.status(err.status || 500).json({ ok: false, error: err.message, code: own ? err.code || 'invalid_request' : code });
        }
    });
}

function invalid(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

mutation('/git/commit', 'git_commit_failed', async (dirPath, body) => {
    const message = validateString(body.message, 'message', { max: 2000 });
    const files = body.files ?? ['.'];
    if (!Array.isArray(files) || !files.length || !files.every(f => typeof f === 'string' && f)) {
        throw invalid('files must be a non-empty array of paths');
    }
    await runGit(dirPath, ['add', '--', ...files]);
    // No --allow-empty fallback: "nothing to commit" is reported, not papered over.
    await runGit(dirPath, ['commit', '-m', message]);
    const [branch, hash] = await Promise.all([
        runGit(dirPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
        runGit(dirPath, ['rev-parse', 'HEAD'])
    ]);
    return { branch, hash: hash.substring(0, 7) };
});

mutation('/git/push', 'git_push_failed', async (dirPath) => (
    { output: await runGit(dirPath, ['push'], { timeout: NETWORK_TIMEOUT_MS }) }
));

mutation('/git/pull', 'git_pull_failed', async (dirPath) => (
    { output: await runGit(dirPath, ['pull', '--rebase'], { timeout: NETWORK_TIMEOUT_MS }) }
));

mutation('/git/branch', 'git_branch_failed', async (dirPath, body) => {
    const branch = validateString(body.branch, 'branch', { max: 250 });
    if (branch.startsWith('-')) throw invalid('branch must not start with "-"');
    await runGit(dirPath, ['checkout', '-b', branch]);
    return { branch };
});

module.exports = router;
