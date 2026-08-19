const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

/**
 * stardustRoutes is 614 lines and had no tests, which matters most for one
 * reason: the H-1 path-traversal fix from the August audit lives in here.
 * `proposeChange` builds a directory path from a caller-supplied name, so a name
 * containing separators or `..` would write outside the workspace.
 *
 * Nothing asserted that it refuses. These tests are the regression guard for
 * that finding, plus coverage of the read routes support will actually call.
 */
describe('Stardust routes', () => {
    let server;
    let baseUrl;
    let workspace;

    beforeAll(async () => {
        workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-stardust-'));

        const app = express();
        app.use(express.json());
        app.use('/api', require('../../backend/interfaces/routes/stardustRoutes'));

        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        fs.rmSync(workspace, { recursive: true, force: true });
    });

    const post = async (pathname, body) => {
        const res = await fetch(`${baseUrl}${pathname}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const get = async (pathname) => {
        const res = await fetch(`${baseUrl}${pathname}`);
        return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    // ── H-1 regression guard ────────────────────────────────────────────
    describe('proposeChange rejects path traversal', () => {
        test.each([
            ['a parent traversal', '../escaped'],
            ['a nested traversal', '../../etc/passwd'],
            ['a forward slash', 'nested/name'],
            ['a backslash', 'nested\\name'],
            ['a traversal in the middle', 'safe/../../escape']
        ])('refuses %s', async (_label, changeName) => {
            const { status, body } = await post('/api/stardust/run', {
                action: 'propose',
                changeId: changeName,
                description: 'test',
                projectRoot: workspace
            });

            expect(status).toBeGreaterThanOrEqual(400);
            expect(JSON.stringify(body)).toMatch(/change|invalid|separator|required/i);
        });

        test('nothing was written outside the workspace', () => {
            // The traversals above aimed at the parent; it must be untouched.
            const parent = path.dirname(workspace);
            const escaped = ['escaped', 'escape'].some((name) => fs.existsSync(path.join(parent, name)));
            expect(escaped).toBe(false);
        });

        test('refuses an empty or non-string name', async () => {
            for (const changeId of ['', null, 42, {}]) {
                const { status } = await post('/api/stardust/run', {
                    action: 'propose', changeId, description: 'x', projectRoot: workspace
                });
                expect(status).toBeGreaterThanOrEqual(400);
            }
        });
    });

    // ── Read routes ─────────────────────────────────────────────────────
    describe('read routes answer for a workspace with no OpenSpec', () => {
        test('board reports not-ready rather than failing', async () => {
            const { status, body } = await get(`/api/stardust/board?projectRoot=${encodeURIComponent(workspace)}`);
            expect(status).toBe(200);
            expect(body).toHaveProperty('changes');
            expect(Array.isArray(body.changes)).toBe(true);
        });

        test('drift explains why it is unavailable instead of erroring', async () => {
            const { status, body } = await get(`/api/stardust/drift?projectRoot=${encodeURIComponent(workspace)}`);
            expect(status).toBe(200);
            expect(body).toHaveProperty('available');
            if (body.available === false) expect(typeof body.reason).toBe('string');
        });

        test('compose requires a file and says so', async () => {
            const { status } = await get(`/api/stardust/compose?projectRoot=${encodeURIComponent(workspace)}`);
            expect(status).toBe(400);
        });

        test('compose returns the three-tool view for a file', async () => {
            fs.writeFileSync(path.join(workspace, 'sample.js'), 'module.exports = 1;\n');
            const params = new URLSearchParams({ projectRoot: workspace, file: 'sample.js' });
            const { status, body } = await get(`/api/stardust/compose?${params}`);

            expect(status).toBe(200);
            expect(body).toHaveProperty('openspec');
            expect(body).toHaveProperty('graphify');
            expect(body).toHaveProperty('contextExpert');
        });

        test('compose clamps depth to the documented 1..4', async () => {
            fs.writeFileSync(path.join(workspace, 'sample.js'), 'module.exports = 1;\n');
            // 0 is falsy so it takes the default of 2; a negative clamps to the
            // floor of 1 rather than the default. Both are sane; asserting the
            // real behaviour rather than the behaviour I assumed.
            for (const [requested, expected] of [[99, 4], [0, 2], [-5, 1], [3, 3]]) {
                const params = new URLSearchParams({ projectRoot: workspace, file: 'sample.js', depth: String(requested) });
                const { body } = await get(`/api/stardust/compose?${params}`);
                expect(body.depth).toBe(expected);
            }
        });
    });

    describe('run rejects an unknown action', () => {
        test('does not silently succeed', async () => {
            const { status } = await post('/api/stardust/run', { action: 'not-a-real-action', projectRoot: workspace });
            expect(status).toBeGreaterThanOrEqual(400);
        });
    });
});
