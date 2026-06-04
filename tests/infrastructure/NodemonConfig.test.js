const fs = require('fs');
const path = require('path');

describe('nodemon runtime stability config', () => {
    test('ignores generated runtime files that can restart chat and search requests', () => {
        const configPath = path.join(__dirname, '../../nodemon.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        expect(config.ignore).toEqual(expect.arrayContaining([
            'sessions.json',
            'audit-log.json',
            'audit-log.jsonl',
            'task-history.json',
            'task-history.jsonl',
            'yodaman.db*',
            'graphify-out/**',
            '**/graphify-out/**',
            'release/**',
            'website/downloads/**',
            'extensions/vscode-yodaman/*.vsix',
            '*.tgz'
        ]));
    });
});
