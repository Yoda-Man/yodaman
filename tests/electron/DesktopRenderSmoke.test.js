/**
 * Black-screen regression guard.
 *
 * v0.4.1 shipped a desktop build whose window came up empty: `BarChart3` was used
 * in Stardust's TABS array without being imported, so the bundle threw a
 * ReferenceError while evaluating and React never mounted. The runtime was
 * healthy and every asset returned 200 — only an actual render proves the UI works.
 *
 * This boots the real runtime, points Electron at it exactly as electron/main.js
 * does, and fails unless #root has mounted children.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const PORT = Number(process.env.SMOKE_PORT || 3399);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const distIndex = path.join(rootDir, 'dist', 'index.html');
const hasBuild = fs.existsSync(distIndex);
// Electron needs a display; on a bare Linux CI box it must be wrapped in xvfb.
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY);

function get(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume();
            resolve(res.statusCode);
        });
        req.on('error', () => resolve(0));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(0);
        });
    });
}

async function waitForServer(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await get(`${BASE_URL}/`)) === 200) return true;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
}

function runProbe() {
    const electronBinary = require('electron');
    const probePath = path.join(__dirname, 'helpers', 'renderProbe.js');

    return new Promise((resolve, reject) => {
        const child = spawn(electronBinary, [probePath], {
            cwd: rootDir,
            env: { ...process.env, PROBE_URL: `${BASE_URL}/`, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

        child.on('error', reject);
        child.on('exit', () => {
            const line = stdout.split('\n').find((entry) => entry.startsWith('PROBE_RESULT '));
            if (!line) {
                reject(new Error(`probe produced no result.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
                return;
            }
            resolve(JSON.parse(line.slice('PROBE_RESULT '.length)));
        });
    });
}

// Without a build there is nothing to render, and without a display Electron
// cannot start — skip rather than report a failure that says nothing about the UI.
const maybeDescribe = hasBuild && hasDisplay ? describe : describe.skip;

maybeDescribe('desktop renders the dashboard', () => {
    let server;
    let serverUp = false;

    beforeAll(async () => {
        server = spawn(process.execPath, [path.join(rootDir, 'server.js')], {
            cwd: rootDir,
            env: { ...process.env, NODE_ENV: 'production', YODAMAN_PORT: String(PORT) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        serverUp = await waitForServer();
    }, 60000);

    afterAll(async () => {
        if (!server || server.killed) return;

        // Wait for the exit, and drop the stdio pipes — an open pipe keeps Jest's
        // event loop alive after the run finishes.
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(timer);
        server.stdout.destroy();
        server.stderr.destroy();
        // Longer than the SIGKILL fallback above. With Jest's default 5s hook
        // timeout the escalation could never actually run: it fired at the same
        // instant the hook was abandoned, so a runtime slow to exit under load
        // failed the whole suite after every test in it had already passed.
    }, 30000);

    test('the runtime serves the built frontend', () => {
        expect(serverUp).toBe(true);
    });

    test('React mounts into #root instead of leaving a black window', async () => {
        const result = await runProbe();

        // Surface the renderer's own errors — a bare "0 children" tells you nothing.
        expect(result.consoleErrors.filter((entry) => /is not defined|ReferenceError|SyntaxError|TypeError/.test(entry)))
            .toEqual([]);
        expect(result.failures).toEqual([]);
        expect(result.rootMissing).toBe(false);
        expect(result.rootChildren).toBeGreaterThan(0);
        expect(result.bodyTextLength).toBeGreaterThan(0);
    }, 120000);

    // Checked separately from the mount assertions above because the failure it
    // describes is the opposite of a blank page: #root is populated, body text is
    // long, every mount assertion passes — and the user is looking at a crash
    // card. An earlier version of this test reported the 0.4.2 boundary crash as
    // a healthy render for exactly that reason.
    test('the mounted UI is the app, not the error boundary', async () => {
        const result = await runProbe();

        expect(result.errorBoundary).toBeNull();
        expect(result.ok).toBe(true);
    }, 120000);
});

if (!hasBuild) {
     
    console.warn(`[DesktopRenderSmoke] skipped: no build at ${distIndex}. Run "npm run build" first.`);
}
if (!hasDisplay) {
     
    console.warn('[DesktopRenderSmoke] skipped: no DISPLAY. Run under xvfb-run to enable.');
}
