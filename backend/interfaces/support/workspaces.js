/**
 * Workspace resolution and validation shared by the route modules.
 *
 * `getConfigPath` used to live in RestController, which meant any route module
 * extracted out of it needed either a circular import or its own copy of the
 * config-reading logic. A second copy is how four ignore lists drifted apart
 * and leaked ten thousand file descriptors, so it lives here once instead.
 */
const fs = require('fs');
const path = require('path');

const logger = require('../../infrastructure/Logger');
const { IGNORED_DIRECTORIES } = require('../../../shared/ignoredPaths');

const { configPath } = require('../../infrastructure/DataPaths');

/** The active config file — overridable so tests never touch the real one. */
function getConfigPath() {
    return configPath();
}

const EMPTY_CONFIG = { watchedDirectories: [], removedDirectories: [] };

/**
 * Reads config from disk, returning an empty config rather than throwing.
 * A corrupt file must not take the API down: the caller sees "no workspaces
 * registered", which is recoverable, instead of a 500 on every request.
 */
function readConfig() {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) return { ...EMPTY_CONFIG };
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
        logger.error('config_load_failed', err, { path: configPath, severity: 'high' });
        return { ...EMPTY_CONFIG };
    }
}

/**
 * Asserts a path exists and is a directory before it is indexed or built.
 * @throws {Error & {status:number, code:string}}
 */
function validateIndexableDirectory(dirPath) {
    let stat;
    try {
        stat = fs.statSync(dirPath);
    } catch (_err) {
        // The stat error itself carries nothing the caller needs; that the path
        // is absent is the whole finding.
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

/**
 * Asserts a path can be registered as a workspace: it exists, is a directory,
 * and is not output YodaMan or a toolchain generates (graphify-out,
 * .yodaman-doc-chunks, node_modules, ...).
 *
 * The docs preprocessor once added every workspace's `.yodaman-doc-chunks`
 * folder to the workspace list. Each one was then watched as a project, and
 * thousands of chunk files exhausted the runtime's file descriptors until
 * spawning ctx failed with EBADF. A generated folder is never a workspace.
 * @throws {Error & {status:number, code:string}}
 */
function validateWorkspaceCandidate(dirPath) {
    validateIndexableDirectory(dirPath);
    if (IGNORED_DIRECTORIES.includes(path.basename(dirPath))) {
        const err = new Error(`Not a workspace: ${path.basename(dirPath)} is generated output`);
        err.status = 400;
        err.code = 'workspace_generated';
        throw err;
    }
}

/**
 * Resolves a caller-supplied path and asserts it is a registered workspace.
 * Refusing unregistered paths is what stops an endpoint from being pointed at
 * an arbitrary directory on the machine.
 * @throws {Error & {status:404, code:'workspace_not_registered'}}
 */
function resolveRegisteredProjectPath(value) {
    const { resolveUserPath } = require('./http');
    const resolved = resolveUserPath(value);
    const config = readConfig();
    if (!(config.watchedDirectories || []).includes(resolved)) {
        const err = new Error(`Workspace is not registered: ${resolved}`);
        err.status = 404;
        err.code = 'workspace_not_registered';
        throw err;
    }
    return resolved;
}

module.exports = {
    getConfigPath,
    readConfig,
    validateIndexableDirectory,
    validateWorkspaceCandidate,
    resolveRegisteredProjectPath
};
