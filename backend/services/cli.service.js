const { spawn } = require('child_process');

class CliService {
    async run(command, args = []) {
        return new Promise((resolve, reject) => {
            const proc = spawn('ctx', [...args]);
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

    async runJson(args = []) {
        const { output } = await this.run(null, [...args, '--json']);
        try {
            // Find the actual JSON block in the output
            const jsonMatch = output.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            throw new Error('No JSON found in CLI output');
        } catch (e) {
            throw new Error(`Failed to parse CLI JSON: ${e.message}`);
        }
    }

    spawn(args = []) {
        return spawn('ctx', args);
    }
}

module.exports = new CliService();
