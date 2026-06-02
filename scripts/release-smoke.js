const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const requiredFiles = [
    'README.md',
    'package.json',
    'server.js',
    'start.js',
    'shared/yodamanClient.js',
    'shared/yodamanClient.d.ts',
    'shared/yodamanProtocol.js',
    'shared/yodamanProtocol.d.ts',
    'backend/interfaces/RestController.js',
    'backend/infrastructure/TaskStore.js',
    'backend/infrastructure/Database.js',
    'docs/support-handover.md',
    'extensions/vscode-yodaman/package.json',
    'extensions/vscode-yodaman/README.md',
    'apps/mobile/README.md',
    'apps/mobile/App.js',
    'electron-builder.json'
];

const checkFiles = [
    'server.js',
    'start.js',
    'shared/yodamanClient.js',
    'shared/yodamanProtocol.js',
    'backend/interfaces/RestController.js',
    'backend/infrastructure/AuditLog.js',
    'backend/infrastructure/TaskStore.js',
    'backend/infrastructure/Database.js',
    'backend/infrastructure/ToolBox.js',
    'extensions/vscode-yodaman/src/extension.js',
    'electron/main.js',
    'scripts/release-smoke.js'
];

function assertFile(relativePath) {
    const fullPath = path.join(root, relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Missing release file: ${relativePath}`);
    }
}

function runNodeCheck(relativePath) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, relativePath)], {
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        throw new Error(`node --check failed for ${relativePath}\n${result.stderr || result.stdout}`);
    }
}

function main() {
    requiredFiles.forEach(assertFile);
    checkFiles.forEach(runNodeCheck);

    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const files = new Set(pkg.files || []);
    ['bin', 'dist', 'backend', 'shared', 'server.js', 'start.js', 'public', 'docs/*.md', 'README.md', 'config.example.json'].forEach((entry) => {
        if (!files.has(entry)) {
            throw new Error(`package.json files is missing ${entry}`);
        }
    });

    // Verify Database.js and SQLite initialization if supported
    const dbHelper = require(path.join(root, 'backend/infrastructure/Database.js'));
    if (typeof dbHelper.useSqlite !== 'boolean') {
        throw new Error('Database.js did not export useSqlite boolean');
    }

    console.log('Release smoke checks passed.');
}

main();
