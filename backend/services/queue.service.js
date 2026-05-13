const cliService = require('./cli.service');

class QueueService {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
        this.activeProcess = null;
    }

    addToQueue(directoryPath) {
        if (!this.queue.includes(directoryPath)) {
            this.queue.push(directoryPath);
            this.process();
        }
    }

    async process() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const targetDir = this.queue.shift();

        console.log(`🏗️  Starting index for: ${targetDir}`);
        
        this.activeProcess = cliService.spawn(['index', targetDir]);

        this.activeProcess.stdout.on('data', (data) => {
            process.stdout.write(`[ctx]: ${data}`);
        });

        this.activeProcess.stderr.on('data', (data) => {
            process.stderr.write(`[ctx error]: ${data}`);
        });

        this.activeProcess.on('close', (code) => {
            console.log(`✅ Finished indexing ${targetDir} (code ${code})`);
            this.activeProcess = null;
            this.isProcessing = false;
            this.process();
        });
    }

    killActive() {
        if (this.activeProcess) {
            this.activeProcess.kill();
        }
    }
}

module.exports = new QueueService();
