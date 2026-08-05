const { spawn } = require('child_process');
const path = require('path');
const dependencyChecker = require('./DependencyChecker');
const { stripCliNoise, summarizeCliError } = require('./CliOutput');

// `ctx list` is a process spawn, so its answer is cached. Short TTL: a workspace
// indexed mid-session should become scopeable without a restart.
const PROJECT_CACHE_TTL_MS = 60_000;

// argv and environment share ARG_MAX (1MB on macOS, and per-entry limits are
// lower on Linux). A prompt past this would make the spawn fail with E2BIG —
// a crash rather than a degraded answer — so it is refused here with a clear
// message instead. ConversationBuffer's job is to keep prompts well under it.
const MAX_PROMPT_CHARS = 120_000;

/**
 * ContextEngine (Infrastructure Layer)
 * 
 * Handles all direct communication with the 'ctx' CLI.
 * Uses DependencyChecker to resolve the full binary path so it works
 * inside Electron's limited PATH (NVM, Homebrew, pip --user, etc.).
 */
class ContextEngine {
    constructor() {
        // Resolve the full path to 'ctx' using DependencyChecker's
        // cross-platform search (NVM, Homebrew, which, etc.).
        // Falls back to bare 'ctx' (system PATH) if not found.
        const resolved = dependencyChecker.which('ctx');
        this.binary = resolved || 'ctx';
        if (resolved) {
            console.log(`[ContextEngine] ctx resolved to: ${resolved}`);
        } else {
            console.log('[ContextEngine] ctx not found via DependencyChecker — will rely on system PATH');
        }

        /** @type {{ at: number, byPath: Map<string, string> } | null} */
        this._projectCache = null;
    }

    /**
     * The ctx project *name* for a workspace path.
     *
     * `ctx -p` takes the indexed project's name, not its path — passing a path
     * makes ctx answer `{"error":"Project not found: …"}`. Callers were passing
     * absolute paths, so every project-scoped search failed and silently fell
     * through to ToolBox's substring-grep fallback: semantic retrieval was off
     * whenever a workspace was specified, which is the normal case. Resolving the
     * name here is what turns Context Expert back on.
     *
     * Falls back to the directory's basename, which is what ctx names a project
     * by default — so this still works when `ctx list` cannot be read.
     */
    async projectName(projectPath) {
        if (!projectPath) return null;
        const absolute = path.resolve(projectPath);

        const fresh = this._projectCache && (Date.now() - this._projectCache.at) < PROJECT_CACHE_TTL_MS;
        if (!fresh) {
            const byPath = new Map();
            try {
                const listing = await this.executeJson(['list']);
                for (const project of listing?.projects || []) {
                    if (project?.path && project?.name) byPath.set(path.resolve(project.path), project.name);
                }
            } catch (err) {
                console.warn(`[ContextEngine] ctx list failed, falling back to basename: ${err.message}`);
            }
            this._projectCache = { at: Date.now(), byPath };
        }

        const known = this._projectCache.byPath.get(absolute);
        if (known) return known;

        // Nested workspace: the closest indexed ancestor still scopes better than
        // searching every indexed project.
        let bestPath = null;
        for (const candidate of this._projectCache.byPath.keys()) {
            if (absolute.startsWith(`${candidate}${path.sep}`) && (!bestPath || candidate.length > bestPath.length)) {
                bestPath = candidate;
            }
        }
        return bestPath ? this._projectCache.byPath.get(bestPath) : path.basename(absolute);
    }

    /**
     * One `ctx ask` round trip.
     *
     * Two things the raw execute() call sites kept getting wrong:
     *   - `-p` was never passed, so every question was answered against every
     *     indexed project at once. On this machine that is 38,000 chunks across
     *     seven repositories for a question about one file.
     *   - Nothing bounded the prompt, so a long task could exceed ARG_MAX and
     *     turn the next spawn into a crash.
     */
    async ask(prompt, { project, topK, timeoutMs } = {}) {
        const text = String(prompt || '');
        if (text.length > MAX_PROMPT_CHARS) {
            throw new Error(`Prompt is ${text.length} characters, over the ${MAX_PROMPT_CHARS} limit for a single ctx invocation. It must be compacted before sending.`);
        }

        const args = ['ask'];
        if (project) {
            const name = await this.projectName(project);
            if (name) args.push('-p', name);
        }
        if (topK) args.push('-k', String(topK));
        args.push('--', text);

        try {
            return await this.execute(args, { timeoutMs });
        } catch (err) {
            // ctx can die partway through generating an answer and still have
            // written useful output. Observed with ctx 1.4.0 + qwen3.5:9b: as soon
            // as the model begins emitting a tool call, ctx's stream handler throws
            //   "Failed to connect to Ollama server: Cannot read properties of
            //    undefined (reading 'content')"
            // and exits 1 — after the first sentence has already reached stdout. A
            // plain prose question over the same project exits 0, so this is ctx's
            // stream parsing rather than Ollama being unreachable.
            //
            // Throwing away a partial answer makes that look like a total failure.
            // Salvage whatever was generated and let the caller decide.
            const salvaged = err?.partialOutput;
            if (salvaged && salvaged.trim()) {
                const reason = summarizeCliError(err.message);
                console.warn(`[ContextEngine] ctx exited non-zero mid-answer (${reason}); salvaging ${salvaged.length} chars of output`);
                return { output: salvaged, code: err.exitCode ?? 1, partial: true, error: reason };
            }
            throw err;
        }
    }

    /**
     * Executes a command on the ctx CLI.
     * @param {string[]} args - Arguments to pass to the CLI.
     * @returns {Promise<{output: string, code: number}>}
     */
    async execute(args = [], { timeoutMs } = {}) {
        return new Promise((resolve, reject) => {
            console.log(`[ContextEngine] Executing: ${this.binary} ${args.join(' ')}`);
            const proc = spawn(this.binary, args);
            let output = '';
            let error = '';
            let settled = false;
            const timeout = Number(timeoutMs || 0) > 0
                ? setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    proc.kill?.('SIGTERM');
                    reject(new Error(`${this.binary} command timed out after ${timeoutMs}ms`));
                }, Number(timeoutMs))
                : null;

            const finish = (fn) => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                fn();
            };

            proc.stdout.on('data', (data) => output += data.toString());
            proc.stderr.on('data', (data) => error += data.toString());

            proc.on('error', (err) => {
                finish(() => reject(new Error(`Failed to start ${this.binary}: ${err.message}`)));
            });

            proc.on('close', (code) => {
                if (code === 0 || (args.includes('--json') && output)) {
                    finish(() => resolve({ output, code }));
                } else {
                    // Carry what was written before the failure. ctx can crash after
                    // streaming part of an answer, and the caller is better placed
                    // than this method to judge whether a partial answer is usable.
                    const failure = new Error(error || `CLI command failed with code ${code}`);
                    failure.partialOutput = output;
                    failure.exitCode = code;
                    finish(() => reject(failure));
                }
            });
        });
    }

    /**
     * Executes a command and parses the output as JSON.
     * @param {string[]} args - Arguments to pass to the CLI.
     * @returns {Promise<Object>} Parsed JSON object.
     */
    async executeJson(args = []) {
        const { output } = await this.execute([...args, '--json']);
        try {
            // Find the actual JSON block by looking for the first { or [ that starts a line
            // or is the start of the output, avoiding "tip" messages in the middle of lines.
            const jsonMatch = output.match(/^[\s]*[\{\[]/m);
            if (!jsonMatch) {
                throw new Error('No valid JSON block found in CLI output');
            }

            const start = jsonMatch.index;
            const lastBrace = output.lastIndexOf('}');
            const lastBracket = output.lastIndexOf(']');
            const end = Math.max(lastBrace, lastBracket);

            if (start !== -1 && end !== -1 && end > start) {
                const jsonStr = output.substring(start, end + 1);
                return JSON.parse(jsonStr);
            }
            
            throw new Error('Could not identify valid JSON boundaries');
        } catch (e) {
            console.error(`[ContextEngine] JSON Parse Error: ${e.message}`);
            throw new Error(`Failed to parse CLI JSON: ${e.message}`);
        }
    }
}


const contextEngine = new ContextEngine();
contextEngine.stripCliNoise = stripCliNoise;

module.exports = contextEngine;
module.exports.stripCliNoise = stripCliNoise;
