/**
 * Editor routes: /api/editor/*
 *
 * POST /editor/open opens a workspace file in the user's editor at a line. See
 * EditorLauncher for why this is done by the runtime rather than with a
 * `vscode://` link in the page.
 *
 * Starting a program on the user's desktop is a side effect, so the guards are
 * deliberately tighter than for a read:
 *
 *   - Local callers only. A paired phone can read the workspace; it has no
 *     business launching applications on the desktop.
 *   - The workspace must be registered, and the file must resolve, after
 *     following symlinks, to a regular file INSIDE it. A link pointing out of
 *     the workspace is refused, not followed.
 *   - The program comes from config or the OS default, never from the request.
 *     The request supplies a file and a line number, and nothing else.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const logger = require('../../infrastructure/Logger');
const editorLauncher = require('../../infrastructure/EditorLauncher');
const { jsonError, validateString, isLocalRequest } = require('../support/http');
const { resolveRegisteredProjectPath } = require('../support/workspaces');
const settings = require('../../infrastructure/SettingsProvider');

const router = express.Router();
const MAX_LINE = 10_000_000;

function fail(status, message, code) {
    const err = new Error(message);
    err.status = status;
    err.code = code;
    return err;
}

/** The real path of a workspace file, or a thrown 4xx explaining why not. */
function resolveWorkspaceFile(workspace, requested) {
    if (requested.includes('\0')) throw fail(400, 'path cannot contain null bytes', 'invalid_path');
    // Search hits and agent answers cite workspace-relative paths, sometimes
    // with a leading "./" the chat adds so they render as links.
    const candidate = path.isAbsolute(requested)
        ? requested
        : path.join(workspace, requested.replace(/^\.[\\/]/, ''));

    let realFile;
    let realWorkspace;
    try {
        realWorkspace = fs.realpathSync(workspace);
        realFile = fs.realpathSync(candidate);
    } catch (_err) {
        throw fail(404, `File not found: ${requested}`, 'file_missing');
    }

    const inside = realFile === realWorkspace || realFile.startsWith(`${realWorkspace}${path.sep}`);
    if (!inside) throw fail(403, 'File is outside the workspace', 'file_outside_workspace');
    if (!fs.statSync(realFile).isFile()) throw fail(400, `Not a file: ${requested}`, 'not_a_file');
    return realFile;
}

function parseLine(value) {
    if (value === undefined || value === null || value === '') return null;
    const line = Number(value);
    if (!Number.isInteger(line) || line < 1 || line > MAX_LINE) {
        throw fail(400, 'line must be a positive whole number', 'invalid_line');
    }
    return line;
}

router.post('/editor/open', async (req, res) => {
    if (!isLocalRequest(req)) {
        return jsonError(res, 403, 'Files can only be opened from this computer', 'editor_local_only');
    }

    let file;
    let line;
    try {
        const workspace = resolveRegisteredProjectPath(req.body?.workspace);
        file = resolveWorkspaceFile(workspace, validateString(req.body?.path, 'path', { max: 4096 }));
        line = parseLine(req.body?.line);
    } catch (err) {
        return jsonError(res, err.status || 400, err.message, err.code || 'invalid_request');
    }

    try {
        const opened = await editorLauncher.launch({ file, line, setting: settings.getAll().editorCommand });
        logger.info('editor_opened', { requestId: req.id, editor: opened.editor, withLine: opened.line });
        res.json({ opened: true, file, line, editor: opened.editor, atLine: opened.line });
    } catch (err) {
        logger.error('editor_open_failed', err, { requestId: req.id });
        jsonError(res, 500, err.message, 'editor_launch_failed');
    }
});

/**
 * What the Settings picker offers: the current choice, the OS default for a
 * typical source file, and the editors found on this machine. Detection only
 * suggests; any editor can be used through a command template.
 */
router.get('/editor/options', async (req, res) => {
    if (!isLocalRequest(req)) {
        return jsonError(res, 403, 'Editor settings are only available on this computer', 'editor_local_only');
    }
    const probe = path.join(__dirname, 'editorRoutes.js');
    const defaultApp = await editorLauncher.defaultAppFor(probe);
    res.json({
        editorCommand: settings.getAll().editorCommand || '',
        systemDefault: defaultApp ? path.basename(defaultApp).replace(/\.app$/i, '') : null,
        detected: editorLauncher.detectEditors(),
        placeholders: ['{file}', '{line}', '{column}']
    });
});

module.exports = router;
module.exports.resolveWorkspaceFile = resolveWorkspaceFile;
