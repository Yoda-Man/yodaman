const crypto = require('crypto');
const entries = [];
const MAX_ENTRIES = 500;

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
    clear: () => {
        entries.length = 0;
    },
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, err, meta = {}) => write('error', message, { ...meta, error: serializeError(err) })
};
