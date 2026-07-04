const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

        // Try global binary first
        const globalCandidates = [];
        if (process.platform === 'win32') {
            globalCandidates.push(
                path.join(process.env.APPDATA || '', 'npm', 'openspec.cmd'),
                path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'openspec.cmd'),
            );
        } else {
            globalCandidates.push(
                path.join(os.homedir(), '.nvm', 'versions', 'node'),
                '/usr/local/bin/openspec',
                '/opt/homebrew/bin/openspec',
                path.join(os.homedir(), '.local', 'bin', 'openspec'),
            );
        }

        for (const candidate of globalCandidates) {
            try {
                if (fs.existsSync(candidate)) {
                    this._binary = candidate;
                    return this._binary;
                }
            } catch (_) { /* ignore */ }
        }

        // Fall back to npx
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

        console.log(`[StardustWrapper] Spawning: ${bin} ${spawnArgs.join(' ')} (cwd: ${effectiveCwd})`);

        return new Promise((resolve, reject) => {
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
                finish({
                    stdout: stdout.trim(),
                    stderr: stderr.trim(),
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
        };

        const effectiveRoot = projectRoot || process.cwd();

        // Resolve binary
        try {
            result.binary = await this._resolveBinary();
        } catch (err) {
            result.errors.push(`Binary resolution failed: ${err.message}`);
            return result;
        }

        // Check version
        try {
            const { stdout, success } = await this._runCommand(['--version'], { timeoutMs: 15000 });
            if (success && stdout) {
                result.version = stdout.trim();
                result.installed = true;
            } else if (stdout) {
                // Some CLIs output version to stderr or return non-zero
                result.version = stdout.trim();
                result.installed = true;
            }
        } catch (err) {
            result.errors.push(`Version check failed: ${err.message}`);
        }

        // Check project root
        const projectMdPath = path.join(effectiveRoot, 'openspec', 'project.md');
        const projectMdAltPath = path.join(effectiveRoot, 'openspec', 'project.json');
        try {
            if (fs.existsSync(projectMdPath)) {
                result.projectRootFound = true;
                result.projectMdPath = projectMdPath;
            } else if (fs.existsSync(projectMdAltPath)) {
                result.projectRootFound = true;
                result.projectMdPath = projectMdAltPath;
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
     * Propose a new change.
     * @param {string} title — change title
     * @param {string} description — change description
     * @param {string} specPath — path to the spec file
     * @param {object} [opts]
     * @param {string} [opts.cwd]
     * @param {boolean} [opts.dryRun]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async propose(title, description, specPath, { cwd, dryRun = false } = {}) {
        const args = ['propose', '--title', title, '--description', description, '--spec', specPath, '--non-interactive'];
        if (dryRun) args.push('--dry-run');
        return this._runCommand(args, { cwd });
    }

    /**
     * Validate a change.
     * @param {string} changeId
     * @param {object} [opts]
     * @param {boolean} [opts.strict=true]
     * @param {string} [opts.cwd]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async validate(changeId, { strict = true, cwd } = {}) {
        const args = ['validate', changeId, '--non-interactive'];
        if (strict) args.push('--strict');
        return this._runCommand(args, { cwd });
    }

    /**
     * Apply a change.
     * @param {string} changeId
     * @param {object} [opts]
     * @param {boolean} [opts.dryRun=true]
     * @param {string} [opts.cwd]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async apply(changeId, { dryRun = true, cwd } = {}) {
        const args = ['apply', changeId, '--non-interactive', '--yes'];
        if (dryRun) args.push('--dry-run');
        return this._runCommand(args, { cwd });
    }

    /**
     * Archive a change.
     * @param {string} changeId
     * @param {object} [opts]
     * @param {string} [opts.cwd]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async archive(changeId, { cwd } = {}) {
        const args = ['archive', changeId, '--non-interactive', '--yes'];
        return this._runCommand(args, { cwd });
    }

    /**
     * List current changes.
     * @param {object} [opts]
     * @param {string} [opts.cwd]
     * @returns {Promise<{stdout: string, stderr: string, success: boolean}>}
     */
    async list({ cwd } = {}) {
        const args = ['list', '--non-interactive'];
        return this._runCommand(args, { cwd });
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
            console.log('[StardustWrapper] Installing @fission-ai/openspec globally...');
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
