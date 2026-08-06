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
const { runGit, readGitContext } = require('../support/git');

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

router.post('/git/commit', async (req, res) => {
    try {
        const dirPath = validateString(req.body?.path, 'path', { max: 2000 });
        const message = validateString(req.body?.message, 'message', { max: 2000 });
        const files = req.body?.files || ['.'];
        const [branch, hash] = await Promise.all([
            runGit(dirPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
            runGit(dirPath, ['add', ...files]).then(() =>
                runGit(dirPath, ['commit', '-m', message]).catch(() =>
                    runGit(dirPath, ['commit', '--allow-empty', '-m', message])
                )
            ).then(() => runGit(dirPath, ['rev-parse', 'HEAD']))
        ]);
        res.json({ ok: true, branch, hash: hash.substring(0, 7) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/git/push', async (req, res) => {
    try {
        const dirPath = validateString(req.body?.path, 'path', { max: 2000 });
        const output = await runGit(dirPath, ['push']);
        res.json({ ok: true, output });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/git/pull', async (req, res) => {
    try {
        const dirPath = validateString(req.body?.path, 'path', { max: 2000 });
        const output = await runGit(dirPath, ['pull', '--rebase']);
        res.json({ ok: true, output });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post('/git/branch', async (req, res) => {
    try {
        const dirPath = validateString(req.body?.path, 'path', { max: 2000 });
        const branch = validateString(req.body?.branch, 'branch', { max: 250 });
        await runGit(dirPath, ['checkout', '-b', branch]);
        res.json({ ok: true, branch });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});


module.exports = router;
