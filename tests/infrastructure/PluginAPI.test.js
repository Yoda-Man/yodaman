const http = require('http');
const PluginAPI = require('../../backend/infrastructure/PluginAPI');
const toolBox = require('../../backend/infrastructure/ToolBox');

describe('PluginAPI.fetch is gated by the network permission', () => {
    let server;
    let url;
    beforeAll(async () => {
        server = http.createServer((req, res) => res.end('{"ok":true}'));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        url = `http://127.0.0.1:${server.address().port}/`;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));

    test('a plugin without network or unrestricted cannot make requests', async () => {
        await expect(new PluginAPI('/plugins', ['read']).fetch(url)).rejects.toThrow('Plugin fetch needs the "network" permission');
    });

    test('any plugin may call its own runtime by path, as Holocron VR does', async () => {
        const previous = process.env.YODAMAN_PORT;
        process.env.YODAMAN_PORT = String(server.address().port);
        try {
            const response = await new PluginAPI('/plugins', ['graphify:read']).fetch('/api/graphify/status');
            expect(await response.json()).toEqual({ ok: true });
        } finally {
            if (previous === undefined) delete process.env.YODAMAN_PORT; else process.env.YODAMAN_PORT = previous;
        }
    });

    test.each([['network'], ['unrestricted']])('%s may', async (permission) => {
        const response = await new PluginAPI('/plugins', [permission]).fetch(url);
        expect(await response.json()).toEqual({ ok: true });
    });

    test('a lifecycle plugin gets an API carrying its declared permissions', () => {
        const declared = { name: 'lifecycle-test', permissions: ['read'], onLoad: async () => {} };
        const undeclared = { name: 'lifecycle-open', onLoad: async () => {} };
        toolBox.validatePlugin(declared);
        toolBox.validatePlugin(undeclared);
        expect(declared._api.permissions).toEqual(['read']);
        // No permissions array means unrestricted, as everywhere else.
        expect(undeclared._api.permissions).toEqual(['unrestricted']);
    });
});
