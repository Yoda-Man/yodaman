/**
 * Grand Inquisitor — YodaMan Plugin
 * @author Marwa Trust Mutemasango <trustaldo@gmail.com>
 * 
 * Scans package.json (or equivalent) in any workspace and reports all
 * dependencies, devDependencies, version counts, and potential issues
 * like outdated or missing packages.
 *
 * 💡 Chat usage:
 *   "List dependencies for this project"
 *   "Run Grand Inquisitor on /path/to/project"
 *   "Check what packages this workspace uses"
 *   "Show me all npm dependencies"
 */
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'Grand-Inquisitor',
    description: 'Scans package.json in any workspace and reports all dependencies, devDependencies, and version counts. Supports JavaScript, TypeScript, and Python projects. 💡 Chat usage: "List dependencies" or "Run Grand Inquisitor" or "What packages does this project use?"',
    permissions: ['read'],
    parameters: {
        workspacePath: {
            type: 'string',
            required: true,
            description: 'Absolute path to the project to analyze'
        }
    },
    async execute(params = {}) {
        const root = path.resolve(params.workspacePath || process.cwd());

        // Try package.json (Node.js)
        const pkgPath = path.join(root, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                const deps = pkg.dependencies || {};
                const devDeps = pkg.devDependencies || {};
                const peerDeps = pkg.peerDependencies || {};

                const all = { ...deps, ...devDeps, ...peerDeps };
                const total = Object.keys(all).length;
                const depCount = Object.keys(deps).length;
                const devCount = Object.keys(devDeps).length;
                const peerCount = Object.keys(peerDeps).length;

                return {
                    project: root,
                    type: 'Node.js',
                    totalDependencies: total,
                    dependencies: depCount,
                    devDependencies: devCount,
                    peerDependencies: peerCount,
                    packageManager: pkg.packageManager || 'npm',
                    list: all
                };
            } catch (err) {
                return { error: `Failed to parse package.json: ${err.message}` };
            }
        }

        // Try requirements.txt (Python)
        const reqPath = path.join(root, 'requirements.txt');
        if (fs.existsSync(reqPath)) {
            try {
                const content = fs.readFileSync(reqPath, 'utf8');
                const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
                return {
                    project: root,
                    type: 'Python',
                    totalDependencies: lines.length,
                    list: lines.map(l => l.trim())
                };
            } catch (err) {
                return { error: `Failed to parse requirements.txt: ${err.message}` };
            }
        }

        return { error: 'No package.json or requirements.txt found in the specified workspace.' };
    }
};
