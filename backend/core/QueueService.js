const contextEngine = require('../infrastructure/ContextEngine');

/**
 * QueueService (Core Layer)
 * 
 * Manages a FIFO queue of indexing tasks to prevent resource exhaustion.
 * It interacts with the Infrastructure layer to spawn background processes.
 */
class QueueService {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.activeProcess = null;
    }

    /**
     * Adds a directory to the indexing queue.
     * @param {string} directoryPath 
     */
    addToQueue(directoryPath) {
        if (!this.queue.includes(directoryPath)) {
            console.log(`[Queue] Adding to queue: ${directoryPath}`);
            this.queue.push(directoryPath);
            this.processNext();
        }
    }

    /**
     * Processes the next item in the queue.
     */
    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const targetDir = this.queue.shift();

        console.log(`[Queue] 🏗️ Starting index for: ${targetDir}`);
        
        try {
            // Using spawn from the ContextEngine (which I should add a method for if needed, or use execute)
            // Actually, spawn is for streaming. I'll use contextEngine.spawn if I add it.
            // Let's ensure ContextEngine has spawn or just use execute for simplicity if we don't need real-time logs.
            // Wait, original used spawn for streaming logs.
            const { spawn } = require('child_process');
            this.activeProcess = spawn('ctx', ['index', targetDir]);

            this.activeProcess.stdout.on('data', (data) => {
                process.stdout.write(`[ctx]: ${data}`);
            });

            this.activeProcess.stderr.on('data', (data) => {
                process.stderr.write(`[ctx-error]: ${data}`);
            });

            this.activeProcess.on('close', (code) => {
                console.log(`[Queue] ✅ Finished indexing ${targetDir} (Exit Code: ${code})`);
                this.activeProcess = null;
                this.isProcessing = false;
                this.processNext(); // Recursive call to process next item
            });
        } catch (err) {
            console.error(`[Queue] Failed to start indexing for ${targetDir}:`, err.message);
            this.isProcessing = false;
            this.processNext();
        }
    }

    /**
     * Terminate any active background process.
     */
    killActive() {
        if (this.activeProcess) {
            console.log('[Queue] Killing active indexing process...');
            this.activeProcess.kill();
        }
    }
}

module.exports = new QueueService();
