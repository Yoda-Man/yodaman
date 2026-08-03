const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');

// sessions.json (local chat history) was committed to a public repository.
// These files hold user data and must never be tracked again.
const USER_DATA_FILES = [
    'sessions.json',
    'yodaman.db',
    'config.json',
    'audit-log.json',
    'audit-log.jsonl',
    'task-history.json',
    'task-history.jsonl'
];

function isTracked(relativePath) {
    try {
        execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
            cwd: rootDir,
            stdio: ['ignore', 'ignore', 'ignore']
        });
        return true;
    } catch {
        return false;
    }
}

describe('Repository hygiene', () => {
    const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

    test.each(USER_DATA_FILES)('%s is listed in .gitignore', (file) => {
        expect(gitignore).toContain(file);
    });

    test.each(USER_DATA_FILES)('%s is not tracked by git', (file) => {
        expect(isTracked(file)).toBe(false);
    });

    test('the published npm package excludes user data', () => {
        const { files } = require(path.join(rootDir, 'package.json'));
        // An allowlist is what keeps user data out of the tarball — a plain
        // .npmignore would be easy to fall out of sync with new data files.
        expect(Array.isArray(files)).toBe(true);
        for (const file of USER_DATA_FILES) {
            expect(files).not.toContain(file);
        }
    });
});
