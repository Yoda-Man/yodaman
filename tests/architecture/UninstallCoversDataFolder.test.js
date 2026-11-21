/**
 * `yodaman uninstall` names every state file the runtime keeps in the data folder.
 *
 * 0.6.4 moved sessions.json and the audit/task JSON fallbacks into the data
 * folder (DataPaths.dataFile), which `npm uninstall` keeps, but the uninstall
 * plan went on naming only config.json and yodaman.db. Any new `dataFile('x')`
 * must be added to DATA_FOLDER_STATE in shared/generatedPaths.js too.
 */
const fs = require('fs');
const path = require('path');
const { DATA_FOLDER_STATE } = require('../../shared/generatedPaths');

const ROOT = path.join(__dirname, '..', '..');

function sources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

const named = [...sources(path.join(ROOT, 'backend')), path.join(ROOT, 'server.js')]
    .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/\bdataFile\(\s*['"]([^'"]+)['"]/g)]
        .map((m) => [m[1], path.relative(ROOT, file)]));

test('the scan finds the stores that use dataFile (so the check below measures something)', () => {
    expect(named.map(([name]) => name)).toEqual(expect.arrayContaining(['sessions.json', 'audit-log.jsonl', 'task-history.jsonl']));
});

test.each(named)('%s (from %s) is in DATA_FOLDER_STATE', (name) => {
    expect(DATA_FOLDER_STATE).toContain(name);
});

test('the CLI hands every one of them to the planner', () => {
    const cli = fs.readFileSync(path.join(ROOT, 'bin', 'yodaman.js'), 'utf8');
    expect(cli).toMatch(/DATA_FOLDER_STATE\.map\(\(name\) => dataPaths\.dataFile\(name\)\)/);
});
