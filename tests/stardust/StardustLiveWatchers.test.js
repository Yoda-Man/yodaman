/**
 * /api/stardust/live — the WebSocket side of the live board.
 *
 * chokidar is replaced with a hand-driven watcher so a test can fire a file event
 * and see exactly when the watcher is closed.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');

jest.mock('chokidar', () => {
    const { EventEmitter } = require('events');
    const created = [];
    return {
        created,
        watch: jest.fn(() => {
            const watcher = new EventEmitter();
            watcher.close = jest.fn();
            created.push(watcher);
            return watcher;
        }),
    };
});

const chokidar = require('chokidar');
const stardustLive = require('../../backend/stardust/StardustLive');

describe('Stardust live socket', () => {
    let root;
    let server;
    let wss;
    let serverSockets;
    let previousConfig;

    beforeEach(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-socket-'));
        fs.mkdirSync(path.join(root, 'openspec', 'changes'), { recursive: true });
        previousConfig = process.env.YODAMAN_CONFIG_PATH;
        process.env.YODAMAN_CONFIG_PATH = path.join(root, 'config.json');
        fs.writeFileSync(process.env.YODAMAN_CONFIG_PATH, JSON.stringify({ watchedDirectories: [root] }));

        chokidar.created.length = 0;
        server = http.createServer();
        wss = stardustLive.attachToServer(server);
        serverSockets = [];
        wss.on('connection', (ws) => serverSockets.push(ws));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    });

    afterEach(async () => {
        for (const client of wss.clients) client.terminate();
        await new Promise((resolve) => wss.close(resolve));
        await new Promise((resolve) => server.close(resolve));
        if (previousConfig === undefined) delete process.env.YODAMAN_CONFIG_PATH;
        else process.env.YODAMAN_CONFIG_PATH = previousConfig;
        fs.rmSync(root, { recursive: true, force: true });
    });

    /** Connect and resolve with the socket and its first message. */
    function connect(projectRoot) {
        const url = `ws://127.0.0.1:${server.address().port}/api/stardust/live?projectRoot=${encodeURIComponent(projectRoot)}`;
        const ws = new WebSocket(url);
        return new Promise((resolve, reject) => {
            ws.once('message', (data) => resolve({ ws, first: JSON.parse(String(data)) }));
            ws.once('error', reject);
        });
    }

    test('a client whose send fails releases its watcher', async () => {
        const { ws, first } = await connect(root);
        expect(first.type).toBe('snapshot');
        expect(chokidar.created).toHaveLength(1);
        const watcher = chokidar.created[0];

        // The socket is gone as far as the server can tell: the next send throws.
        const serverSide = serverSockets[0];
        serverSide.send = () => { throw new Error('socket gone'); };
        watcher.emit('all', 'change', path.join(root, 'openspec', 'changes', 'x.md'));

        // It was the only client of this workspace, so the watcher must close.
        expect(watcher.close).toHaveBeenCalledTimes(1);

        const closed = new Promise((resolve) => serverSide.once('close', resolve));
        ws.close();
        await closed;
        expect(watcher.close).toHaveBeenCalledTimes(1);
    });

    test('an unregistered folder is refused, and nothing is watched', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'stardust-outside-'));
        try {
            fs.mkdirSync(path.join(outside, 'openspec', 'changes'), { recursive: true });
            const { ws, first } = await connect(outside);
            expect(first).toMatchObject({ type: 'error', code: 'workspace_not_registered' });
            const code = await new Promise((resolve) => ws.once('close', resolve));
            expect(code).toBe(1008);
            expect(chokidar.created).toHaveLength(0);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
