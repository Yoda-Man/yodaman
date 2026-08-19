const contextEngine = require('../infrastructure/ContextEngine');
const logger = require('../infrastructure/Logger');
const graphifyService = require('../infrastructure/GraphifyService');

/**
 * QueueService (Core Layer)
 * 
 * Manages a FIFO queue of indexing tasks to prevent resource exhaustion.
 * It interacts with the Infrastructure layer to spawn background processes.
 */
// Generated or vendored directories that must never enter the search index.
// Shared with FileSystemWatcher so the indexer and the watcher cannot drift.
const { IGNORED_DIRECTORIES } = require('../../shared/ignoredPaths');

const INDEX_IGNORE_PATTERNS = IGNORED_DIRECTORIES.join(',');

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
            logger.info('queue_enqueued', { path: directoryPath });
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

        logger.info('queue_index_started', { path: targetDir });
        logger.info('index_started', { path: targetDir });
        
        try {
            // Using spawn from the ContextEngine (which I should add a method for if needed, or use execute)
            // Actually, spawn is for streaming. I'll use contextEngine.spawn if I add it.
            // Let's ensure ContextEngine has spawn or just use execute for simplicity if we don't need real-time logs.
            // Wait, original used spawn for streaming logs.
            const { spawn } = require('child_process');
            // Never index our own generated output. ctx indexes whatever is in
            // the workspace, and graphify-out/ is Graphify's AST cache — written
            // by us. Left in, those hash-named blobs dominate results: a search
            // for "Architecture_Overview_Document" returned five copies of
            // graphify-out/cache/ast/86c41b74….json instead of the document, and
            // every hit for that query was a cache file. They are never in the
            // knowledge graph either, so graph ranking matched nothing and the
            // advertised four-signal blend silently fell back to semantic-only.
            // The agent was being handed them as context.
            // --force is required, not optional. Without it ctx refuses an
            // already-indexed project with "Project already indexed ... Hint:
            // Use --force to re-index" and exits, while YodaMan reported
            // "Indexing and Graphify graph update queued" and logged the refusal
            // as ordinary stdout. Every reindex of an existing workspace was a
            // no-op that looked like success — including "Sync Repository" in
            // the UI and the remediation the runbook gives support for a stale
            // workspace, which is why stale workspaces stayed stale.
            this.activeProcess = spawn(contextEngine.binary, [
                'index', targetDir, '--force', '--ignore', INDEX_IGNORE_PATTERNS
            ]);
            let stderr = '';

            this.activeProcess.stdout.on('data', (data) => {
                const text = data.toString();
                process.stdout.write(`[ctx]: ${text}`);
                // ctx writes its failures to stdout, so logging everything at
                // info hid "Project already indexed" for as long as that bug
                // existed. Anything that announces itself as an error is logged
                // as one.
                if (/^\s*Error:/m.test(text)) {
                    logger.error('ctx_index_reported_error', new Error(text.trim().slice(0, 400)), {
                        path: targetDir,
                        userAction: 'reindex'
                    });
                } else {
                    logger.info('ctx_index_stdout', { path: targetDir, output: text.trim() });
                }
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
                logger.info('queue_index_finished', { path: targetDir, exitCode: code });
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
            logger.error('queue_index_start_failed', err, { path: targetDir });
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
            logger.info('queue_index_killed');
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
