const contextEngine = require('../infrastructure/ContextEngine');
const logger = require('../infrastructure/Logger');
const graphifyService = require('../infrastructure/GraphifyService');

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
            logger.info('index_queue_added', { path: directoryPath, queueLength: this.queue.length + 1 });
            this.queue.push(directoryPath);
            this.processNext();
        } else {
            logger.info('index_queue_duplicate_ignored', { path: directoryPath });
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
        logger.info('index_started', { path: targetDir });
        
        try {
            // Using spawn from the ContextEngine (which I should add a method for if needed, or use execute)
            // Actually, spawn is for streaming. I'll use contextEngine.spawn if I add it.
            // Let's ensure ContextEngine has spawn or just use execute for simplicity if we don't need real-time logs.
            // Wait, original used spawn for streaming logs.
            const { spawn } = require('child_process');
            this.activeProcess = spawn('ctx', ['index', targetDir]);
            let stderr = '';

            this.activeProcess.stdout.on('data', (data) => {
                const text = data.toString();
                process.stdout.write(`[ctx]: ${text}`);
                logger.info('ctx_index_stdout', { path: targetDir, output: text.trim() });
            });

            this.activeProcess.stderr.on('data', (data) => {
                const text = data.toString();
                stderr += text;
                process.stderr.write(`[ctx-error]: ${text}`);
                logger.warn('ctx_index_stderr', { path: targetDir, output: text.trim() });
            });

            this.activeProcess.on('error', (err) => {
                logger.error('index_process_error', err, { path: targetDir });
            });

            this.activeProcess.on('close', (code) => {
                console.log(`[Queue] ✅ Finished indexing ${targetDir} (Exit Code: ${code})`);
                if (code === 0) {
                    logger.info('index_completed', { path: targetDir, exitCode: code });
                    graphifyService.build(targetDir, { update: true }).catch((err) => {
                        logger.error('graphify_build_failed', err, { path: targetDir });
                    });
                } else {
                    const detail = stderr.trim();
                    const message = detail
                        ? `ctx index exited with code ${code}: ${detail}`
                        : `ctx index exited with code ${code}`;
                    logger.error('index_failed', new Error(message), { path: targetDir, exitCode: code });
                }
                this.activeProcess = null;
                this.isProcessing = false;
                this.processNext(); // Recursive call to process next item
            });
        } catch (err) {
            console.error(`[Queue] Failed to start indexing for ${targetDir}:`, err.message);
            logger.error('index_start_failed', err, { path: targetDir });
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
            logger.warn('index_process_killed');
            this.activeProcess.kill();
        }
    }

    getStatus() {
        return {
            isProcessing: this.isProcessing,
            queue: [...this.queue],
            active: this.activeProcess ? {
                pid: this.activeProcess.pid
            } : null
        };
    }
}

module.exports = new QueueService();
