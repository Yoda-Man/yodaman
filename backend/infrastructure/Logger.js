const crypto = require('crypto');
const entries = [];
const MAX_ENTRIES = 500;

function now() {
    return new Date().toISOString();
}

function serializeError(err) {
    return {
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
    };
}

function write(level, message, meta = {}) {
    const payload = {
        timestamp: now(),
        level,
        message,
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
    list: (limit = 200) => entries.slice(-Number(limit || 200)).reverse(),
    clear: () => {
        entries.length = 0;
    },
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, err, meta = {}) => write('error', message, { ...meta, error: serializeError(err) })
};
