const queueService = require('../../backend/core/QueueService');
const contextEngine = require('../../backend/infrastructure/ContextEngine');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('child_process');

describe('QueueService', () => {
    const originalIndexNameFor = contextEngine.indexNameFor;
    // Real folders: a workspace that does not exist is skipped, not indexed.
    const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-queue-'));
    const ONE = path.join(ROOT, '1');
    const CUSTOM = path.join(ROOT, 'custom');
    fs.mkdirSync(ONE);
    fs.mkdirSync(CUSTOM);
    const tick = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
        queueService.queue = [];
        queueService.isProcessing = false;
        queueService.activeProcess = null;
        jest.clearAllMocks();
        // Naming reads `ctx list`; its own rules are tested in ContextEngine.test.js.
        contextEngine.indexNameFor = jest.fn(async (dir) => require('path').basename(dir));
    });

    afterAll(() => {
        contextEngine.indexNameFor = originalIndexNameFor;
        fs.rmSync(ROOT, { recursive: true, force: true });
    });

    test('should add items to queue and process them', async () => {
        const mockProc = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: jest.fn()
        };
        spawn.mockReturnValue(mockProc);

        queueService.addToQueue(ONE);
        await tick();
        expect(queueService.queue).toHaveLength(0); // Shifted immediately
        expect(queueService.isProcessing).toBe(true);
        // The ignore list is asserted, not just tolerated. Indexing our own
        // generated output put graphify-out AST cache blobs at the top of search
        // results and broke graph ranking, because those files are never in the
        // knowledge graph. Losing these patterns silently would bring that back.
        expect(spawn).toHaveBeenCalledWith(
            contextEngine.binary,
            ['index', ONE, '--name', '1', '--force', '--ignore', expect.stringContaining('graphify-out')]
        );
    });

    test('uses the configured ContextEngine binary for indexing', async () => {
        const originalBinary = contextEngine.binary;
        contextEngine.binary = 'ctx-custom';
        const mockProc = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: jest.fn()
        };
        spawn.mockReturnValue(mockProc);

        try {
            queueService.addToQueue(CUSTOM);
            await tick();
            expect(spawn).toHaveBeenCalledWith(
                'ctx-custom',
                ['index', CUSTOM, '--name', 'custom', '--force', '--ignore', expect.stringContaining('graphify-out')]
            );
        } finally {
            contextEngine.binary = originalBinary;
        }
    });

    test('should not add duplicate items to queue', () => {
        queueService.isProcessing = true; // Pretend we are busy
        queueService.addToQueue('/path/1');
        queueService.addToQueue('/path/1');
        
        expect(queueService.queue).toHaveLength(1);
    });

    test('skips a workspace whose folder is gone, without recreating it', async () => {
        const gone = path.join(ROOT, 'moved-away');
        queueService.addToQueue(gone);
        await tick();
        expect(spawn).not.toHaveBeenCalled();
        expect(queueService.isProcessing).toBe(false);
        expect(fs.existsSync(gone)).toBe(false);
    });

    test('killActive should terminate the process', () => {
        const mockKill = jest.fn();
        queueService.activeProcess = { kill: mockKill };
        
        queueService.killActive();
        expect(mockKill).toHaveBeenCalled();
    });
});
