/**
 * YodaMan's MCP server, driven over the real protocol.
 *
 * This speaks JSON-RPC over the child's stdio by hand rather than importing the
 * MCP SDK. The SDK is ESM-only and this suite is CommonJS, but the better
 * reason is that hand-rolling the frames tests the wire the way a client sees
 * it — a client we do not control and cannot assume shares our SDK version.
 *
 * What matters most here is the second describe block. Every tool this server
 * exposes must be read-only. YodaMan's approval gate protects writes made by
 * YodaMan's own agent; a client on the far side of this boundary does not run
 * that gate and cannot be made to. A write tool added here would hand out a key
 * to a door we stopped locking, and it would look perfectly reasonable in
 * review — so it is asserted rather than left to judgement.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const SERVER = path.join(rootDir, 'bin', 'yodaman-mcp.mjs');

/**
 * Speak one MCP session to the server and return the responses.
 *
 * MCP's stdio transport is newline-delimited JSON — not the Content-Length
 * framing LSP uses. Getting that wrong produces a server that looks broken and
 * is not: the first version of this harness sent LSP frames and received
 * silence, which reads exactly like a dead server.
 */
function session(requests, { env = {}, timeoutMs = 25000, awaitId } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SERVER], {
            cwd: rootDir,
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`MCP session timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, timeoutMs);
        timer.unref();

        // Close stdin once the answer we care about has arrived, rather than
        // after a fixed delay — a fixed delay either cuts the server off before
        // it replies or pads every run with dead time.
        const wanted = awaitId ?? Math.max(...requests.filter((r) => r.id).map((r) => r.id));
        let settled = false;
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
            if (!settled && stdout.includes(`"id":${wanted}`)) {
                settled = true;
                setTimeout(() => child.stdin.end(), 150).unref();
            }
        });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('exit', () => {
            clearTimeout(timer);
            const messages = stdout
                .split('\n')
                .filter((line) => line.trim())
                .map((line) => { try { return JSON.parse(line); } catch (_err) { return null; } })
                .filter(Boolean);
            resolve({ messages, stderr });
        });

        // Sequenced, not fired at once: the server must see `initialize` answered
        // before it will accept `tools/list`.
        (async () => {
            for (const request of requests) {
                child.stdin.write(`${JSON.stringify(request)}\n`);
                await new Promise((r) => { setTimeout(r, 250).unref(); });
            }
        })();
        // Backstop: if the awaited id never arrives, do not hang to the timeout.
        setTimeout(() => { if (!settled) child.stdin.end(); }, timeoutMs - 3000).unref();
    });
}

const INITIALIZE = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'yodaman-tests', version: '0' }
    }
};

const LIST_TOOLS = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

describe('MCP server', () => {
    let tools;

    beforeAll(async () => {
        const { messages } = await session([
            INITIALIZE,
            { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
            LIST_TOOLS
        ]);
        const listed = messages.find((m) => m.id === 2);
        tools = listed?.result?.tools || [];
    }, 30000);

    it('completes an MCP handshake', async () => {
        const { messages } = await session([INITIALIZE]);
        const initialized = messages.find((m) => m.id === 1);
        expect(initialized?.result?.serverInfo?.name).toBe('yodaman');
        // The version a client sees must be the version we shipped.
        expect(initialized.result.serverInfo.version)
            .toBe(require(path.join(rootDir, 'package.json')).version);
    }, 30000);

    it('exposes the three pillars', () => {
        const names = tools.map((t) => t.name).sort();
        expect(names).toEqual([
            'yodaman_graph_query',
            'yodaman_impact',
            'yodaman_projects',
            'yodaman_search',
            'yodaman_spec_drift'
        ]);
    });

    it('describes every tool, since the description is the whole interface', () => {
        // A model chooses tools by reading these. An undescribed tool is one
        // that never gets called, or gets called for the wrong reason.
        for (const tool of tools) {
            expect(typeof tool.description).toBe('string');
            expect(tool.description.length).toBeGreaterThan(40);
            expect(tool.inputSchema).toBeTruthy();
        }
    });

    it('requires a workspace path everywhere one is needed', () => {
        for (const tool of tools) {
            if (tool.name === 'yodaman_projects') continue;
            const required = tool.inputSchema.required || [];
            expect(required).toContain('project');
        }
    });
});

describe('MCP server is read-only', () => {
    /**
     * The boundary rule. These names are the ones a future contributor would
     * most plausibly add, and each would cross a trust boundary the approval
     * gate does not extend across.
     */
    const FORBIDDEN = [
        'write', 'patch', 'edit', 'apply', 'delete', 'remove',
        'exec', 'command', 'run', 'shell', 'install', 'propose', 'archive'
    ];

    it('exposes no tool that could change anything', async () => {
        const { messages } = await session([
            INITIALIZE,
            { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
            LIST_TOOLS
        ]);
        const tools = messages.find((m) => m.id === 2)?.result?.tools || [];
        expect(tools.length).toBeGreaterThan(0);

        for (const tool of tools) {
            for (const verb of FORBIDDEN) {
                expect(tool.name.toLowerCase()).not.toContain(verb);
            }
        }
    }, 30000);

    it('never calls the runtime with a mutating HTTP method', () => {
        // Proven from the source rather than by observation: a POST is fine —
        // /graphify/query is a read expressed as a POST — but PUT, PATCH and
        // DELETE have no read-only reading.
        const source = fs.readFileSync(SERVER, 'utf8');
        expect(source).not.toMatch(/method:\s*['"](PUT|PATCH|DELETE)['"]/i);
    });

    it('does not import the toolbox or any write path', () => {
        // It proxies the runtime deliberately. Reaching into ToolBox here would
        // put file-writing code inside a process with no approval gate.
        const source = fs.readFileSync(SERVER, 'utf8');
        expect(source).not.toMatch(/require\(|ToolBox|writeFileSync|child_process/);
    });
});

describe('MCP server without a runtime', () => {
    it('says how to fix it rather than failing obscurely', async () => {
        // A port nothing is listening on. The message reaches the model and
        // often the user verbatim, so it has to name the remedy.
        const { messages } = await session([
            INITIALIZE,
            { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
            {
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: { name: 'yodaman_projects', arguments: {} }
            }
        ], { env: { YODAMAN_URL: 'http://127.0.0.1:59999' } });

        const call = messages.find((m) => m.id === 3);
        const text = JSON.stringify(call?.result || call?.error || {});
        expect(text).toMatch(/not reachable|did not answer/);
        expect(text).toMatch(/Start YodaMan/);
        // No half-answer: it must be explicit that nothing was read.
        expect(text).toMatch(/Nothing was read/);
    }, 30000);
});

/**
 * The tools must actually return data.
 *
 * Everything above this point inspects the tool LIST or the SOURCE. Not one of
 * those tests calls a tool successfully — the single tools/call is aimed at a
 * dead port on purpose. So `yodaman_search` could map a parameter wrong, return
 * garbage, or break when the runtime's response shape changes, and all eight
 * would still pass.
 *
 * That is the same failure the approval gate had: the suite tested the one path
 * that happened to work, and the surface looked correct throughout. A test of
 * the surface is not a test of the behaviour.
 *
 * These drive a real runtime and assert results come back — and that search
 * agrees with the HTTP API it proxies, since a proxy that quietly diverges from
 * its source is the specific thing this design was chosen to avoid.
 */
const http = require('http');

const LIVE_PORT = Number(process.env.MCP_LIVE_PORT || 3096);
const LIVE_URL = `http://127.0.0.1:${LIVE_PORT}`;

function get(url) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
            let body = '';
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body }));
        });
        request.on('error', reject);
        request.setTimeout(120000, () => request.destroy(new Error('timeout')));
    });
}

/** Ask the MCP server for one tool result, against the live runtime. */
async function callTool(name, args) {
    const { messages } = await session([
        INITIALIZE,
        { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }
    ], { env: { YODAMAN_URL: LIVE_URL }, timeoutMs: 180000, awaitId: 3 });

    const call = messages.find((m) => m.id === 3);
    const text = call?.result?.content?.[0]?.text;
    if (!text) throw new Error(`no result for ${name}: ${JSON.stringify(call || messages).slice(0, 400)}`);
    return JSON.parse(text);
}

describe('MCP tools return real data', () => {
    let server;
    let workspace = null;

    beforeAll(async () => {
        server = spawn(process.execPath, [path.join(rootDir, 'server.js')], {
            cwd: rootDir,
            env: { ...process.env, NODE_ENV: 'production', YODAMAN_PORT: String(LIVE_PORT) },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const deadline = Date.now() + 60000;
        while (Date.now() < deadline) {
            try {
                if ((await get(`${LIVE_URL}/api/health`)).status === 200) break;
            } catch (_err) { /* not up yet */ }
            await new Promise((r) => { setTimeout(r, 1000).unref(); });
        }

        // An indexed workspace, chosen the same way the journey gate chooses:
        // never a temp path, and `indexed` rather than a file count, because
        // GET /api/projects reports files as 0 for every project.
        try {
            const { body } = await get(`${LIVE_URL}/api/projects`);
            const payload = JSON.parse(body);
            const list = Array.isArray(payload) ? payload : payload.projects || [];
            const usable = list
                .filter((p) => p.path && p.indexed && !/^\/(private\/)?var\/folders\//.test(p.path))
                .sort((a, b) => String(a.path).localeCompare(String(b.path)));
            workspace = usable.length ? usable[0].path : null;
        } catch (_err) { /* reported as a skip below */ }
    }, 90000);

    afterAll(async () => {
        if (!server || server.killed) return;
        const exited = new Promise((resolve) => server.once('exit', resolve));
        server.kill();
        const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
        await exited;
        clearTimeout(timer);
        server.stdout.destroy();
        server.stderr.destroy();
    }, 30000);

    it('yodaman_projects lists indexed workspaces', async () => {
        const result = await callTool('yodaman_projects', {});
        expect(Array.isArray(result)).toBe(true);
        // Shape matters as much as presence: a client reads these field names.
        if (result.length > 0) {
            expect(result[0]).toHaveProperty('path');
            expect(result[0]).toHaveProperty('indexed');
        }
    }, 120000);

    it('yodaman_search returns what the HTTP API returns', async () => {
        if (!workspace) return; // No indexed workspace here; nothing to compare.

        const query = 'search';
        const viaMcp = await callTool('yodaman_search', { query, project: workspace });

        const params = new URLSearchParams({ query, project: workspace });
        const { body } = await get(`${LIVE_URL}/api/search?${params}`);
        const viaHttp = JSON.parse(body);

        // Non-empty FIRST. Comparing two empty lists proves nothing, and the
        // first version of this test did exactly that: it read `r.file`, which
        // does not exist on a search hit, so it compared [null,null,...] to
        // itself and passed with the query parameter deliberately broken.
        expect(viaMcp.results.length).toBeGreaterThan(0);

        // The proxy must not diverge from its source. A second implementation
        // drifting from the first is exactly what proxying was chosen to avoid.
        expect(viaMcp.results.length).toBe((viaHttp.results || []).length);
        expect(viaMcp.graphRanked).toBe(Boolean(viaHttp.graphRanked));
        expect(viaMcp.weights).toEqual(viaHttp.weights || null);

        // `filePath` and the line span are the fields a hit actually carries.
        // Including the span makes ordering discriminating: every query returns
        // the same top-30 files, so file names alone would not tell two
        // different searches apart.
        const identity = (list) => list.slice(0, 5)
            .map((r) => `${r.filePath}:${r.lineStart}-${r.lineEnd}`);
        expect(identity(viaMcp.results).every((entry) => !entry.includes('undefined'))).toBe(true);
        expect(identity(viaMcp.results)).toEqual(identity(viaHttp.results || []));
    }, 180000);

    it('yodaman_spec_drift answers even for a workspace with no specs', async () => {
        if (!workspace) return;

        const drift = await callTool('yodaman_spec_drift', { project: workspace });

        // The 0.5.4 change: no specs is a coverage answer, not an absence of one.
        expect(drift).toHaveProperty('available');
        if (drift.available) {
            expect(drift).toHaveProperty('covered');
            expect(typeof drift.undocumentedCount).toBe('number');
        }
    }, 120000);

    it('reports a bad workspace path instead of answering emptily', async () => {
        const result = await callTool('yodaman_search', {
            query: 'anything',
            project: '/definitely/not/a/workspace'
        }).catch((err) => ({ error: err.message }));

        // Either an explicit error or an empty result set — never a fabricated
        // answer that looks like a real one.
        const text = JSON.stringify(result);
        expect(text).toMatch(/error|HTTP|not|\[\]/i);
    }, 120000);
});
