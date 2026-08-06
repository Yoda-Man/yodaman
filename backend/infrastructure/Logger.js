const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const entries = [];
const MAX_ENTRIES = 500;

// ─────────────────────────────────────────────────────────────────────────
//  FILE SINK
//
//  Logs used to go to stdout only. In the packaged Electron desktop app stdout
//  is not attached to anything, so when a user reported a failure there was no
//  artefact for support to ask for — while the runbook's "Search Runtime Logs"
//  and "Rotate local logs" sections assumed files that were never written.
//
//  Rotation is size-based and synchronous. Volume here is low (a line per
//  request), and a desktop app that loses its last few log lines on a crash is
//  worse than one that spends a microsecond appending.
// ─────────────────────────────────────────────────────────────────────────

const LOG_FILE_NAME = 'runtime.log';
const MAX_LOG_BYTES = Number(process.env.YODAMAN_LOG_MAX_BYTES || 5 * 1024 * 1024);
const MAX_LOG_FILES = Number(process.env.YODAMAN_LOG_MAX_FILES || 3);

function logDirectory() {
    return process.env.YODAMAN_LOG_DIR || path.join(os.homedir(), '.yodaman', 'logs');
}

function logFilePath() {
    return path.join(logDirectory(), LOG_FILE_NAME);
}

/**
 * File logging is on by default, off under Jest unless a directory is named —
 * otherwise every test run would litter the user's real log directory.
 */
function fileLoggingEnabled() {
    if (process.env.YODAMAN_LOG_TO_FILE === 'false') return false;
    if (process.env.YODAMAN_LOG_TO_FILE === 'true') return true;
    return process.env.NODE_ENV !== 'test';
}

let sinkBytes = null;      // bytes in the current file; null until first probe
let sinkFailed = false;    // set once, so a broken sink never spams the console

/**
 * runtime.log -> runtime.log.1 -> runtime.log.2 ... dropping the oldest.
 */
function rotate(dir) {
    const oldest = path.join(dir, `${LOG_FILE_NAME}.${MAX_LOG_FILES}`);
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });

    for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
        const from = path.join(dir, `${LOG_FILE_NAME}.${index}`);
        if (fs.existsSync(from)) {
            fs.renameSync(from, path.join(dir, `${LOG_FILE_NAME}.${index + 1}`));
        }
    }

    const current = path.join(dir, LOG_FILE_NAME);
    if (fs.existsSync(current)) fs.renameSync(current, path.join(dir, `${LOG_FILE_NAME}.1`));
}

/**
 * Appends one JSON line to the log file, rotating first if it is full.
 * Never throws: logging must not be able to take the runtime down.
 */
function appendToFile(line) {
    if (sinkFailed || !fileLoggingEnabled()) return;

    try {
        const dir = logDirectory();
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, LOG_FILE_NAME);

        if (sinkBytes === null) {
            sinkBytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
        }

        const bytes = Buffer.byteLength(line) + 1;
        if (sinkBytes + bytes > MAX_LOG_BYTES) {
            rotate(dir);
            sinkBytes = 0;
        }

        fs.appendFileSync(target, `${line}\n`);
        sinkBytes += bytes;
    } catch (err) {
        sinkFailed = true;
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            message: 'log_file_sink_disabled',
            severity: 'medium',
            reason: err.message,
            directory: logDirectory()
        }));
    }
}

function now() {
    return new Date().toISOString();
}

function serializeError(err) {
    if (!err) return undefined;
    return {
        name: err.name || 'Error',
        message: err.message,
        code: err.code,
        status: err.status,
        stack: err.stack,
        cause: err.cause ? {
            name: err.cause.name,
            message: err.cause.message,
            code: err.cause.code
        } : undefined
    };
}

function write(level, message, meta = {}) {
    const payload = {
        timestamp: now(),
        level,
        message,
        severity: meta.severity || (level === 'error' ? 'high' : level === 'warn' ? 'medium' : 'low'),
        ...meta
    };
    entries.push(payload);
    if (entries.length > MAX_ENTRIES) entries.shift();

    const line = JSON.stringify(payload);
    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
    appendToFile(line);
}

function matchesText(entry, query) {
    if (!query) return true;
    const needle = String(query).toLowerCase();
    return JSON.stringify(entry).toLowerCase().includes(needle);
}

function inTimeRange(entry, { since, until }) {
    const timestamp = Date.parse(entry.timestamp);
    if (since && timestamp < Date.parse(since)) return false;
    if (until && timestamp > Date.parse(until)) return false;
    return true;
}

function list(limit = 200, filters = {}) {
    const max = Number(limit || 200);
    return entries
        .filter((entry) => !filters.level || entry.level === filters.level)
        .filter((entry) => !filters.severity || entry.severity === filters.severity)
        .filter((entry) => !filters.userAction || entry.userAction === filters.userAction)
        .filter((entry) => !filters.message || entry.message === filters.message)
        .filter((entry) => matchesText(entry, filters.query))
        .filter((entry) => inTimeRange(entry, filters))
        .slice(-max)
        .reverse();
}

function requestId(req, res, next) {
    req.id = req.get('X-Request-Id') || crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
}

function requestLogger(req, res, next) {
    const startedAt = Date.now();
    res.on('finish', () => {
        write(res.statusCode >= 500 ? 'error' : 'info', 'http_request', {
            requestId: req.id,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Date.now() - startedAt
        });
    });
    next();
}

module.exports = {
    requestId,
    requestLogger,
    list,
    logFilePath,
    logDirectory,
    clear: () => {
        entries.length = 0;
    },
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, err, meta = {}) => write('error', message, { ...meta, error: serializeError(err) })
};
