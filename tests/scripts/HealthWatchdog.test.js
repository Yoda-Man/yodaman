/**
 * The watchdog probes the port it checks with lsof.
 *
 * YODAMAN_PORT used to move only the lsof check: the probe still went to
 * 3090, so a runtime on another port read "down" (or, with something else on
 * 3090, healthy) whatever its real state.
 */
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'health-watchdog.js');

function once(env) {
    return new Promise((resolve) => {
        const clean = { ...process.env };
        delete clean.YODAMAN_HEALTH_URL;
        delete clean.YODAMAN_PORT;
        execFile(process.execPath, [SCRIPT, '--once', '--json'], { env: { ...clean, ...env }, timeout: 20000 }, (err, stdout) => {
            resolve({ code: err ? err.code : 0, line: JSON.parse(stdout.trim()) });
        });
    });
}

describe('health watchdog', () => {
    let server;
    let port;
    beforeAll(async () => {
        server = http.createServer((req, res) => res.end('{}'));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });
    afterAll(() => new Promise((resolve) => server.close(resolve)));

    test('YODAMAN_PORT moves the probe URL too', async () => {
        const { code, line } = await once({ YODAMAN_PORT: String(port) });
        expect(line.url).toBe(`http://127.0.0.1:${port}`);
        expect(line.state).toBe('healthy');
        expect(code).toBe(0);
    });

    test('YODAMAN_HEALTH_URL still decides the address', async () => {
        const { line } = await once({ YODAMAN_HEALTH_URL: `http://127.0.0.1:${port}`, YODAMAN_PORT: '1' });
        expect(line).toMatchObject({ url: `http://127.0.0.1:${port}`, state: 'healthy' });
    });
});
