const fs = require('fs');
const path = require('path');

/**
 * YodaMan Plugin: listDependencies
 * 
 * Scans package.json and returns a list of dependencies.
 */
module.exports = {
    name: 'listDependencies',
    description: 'Lists all NPM dependencies and their versions from package.json in the current project.',
    parameters: {},
    async execute() {
        const pkgPath = path.resolve(process.cwd(), 'package.json');
        if (!fs.existsSync(pkgPath)) {
            return { error: 'package.json not found in the current directory.' };
        }

        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            return {
                dependencies: pkg.dependencies || {},
                devDependencies: pkg.devDependencies || {}
            };
        } catch (err) {
            return { error: `Failed to parse package.json: ${err.message}` };
        }
    }
};
