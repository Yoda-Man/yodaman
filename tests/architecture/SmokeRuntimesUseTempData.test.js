/**
 * Every script or test that starts the runtime gives it a throwaway data folder.
 *
 * plugin-smoke.js and the desktop render smokes started server.js with the
 * user's environment, so the runtime they booted wrote sessions, task history
 * and the audit log into the developer's real data folder (DataPaths.dataDir).
 * packaged-smoke.js already passed YODAMAN_DATA_DIR; this makes that the rule
 * for every spawn of server.js or the CLI that launches it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : files(full);
        return /\.(c?js|mjs)$/.test(entry.name) ? [full] : [];
    });
}

/** Comments describe old bugs (`spawn('node', [serverPath])`); only code counts. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\w])\/\/.*$/gm, '$1');

/** The text of each `spawn(...)` call, parentheses balanced. */
function spawnCalls(text) {
    const calls = [];
    for (const match of text.matchAll(/\bspawn\(/g)) {
        let depth = 0;
        for (let i = match.index + 'spawn'.length; i < text.length; i += 1) {
            if (text[i] === '(') depth += 1;
            if (text[i] === ')' && --depth === 0) { calls.push(text.slice(match.index, i + 1)); break; }
        }
    }
    return calls;
}

// server.js itself, a variable holding its path, or the CLI that spawns it.
const STARTS_RUNTIME = /server\.js|\bserverPath\b|\bCLI\b/;

const starters = [...files(path.join(ROOT, 'scripts')), ...files(path.join(ROOT, 'tests'))]
    .filter((file) => file !== __filename)
    .flatMap((file) => spawnCalls(withoutComments(fs.readFileSync(file, 'utf8')))
        .filter((call) => STARTS_RUNTIME.test(call))
        .map((call) => [path.relative(ROOT, file), call]));

test('the scan finds the runtime spawns (so the check below measures something)', () => {
    const where = new Set(starters.map(([file]) => file));
    expect([...where]).toEqual(expect.arrayContaining([
        'scripts/plugin-smoke.js', 'scripts/packaged-smoke.js', 'tests/electron/DesktopRenderSmoke.test.js'
    ]));
});

test.each(starters)('%s gives the runtime its own YODAMAN_DATA_DIR', (_file, call) => {
    expect(call).toMatch(/YODAMAN_DATA_DIR/);
});
