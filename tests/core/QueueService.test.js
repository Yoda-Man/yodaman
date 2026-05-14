const queueService = require('../../backend/core/QueueService');
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
        expect(spawn).toHaveBeenCalledWith('ctx', ['index', '/path/1']);
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
