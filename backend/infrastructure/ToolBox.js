const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const contextEngine = require('./ContextEngine');
const auditLog = require('./AuditLog');
const graphifyService = require('./GraphifyService');
const impactAnalyzer = require('./ImpactAnalyzer');
const specDrift = require('../stardust/SpecDrift');
const stardustWrapper = require('../stardust/StardustWrapper');
const logger = require('./Logger');

/**
 * Baseline executables the agent may invoke. See getAllowedExecutables().
 * Read-only inspection and standard build/test tooling only — nothing that
 * mutates the filesystem, escalates privilege, or fetches from the network.
 */
const DEFAULT_ALLOWED_EXECUTABLES = [
    // version control
    'git',
    // node ecosystem
    'node', 'npm', 'npx', 'yarn', 'pnpm', 'jest', 'tsc', 'eslint', 'prettier', 'vite',
    // python
    'python', 'python3', 'pip', 'pip3', 'pytest',
    // other build toolchains
    'make', 'cargo', 'go',
    // read-only inspection
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'diff', 'stat', 'file',
    'echo', 'pwd', 'which', 'sort', 'uniq', 'tree', 'du', 'df', 'date'
];

/**
 * Interpreter flags that execute inline source.
 *
 * Allowlisting `node` and `python3` is necessary — running project scripts is
 * the point — but `node -e "…"` and `python3 -c "…"` turn an allowed binary
 * straight back into arbitrary code execution. Running a script FILE stays
 * permitted: it lives in the workspace and is reviewable. Only inline
 * evaluation is refused.
 */
const INLINE_EVAL_FLAGS = {
    node: ['-e', '--eval', '-p', '--print'],
    python: ['-c'],
    python3: ['-c'],
    ruby: ['-e'],
    perl: ['-e']
};

const CONFIG_PATH = path.join(__dirname, '../../config.json');
const PLUGIN_CONFIG_PATH = path.join(__dirname, '../../plugins/config.json');
const PLUGIN_PERMISSION_ALLOWLIST = new Set([
    'read',
    'write',
    'command',
    'network',
    'search',
    'unrestricted',
    'graphify:read',
    'agent:invoke',
    'audit:write',
    'task:create',
    'desktop:openFile',
    'desktop:openfile',
    'storage:indexeddb',
    'webxr',
    'speech',
    'git:read',
    'upload:temp',
    'filesystem:read-selected'
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
        this.disabledPlugins = new Set();
        this.loadDisabledConfig();
        this.loadPlugins();
    }

    loadDisabledConfig() {
        try {
            if (fs.existsSync(PLUGIN_CONFIG_PATH)) {
                const config = JSON.parse(fs.readFileSync(PLUGIN_CONFIG_PATH, 'utf8'));
                if (Array.isArray(config.disabled)) this.disabledPlugins = new Set(config.disabled);
            }
        } catch (err) { logger.error('toolbox_plugin_config_load_failed', err); }
    }
    loadPluginPermissions() {
        // Reload plugin permissions from current settings — called after settings change
        for (const [name, _plugin] of this.plugins) {
            try { this.assertPluginPermissions(name); }
            catch (err) { logger.warn('toolbox_plugin_permission_recheck_failed', { plugin: name, reason: err.message }); }
        }
    }
    saveDisabledConfig() {
        try { const dir = path.dirname(PLUGIN_CONFIG_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(PLUGIN_CONFIG_PATH, JSON.stringify({disabled:Array.from(this.disabledPlugins)},null,2),'utf8'); }
        catch (err) { logger.error('toolbox_plugin_config_save_failed', err); }
    }
    enablePlugin(name) { this.disabledPlugins.delete(name); this.saveDisabledConfig(); this.loadPlugins(); logger.info('toolbox_plugin_enabled', { plugin: name }); }
    disablePlugin(name) {
        const plugin = this.plugins.get(name);
        if (plugin && plugin._api && plugin.onDisable) {
            plugin.onDisable(plugin._api).catch(e => logger.warn('toolbox_plugin_on_disable_failed', { plugin: name, reason: e.message }));
        }
        this.disabledPlugins.add(name); this.plugins.delete(name); this.saveDisabledConfig(); logger.info('toolbox_plugin_disabled', { plugin: name });
    }

    /**
     * Dynamically loads custom tools from the plugins directory.
     *
     * THIS METHOD IS WHY plugins/*.js ARE LOAD-BEARING DESPITE LOOKING DEAD.
     * Plugins are found by
     * readdirSync() and pulled in with require(pluginPath) — a computed path, not
     * a literal. No static import exists anywhere, so knip, IDE "unused file"
     * hints, bundler tree-shaking, and any basename-matching scan will all report
     * every shipped plugin as unreferenced. Deleting one on that basis silently
     * removes a working feature; the suite will still pass, because the plugin
     * tests require() by path too.
     *
     * Before deleting anything under plugins/, run:
     *     node -e "const t=require('./backend/infrastructure/ToolBox');console.log([...t.plugins.keys()])"
     */
    loadPlugins() {
        const pluginsDir = path.resolve(__dirname, '../../plugins');
        if (!fs.existsSync(pluginsDir)) return;

        const files = fs.readdirSync(pluginsDir);
        files.forEach(file => {
            if (!file.endsWith('.js')) return;
            // Check if disabled by reading plugin name from source
            try {
                const content = fs.readFileSync(path.join(pluginsDir, file), 'utf8');
                const match = content.match(/name:\s*['"]([^'"]+)['"]/);
                const pn = match ? match[1] : null;
                if (pn && this.disabledPlugins.has(pn)) { logger.info('toolbox_plugin_skipped_disabled', { plugin: pn }); return; }
            } catch (_err) {
                // This read only decides whether the plugin is *disabled*. If it
                // fails, fall through and let the require() below surface the
                // real problem with a useful message instead of masking it here.
            }
            
                try {
                    const pluginPath = path.join(pluginsDir, file);
                    // Clear cache to allow reloading of updated plugins
                    delete require.cache[require.resolve(pluginPath)];
                    
                    const plugin = require(pluginPath);
                    if (this.validatePlugin(plugin)) {
                        const permissions = this.normalizePluginPermissions(plugin.permissions);
                        logger.info('toolbox_plugin_loaded', { plugin: plugin.name });
                        this.plugins.set(plugin.name, {
                            ...plugin,
                            permissions,
                            _filename: file // Store filename for deletion logic
                        });
                    }

                } catch (err) {
                    logger.error('toolbox_plugin_load_failed', err, { file });
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
     * Every built-in tool's signature, as data rather than as a hand-written line.
     *
     * The previous form rendered bare parameter names — `readFile(filePath)` — so
     * the model was never told a type, which was required, or what a value should
     * look like. Guessing followed: relative paths where absolute were needed,
     * `depth: "2"` as a string, `project` omitted so the tool fell back to the
     * runtime's cwd instead of the user's workspace. Typing them here is the
     * cheapest available accuracy win, because it costs prompt tokens once and
     * removes a whole class of retry.
     */
    static get TOOL_SCHEMA() {
        // `file` and `project` recur across almost every tool. Their meaning is
        // stated once in TOOL_CONVENTIONS instead of being repeated per signature:
        // spelled out inline, `project` alone cost ~600 characters of every prompt,
        // and the whole block is re-sent on every reasoning step.
        const file = { type: 'string', required: true };
        const project = { type: 'string', required: false };

        return [
            ['readFile', { filePath: file }, 'Returns the content of a file.'],
            ['writeFile', { filePath: file, content: { type: 'string', required: true, note: 'the complete new file content' } },
                'Overwrites a file with new content. Requires human approval, so prefer applyPatch for edits to existing files.'],
            ['applyPatch', {
                filePath: file,
                oldText: { type: 'string', required: true, note: 'exact existing text, including indentation' },
                newText: { type: 'string', required: true },
            }, 'Replaces an exact text range in a file. Fails if oldText is not found verbatim or is not unique.'],
            ['executeCommand', {
                command: { type: 'string', required: true },
                cwd: { type: 'string', required: false, note: 'defaults to the active workspace' },
            }, 'Runs a shell command and returns its output. Destructive patterns are blocked by policy.'],
            ['searchCode', {
                query: { type: 'string', required: true, note: 'natural language or a code fragment' },
                project,
                top: { type: 'number', required: false, note: 'max 50, default 10' },
            }, 'Semantic search across the indexed workspace.'],
            ['listFiles', { directoryPath: { type: 'string', required: true } }, 'Lists the entries of a directory.'],
            ['impactOf', {
                file,
                project,
                depth: { type: 'number', required: false, note: 'hops, 1-4, default 2' },
            }, 'BEFORE editing any file: its dependents, covering tests, risk, and the OpenSpec specs describing it. Cheap in-process graph read — call it rather than guessing what a change reaches.'],
            ['graphifyQuery', { query: { type: 'string', required: true }, project },
                'Queries the knowledge graph for related code, docs and diagram relationships.'],
            ['graphifyExplain', { node: { type: 'string', required: true, note: 'graph node id or symbol' }, project },
                'Explains a graph node and its neighbours.'],
            ['graphifyPath', {
                source: { type: 'string', required: true },
                target: { type: 'string', required: true },
                project,
            }, 'Finds a dependency path between two entities.'],
            ['graphifyAffected', {
                node: { type: 'string', required: true },
                project,
                depth: { type: 'number', required: false },
            }, 'Nodes impacted by a change to a graph entity. Prefer impactOf for file-level questions.'],
            ['specDrift', { project, minDependents: { type: 'number', required: false } },
                'OpenSpec intent versus the graph: specs citing files that no longer exist, and load-bearing modules no spec describes.'],
            ['specPropose', {
                project,
                changeName: { type: 'string', required: true, note: 'kebab-case' },
                description: { type: 'string', required: false },
            }, 'Creates an OpenSpec change proposal. Call BEFORE implementing any significant feature.'],
            ['specValidate', { project, changeName: { type: 'string', required: true } },
                'Validates a change against project specs. Run after implementing, before archiving.'],
            ['specArchive', { project, changeName: { type: 'string', required: true } },
                'Archives a completed change. Run only after specValidate passes.'],
        ];
    }

    /**
     * Conventions shared by most tools, stated once above the list.
     *
     * `?` marking and per-parameter types are the accuracy win; repeating the same
     * prose for `project` on nine tools was not. This is the same information for a
     * tenth of the tokens.
     */
    static get TOOL_CONVENTIONS() {
        return [
            'Parameter conventions: `name: type` is required, `name?: type` is optional.',
            '`file`/`filePath` take a workspace-relative or absolute path.',
            '`project` takes an absolute workspace path — pass it whenever you know it, or the tool falls back to the runtime directory rather than the user\'s workspace.',
        ].join('\n');
    }

    /** Render one parameter map as a typed signature. */
    static formatParameters(parameters) {
        return Object.entries(parameters || {})
            .map(([name, spec]) => {
                // Plugin authors write { type, required, description }; built-ins
                // above use `note`. Accept either rather than making plugins
                // conform to an internal shape.
                const type = spec?.type || 'string';
                const optional = spec?.required === true ? '' : '?';
                const note = spec?.note || spec?.description;
                return `${name}${optional}: ${type}${note ? ` (${note})` : ''}`;
            })
            .join(', ');
    }

    /**
     * Returns a description of all available tools for the AI system prompt.
     */
    getToolDefinitions() {
        const builtIn = ToolBox.TOOL_SCHEMA.map(([name, parameters, description]) =>
            `${name}(${ToolBox.formatParameters(parameters)})\n    ${description}`);

        // A plugin description is author-written and can be long. It is the only
        // thing that makes the model pick the plugin, so it is kept — but capped,
        // because it is re-sent on every reasoning step of every task.
        const pluginDocs = Array.from(this.plugins.values()).map(plugin => {
            const description = String(plugin.description || 'Custom plugin tool.').replace(/\s+/g, ' ').trim();
            const capped = description.length > 300 ? `${description.slice(0, 300)}…` : description;
            return `${plugin.name}(${ToolBox.formatParameters(plugin.parameters)})\n    ${capped}`;
        });

        const numbered = [...builtIn, ...pluginDocs]
            .map((entry, i) => `${i + 1}. ${entry}`)
            .join('\n');

        return `${ToolBox.TOOL_CONVENTIONS}\n\n${numbered}`;
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
        const argv = this.assertCommandAllowed(command);
        const settings = require('./SettingsProvider');
        if (!settings.get('allowAgentCommands')) {
            throw new Error('Agent shell commands are disabled. Enable in Settings.');
        }

        const [bin, ...args] = argv;

        return new Promise((resolve) => {
            logger.info('toolbox_command_started', { bin, args, cwd: workingDirectory });
            // execFile, not exec: the command never reaches a shell, so quoting,
            // globbing, substitution and chaining cannot be reinterpreted.
            execFile(bin, args, { cwd: workingDirectory, timeout: 120000 }, (error, stdout, stderr) => {
                if (error && error.code === 'ENOENT') {
                    resolve({
                        stdout: '',
                        stderr: `Command not found: ${bin}`,
                        exitCode: 127
                    });
                    return;
                }
                resolve({
                    stdout: stdout || '',
                    stderr: stderr || '',
                    exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0
                });
            });
        });
    }

    async searchCode({ query, project, top } = {}) {
        const args = ['search', query];
        if (project) {
            // ctx -p takes the indexed project's NAME. This passed the absolute
            // path, so ctx answered "Project not found", the JSON parse failed,
            // and every workspace-scoped search fell through to the substring
            // grep below — semantic retrieval was effectively off in exactly the
            // case it is always used. ContextEngine.projectName resolves it.
            const name = await contextEngine.projectName(this.resolveAllowedPath(project));
            if (name) args.push('-p', name);
        }
        if (top) args.push('-k', String(Math.min(Math.max(Number(top) || 10, 1), 50)));
        try {
            const results = await contextEngine.executeJson(args);
            if (Array.isArray(results) && results.length > 0) return this.normalizeSearchHits(results);
            if (Array.isArray(results?.results) && results.results.length > 0) return this.normalizeSearchHits(results.results);
            if (Array.isArray(results) || Array.isArray(results?.results)) {
                return this.searchCodeFilesystem({ query, project, top });
            }
            if (results?.error || results?.message) {
                throw new Error(results.error || results.message);
            }
            throw new Error('ctx search returned an unsupported result shape');
        } catch (err) {
            logger.warn('ctx_search_fallback_started', {
                query,
                project,
                error: err.message,
                userAction: 'code_search',
                severity: 'medium'
            });
            return this.searchCodeFilesystem({ query, project, top });
        }
    }

    /**
     * Put ctx's hits into the shape every consumer already reads.
     *
     * `ctx search --json` returns `{ score, filePath, lineStart, content, … }`,
     * while GraphRanker, searchRouter, the compose route, SearchTrace and
     * SearchWindow all read `metadata.path` / `content` — the shape produced by
     * searchCodeFilesystem. That mismatch went unnoticed because the -p bug meant
     * they only ever received fallback results. With semantic search working, the
     * real shape has to be mapped or every hit arrives with no filename.
     *
     * Original fields are kept alongside, so anything reading ctx's names still
     * works.
     */
    normalizeSearchHits(hits) {
        return hits.map((hit) => {
            if (!hit || typeof hit !== 'object') return hit;
            const filePath = hit.metadata?.path || hit.filePath || hit.path || hit.file || '';
            const content = hit.content || hit.text || hit.snippet || '';
            return {
                ...hit,
                content,
                text: content,
                snippet: content,
                score: Number(hit.score) || 0,
                metadata: {
                    ...(hit.metadata || {}),
                    path: filePath,
                    line: hit.metadata?.line ?? hit.lineStart ?? null,
                    lineEnd: hit.metadata?.lineEnd ?? hit.lineEnd ?? null,
                    language: hit.metadata?.language ?? hit.language ?? null,
                    source: hit.metadata?.source || 'ctx-semantic',
                },
            };
        });
    }

    searchCodeFilesystem({ query, project, top = 10 }) {
        const root = this.resolveAllowedPath(project || process.cwd());
        const needle = String(query || '').trim().toLowerCase();
        if (!needle) return [];

        const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'release', 'graphify-out', '.next', '.cache']);
        const ignoredFiles = new Set(['.env', '.env.local', '.env.development', '.env.production', '.env.test']);
        const maxResults = Math.min(Math.max(Number(top || 10), 1), 50);
        const results = [];

        const walk = (dirPath, depth = 0) => {
            if (results.length >= maxResults || depth > 8) return;
            let entries;
            try {
                entries = fs.readdirSync(dirPath, { withFileTypes: true });
            } catch {
                return;
            }

            for (const entry of entries) {
                if (results.length >= maxResults) break;
                const entryPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    if (!ignoredDirs.has(entry.name)) walk(entryPath, depth + 1);
                    continue;
                }
                if (!entry.isFile()) continue;
                if (ignoredFiles.has(entry.name) || entry.name.startsWith('.env.')) continue;
                this.searchFileForNeedle(entryPath, needle, results, maxResults);
            }
        };

        walk(root);
        return results;
    }

    searchFileForNeedle(filePath, needle, results, _maxResults) {
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch {
            return;
        }
        if (stat.size > 1024 * 1024) return;

        let content;
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch {
            return;
        }
        if (content.includes('\u0000')) return;

        const lower = content.toLowerCase();
        const index = lower.indexOf(needle);
        if (index === -1) return;

        const before = content.slice(0, index).split('\n');
        const lineNumber = before.length;
        const lines = content.split('\n');
        const startLine = Math.max(lineNumber - 3, 0);
        const endLine = Math.min(lineNumber + 2, lines.length);
        const snippet = lines.slice(startLine, endLine).join('\n');
        const exactPathMatch = path.basename(filePath).toLowerCase().includes(needle) ? 0.15 : 0;

        results.push({
            content: snippet,
            text: snippet,
            snippet,
            score: Math.min(0.95, 0.65 + exactPathMatch),
            metadata: {
                path: filePath,
                line: lineNumber,
                source: 'filesystem-fallback'
            }
        });
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

    /**
     * What editing one file would reach, and what the specs say about it.
     *
     * This is the same composition the writeFile approval gate performs — but the
     * gate runs *after* the model has already decided what to write, so the risk
     * information only ever reached the human. Exposing it as a tool lets the
     * model check before proposing, which is the difference between "here is a
     * diff, decide" and "this file has 12 dependents and no tests, so I will add
     * a test first".
     *
     * Reads the graph in-process rather than shelling out to the graphify CLI
     * (which is what graphifyAffected does), so it is cheap enough to call per
     * file without the model hesitating over cost.
     */
    async impactOf({ file, project, depth = 2 }) {
        if (!file) throw new Error('file is required — the workspace-relative path you intend to edit');

        const projectPath = this.resolveAllowedPath(project || process.cwd());
        const hops = Math.min(4, Math.max(1, Number(depth) || 2));
        const impact = impactAnalyzer.analyzeFile(projectPath, file, { depth: hops });

        if (!impact?.available) {
            return {
                file,
                available: false,
                reason: impact?.reason || 'no structural information for this file',
                advice: 'Proceed with care: the graph cannot confirm what depends on this file.',
            };
        }

        // Which specs describe this file — the OpenSpec half of the answer.
        let describedBy = [];
        let specCount = 0;
        try {
            const specs = specDrift.readSpecs(projectPath);
            specCount = specs.length;
            describedBy = specs
                .filter(spec => specDrift.extractReferences(spec.text)
                    .some(reference => impact.targetFile.endsWith(reference) || reference.endsWith(path.basename(impact.targetFile))))
                .map(spec => spec.id);
        } catch (_) { /* OpenSpec unavailable — structure alone still answers */ }

        // The transcript pays for every character of this, so cap the lists.
        return {
            file: impact.targetFile,
            available: true,
            risk: impact.risk,
            stale: impact.stale,
            depth: hops,
            dependentCount: impact.impactedCount,
            dependents: impact.topDependents,
            testCount: impact.testCount,
            coveringTests: impact.coveringTests.slice(0, 5),
            specCount,
            describedBy,
            summary: impactAnalyzer.summarize(impact),
            advice: impact.testCount === 0 && impact.impactedCount > 0
                ? `${impact.impactedCount} file(s) depend on this and no test covers it — add or extend a test before changing behaviour.`
                : describedBy.length > 0
                    ? `Spec(s) ${describedBy.join(', ')} describe this file; keep the change consistent with them or update the spec.`
                    : 'Low structural risk — a focused edit here is unlikely to reach far.',
        };
    }

    /**
     * Architecture drift: what the specs say versus what the code does.
     * Only possible because OpenSpec and Graphify are both mandatory.
     */
    async specDrift({ project, minDependents = 2 }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        const report = specDrift.detectDrift(projectPath, { minDependents });
        return { ...report, summary: specDrift.formatDrift(report) };
    }

    /**
     * OpenSpec propose — create a new change proposal.
     * Creates proposal.md, design.md, and tasks.md under openspec/changes/<name>/.
     */
    async specPropose({ project, changeName, description = '' }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        if (!changeName) throw new Error('changeName is required — provide a kebab-case name like "add-dark-mode"');

        // Create the change directory and proposal files using the stardust workflow
        const changeDir = path.join(projectPath, 'openspec', 'changes', changeName);
        if (!fs.existsSync(changeDir)) fs.mkdirSync(changeDir, { recursive: true });

        const proposalPath = path.join(changeDir, 'proposal.md');
        const designPath = path.join(changeDir, 'design.md');
        const tasksPath = path.join(changeDir, 'tasks.md');

        // Only write if the files don't already exist (don't overwrite user edits)
        if (!fs.existsSync(proposalPath)) {
            fs.writeFileSync(proposalPath, `# ${changeName}\n\n${description || 'Proposed change.'}\n`);
        }
        if (!fs.existsSync(designPath)) {
            fs.writeFileSync(designPath, `# Design: ${changeName}\n\n## Approach\n\n## Tradeoffs\n\n## Affected modules\n`);
        }
        if (!fs.existsSync(tasksPath)) {
            fs.writeFileSync(tasksPath, `# Tasks: ${changeName}\n\n- [ ] Implement the change\n- [ ] Add tests\n- [ ] Validate against specs\n`);
        }

        return {
            success: true,
            changeName,
            proposalPath,
            files: ['proposal.md', 'design.md', 'tasks.md'],
            message: `OpenSpec change "${changeName}" proposed. Review the files in openspec/changes/${changeName}/ and run specValidate when ready.`
        };
    }

    /**
     * OpenSpec validate — check a change against project specs.
     */
    async specValidate({ project, changeName }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        if (!changeName) throw new Error('changeName is required');

        const result = await stardustWrapper.validate(changeName, { cwd: projectPath });
        return {
            success: result.success,
            changeName,
            output: result.stdout,
            errors: result.stderr || null,
            message: result.success
                ? `Change "${changeName}" passed validation.`
                : `Validation failed for "${changeName}": ${result.stderr || 'unknown error'}`
        };
    }

    /**
     * OpenSpec archive — finalize a completed change.
     */
    async specArchive({ project, changeName }) {
        const projectPath = this.resolveAllowedPath(project || process.cwd());
        if (!changeName) throw new Error('changeName is required');

        const result = await stardustWrapper.archive(changeName, { cwd: projectPath });
        return {
            success: result.success,
            changeName,
            output: result.stdout,
            errors: result.stderr || null,
            message: result.success
                ? `Change "${changeName}" has been archived.`
                : `Archive failed for "${changeName}": ${result.stderr || 'unknown error'}`
        };
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
                logger.error('toolbox_config_load_failed', err);
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
            allowedExecutables: Array.from(this.getAllowedExecutables()).sort(),
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

        // Resolve symlinks BEFORE testing containment. path.resolve() is purely
        // lexical, so a symlink inside a watched directory pointing at
        // ~/.ssh/id_rsa used to satisfy the check and escape the workspace.
        const realPath = this.realPathOrNearest(resolvedPath);

        const allowed = this.getAllowedRoots().some((root) => {
            const relative = path.relative(this.realPathOrNearest(root), realPath);
            return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        });

        if (!allowed) {
            throw new Error(`Path is outside allowed workspaces: ${resolvedPath}`);
        }

        return resolvedPath;
    }

    /**
     * fs.realpathSync for a path that need not exist yet.
     *
     * writeFile legitimately targets files that have not been created, and
     * realpathSync throws ENOENT on those. This walks up to the nearest existing
     * ancestor, resolves that, then re-appends the missing tail — so the symlink
     * containment check works for new files as well as existing ones.
     * @param {string} target
     * @returns {string} Fully symlink-resolved absolute path.
     */
    realPathOrNearest(target) {
        let current = path.resolve(target);
        const missingTail = [];

        for (;;) {
            try {
                return path.join(fs.realpathSync(current), ...[...missingTail].reverse());
            } catch (err) {
                if (err.code !== 'ENOENT') return current;
                const parent = path.dirname(current);
                if (parent === current) return current; // reached the filesystem root
                missingTail.push(path.basename(current));
                current = parent;
            }
        }
    }

    /**
     * Executables the agent may run. argv[0] must match one of these exactly.
     *
     * This replaced a six-pattern denylist which was trivially bypassable:
     * `rm -fr /`, `rm -r -f /`, `curl -o /tmp/x … && sh /tmp/x`, `node -e "…"`
     * and `python3 -c "…"` all sailed straight through it. An allowlist fails
     * closed instead of guessing at what is dangerous.
     *
     * Mutating the filesystem is deliberately absent (no rm/mv/cp/chmod): file
     * changes belong in writeFile/applyPatch, which are workspace-sandboxed.
     * Extend per-project via `settings.allowedCommands` in config.json.
     */
    getAllowedExecutables() {
        const settings = require('./SettingsProvider');
        const extra = settings.get('allowedCommands');
        return new Set([
            ...DEFAULT_ALLOWED_EXECUTABLES,
            ...(Array.isArray(extra) ? extra : [])
        ]);
    }

    /**
     * Splits a command string into argv, honouring single and double quotes.
     *
     * Shell operators are rejected rather than escaped. Nothing runs through a
     * shell any more, so they cannot be honoured — and silently dropping them
     * would execute something other than what the caller asked for.
     * @returns {string[]} argv
     */
    parseCommand(command) {
        if (/[;&|`$><\n\r]/.test(command)) {
            throw new Error(
                'Command blocked by policy: shell operators (; & | ` $ > <) are not permitted. Run one command at a time.'
            );
        }

        const argv = [];
        const token = /"([^"]*)"|'([^']*)'|(\S+)/g;
        let match;
        while ((match = token.exec(command)) !== null) {
            argv.push(match[1] ?? match[2] ?? match[3]);
        }
        return argv;
    }

    /**
     * Legacy denylist, kept as defence in depth and for the /api/policy report.
     * The allowlist in assertCommandAllowed is the real control.
     */
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

    /**
     * Validates a command and returns its argv.
     * @throws if the command is empty, uses shell operators, or is not allowlisted.
     * @returns {string[]} argv ready for execFile.
     */
    assertCommandAllowed(command) {
        if (!command || typeof command !== 'string') {
            throw new Error('Command is required');
        }

        const blocked = this.getBlockedCommandPatterns().find((pattern) => pattern.test(command));
        if (blocked) {
            throw new Error(`Command blocked by policy: ${blocked}`);
        }

        const argv = this.parseCommand(command);
        if (argv.length === 0) {
            throw new Error('Command is required');
        }

        // Bare names only. A path like /tmp/evil or ./npm could otherwise
        // impersonate an allowlisted executable.
        const bin = argv[0];
        if (bin.includes('/') || bin.includes('\\')) {
            throw new Error(`Command blocked by policy: use a bare executable name, not a path (${bin})`);
        }

        if (!this.getAllowedExecutables().has(bin)) {
            throw new Error(
                `Command blocked by policy: "${bin}" is not an allowed executable. ` +
                'Add it to settings.allowedCommands in config.json if this is intentional.'
            );
        }

        const evalFlags = INLINE_EVAL_FLAGS[bin];
        if (evalFlags) {
            const inlineEval = argv.slice(1).find((arg) => evalFlags.includes(arg));
            if (inlineEval) {
                throw new Error(
                    `Command blocked by policy: "${bin} ${inlineEval}" executes inline source. ` +
                    'Run a script file instead.'
                );
            }
        }

        return argv;
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
            const settings = require('./SettingsProvider');
            if (!settings.get('allowUnrestrictedPlugins')) {
                throw new Error(`Plugin ${name} is unrestricted. Enable in Settings.`);
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
            // Support legacy plugin format (onLoad/onEnable lifecycle)
            if (typeof plugin.onLoad === 'function' || typeof plugin.onEnable === 'function') {
                const PluginAPI = require('./PluginAPI');
                const pluginsDir = path.resolve(__dirname, '../../plugins');
                const pluginDir = pluginsDir;
                plugin._api = new PluginAPI(pluginDir);
                plugin.execute = async (params = {}) => {
                    if (plugin.onLoad) await plugin.onLoad(plugin._api);
                    if (params._action === 'enable' && plugin.onEnable) await plugin.onEnable(plugin._api);
                    if (params._action === 'disable' && plugin.onDisable) await plugin.onDisable(plugin._api);
                    if (params._action === 'unload' && plugin.onUnload) await plugin.onUnload(plugin._api);
                    return { legacy: true, name: plugin.name, message: 'Legacy plugin loaded with full API' };
                };
            } else {
                throw new Error(`Plugin ${plugin.name} must export an execute function`);
            }
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
