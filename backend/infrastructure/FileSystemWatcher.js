const chokidar = require('chokidar');
const path = require('path');
const queueService = require('../core/QueueService');
const logger = require('./Logger');

/** Directory names that are never worth indexing. Single source of truth. */
const IGNORED_DIRECTORIES = ['node_modules', '.git', 'dist', 'build', 'release', 'graphify-out'];

/**
 * FileSystemWatcher (Infrastructure Layer)
 *
 * Monitors project directories for file changes and triggers re-indexing.
 */
class FileSystemWatcher {
    constructor() {
        this.watchers = new Map();
        this.debounceTimers = new Map();
        this.ignoredDirectories = IGNORED_DIRECTORIES;
        this.ignored = IGNORED_DIRECTORIES.map((dir) => `**/${dir}/**`);
        this.debounceMs = Number(process.env.YODAMAN_WATCH_DEBOUNCE_MS || 1500);
    }

    /**
     * Decides whether a path should be skipped, relative to the directory being
     * watched. chokidar v4 dropped glob support — `ignored` now takes a path, a
     * regex, or a predicate — so this replaces the `**` patterns in this.ignored,
     * which are kept as the declared (and testable) ignore list.
     * @param {string} targetPath - Absolute path chokidar is asking about.
     * @param {string} [rootPath] - The watch root, which is never self-ignored.
     */
    isIgnored(targetPath, rootPath) {
        const relative = rootPath ? path.relative(rootPath, targetPath) : targetPath;
        // Empty means targetPath *is* the watch root; '..' means it sits outside it.
        if (!relative || relative.startsWith('..')) return false;
        return relative.split(/[\\/]/).some((segment) => this.ignoredDirectories.includes(segment));
    }

    /**
     * Initializes a watcher for a specific directory.
     * @param {string} dirPath - The absolute path to the directory.
     */
    setupWatcher(dirPath) {
        if (this.watchers.has(dirPath)) return;

        logger.info('watcher_initialized', { path: dirPath });
        const watcher = chokidar.watch(dirPath, {
            ignored: (targetPath) => this.isIgnored(targetPath, dirPath),
            persistent: true,
            ignoreInitial: true,
            depth: 3
        });

        watcher.on('all', (event, filePath) => {
            logger.info('watcher_change_detected', { event, path: filePath });
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
            logger.info('watcher_removed', { path: dirPath });
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
        logger.info('watcher_all_closed');
    }
}

module.exports = new FileSystemWatcher();
