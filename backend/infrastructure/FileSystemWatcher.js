const chokidar = require('chokidar');
const path = require('path');
const queueService = require('../core/QueueService');

/**
 * FileSystemWatcher (Infrastructure Layer)
 * 
 * Monitors project directories for file changes and triggers re-indexing.
 */
class FileSystemWatcher {
    constructor() {
        this.watchers = new Map();
        this.debounceTimers = new Map();
        this.ignored = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];
        this.debounceMs = Number(process.env.YODAMAN_WATCH_DEBOUNCE_MS || 1500);
    }

    /**
     * Initializes a watcher for a specific directory.
     * @param {string} dirPath - The absolute path to the directory.
     */
    setupWatcher(dirPath) {
        if (this.watchers.has(dirPath)) return;

        console.log(`[Watcher] Initializing for: ${dirPath}`);
        const watcher = chokidar.watch(dirPath, {
            ignored: this.ignored,
            persistent: true,
            ignoreInitial: true,
            depth: 3
        });

        watcher.on('all', (event, filePath) => {
            console.log(`[Watcher] Change detected: ${event} on ${filePath}`);
            clearTimeout(this.debounceTimers.get(dirPath));
            this.debounceTimers.set(dirPath, setTimeout(() => {
                this.debounceTimers.delete(dirPath);
                queueService.addToQueue(dirPath);
            }, this.debounceMs));
        });

        this.watchers.set(dirPath, watcher);
    }

    /**
     * Removes a watcher for a specific directory.
     * @param {string} dirPath 
     */
    removeWatcher(dirPath) {
        const watcher = this.watchers.get(dirPath);
        if (watcher) {
            clearTimeout(this.debounceTimers.get(dirPath));
            this.debounceTimers.delete(dirPath);
            watcher.close();
            this.watchers.delete(dirPath);
            console.log(`[Watcher] Removed for: ${dirPath}`);
        }
    }

    /**
     * Closes all active watchers.
     */
    closeAll() {
        for (const [path, watcher] of this.watchers) {
            clearTimeout(this.debounceTimers.get(path));
            watcher.close();
        }
        this.debounceTimers.clear();
        this.watchers.clear();
        console.log('[Watcher] All watchers closed.');
    }
}

module.exports = new FileSystemWatcher();
