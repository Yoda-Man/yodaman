/**
 * The CLI's argument handling, tested by actually running the binary.
 *
 * THE BUG THIS EXISTS FOR:
 *
 * `bin/yodaman.js` handled exactly one command — `create-plugin`. Everything
 * else, including `--help`, `--version` and `-h`, fell through the whole file
 * and reached the `spawn('node', [serverPath])` at the bottom. A user typing
 * `yodaman --help` got a running server on port 3090 and no help text.
 *
 * It survived because nothing tested the CLI at all. The docs quietly worked
 * around it: SECURITY.md and the bug-report template ask for a version via
 * `npm list -g yodaman` rather than the obvious `yodaman --version`.
 *
 * WHY THIS ASSERTS ON MORE THAN THE OUTPUT:
 *
 * Checking that `--help` prints help would pass while the server ALSO started
 * behind it — which is precisely the failure. So the real assertions are that
 * the process exits by itself and prints no start banner.
 *
 * KILLING THE PROCESS GROUP, NOT THE PROCESS:
 *
 * `yodaman` with no arguments spawns `server.js` as a CHILD. The first version
 * of this file killed the CLI and left that grandchild running — a test that
 * leaked a live server onto port 3090 and then poisoned its own `--help`
 * assertion on the next run. Everything here is spawned detached and killed by
 * process group so nothing survives the suite.
 */
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const CLI = path.join(__dirname, '..', '..', 'bin', 'yodaman.js');
const RUNTIME_PORT = 3090;

/** True if something is accepting connections on the port. */
function portIsOpen(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ port, host: '127.0.0.1' });
        const done = (answer) => { socket.destroy(); resolve(answer); };
        socket.setTimeout(1500);
        socket.on('connect', () => done(true));
        socket.on('error', () => done(false));
        socket.on('timeout', () => done(false));
    });
}

/**
 * Run the CLI and resolve with what it did.
 *
 * Rejects nothing: "it never exited" is a RESULT here, not an error, because
 * that is the bug being tested for.
 *
 * @param {string[]} args
 * @param {object}   options
 * @param {number}   options.timeoutMs   Give up and kill the group after this.
 * @param {RegExp}   options.stopOnStdout Kill as soon as stdout matches, so a
 *                   test that only needs to see a banner does not have to wait
 *                   out the full timeout with a server running.
 */
function runCli(args, { timeoutMs = 15000, stopOnStdout = null } = {}) {
    return new Promise((resolve) => {
        // detached:true puts the child in its own process group, so killing
        // -pid reaps anything it spawned. Without this, `server.js` outlives us.
        const child = spawn(process.execPath, [CLI, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
            env: { ...process.env, NODE_ENV: 'test' }
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const killGroup = () => {
            try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {
                // Already gone, or never became a group leader. Fall back to
                // the direct kill; failing to kill something already dead is
                // not an error worth surfacing.
                try { child.kill('SIGKILL'); } catch (_e) { /* nothing left */ }
            }
        };

        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            killGroup();
            // A moment for the group to actually die before the next test
            // asks whether the port is free.
            setTimeout(() => resolve(result), 250);
        };

        const timer = setTimeout(() => finish({ stdout, stderr, code: null, timedOut: true }), timeoutMs);

        child.stdout.on('data', (d) => {
            stdout += d;
            if (stopOnStdout && stopOnStdout.test(stdout)) {
                finish({ stdout, stderr, code: null, timedOut: false, stoppedEarly: true });
            }
        });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('exit', (code) => finish({ stdout, stderr, code, timedOut: false }));
    });
}

describe('yodaman --help', () => {
    let result;
    let portWasOpenBefore;
    let portOpenAfter;

    beforeAll(async () => {
        // Recorded first: a developer running `npm run dev` in another terminal
        // would otherwise make this fail for a reason that is not the bug.
        portWasOpenBefore = await portIsOpen(RUNTIME_PORT);
        result = await runCli(['--help']);
        portOpenAfter = await portIsOpen(RUNTIME_PORT);
    }, 40000);

    it('exits on its own', () => {
        // The original bug: it never exited, because it had started a server.
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(0);
    });

    it('does not print the runtime start banner', () => {
        // The banner appearing here means it fell through to the spawn again.
        // This is the assertion that survives on any machine.
        expect(result.stdout).not.toMatch(/Starting YodaMan/);
    });

    it('starts nothing listening on the runtime port', () => {
        if (portWasOpenBefore) {
            // Something was already serving before this test ran, so the port
            // says nothing about what --help did. Skipping is honest; asserting
            // either way here would be measuring the developer's terminal.
            return;
        }
        expect(portOpenAfter).toBe(false);
    });

    it('prints usage naming the real commands', () => {
        expect(result.stdout).toMatch(/yodaman setup/);
        expect(result.stdout).toMatch(/yodaman doctor/);
        expect(result.stdout).toMatch(/create-plugin/);
    });
});

describe('yodaman --version', () => {
    const { version } = require('../../package.json');

    it('prints the version from package.json and exits', async () => {
        const result = await runCli(['--version']);
        expect(result.timedOut).toBe(false);
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe(version);
    }, 40000);

    it('prints the version and NOTHING else', async () => {
        // The CLI used to require GraphifyDoctor and DependencyDoctor at the
        // top of the file, which pulls in the toolbox, the plugin registry and
        // the logger — all of which write to stdout as they initialise. The
        // version came out preceded by JSON log lines.
        //
        // It passed locally, where the logger was quiet, and failed in CI where
        // it was not. Asserting the exact output is what makes that difference
        // impossible to miss again: a flag that answers a question about the
        // CLI must not boot the product to answer it.
        const result = await runCli(['--version']);
        expect(result.stdout).toBe(`${version}\n`);
        expect(result.stdout).not.toMatch(/timestamp|toolbox_plugin_loaded|ctx_binary/);
    }, 40000);

    it('accepts -v as well', async () => {
        const result = await runCli(['-v']);
        expect(result.stdout.trim()).toBe(version);
    }, 40000);
});

describe('yodaman setup --dry-run', () => {
    it('reports without installing anything', async () => {
        const result = await runCli(['setup', '--dry-run'], { timeoutMs: 60000 });

        expect(result.timedOut).toBe(false);
        expect(result.stdout).toMatch(/Checking what YodaMan needs/);
        // Either everything is already present, or it says what it WOULD do.
        // Both are valid depending on the machine; neither installs.
        expect(result.stdout).toMatch(/already installed|Dry run|Will install/i);
        // The arrow prefix is only printed when a command is actually executed.
        expect(result.stdout).not.toMatch(/^→ npm install/m);
    }, 90000);
});

describe('yodaman uninstall', () => {
    const fs = require('fs');
    const osmod = require('os');

    it('is a dry run by default and deletes nothing', async () => {
        // The assertion that matters is not the wording — it is that a real
        // directory survives. Create one, run the command, confirm it is still
        // there. A test that only checked the output would pass while the
        // command happily deleted things.
        const sentinel = fs.mkdtempSync(path.join(osmod.tmpdir(), 'yodaman-uninstall-test-'));
        const generated = path.join(sentinel, 'graphify-out');
        fs.mkdirSync(generated);
        fs.writeFileSync(path.join(generated, 'graph.json'), '{}');

        try {
            const result = await runCli(['uninstall'], { timeoutMs: 30000 });

            expect(result.timedOut).toBe(false);
            expect(result.code).toBe(0);
            expect(result.stdout).toMatch(/Nothing was deleted|Nothing generated by YodaMan/);
            // Still there.
            expect(fs.existsSync(path.join(generated, 'graph.json'))).toBe(true);
        } finally {
            fs.rmSync(sentinel, { recursive: true, force: true });
        }
    }, 60000);

    it('never offers to delete the user\'s specs', async () => {
        const result = await runCli(['uninstall'], { timeoutMs: 30000 });

        // Only the "Would remove:" block. Splitting on "You will need" was
        // wrong: the "Kept — yours, not YodaMan's" section sits between them
        // and legitimately names openspec, so the slice included the very
        // section that proves the protection works and failed on it.
        const start = result.stdout.indexOf('Would remove:');
        const endMarkers = ['Kept —', 'Skipped:', 'You will need'];
        const ends = endMarkers.map((m) => result.stdout.indexOf(m)).filter((i) => i > start);
        const wouldRemove = start === -1
            ? ''
            : result.stdout.slice(start, ends.length ? Math.min(...ends) : undefined);

        expect(wouldRemove).not.toMatch(/openspec/);
        // And prove the slice was not empty, or this passes vacuously.
        expect(result.stdout).toMatch(/Would remove:|Nothing generated by YodaMan/);
    }, 60000);

    it('states that source code is untouched', async () => {
        const result = await runCli(['uninstall'], { timeoutMs: 30000 });
        expect(result.stdout).toMatch(/source code is never touched/i);
    }, 60000);
});

describe('bare `yodaman` still starts the runtime', () => {
    it('takes the runtime path rather than printing help', async () => {
        // Documented behaviour: user_manual.md tells people to run `yodaman`
        // from Terminal when the runtime is unreachable. An early version of
        // the help handling matched `args.length === 0` and broke exactly this,
        // which is why the assertion is here rather than in a comment.
        //
        // stopOnStdout kills the group the instant the banner appears, so the
        // runtime exists for milliseconds and nothing is left behind.
        const result = await runCli([], {
            timeoutMs: 20000,
            stopOnStdout: /Starting YodaMan/
        });

        expect(result.stdout).toMatch(/Starting YodaMan/);
        expect(result.stdout).not.toMatch(/Options\s+--help/);
    }, 40000);

    it('leaves nothing running afterwards', async () => {
        // The fault in the first version of this file, now asserted.
        expect(await portIsOpen(RUNTIME_PORT)).toBe(false);
    }, 20000);
});
