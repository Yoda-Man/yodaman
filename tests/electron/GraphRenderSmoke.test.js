/**
 * Prove Graph Studio can actually draw a graph before shipping.
 *
 * The bug this exists to prevent shipped in 0.5.1 and reached a user. Graphify
 * emits its rendering library as a CDN tag carrying a subresource-integrity
 * hash. YodaMan rewrites the `src` to a vendored copy so the app works offline
 * — but left the `integrity` hash in place, and the vendored copy is a
 * different build (vis-network was upgraded 9.x -> 10.1.1 to clear a
 * vulnerability). The hashes could not match by construction, so the browser
 * blocked the script, `vis` was never defined, and Graph Studio showed an empty
 * canvas while reporting "Graph ready — 2804 nodes / 3151 links".
 *
 * Every existing check passed. The endpoint returned 200 with 2.1MB of correct
 * HTML; the data was never the problem. Nothing asserted that a browser could
 * run it.
 *
 * So this drives a real Electron window, exactly like DesktopRenderSmoke, and
 * asserts the library executed and produced a canvas. The fixture goes through
 * the REAL localiser, so a future change that reintroduces a stale hash — or
 * points at a CDN, or vendors an incompatible build — fails here rather than in
 * someone's Graph tab.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const rootDir = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.GRAPH_RENDER_PORT || 3099);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** The tag Graphify actually emits, hash and all. Keep this realistic. */
const GRAPHIFY_SCRIPT_TAG = '<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"\n'
    + '        integrity="sha384-Ux6phic9PEHJ38YtrijhkzyJ8yQlH8i/+buBR8s3mAZOJrP1gwyvAcIYl3GWtpX1"\n'
    + '        crossorigin="anonymous"></script>';

function fixtureHtml() {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>graph fixture</title>
${GRAPHIFY_SCRIPT_TAG}
</head><body><div id="graph" style="width:800px;height:600px"></div>
<script>
  const nodes = new vis.DataSet([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
  const edges = new vis.DataSet([{ from: 1, to: 2 }]);
  const network = new vis.Network(document.getElementById('graph'), { nodes, edges }, {});
</script>
</body></html>`;
}

function get(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
            let body = '';
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body }));
        });
        request.on('error', reject);
        request.setTimeout(5000, () => { request.destroy(new Error('timeout')); });
    });
}

async function waitForServer(deadlineMs = 45000) {
    const started = Date.now();
    while (Date.now() - started < deadlineMs) {
        try {
            const { status } = await get(`${BASE_URL}/api/health`);
            if (status === 200) return true;
        } catch (_err) {
            // Not up yet — the loop is the retry.
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
}

function runProbe(fileUrl) {
    const electronBinary = require('electron');
    const probePath = path.join(__dirname, 'helpers', 'graphProbe.js');

    return new Promise((resolve, reject) => {
        const child = spawn(electronBinary, [probePath], {
            cwd: rootDir,
            env: { ...process.env, PROBE_URL: fileUrl, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
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

// Electron cannot run headless in every CI image; the desktop suite has the
// same guard. Skipping is honest here because the packaged gate still runs.
const canRunElectron = (() => {
    try {
        require('electron');
        return process.platform === 'darwin' || Boolean(process.env.DISPLAY);
    } catch (_err) {
        return false;
    }
})();

const maybeDescribe = canRunElectron ? describe : describe.skip;

maybeDescribe('Graph Studio renders', () => {
    let server;
    let serverUp = false;
    let workDir;

    beforeAll(async () => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-render-'));
        server = spawn(process.execPath, [path.join(rootDir, 'server.js')], {
            cwd: rootDir,
            env: { ...process.env, NODE_ENV: 'production', YODAMAN_PORT: String(PORT) },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        serverUp = await waitForServer();
    }, 60000);

    afterAll(async () => {
        if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
        if (!server || server.killed) return;
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(timer);
        server.stdout.destroy();
        server.stderr.destroy();
        // Longer than the SIGKILL fallback, so the escalation can actually run.
    }, 30000);

    it('serves the vendored rendering library', async () => {
        expect(serverUp).toBe(true);
        const { status, body } = await get(`${BASE_URL}/vendor/vis-network.min.js`);
        expect(status).toBe(200);
        // A stub or an error page would still be 200; require real bulk.
        expect(body.length).toBeGreaterThan(100000);
    });

    it('draws a graph in a real browser', async () => {
        expect(serverUp).toBe(true);

        // Through the real localiser, so this fails if it ever leaves a stale
        // integrity hash behind or stops rewriting the CDN URL.
        const { localizeVendorScripts } = require('../../backend/infrastructure/GraphifyService');
        const localized = localizeVendorScripts(fixtureHtml());

        expect(localized).not.toContain('unpkg.com');
        expect(localized).toContain('/vendor/vis-network.min.js');

        // The page is loaded from disk, so point the vendor path at the runtime.
        const loadable = localized.replace(/"\/vendor\//g, `"${BASE_URL}/vendor/`);
        const file = path.join(workDir, 'graph.html');
        fs.writeFileSync(file, loadable, 'utf8');

        const result = await runProbe(`file://${file}`);

        // Report the browser's own reason rather than a bare false.
        expect({ errors: result.consoleErrors, failures: result.failures, canvases: result.canvases })
            .toEqual({ errors: [], failures: [], canvases: result.canvases });
        expect(result.visDefined).toBe(true);
        expect(result.hasNetwork).toBe(true);
        expect(result.hasDataSet).toBe(true);
        expect(result.canvases).toBeGreaterThan(0);
        expect(result.ok).toBe(true);
    }, 90000);
});
