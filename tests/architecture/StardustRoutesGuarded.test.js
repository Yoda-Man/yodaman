/**
 * Every /api/stardust route serves registered workspaces only, and every error
 * it sends carries a `code`.
 *
 * `/stardust/run` once took any `projectRoot`, so `propose` wrote an OpenSpec
 * tree into whatever folder a caller named, and most routes answered errors as
 * a bare `{ error }` the clients could not branch on. Both were per-route
 * habits, so the checks below cover every route, including ones added later.
 */
const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROUTES_FILE = path.join(__dirname, '..', '..', 'backend', 'interfaces', 'routes', 'stardustRoutes.js');
const router = require(ROUTES_FILE);

/** Every [method, path] the router registers. */
const routes = router.stack
    .filter(layer => layer.route)
    .flatMap(layer => Object.keys(layer.route.methods).map(method => [method.toUpperCase(), layer.route.path]));

describe('Stardust routes refuse unregistered workspaces', () => {
    let server;
    let baseUrl;
    let registered;
    let outside;
    let previousConfig;

    beforeAll(async () => {
        registered = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-guard-ws-'));
        outside = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-guard-out-'));
        previousConfig = process.env.YODAMAN_CONFIG_PATH;
        process.env.YODAMAN_CONFIG_PATH = path.join(registered, 'config.json');
        fs.writeFileSync(process.env.YODAMAN_CONFIG_PATH, JSON.stringify({ watchedDirectories: [registered] }));

        const app = express();
        app.use(express.json());
        app.use('/api', router);
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        if (previousConfig === undefined) delete process.env.YODAMAN_CONFIG_PATH;
        else process.env.YODAMAN_CONFIG_PATH = previousConfig;
        fs.rmSync(registered, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    test('the scan finds the routes (so the check below measures something)', () => {
        expect(routes).toEqual(expect.arrayContaining([['POST', '/stardust/run'], ['GET', '/stardust/board']]));
        expect(routes.length).toBeGreaterThanOrEqual(10);
    });

    test.each(routes)('%s %s', async (method, routePath) => {
        // Enough of a valid request that each route reaches its workspace check.
        const url = `${baseUrl}/api${routePath.replace(':name', 'some-change')}?${new URLSearchParams({ projectRoot: outside, spec: 'x', file: 'x.js' })}`;
        const body = { projectRoot: outside, action: 'propose', changeId: 'planted', status: 'ok' };
        const res = await fetch(url, method === 'GET' ? {} : {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });

        expect(res.status).toBe(404);
        expect((await res.json()).code).toBe('workspace_not_registered');
        expect(fs.readdirSync(outside)).toEqual([]);
    });
});

describe('Stardust route errors carry a code', () => {
    const source = fs.readFileSync(ROUTES_FILE, 'utf8');
    const lineOf = index => `stardustRoutes.js:${source.slice(0, index).split('\n').length}`;

    /** Top-level arguments of the call whose `(` is at `open`, skipping strings. */
    function callArguments(open) {
        const args = [];
        let depth = 0;
        let quote = null;
        let start = open + 1;
        for (let i = open; i < source.length; i += 1) {
            const ch = source[i];
            if (quote) {
                if (ch === '\\') i += 1;
                else if (ch === quote) quote = null;
            } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
            else if ('([{'.includes(ch)) depth += 1;
            else if (')]}'.includes(ch)) {
                depth -= 1;
                if (depth === 0) return [...args, source.slice(start, i)].map(arg => arg.trim()).filter(Boolean);
            } else if (ch === ',' && depth === 1) {
                args.push(source.slice(start, i));
                start = i + 1;
            }
        }
        throw new Error(`unclosed call at ${lineOf(open)}`);
    }

    const jsonErrors = [...source.matchAll(/\bjsonError\(/g)]
        .filter(match => !/function\s+$|\{\s*$/.test(source.slice(0, match.index)))
        .map(match => ({ at: lineOf(match.index), args: callArguments(match.index + match[0].length - 1) }));

    test('the scan finds the error responses (so the checks below measure something)', () => {
        expect(jsonErrors.length).toBeGreaterThanOrEqual(15);
        // A message holding commas is still one argument.
        expect(jsonErrors.find(call => call.args[2] === "'status must be ok, warn, or error'")?.args).toHaveLength(4);
    });

    test('no response status is set by hand, so every error goes through jsonError', () => {
        expect([...source.matchAll(/\bres\.status\(/g)].map(match => lineOf(match.index))).toEqual([]);
    });

    test('every jsonError passes a code', () => {
        expect(jsonErrors.filter(call => call.args.length < 4).map(call => call.at)).toEqual([]);
    });
});
