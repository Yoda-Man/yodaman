/**
 * Every runtime call from the UI goes through src/api/api.js.
 *
 * api.js prefixes each URL with VITE_YODAMAN_API_BASE, so a client pointed at a
 * runtime on another origin reaches it. A hand-written '/api/...' URL in a
 * component bypasses that and quietly talks to the page's own origin instead:
 * the health poll, Dashboard and Impact Analysis all did, until 0.6.7.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const API_MODULE = path.join(ROOT, 'src', 'api', 'api.js');

function sources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full);
        return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
    });
}

// A string or template literal that starts with /api, or a template part
// `${host}/api/...` building one by hand.
const HAND_BUILT_API_URL = /['"`]\/api(?=[/'"`?])|\}\/api\//;

const files = [...sources(path.join(ROOT, 'src')), ...sources(path.join(ROOT, 'frontend'))];

test('the pattern matches the URLs api.js itself builds (so the scan measures something)', () => {
    expect(fs.readFileSync(API_MODULE, 'utf8')).toMatch(/['"`]\/api['"`]/);
    expect("fetch('/api/health')").toMatch(HAND_BUILT_API_URL);
    expect('fetch(`/api/stardust/compose?${params}`)').toMatch(HAND_BUILT_API_URL);
    expect('`${protocol}//${host}/api/stardust/live`').toMatch(HAND_BUILT_API_URL);
});

test.each(files.filter((file) => file !== API_MODULE).map((file) => [path.relative(ROOT, file), file]))(
    '%s builds no /api URL by hand',
    (_rel, file) => {
        const offending = fs.readFileSync(file, 'utf8').split('\n')
            .map((line, i) => `${i + 1}: ${line.trim()}`)
            .filter((line) => HAND_BUILT_API_URL.test(line) && !/^\d+: (\/\/|\*|\/\*)/.test(line));
        expect(offending).toEqual([]);
    }
);
