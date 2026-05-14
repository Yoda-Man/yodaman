const { spawn } = require('child_process');

/**
 * ContextEngine (Infrastructure Layer)
 * 
 * Handles all direct communication with the 'ctx' CLI.
 * It abstracts the execution of CLI commands and provides JSON parsing.
 */
class ContextEngine {
    constructor() {
        this.binary = 'ctx';
    }

    /**
     * Executes a command on the ctx CLI.
     * @param {string[]} args - Arguments to pass to the CLI.
     * @returns {Promise<{output: string, code: number}>}
     */
    async execute(args = []) {
        return new Promise((resolve, reject) => {
            console.log(`[ContextEngine] Executing: ${this.binary} ${args.join(' ')}`);
            const proc = spawn(this.binary, args);
            let output = '';
            let error = '';

            proc.stdout.on('data', (data) => output += data.toString());
            proc.stderr.on('data', (data) => error += data.toString());

            proc.on('close', (code) => {
                if (code === 0 || (args.includes('--json') && output)) {
                    resolve({ output, code });
                } else {
                    reject(new Error(error || `CLI command failed with code ${code}`));
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
