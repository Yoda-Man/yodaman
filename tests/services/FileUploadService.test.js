const fs = require('fs');
const os = require('os');
const path = require('path');

describe('fileUploadService', () => {
    let service;
    let storageRoot;

    beforeEach(() => {
        jest.resetModules();
        storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-upload-test-'));
        process.env.YODAMAN_UPLOAD_ROOT = storageRoot;
        service = require('../../backend/services/fileUploadService');
    });

    afterEach(() => {
        delete process.env.YODAMAN_UPLOAD_ROOT;
        fs.rmSync(storageRoot, { recursive: true, force: true });
    });

    test('saves allowed temp files with metadata and a unique file id', () => {
        const saved = service.saveTempFile({
            originalname: 'notes.md',
            mimetype: 'text/markdown',
            size: 12,
            buffer: Buffer.from('hello uploads')
        });

        expect(saved).toEqual(expect.objectContaining({
            fileId: expect.any(String),
            filename: 'notes.md',
            size: 12,
            type: 'text/markdown'
        }));
        expect(saved.fileId).not.toContain('notes.md');
        expect(fs.existsSync(saved.path)).toBe(true);
        expect(saved.path).toContain(path.join(storageRoot, 'temp'));
    });

    test('rejects unsupported file extensions and files over 5MB', () => {
        expect(() => service.saveTempFile({
            originalname: 'malware.exe',
            mimetype: 'application/octet-stream',
            size: 10,
            buffer: Buffer.from('nope')
        })).toThrow('Unsupported file type');

        expect(() => service.saveTempFile({
            originalname: 'huge.txt',
            mimetype: 'text/plain',
            size: service.MAX_FILE_SIZE_BYTES + 1,
            buffer: Buffer.alloc(1)
        })).toThrow('File is too large');
    });

    test('attaches temp files to a task, lists them, and deletes old temp files', () => {
        const saved = service.saveTempFile({
            originalname: 'trace.log',
            mimetype: 'text/plain',
            size: 5,
            buffer: Buffer.from('trace')
        });

        const attached = service.attachTempFileToTask('task-123', saved.fileId);
        expect(attached.taskId).toBe('task-123');
        expect(attached.path).toContain(path.join(storageRoot, 'tasks', 'task-123'));
        expect(fs.existsSync(attached.path)).toBe(true);
        expect(fs.existsSync(saved.path)).toBe(false);

        const files = service.listTaskFiles('task-123');
        expect(files).toHaveLength(1);
        expect(files[0]).toEqual(expect.objectContaining({
            fileId: saved.fileId,
            filename: 'trace.log',
            taskId: 'task-123'
        }));

        const stale = service.saveTempFile({
            originalname: 'old.txt',
            mimetype: 'text/plain',
            size: 3,
            buffer: Buffer.from('old')
        });
        service.tempFiles.get(stale.fileId).createdAt = new Date(Date.now() - service.TEMP_TTL_MS - 1000).toISOString();

        const removed = service.cleanupExpiredTempFiles();
        expect(removed).toContain(stale.fileId);
        expect(fs.existsSync(stale.path)).toBe(false);
    });
});
