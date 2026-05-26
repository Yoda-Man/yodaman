const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const contextEngine = require('./ContextEngine');
const auditLog = require('./AuditLog');
const graphifyService = require('./GraphifyService');

const CONFIG_PATH = path.join(__dirname, '../../config.json');
const PLUGIN_PERMISSION_ALLOWLIST = new Set([
    'read',
    'write',
    'command',
    'network',
    'search',
    'unrestricted'
]);

/**
 * ToolBox (Infrastructure Layer)
 * 
 * Provides concrete implementations of system tools like file I/O and command execution.
 * Now supports dynamic plugins from the /plugins directory.
 */
class ToolBox {
    constructor() {
        this.plugins = new Map();
        this.extraAllowedRoots = [];
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
                    if (this.validatePlugin(plugin)) {
                        const permissions = this.normalizePluginPermissions(plugin.permissions);
                        console.log(`[ToolBox] Loaded plugin: ${plugin.name}`);
                        this.plugins.set(plugin.name, {
                            ...plugin,
                            permissions,
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
        const startedAt = Date.now();

        try {
            let result;
            if (this.plugins.has(name)) {
                this.assertPluginPermissions(name);
                result = await this.plugins.get(name).execute(parameters);
            } else if (typeof this[name] === 'function') {
                result = await this[name](parameters);
            } else {
                throw new Error(`Tool not found: ${name}`);
            }

            auditLog.record({
                type: 'tool_call',
                tool: name,
                status: 'success',
                durationMs: Date.now() - startedAt,
                parameters: this.sanitizeParameters(parameters),
                resultSummary: this.summarizeResult(result)
            });
            return result;
        } catch (err) {
            auditLog.record({
                type: 'tool_call',
                tool: name,
                status: 'error',
                durationMs: Date.now() - startedAt,
                parameters: this.sanitizeParameters(parameters),
                error: err.message
            });
            throw err;
        }
    }

    /**
     * Returns a description of all available tools for the AI system prompt.
     */
    getToolDefinitions() {
        const builtIn = [
            "1. readFile(filePath): Returns the content of a file.",
            "2. writeFile(filePath, content): Writes content to a file.",
            "3. applyPatch(filePath, oldText, newText): Replaces an exact text range in a file.",
            "4. executeCommand(command, cwd): Runs a shell command and returns output.",
            "5. searchCode(query): Searches the codebase for relevant snippets.",
            "6. listFiles(directoryPath): Lists files in a directory.",
            "7. graphifyQuery(query, project): Queries the workspace knowledge graph for related code, docs, and diagram relationships.",
            "8. graphifyExplain(node, project): Explains a graph node and its neighbors.",
            "9. graphifyPath(source, target, project): Finds a graph path between two entities.",
            "10. graphifyAffected(node, project, depth): Finds nodes likely impacted by a change to a graph entity."
        ];

        const pluginDocs = Array.from(this.plugins.values()).map((p, i) => {
            const params = Object.keys(p.parameters || {}).join(', ');
            return `${builtIn.length + i + 1}. ${p.name}(${params}): ${p.description || 'Custom plugin tool.'}`;
        });

        return [...builtIn, ...pluginDocs].join('\n');
    }

    async readFile({ filePath }) {
        const fullPath = this.resolveAllowedPath(filePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        return { content };
    }

    async writeFile({ filePath, content }) {
        const fullPath = this.resolveAllowedPath(filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf8');
        return { message: `Successfully wrote to ${filePath}` };
    }

    async applyPatch({ filePath, oldText, newText }) {
        const fullPath = this.resolveAllowedPath(filePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        if (typeof oldText !== 'string' || typeof newText !== 'string') {
            throw new Error('oldText and newText are required');
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        const occurrences = content.split(oldText).length - 1;
        if (occurrences === 0) {
            throw new Error('Patch failed: oldText was not found');
        }
        if (occurrences > 1) {
            throw new Error('Patch failed: oldText matched more than once');
        }

        fs.writeFileSync(fullPath, content.replace(oldText, newText), 'utf8');
        return { message: `Successfully patched ${filePath}` };
    }

    async executeCommand({ command, cwd }) {
        const workingDirectory = this.resolveAllowedPath(cwd || process.cwd());
        this.assertCommandAllowed(command);

        return new Promise((resolve) => {
            console.log(`[ToolBox] Running command: ${command} (cwd: ${workingDirectory})`);
            exec(command, { cwd: workingDirectory }, (error, stdout, stderr) => {
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
        if (project) args.push('-p', this.resolveAllowedPath(project));
        return await contextEngine.executeJson(args);
    }

    async listFiles({ directoryPath }) {
        const fullPath = this.resolveAllowedPath(directoryPath || '.');
        const files = fs.readdirSync(fullPath, { withFileTypes: true });
        return files.map(f => ({
            name: f.name,
            isDir: f.isDirectory()
        }));
    }

    async graphifyQuery({ query, project }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        const insights = await graphifyService.query(query, projectPath);
        return { insights, graphPath: graphifyService.graphPath(projectPath) };
    }

    async graphifyExplain({ node, project }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        const explanation = await graphifyService.explain(node, projectPath);
        return { explanation, graphPath: graphifyService.graphPath(projectPath) };
    }

    async graphifyPath({ source, target, project }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        const result = await graphifyService.pathBetween(source, target, projectPath);
        return { result, graphPath: graphifyService.graphPath(projectPath) };
    }

    async graphifyAffected({ node, project, depth = 2, relations = [] }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        const impact = await graphifyService.affected(node, projectPath, { depth, relations });
        return { impact, graphPath: graphifyService.graphPath(projectPath) };
    }

    async getFileContent(filePath) {
        const fullPath = this.resolveAllowedPath(filePath);
        if (!fs.existsSync(fullPath)) return '';
        return fs.readFileSync(fullPath, 'utf8');
    }

    setExtraAllowedRoots(roots) {
        this.extraAllowedRoots = roots.map((root) => path.resolve(root));
    }

    getAllowedRoots() {
        let watchedDirectories = [];
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                watchedDirectories = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).watchedDirectories || [];
            } catch (err) {
                console.error('[ToolBox] Failed to load config:', err.message);
            }
        }

        const roots = [
            process.cwd(),
            ...watchedDirectories,
            ...this.extraAllowedRoots
        ];

        if (process.env.NODE_ENV === 'test') {
            roots.push(os.tmpdir());
        }

        return Array.from(new Set(roots.filter(Boolean).map((root) => path.resolve(root))));
    }

    getPolicy() {
        return {
            allowedRoots: this.getAllowedRoots(),
            blockedCommandPatterns: this.getBlockedCommandPatterns().map((pattern) => pattern.toString()),
            auditLog: {
                enabled: true,
                maxEntries: 500
            },
            plugins: Array.from(this.plugins.values()).map((plugin) => ({
                name: plugin.name,
                permissions: plugin.permissions,
                restricted: !plugin.permissions.includes('unrestricted')
            }))
        };
    }

    resolveAllowedPath(inputPath) {
        const resolvedPath = path.resolve(inputPath || '.');
        const allowed = this.getAllowedRoots().some((root) => {
            const relative = path.relative(root, resolvedPath);
            return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        });

        if (!allowed) {
            throw new Error(`Path is outside allowed workspaces: ${resolvedPath}`);
        }

        return resolvedPath;
    }

    getBlockedCommandPatterns() {
        return [
            /\brm\s+-rf\s+(\/|\*|~)/i,
            /\bsudo\b/i,
            /\b(chmod|chown)\s+-R\b/i,
            /curl\b.*\|\s*(sh|bash)/i,
            /wget\b.*\|\s*(sh|bash)/i,
            /:\(\)\s*\{\s*:\|:/ // fork bomb signature
        ];
    }

    assertCommandAllowed(command) {
        if (!command || typeof command !== 'string') {
            throw new Error('Command is required');
        }

        const blocked = this.getBlockedCommandPatterns().find((pattern) => pattern.test(command));
        if (blocked) {
            throw new Error(`Command blocked by policy: ${blocked}`);
        }
    }

    assertPluginPermissions(name) {
        const plugin = this.plugins.get(name);
        if (!plugin) {
            throw new Error(`Plugin not found: ${name}`);
        }

        const permissions = this.normalizePluginPermissions(plugin.permissions);
        plugin.permissions = permissions;

        const invalid = permissions.filter((permission) => !PLUGIN_PERMISSION_ALLOWLIST.has(permission));
        if (invalid.length > 0) {
            throw new Error(`Plugin ${name} declares unsupported permissions: ${invalid.join(', ')}`);
        }

        if (permissions.includes('unrestricted')) {
            if (process.env.YODAMAN_ALLOW_UNRESTRICTED_PLUGINS !== 'true') {
                throw new Error(`Plugin ${name} is unrestricted. Set YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true to allow it.`);
            }
        }
    }

    validatePlugin(plugin, options = {}) {
        if (!plugin || typeof plugin !== 'object') {
            throw new Error('Plugin must export an object');
        }
        if (!plugin.name || typeof plugin.name !== 'string') {
            throw new Error('Plugin name is required');
        }
        if (typeof plugin.execute !== 'function') {
            throw new Error(`Plugin ${plugin.name} must export an execute function`);
        }
        if (options.requireExplicitPermissions && !Array.isArray(plugin.permissions)) {
            throw new Error(`Plugin ${plugin.name} must declare a permissions array`);
        }

        const permissions = this.normalizePluginPermissions(plugin.permissions);
        const invalid = permissions.filter((permission) => !PLUGIN_PERMISSION_ALLOWLIST.has(permission));
        if (invalid.length > 0) {
            throw new Error(`Plugin ${plugin.name} declares unsupported permissions: ${invalid.join(', ')}`);
        }

        return true;
    }

    normalizePluginPermissions(permissions) {
        if (!permissions) return ['unrestricted'];
        if (!Array.isArray(permissions)) {
            throw new Error('Plugin permissions must be an array');
        }

        const normalized = permissions
            .filter((permission) => typeof permission === 'string')
            .map((permission) => permission.trim().toLowerCase())
            .filter(Boolean);

        return normalized.length > 0 ? Array.from(new Set(normalized)) : ['unrestricted'];
    }

    sanitizeParameters(parameters = {}) {
        const clone = { ...parameters };
        if (typeof clone.content === 'string') {
            clone.content = `[${clone.content.length} chars]`;
        }
        if (typeof clone.newContent === 'string') {
            clone.newContent = `[${clone.newContent.length} chars]`;
        }
        if (typeof clone.oldContent === 'string') {
            clone.oldContent = `[${clone.oldContent.length} chars]`;
        }
        return clone;
    }

    summarizeResult(result) {
        if (!result || typeof result !== 'object') {
            return result;
        }
        if (typeof result.content === 'string') {
            return { ...result, content: `[${result.content.length} chars]` };
        }
        return result;
    }
}

module.exports = new ToolBox();
