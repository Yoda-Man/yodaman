const queueService = require('../../backend/core/QueueService');
const contextEngine = require('../../backend/infrastructure/ContextEngine');
const { spawn } = require('child_process');

jest.mock('child_process');

describe('QueueService', () => {
    beforeEach(() => {
        queueService.queue = [];
        queueService.isProcessing = false;
        queueService.activeProcess = null;
        jest.clearAllMocks();
    });

    test('should add items to queue and process them', () => {
        const mockProc = {
            stdout: { on: jest.fn() },
            stderr: { on: jest.fn() },
            on: jest.fn(),
            kill: jest.fn()
        };
        spawn.mockReturnValue(mockProc);

        queueService.addToQueue('/path/1');
        expect(queueService.queue).toHaveLength(0); // Shifted immediately
        expect(queueService.isProcessing).toBe(true);
        // The ignore list is asserted, not just tolerated. Indexing our own
        // generated output put graphify-out AST cache blobs at the top of search
        // results and broke graph ranking, because those files are never in the
        // knowledge graph. Losing these patterns silently would bring that back.
        expect(spawn).toHaveBeenCalledWith(
            contextEngine.binary,
            ['index', '/path/1', '--force', '--ignore', expect.stringContaining('graphify-out')]
        );
    });

    test('uses the configured ContextEngine binary for indexing', () => {
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
            queueService.addToQueue('/path/custom');
            expect(spawn).toHaveBeenCalledWith(
                'ctx-custom',
                ['index', '/path/custom', '--force', '--ignore', expect.stringContaining('graphify-out')]
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

    test('killActive should terminate the process', () => {
        const mockKill = jest.fn();
        queueService.activeProcess = { kill: mockKill };
        
        queueService.killActive();
        expect(mockKill).toHaveBeenCalled();
    });
});
