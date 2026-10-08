/**
 * Every module in the product is used by the product.
 *
 * A file that only its own test imports is dead code with a green tick on it:
 * it costs reading time, review time and upgrade time, and its passing test
 * suggests a capability the product no longer has. backend/utils/queryClassifier.js
 * survived that way for months after the code/docs mode toggle it served was
 * removed; its test kept passing the whole time.
 *
 * A module counts as used when a non-test file names it in a require, an
 * import, or a config (package.json scripts, electron-builder, index.html,
 * Vite). Removing the last real user of a module now fails this test until the
 * module is removed too.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SOURCE_ROOTS = ['backend', 'shared', 'src', 'electron', 'bin', 'scripts', 'plugins'];
const CONFIG_FILES = ['server.js', 'start.js', 'index.html', 'package.json', 'electron-builder.json', 'vite.config.js'];
const SOURCE = /\.(c?js|mjs|jsx)$/;

function list(rel) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
        const child = path.join(rel, entry.name);
        if (entry.isDirectory()) return list(child);
        return SOURCE.test(entry.name) ? [child] : [];
    });
}

const modules = SOURCE_ROOTS.flatMap(list);
const readers = [...modules, ...CONFIG_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)))]
    .map((rel) => [rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')]);

function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Non-test files that refer to this module by its import path. */
function usersOf(rel) {
    const name = path.basename(rel).replace(SOURCE, '');
    const reference = new RegExp(`['"\`/]${escape(name)}(\\.(c?js|mjs|jsx))?['"\`]`);
    return readers.filter(([other, text]) => other !== rel && reference.test(text)).map(([other]) => other);
}

test('the scan sees the codebase', () => {
    expect(modules.length).toBeGreaterThan(100);
    expect(usersOf('backend/core/SearchPipeline.js').length).toBeGreaterThan(0);
});

test('no module is imported only by its own tests', () => {
    expect(modules.filter((rel) => usersOf(rel).length === 0)).toEqual([]);
});
