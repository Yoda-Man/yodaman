const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const ALLOWED_EXTENSIONS = new Set(['.dart', '.js', '.ts', '.json', '.yaml', '.md', '.log', '.txt']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const TEMP_TTL_MS = 60 * 60 * 1000;

const tempFiles = new Map();
const taskFiles = new Map();

function storageRoot() {
    return process.env.YODAMAN_UPLOAD_ROOT || path.join(os.tmpdir(), 'yodaman-agent-uploads');
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function safeOriginalFilename(originalName) {
    const filename = path.basename(String(originalName || 'upload.txt'));
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'upload.txt';
}

function validateUploadFile(file) {
    if (!file) {
        const err = new Error('file is required');
        err.status = 400;
        throw err;
    }

    const filename = safeOriginalFilename(file.originalname);
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
        const err = new Error('Unsupported file type');
        err.status = 400;
        throw err;
    }

    if (Number(file.size || 0) > MAX_FILE_SIZE_BYTES) {
        const err = new Error('File is too large');
        err.status = 413;
        throw err;
    }

    return filename;
}

function publicFile(file) {
    return {
        fileId: file.fileId,
        filename: file.filename,
        size: file.size,
        type: file.type,
        taskId: file.taskId
    };
}

function saveTempFile(file) {
    const filename = validateUploadFile(file);
    const fileId = crypto.randomUUID();
    const tempDir = path.join(storageRoot(), 'temp');
    ensureDir(tempDir);

    const storedName = `${fileId}_${filename}`;
    const filePath = path.join(tempDir, storedName);
    fs.writeFileSync(filePath, file.buffer || Buffer.alloc(0));

    const metadata = {
        fileId,
        filename,
        size: Number(file.size || file.buffer?.length || 0),
        type: file.mimetype || 'application/octet-stream',
        path: filePath,
        createdAt: new Date().toISOString()
    };
    tempFiles.set(fileId, metadata);
    return metadata;
}

function attachTempFileToTask(taskId, fileId) {
    if (!taskId || typeof taskId !== 'string') {
        const err = new Error('taskId is required');
        err.status = 400;
        throw err;
    }

    const file = tempFiles.get(fileId);
    if (!file || !fs.existsSync(file.path)) {
        const err = new Error('Temp file not found');
        err.status = 404;
        throw err;
    }

    const taskDir = path.join(storageRoot(), 'tasks', safeOriginalFilename(taskId));
    ensureDir(taskDir);
    const nextPath = path.join(taskDir, `${file.fileId}_${file.filename}`);
    fs.renameSync(file.path, nextPath);

    const attached = {
        ...file,
        path: nextPath,
        taskId,
        attachedAt: new Date().toISOString()
    };
    tempFiles.delete(fileId);
    taskFiles.set(taskId, [...(taskFiles.get(taskId) || []), attached]);
    return attached;
}

function deleteTempFile(fileId) {
    const file = tempFiles.get(fileId);
    if (!file) return false;
    fs.rmSync(file.path, { force: true });
    tempFiles.delete(fileId);
    return true;
}

function listTaskFiles(taskId) {
    return taskFiles.get(taskId) || [];
}

function cleanupExpiredTempFiles(now = Date.now()) {
    const removed = [];
    for (const [fileId, file] of tempFiles.entries()) {
        if (now - new Date(file.createdAt).getTime() > TEMP_TTL_MS) {
            deleteTempFile(fileId);
            removed.push(fileId);
        }
    }
    return removed;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

const router = express.Router();

router.post('/temp', upload.single('file'), (req, res) => {
    try {
        cleanupExpiredTempFiles();
        const saved = saveTempFile(req.file);
        res.status(201).json(publicFile(saved));
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
});

router.post('/attach', (req, res) => {
    try {
        const attached = attachTempFileToTask(req.body?.taskId, req.body?.fileId);
        res.json(publicFile(attached));
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
});

router.delete('/temp/:fileId', (req, res) => {
    const deleted = deleteTempFile(req.params.fileId);
    res.json({ deleted });
});

router.get('/task/:taskId/files', (req, res) => {
    res.json({ files: listTaskFiles(req.params.taskId).map(publicFile) });
});

router.use((err, req, res, next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File is too large' });
    }
    return next(err);
});

const cleanupTimer = setInterval(() => cleanupExpiredTempFiles(), 5 * 60 * 1000);
cleanupTimer.unref?.();

module.exports = {
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    TEMP_TTL_MS,
    router,
    tempFiles,
    taskFiles,
    saveTempFile,
    attachTempFileToTask,
    deleteTempFile,
    listTaskFiles,
    cleanupExpiredTempFiles
};
