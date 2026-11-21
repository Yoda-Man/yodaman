/**
 * setup.sh enforces the same minimums as the runtime: Node from package.json
 * "engines" and ctx from DependencyChecker's SERVICES.ctx.minVersion.
 *
 * It used to check only that each tool was on PATH, so a Node 22 or a ctx
 * 1.1.0 passed setup and failed later. setup.sh itself is never run here (it
 * installs software): its functions are loaded into bash and called against
 * fake `node` and `ctx` on a stub PATH.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SERVICES } = require('../../backend/infrastructure/DependencyChecker');

const ROOT = path.join(__dirname, '..', '..');
const SETUP = fs.readFileSync(path.join(ROOT, 'setup.sh'), 'utf8');
const unix = process.platform === 'win32' ? test.skip : test;

/** The minimums and function definitions of setup.sh, without its install steps. */
const DEFINITIONS = [
    ...(SETUP.match(/^[A-Z_]+_(?:MAJOR|VERSION)=.*$/gm) || []),
    ...(SETUP.match(/^[a-z_]+\(\) \{[\s\S]*?^\}$/gm) || [])
].join('\n');

function bash(snippet, fakes = {}, shell = '/bin/bash') {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-setup-'));
    try {
        for (const [name, version] of Object.entries(fakes)) {
            fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${version}"\n`, { mode: 0o755 });
        }
        execFileSync(shell, ['-c', `${DEFINITIONS}\n${snippet}`], { env: { PATH: `${bin}:/usr/bin:/bin` }, stdio: 'pipe' });
        return true;
    } catch (_err) {
        return false;
    } finally {
        fs.rmSync(bin, { recursive: true, force: true });
    }
}

describe('setup.sh minimum versions', () => {
    test('match the runtime\'s own minimums', () => {
        const engines = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node;
        expect(SETUP).toContain(`NODE_MIN_MAJOR=${engines.replace(/^>=\s*/, '')}`);
        expect(SETUP).toContain(`CTX_MIN_VERSION=${SERVICES.ctx.minVersion}`);
    });

    unix('the script parses', () => {
        expect(() => execFileSync('/bin/bash', ['-n', path.join(ROOT, 'setup.sh')])).not.toThrow();
    });

    unix.each([
        ['1.3.4', '1.3.4', true], ['1.10.0', '1.3.4', true], ['v24.0.0', '24', true], ['2.0', '1.3.4', true],
        ['1.3.3', '1.3.4', false], ['v22.11.0', '24', false], ['', '1.3.4', false], ['1.3.4-beta', '1.3.4', true]
    ])('version_at_least %p %p is %p', (have, need, expected) => {
        expect(bash(`version_at_least "${have}" "${need}"`)).toBe(expected);
    });

    // README says `sh setup.sh`, and /bin/sh need not be bash.
    (process.platform !== 'win32' && fs.existsSync('/bin/dash') ? test : test.skip)('the version checks work under a POSIX sh too', () => {
        expect(bash('version_at_least v24.1.0 24 && ! version_at_least 1.3.3 1.3.4', {}, '/bin/dash')).toBe(true);
    });

    unix.each([['v24.1.0', true], ['v22.11.0', false]])('Node %s passes: %p', (version, ok) => {
        expect(bash('node_version_ok', { node: version })).toBe(ok);
    });

    unix.each([['1.3.5', true], [SERVICES.ctx.minVersion, true], ['1.1.0', false]])('ctx %s passes: %p', (version, ok) => {
        expect(bash('ctx_version_ok', { ctx: version })).toBe(ok);
    });

    unix('a ctx that fails to start counts as too old, so it is reinstalled', () => {
        expect(bash('ctx_version_ok')).toBe(false);
    });

    test('an old ctx is reinstalled and an old Node stops setup with a clear message', () => {
        expect(SETUP).toMatch(/if check_cmd ctx && ctx_version_ok; then/);
        expect(SETUP).toMatch(/YodaMan needs Node\.js \$\{NODE_MIN_MAJOR\} or newer/);
    });
});
