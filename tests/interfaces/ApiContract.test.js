/**
 * The API's error contract over real HTTP, through the router as server.js
 * mounts it. Each case shipped broken in 0.6.6 and only shows through Express
 * itself (body parsing, multer, route fall-through), so handler-level tests
 * could not see it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const settings = require('../../backend/infrastructure/SettingsProvider');

describe('API error contract (live HTTP)', () => {
    let server;
    let baseUrl;
    let configDir;
    const saved = {};

    beforeAll(async () => {
        for (const key of ['YODAMAN_CONFIG_PATH', 'YODAMAN_ALLOW_PLUGIN_UPLOADS']) saved[key] = process.env[key];
        configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-contract-'));
        process.env.YODAMAN_CONFIG_PATH = path.join(configDir, 'config.json');
        process.env.YODAMAN_ALLOW_PLUGIN_UPLOADS = 'true';
        fs.writeFileSync(process.env.YODAMAN_CONFIG_PATH, JSON.stringify({ watchedDirectories: [], removedDirectories: [] }));
        settings.reset();

        const app = express();
        app.use(express.json());
        app.use('/api', require('../../backend/interfaces/RestController'));
        // As in server.js: the web app's catch-all comes after the API.
        app.get('/*splat', (req, res) => res.send('<html>index</html>'));
        server = http.createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        settings.reset();
        fs.rmSync(configDir, { recursive: true, force: true });
    });

    const call = async (method, pathname, init = {}) => {
        const res = await fetch(`${baseUrl}${pathname}`, { method, ...init });
        const type = res.headers.get('content-type') || '';
        return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
    };

    test('an unknown /api path is a JSON 404, not the web app', async () => {
        const res = await call('GET', '/api/no-such-route');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'No API route for GET /api/no-such-route', code: 'not_found' });
        // The web app still answers its own paths.
        expect((await call('GET', '/settings')).body).toContain('index');
    });

    test.each([
        ['PUT', '/api/settings', 'invalid_settings'],
        ['POST', '/api/pairing/revoke', 'invalid_token'],
        ['POST', '/api/agent/approve', 'invalid_task_id']
    ])('%s %s with no body is a 400, not a 500', async (method, pathname, code) => {
        const res = await call(method, pathname);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(code);
    });

    test('an agent task for an unregistered workspace is refused before anything runs', async () => {
        const sessionStore = require('../../backend/infrastructure/SessionStore');
        const res = await call('POST', '/api/agent/task', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task: 'list the files', projectId: configDir })
        });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: `Workspace is not registered: ${configDir}`, code: 'workspace_not_registered' });
        expect(sessionStore.getMessages(configDir)).toEqual([]);
    });

    const upload = (name, source = 'module.exports = {};') => {
        const form = new FormData();
        form.append('plugin', new Blob([source]), name);
        return call('POST', '/api/plugins', { body: form });
    };

    test('a plugin upload whose file name is taken is a 409', async () => {
        const res = await upload('graphify.js');
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('plugin_exists');
    });

    test('a plugin upload with a refused file name is a 400', async () => {
        const res = await upload('evil.txt');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_plugin');
        expect(fs.existsSync(path.resolve(__dirname, '../../plugins/evil.txt'))).toBe(false);
    });

    test('a settings change that cannot be written is a 500, and is not reported as kept', async () => {
        const blocked = path.join(configDir, 'blocked');
        fs.mkdirSync(path.join(blocked, 'config.json'), { recursive: true });
        process.env.YODAMAN_CONFIG_PATH = path.join(blocked, 'config.json');
        settings.reset();
        try {
            const res = await call('PUT', '/api/settings', {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allowSelfHealInstall: true })
            });
            expect(res.status).toBe(500);
            expect(res.body.code).toBe('settings_save_failed');
            expect(settings.get('allowSelfHealInstall')).toBe(false);
        } finally {
            process.env.YODAMAN_CONFIG_PATH = path.join(configDir, 'config.json');
            settings.reset();
        }
    });
});
