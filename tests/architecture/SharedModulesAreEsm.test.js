/**
 * Every module outside src/ that the UI imports must be an ES module.
 *
 * Vite's dev server serves source files to the browser as native ESM and does
 * not convert CommonJS, while `vite build` does. So a `module.exports` file
 * imported by src/ ships fine and leaves `npm run client` on a blank page:
 * "does not provide an export named 'hitLine'". That went unnoticed from 0.6.0,
 * when SearchWindow started importing shared/searchHits.js. The backend still
 * require()s these modules, which Node 24 does for ES modules.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

function sources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
    });
}

/** Files outside src/ reached by a relative import from src/. */
function importedFromOutsideSrc() {
    const found = new Set();
    for (const file of sources(SRC)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const [, spec] of text.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]/g)) {
            const target = path.resolve(path.dirname(file), spec);
            if (!target.startsWith(SRC + path.sep) && /\.(c?js|mjs)$/.test(target)) found.add(target);
        }
    }
    return [...found];
}

describe('modules the UI imports from outside src/', () => {
    const imported = importedFromOutsideSrc();

    test('the scan finds the shared modules (so the check below measures something)', () => {
        const rel = imported.map((file) => path.relative(ROOT, file));
        expect(rel).toEqual(expect.arrayContaining(['shared/searchHits.js', 'shared/pluginInvocation.js']));
    });

    test.each(imported.map((file) => [path.relative(ROOT, file), file]))('%s is an ES module', (_rel, file) => {
        const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        expect(code).not.toMatch(/\bmodule\.exports\b|\bexports\.\w+\s*=|\brequire\s*\(/);
        expect(code).toMatch(/^export\s/m);
    });
});
