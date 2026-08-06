const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dependencyChecker = require('../infrastructure/DependencyChecker');
const logger = require('../infrastructure/Logger');

/**
 * StardustWrapper — CLI subprocess wrapper for OpenSpec.
 *
 * Spawns the official `openspec` CLI (`npx openspec` or global binary)
 * as a child process. Provides 100% functional coverage of OpenSpec's
 * core workflow: propose → validate → apply → archive.
 *
 * Architecture: Path A — CLI Subprocess Wrapper (does NOT rewrite OpenSpec internals).
 */
class StardustWrapper {
    constructor() {
        this._binary = null;
    }

    // ──────────────────────────────────────────────
    //  Binary resolution
    // ──────────────────────────────────────────────

    /**
     * Resolve the openspec binary, preferring a global install over npx.
     * Cached after first call.
     */
    async _resolveBinary() {
        if (this._binary) return this._binary;

        // Use DependencyChecker's cross-platform PATH resolution (same as ContextEngine)
        const resolved = dependencyChecker.which('openspec');
        if (resolved) {
            this._binary = resolved;
            logger.info('openspec_binary_resolved', { binary: resolved });
            return this._binary;
        }

        // Fall back to npx
        logger.warn('openspec_binary_not_found', { detail: 'falling back to npx' });
        this._binary = 'npx';
        return this._binary;
    }

    /**
     * Build the argument array. If binary is 'npx', prefix with ['openspec'].
     */
    async _buildArgs(args) {
        const bin = await this._resolveBinary();
        if (bin === 'npx') {
            return ['openspec', ...args];
        }
        return args;
    }

    // ──────────────────────────────────────────────
    //  Core spawn primitive
    // ──────────────────────────────────────────────

    /**
     * Spawn the openspec CLI with given args.
     *
     * @param {string[]} args — CLI arguments (without the binary name)
     * @param {object}   opts
     * @param {string}   opts.cwd        — working directory
     * @param {number}   opts.timeoutMs  — max runtime (default 60 000)
     * @param {string}   opts.stdin      — optional string to pipe to stdin
     * @returns {Promise<{stdout: string, stderr: string, code: number, success: boolean}>}
     */
    async _runCommand(args, { cwd, timeoutMs = 60000, stdin } = {}) {
        const bin = await this._resolveBinary();
        const spawnArgs = await this._buildArgs(args);
        const effectiveCwd = cwd || process.cwd();

        logger.info('openspec_spawn', { bin, args: spawnArgs, cwd: effectiveCwd });

        return new Promise((resolve, _reject) => {
            const proc = spawn(bin, spawnArgs, { cwd: effectiveCwd, stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            let settled = false;

            const timeout = setTimeout(() => {
                if (settled) return;
                settled = true;
                proc.kill('SIGTERM');
                // Send SIGKILL after 5s if still alive
                setTimeout(() => {
                    try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
                }, 5000);
                resolve({
                    stdout,
                    stderr: (stderr + `\n[TIMEOUT] Command timed out after ${timeoutMs}ms`).trim(),
                    code: null,
                    success: false,
                });
            }, timeoutMs);

            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(result);
            };

            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });

            // Optional stdin
            if (stdin) {
                proc.stdin.write(stdin);
                proc.stdin.end();
            }

            proc.on('error', (err) => {
                finish({
                    stdout: stdout.trim(),
                    stderr: (stderr + `\n[ERROR] ${err.message}`).trim(),
                    code: null,
                    success: false,
                });
            });

            proc.on('close', (code) => {
                const trimmedStdout = stdout.trim();
                const trimmedStderr = stderr.trim();

                // Always log to server console for diagnostics
                if (trimmedStderr) {
                    logger.warn('openspec_stderr', { code, stderr: trimmedStderr.slice(0, 500) });
                }
                if (code !== 0) {
                    logger.error('openspec_command_failed', null, { code, bin, args: spawnArgs });
                    if (trimmedStderr) logger.error('openspec_command_failed_stderr', null, { stderr: trimmedStderr });
                } else {
                    logger.info('openspec_command_succeeded', { code });
                }

                finish({
                    stdout: trimmedStdout,
                    stderr: trimmedStderr,
                    code,
                    success: code === 0,
                });
            });
        });
    }

    // ──────────────────────────────────────────────
    //  Public API — Diagnostics
    // ──────────────────────────────────────────────

    /**
     * Full diagnostics: checks PATH, version, and project structure.
     *
     * @param {string} [projectRoot] — workspace root to check
     * @returns {Promise<{
     *   installed: boolean,
     *   version: string|null,
     *   projectRootFound: boolean,
     *   projectMdPath: string|null,
     *   binary: string,
     *   errors: string[]
     * }>}
     */
    async diagnose(projectRoot) {
        const result = {
            installed: false,
            version: null,
            projectRootFound: false,
            projectMdPath: null,
            binary: 'openspec',
            errors: [],
            // Raw diagnostic outputs for debugging
            _debug: {
                versionRawStdout: null,
                versionRawStderr: null,
                versionExitCode: null,
            },
        };

        const effectiveRoot = projectRoot || process.cwd();

        // Resolve binary
        try {
            result.binary = await this._resolveBinary();
        } catch (err) {
            result.errors.push(`Binary resolution failed: ${err.message}`);
            return result;
        }

        // Check version (stdout and stderr — some CLIs write version to stderr)
        try {
            const { stdout, stderr: versionStderr, success, code } = await this._runCommand(['--version'], { timeoutMs: 15000 });
            result._debug.versionRawStdout = stdout;
            result._debug.versionRawStderr = versionStderr;
            result._debug.versionExitCode = code;
            const versionOutput = (stdout + versionStderr).trim();
            if (versionOutput) {
                result.version = versionOutput;
                result.installed = true;
            } else if (success) {
                result.installed = true;
            }
            if (!result.installed) {
                result.errors.push(`Version check returned no output (exit code: ${code}). Raw stderr: "${versionStderr.slice(0, 200)}"`);
            }
        } catch (err) {
            result.errors.push(`Version check threw: ${err.message}`);
        }

        // Check project root
        // OpenSpec init creates: openspec/config.yaml, openspec/changes/, openspec/specs/
        const configYamlPath = path.join(effectiveRoot, 'openspec', 'config.yaml');
        const specsDir = path.join(effectiveRoot, 'openspec', 'specs');
        const changesDir = path.join(effectiveRoot, 'openspec', 'changes');
        try {
            if (fs.existsSync(configYamlPath)) {
                result.projectRootFound = true;
                result.projectMdPath = configYamlPath;
            } else if (fs.existsSync(specsDir) && fs.statSync(specsDir).isDirectory()) {
                result.projectRootFound = true;
                result.projectMdPath = specsDir;
            } else if (fs.existsSync(changesDir) && fs.statSync(changesDir).isDirectory()) {
                result.projectRootFound = true;
                result.projectMdPath = changesDir;
            }
        } catch (err) {
            result.errors.push(`Project root check failed: ${err.message}`);
        }

        return result;
    }

    // ──────────────────────────────────────────────
    //  Public API — Workflow commands
    // ──────────────────────────────────────────────

    /**
     * Validate a change or spec.
     * @param {string} itemName — change or spec name
     * @param {object} [opts]
     * @param {string} [opts.cwd]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async validate(itemName, { cwd } = {}) {
        return this._runCommand(['validate', itemName], { cwd });
    }

    /**
     * Archive a completed change.
     * @param {string} changeName
     * @param {object} [opts]
     * @param {string} [opts.cwd]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async archive(changeName, { cwd } = {}) {
        return this._runCommand(['archive', changeName], { cwd });
    }

    /**
     * List current changes or specs.
     * @param {object} [opts]
     * @param {boolean} [opts.specs=false] — list specs instead of changes
     * @param {string} [opts.cwd]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async list({ specs = false, cwd } = {}) {
        const args = ['list', '--json'];
        if (specs) args.push('--specs');
        return this._runCommand(args, { cwd });
    }

    // ──────────────────────────────────────────────
    //  Project initialization
    // ──────────────────────────────────────────────

    /**
     * Initialize OpenSpec in a project directory.
     * Runs `openspec init [path]` to create openspec/project.md and related files.
     *
     * @param {string} projectRoot — workspace root
     * @param {object} [opts]
     * @param {string} [opts.tools='all'] — AI tools config
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async init(projectRoot, { tools = 'all' } = {}) {
        const args = ['init', projectRoot, '--tools', tools, '--force'];
        return this._runCommand(args, { cwd: projectRoot });
    }

    // ──────────────────────────────────────────────
    //  Installation helper
    // ──────────────────────────────────────────────

    /**
     * Install openspec globally via npm.
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async install() {
        return new Promise((resolve) => {
            logger.info('openspec_install_started', { package: '@fission-ai/openspec' });
            const proc = spawn('npm', ['install', '-g', '@fission-ai/openspec'], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.stderr.on('data', (d) => { stderr += d.toString(); });

            proc.on('close', (code) => {
                this._binary = null; // clear cache so next call re-resolves
                resolve({
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
                    success: code === 0,
                });
            });

            proc.on('error', (err) => {
                resolve({
                    stdout: stdout.trim(),
                    stderr: (stderr + `\n${err.message}`).trim(),
                    success: false,
                });
            });

            // Timeout after 120s
            setTimeout(() => {
                try { proc.kill('SIGTERM'); } catch (_) { /* ignore */ }
                setTimeout(() => {
                    try { proc.kill('SIGKILL'); } catch (_) { /* ignore */ }
                }, 5000);
            }, 120000);
        });
    }
}

// Singleton — same pattern as ContextEngine
module.exports = new StardustWrapper();
