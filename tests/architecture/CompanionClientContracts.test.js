/**
 * The companion clients (mobile app, VS Code extension) and the shared client
 * they call drifted from each other and from the linter, silently:
 *
 *  - shared/yodamanClient.d.ts declared 29 of the 45 methods the client returns,
 *    so a typed consumer could not call health(), readiness() or any stardust*().
 *  - The extension's src/ matched no ESLint block, so it was linted with no
 *    rules and an undefined `mode` in extension.js shipped in 0.6.6.
 *  - The extension packages its own copy of shared/ (copy-shared.js); a stale
 *    copy ships an old protocol.
 *
 * Each check below covers the whole class, not the one instance.
 */
const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');
const clientModule = require('../../shared/yodamanClient');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const clientMethods = Object.keys(clientModule.createYodaManClient('http://127.0.0.1:1'));

describe('shared/yodamanClient.d.ts', () => {
    const dts = read('shared/yodamanClient.d.ts');
    const iface = dts.match(/interface YodaManClient \{([\s\S]*?)\n\}/)[1];
    const declared = [...iface.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]);

    test('the scan reads both sides (so the checks below measure something)', () => {
        expect(clientMethods.length).toBeGreaterThan(30);
        expect(declared).toContain('runAgentTask');
    });

    test('declares every method createYodaManClient returns, and nothing else', () => {
        expect([...declared].sort()).toEqual([...clientMethods].sort());
    });

    test('declares every module export', () => {
        for (const name of Object.keys(clientModule)) {
            expect(dts).toMatch(new RegExp(`export (const|function) ${name}\\b`));
        }
    });
});

describe('companion clients call only methods the client has', () => {
    const callers = [
        'apps/mobile/App.js',
        'extensions/vscode-yodaman/src/extension.js',
        'extensions/vscode-yodaman/src/coreSurface.js'
    ];
    const calls = callers.flatMap((rel) =>
        [...read(rel).matchAll(/\b(?:client|getClient\(\))\.(\w+)\b/g)].map((m) => [rel, m[1]]));

    test('the scan finds calls in every caller', () => {
        for (const rel of callers) expect(calls.some(([file]) => file === rel)).toBe(true);
    });

    test.each(calls)('%s calls %s', (_rel, method) => {
        expect(clientMethods).toContain(method);
    });
});

describe('the extension packages an up-to-date copy of shared/', () => {
    const copyDir = 'extensions/vscode-yodaman/src/shared';
    const copies = fs.readdirSync(path.join(ROOT, copyDir));

    test('the copy includes the client', () => {
        expect(copies).toContain('yodamanClient.js');
    });

    // Fails after a shared/ change until `node extensions/vscode-yodaman/copy-shared.js` runs.
    test.each(copies)('%s equals shared/', (name) => {
        expect(read(`${copyDir}/${name}`)).toBe(read(`shared/${name}`));
    });
});

describe('every JavaScript source ESLint reaches is linted with rules', () => {
    const SKIP = new Set(['node_modules', '.git', 'dist', 'release', 'coverage', '.claude', 'graphify-out', 'ios', 'android']);
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        if (SKIP.has(entry.name)) return [];
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(c|m)?jsx?$/.test(entry.name) ? [full] : [];
    });

    test('no-undef is on for each of them', async () => {
        // The config is passed in, not loaded: ESLint loads its file with a
        // dynamic import(), which Jest refuses without --experimental-vm-modules.
        const eslint = new ESLint({ cwd: ROOT, overrideConfigFile: true, overrideConfig: require('../../eslint.config.js') });
        const unlinted = [];
        let checked = 0;
        for (const file of walk(ROOT)) {
            if (await eslint.isPathIgnored(file)) continue;
            checked += 1;
            const rule = (await eslint.calculateConfigForFile(file))?.rules?.['no-undef'];
            const severity = Array.isArray(rule) ? rule[0] : rule;
            if (!severity || severity === 'off') unlinted.push(path.relative(ROOT, file));
        }
        expect(checked).toBeGreaterThan(200);
        expect(unlinted).toEqual([]);
    }, 60000);
});
