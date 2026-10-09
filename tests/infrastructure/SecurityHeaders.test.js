/**
 * The page's Content Security Policy: WebAssembly allowed, JavaScript eval not.
 *
 * Holocron's layout engine is WebAssembly. Under `script-src 'self'` the
 * browser refused to compile it (a CSP CompileError), and Holocron silently
 * fell back to its basic layout everywhere. 'wasm-unsafe-eval' permits
 * compiling WebAssembly and nothing more; 'unsafe-eval' would also re-enable
 * eval() and new Function() for JavaScript, which nothing here needs.
 */
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const csp = (/'Content-Security-Policy',\s*"([^"]+)"/.exec(server) || [])[1] || '';
const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '').split(/\s+/).slice(1);

test('the policy is found, so the checks below are not vacuous', () => {
    expect(csp).toMatch(/default-src 'self'/);
});

test('scripts: same origin only, plus WebAssembly compilation', () => {
    expect(directive('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
});

test('JavaScript eval is never allowed', () => {
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
});
