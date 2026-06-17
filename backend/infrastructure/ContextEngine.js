const { spawn } = require('child_process');
const dependencyChecker = require('./DependencyChecker');

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
                    finish(() => reject(new Error(error || `CLI command failed with code ${code}`)));
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


module.exports = new ContextEngine();
