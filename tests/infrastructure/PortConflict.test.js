const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

/**
 * A taken port must fail loudly, with an actionable message.
 *
 * This is the failure a user is most likely to cause themselves — a second
 * runtime, a stale process, a dev server left running — and it used to surface
 * as a generic uncaught exception. To anyone launching the desktop app it
 * surfaced as nothing at all: a black window, because the shell had no runtime
 * behind it and nothing said why.
 *
 * The assertion is on the contract a support engineer relies on: a distinct
 * exit code, the port named, and a command they can run.
 */
describe('Runtime port conflict', () => {
    let blocker;
    let port;

    beforeAll(async () => {
        // Take a port the runtime will then fail to bind.
        blocker = net.createServer();
        await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
        port = blocker.address().port;
    });

    afterAll(() => {
        if (blocker) blocker.close();
    });

    test('reports the port, the cause, and a way out — and exits distinctly', async () => {
        const serverPath = path.resolve(__dirname, '../../server.js');
        const child = spawn(process.execPath, [serverPath], {
            // YODAMAN_PORT, not PORT. Writing PORT here is what caught the runtime
            // printing `PORT=3091` as the remedy — advice that would not have worked.
            env: { ...process.env, YODAMAN_PORT: String(port) },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        child.stdout.on('data', (d) => { output += d.toString(); });
        child.stderr.on('data', (d) => { output += d.toString(); });

        const exitCode = await new Promise((resolve) => {
            child.on('exit', resolve);
            setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 30000);
        });

        // 2 rather than 1: a caller can tell "port taken" from "crashed".
        expect(exitCode).toBe(2);
        expect(output).toMatch(/port .* is already in use/i);
        expect(output).toContain(String(port));
        // The message must carry a command, not just a diagnosis.
        expect(output).toMatch(/lsof/);
        // The remedy must name the variable the runtime actually reads.
        expect(output).toContain('YODAMAN_PORT');
    }, 40000);
});
