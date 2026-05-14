const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const contextEngine = require('./ContextEngine');

/**
 * ToolBox (Infrastructure Layer)
 * 
 * Provides concrete implementations of system tools like file I/O and command execution.
 */
class ToolBox {
    /**
     * Reads a file from the disk.
     * @param {Object} params - Tool parameters.
     * @param {string} params.filePath - Path to the file.
     */
    async readFile({ filePath }) {
        const fullPath = path.resolve(filePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        return { content };
    }

    /**
     * Writes or overwrites a file.
     * @param {Object} params
     * @param {string} params.filePath
     * @param {string} params.content
     */
    async writeFile({ filePath, content }) {
        const fullPath = path.resolve(filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        return { message: `Successfully wrote to ${filePath}` };
    }

    /**
     * Runs a shell command.
     * @param {Object} params
     * @param {string} params.command
     * @param {string} [params.cwd]
     */
    async executeCommand({ command, cwd }) {
        return new Promise((resolve) => {
            console.log(`[ToolBox] Running command: ${command} (cwd: ${cwd || 'default'})`);
            exec(command, { cwd: cwd || process.cwd() }, (error, stdout, stderr) => {
                resolve({
                    stdout: stdout || '',
                    stderr: stderr || '',
                    exitCode: error ? error.code : 0
                });
            });
        });
    }

    /**
     * Searches the codebase using the context engine.
     * @param {Object} params
     * @param {string} params.query
     * @param {string} [params.project]
     */
    async searchCode({ query, project }) {
        const args = ['search', query];
        if (project) args.push('-p', project);
        return await contextEngine.executeJson(args);
    }

    /**
     * Lists files in a directory.
     * @param {Object} params
     * @param {string} [params.directoryPath]
     */
    async listFiles({ directoryPath }) {
        const fullPath = path.resolve(directoryPath || '.');
        const files = fs.readdirSync(fullPath, { withFileTypes: true });
        return files.map(f => ({
            name: f.name,
            isDir: f.isDirectory()
        }));
    }
}

module.exports = new ToolBox();
