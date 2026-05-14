const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const contextEngine = require('./ContextEngine');

/**
 * ToolBox (Infrastructure Layer)
 * 
 * Provides concrete implementations of system tools like file I/O and command execution.
 * Now supports dynamic plugins from the /plugins directory.
 */
class ToolBox {
    constructor() {
        this.plugins = new Map();
        this.loadPlugins();
    }

    /**
     * Dynamically loads custom tools from the plugins directory.
     */
    loadPlugins() {
        const pluginsDir = path.resolve(__dirname, '../../plugins');
        if (!fs.existsSync(pluginsDir)) return;

        const files = fs.readdirSync(pluginsDir);
        files.forEach(file => {
            if (file.endsWith('.js')) {
                try {
                    const pluginPath = path.join(pluginsDir, file);
                    // Clear cache to allow reloading of updated plugins
                    delete require.cache[require.resolve(pluginPath)];
                    
                    const plugin = require(pluginPath);
                    if (plugin.name && typeof plugin.execute === 'function') {
                        console.log(`[ToolBox] Loaded plugin: ${plugin.name}`);
                        this.plugins.set(plugin.name, {
                            ...plugin,
                            _filename: file // Store filename for deletion logic
                        });
                    }

                } catch (err) {
                    console.error(`[ToolBox] Failed to load plugin ${file}:`, err.message);
                }
            }
        });

    }

    /**
     * Executes a tool, checking built-in tools first, then plugins.
     */
    async callTool(name, parameters) {
        // Check if it's a plugin
        if (this.plugins.has(name)) {
            return await this.plugins.get(name).execute(parameters);
        }

        // Check built-in tools
        if (typeof this[name] === 'function') {
            return await this[name](parameters);
        }

        throw new Error(`Tool not found: ${name}`);
    }

    /**
     * Returns a description of all available tools for the AI system prompt.
     */
    getToolDefinitions() {
        const builtIn = [
            "1. readFile(filePath): Returns the content of a file.",
            "2. writeFile(filePath, content): Writes content to a file.",
            "3. executeCommand(command, cwd): Runs a shell command and returns output.",
            "4. searchCode(query): Searches the codebase for relevant snippets.",
            "5. listFiles(directoryPath): Lists files in a directory."
        ];

        const pluginDocs = Array.from(this.plugins.values()).map((p, i) => {
            const params = Object.keys(p.parameters || {}).join(', ');
            return `${builtIn.length + i + 1}. ${p.name}(${params}): ${p.description || 'Custom plugin tool.'}`;
        });

        return [...builtIn, ...pluginDocs].join('\n');
    }

    async readFile({ filePath }) {
        const fullPath = path.resolve(filePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        return { content };
    }

    async writeFile({ filePath, content }) {
        const fullPath = path.resolve(filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        return { message: `Successfully wrote to ${filePath}` };
    }

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

    async searchCode({ query, project }) {
        const args = ['search', query];
        if (project) args.push('-p', project);
        return await contextEngine.executeJson(args);
    }

    async listFiles({ directoryPath }) {
        const fullPath = path.resolve(directoryPath || '.');
        const files = fs.readdirSync(fullPath, { withFileTypes: true });
        return files.map(f => ({
            name: f.name,
            isDir: f.isDirectory()
        }));
    }

    async getFileContent(filePath) {
        const fullPath = path.resolve(filePath);
        if (!fs.existsSync(fullPath)) return '';
        return fs.readFileSync(fullPath, 'utf8');
    }
}

module.exports = new ToolBox();
