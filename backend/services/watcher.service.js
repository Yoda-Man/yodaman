const chokidar = require('chokidar');
const path = require('path');
const queueService = require('./queue.service');

class WatcherService {
    constructor() {
        this.watchers = new Map();
    }

    setupWatcher(dirPath) {
        if (this.watchers.has(dirPath)) return;

        try {
            const watcher = chokidar.watch(dirPath, {
                ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/dist/**'],
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
            });

            watcher
                .on('change', filePath => {
                    console.log(`📝 Change: ${path.basename(filePath)}. Re-indexing...`);
                    queueService.addToQueue(dirPath);
                })
                .on('error', error => {
                    console.error(`🔴 Watcher error for ${dirPath}:`, error);
                    this.removeWatcher(dirPath);
                    setTimeout(() => this.setupWatcher(dirPath), 10000);
                });

            this.watchers.set(dirPath, watcher);
            console.log(`👀 Watching: ${dirPath}`);
        } catch (err) {
            console.error(`❌ Watcher setup failed for ${dirPath}:`, err);
        }
    }

    removeWatcher(dirPath) {
        if (this.watchers.has(dirPath)) {
            this.watchers.get(dirPath).close();
            this.watchers.delete(dirPath);
        }
    }

    closeAll() {
        for (const [p, w] of this.watchers) w.close();
        this.watchers.clear();
    }
}

module.exports = new WatcherService();
