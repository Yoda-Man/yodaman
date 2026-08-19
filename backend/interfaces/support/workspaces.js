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

const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../../config.json');

/** The active config file — overridable so tests never touch the real one. */
function getConfigPath() {
    return process.env.YODAMAN_CONFIG_PATH || DEFAULT_CONFIG_PATH;
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
    resolveRegisteredProjectPath
};
