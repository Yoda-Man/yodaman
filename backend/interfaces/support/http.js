/**
 * Shared HTTP helpers for the route modules.
 *
 * Extracted from RestController.js during the W-6 split. Every route module
 * validates input the same way, so these live in one place rather than being
 * closed over by a single 2,300-line file.
 */
const path = require('path');

/**
 * Uniform error body. Every failure the API returns has `error` and `code`.
 */
function jsonError(res, status, message, code) {
    return res.status(status).json({ error: message, code });
}

/**
 * Validates and trims a string parameter.
 * @throws {Error & {status: 400}} when missing, wrong type, or over `max`.
 */
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

function validateProjectId(projectId) {
    return validateString(projectId, 'projectId', { required: false, max: 4096 });
}

/**
 * Resolves a caller-supplied path to an absolute one, rejecting null bytes.
 * Workspace containment is enforced separately by the caller — this only makes
 * the value safe to pass to the filesystem.
 */
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

/**
 * True when the request arrived over loopback.
 *
 * NOT a trust boundary on its own — a browser running a malicious page on the
 * user's machine is also 127.0.0.1. OriginPolicy.crossSiteGuard runs first and
 * is what actually distinguishes the local UI from a remote page.
 */
function isLocalRequest(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

module.exports = {
    jsonError,
    validateString,
    validateProjectId,
    resolveUserPath,
    isLocalRequest
};
