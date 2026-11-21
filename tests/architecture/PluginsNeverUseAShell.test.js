/**
 * No bundled plugin runs a command through a shell.
 *
 * lightsaber built `grep ... "${workspacePath}"` and `find "${workspacePath}"`
 * strings for child_process.exec, so a workspace path holding `"$(...)"` ran
 * as a command. Plugin parameters come from the agent, so commands must go to
 * execFile or spawn as an argument array, without `shell: true`.
 */
const fs = require('fs');
const path = require('path');

const PLUGINS = path.join(__dirname, '..', '..', 'plugins');

function sources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return /\.(c?js|mjs)$/.test(entry.name) && !entry.name.endsWith('.test.js') ? [full] : [];
    });
}

const SHELL = [
    // const { exec } = require('child_process') / execSync, in any order
    /\{[^}]*\bexec(?:Sync)?\b(?!File)[^}]*\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/,
    // require('child_process').exec(...) / cp.execSync(...)
    /\.\s*exec(?:Sync)?\s*\(\s*[`'"]/,
    /promisify\(\s*exec\s*\)/,
    /\bshell\s*:\s*true\b/
];

const files = sources(PLUGINS);

test('the scan reads the bundled plugins (so the check below measures something)', () => {
    expect(files.map((f) => path.basename(f))).toEqual(expect.arrayContaining(['lightsaber.js', 'CodeTrooper.js']));
});

test.each(files.map((f) => [path.relative(PLUGINS, f), f]))('%s never hands a command string to a shell', (_rel, file) => {
    const code = fs.readFileSync(file, 'utf8');
    for (const pattern of SHELL) expect(code).not.toMatch(pattern);
});
