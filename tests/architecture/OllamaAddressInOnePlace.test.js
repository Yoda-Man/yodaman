/**
 * The Ollama address lives in one place: OllamaConfig.ollamaUrl(), which reads
 * OLLAMA_HOST the way ctx and the ollama CLI do.
 *
 * SearchSummary and DependencyChecker each had `http://127.0.0.1:11434` typed
 * in, so with OLLAMA_HOST set ctx answered from one server while the search
 * summary and the health checks asked another. A new hardcoded address in the
 * runtime or in the release-gate scripts fails here.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWED = path.join(ROOT, 'backend', 'infrastructure', 'OllamaConfig.js');

function sources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full);
        return /\.(c?js|mjs)$/.test(entry.name) ? [full] : [];
    });
}

describe('the Ollama address', () => {
    const files = [...['backend', 'shared', 'electron', 'bin', 'plugins', 'scripts'].flatMap((dir) => sources(path.join(ROOT, dir))), path.join(ROOT, 'server.js')];

    test('the scan covers the runtime (so the check below measures something)', () => {
        expect(files).toEqual(expect.arrayContaining([ALLOWED, path.join(ROOT, 'backend', 'core', 'SearchSummary.js'), path.join(ROOT, 'scripts', 'plugin-smoke.js')]));
        expect(fs.readFileSync(ALLOWED, 'utf8')).toMatch(/11434/);
    });

    test('is written only in OllamaConfig', () => {
        const offenders = files.filter((file) => file !== ALLOWED && /:11434\b/.test(fs.readFileSync(file, 'utf8')));
        expect(offenders.map((file) => path.relative(ROOT, file))).toEqual([]);
    });
});
