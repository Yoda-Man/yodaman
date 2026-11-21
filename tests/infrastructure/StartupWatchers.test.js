const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Registered workspaces are watched even when ctx is unavailable at startup.
 *
 * server.js used to start the file watchers only after `ctx list` succeeded,
 * so with ctx missing or broken no workspace was watched at all: edits went
 * unnoticed until a restart with ctx working. A stand-in `ctx` that always
 * fails is put first on PATH, and the runtime must still watch the workspace.
 */
describe('Startup watchers', () => {
    let root;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-startup-watch-'));
        fs.mkdirSync(path.join(root, 'bin'));
        fs.mkdirSync(path.join(root, 'workspace'));
        fs.mkdirSync(path.join(root, 'data'));
        fs.writeFileSync(path.join(root, 'bin', 'ctx'), '#!/bin/sh\necho "ctx is broken" >&2\nexit 1\n', { mode: 0o755 });
        fs.writeFileSync(path.join(root, 'data', 'config.json'), JSON.stringify({
            watchedDirectories: [path.join(root, 'workspace')],
            removedDirectories: []
        }));
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    test('a registered workspace is watched although ctx list fails', async () => {
        const child = spawn(process.execPath, [path.resolve(__dirname, '../../server.js')], {
            env: {
                ...process.env,
                PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
                YODAMAN_PORT: '0',
                YODAMAN_DATA_DIR: path.join(root, 'data'),
                YODAMAN_CONFIG_PATH: path.join(root, 'data', 'config.json'),
                YODAMAN_LOG_TO_FILE: 'false'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let output = '';
        const finished = new Promise((resolve) => {
            const check = (d) => {
                output += d.toString();
                if (output.includes('startup_health_summary')) resolve();
            };
            child.stdout.on('data', check);
            child.stderr.on('data', check);
            setTimeout(resolve, 45000);
        });
        await finished;
        child.kill('SIGKILL');

        // Inputs were real: ctx was the failing stand-in, and the sync did fail.
        expect(output).toContain('startup_sync_failed');
        expect(output).toMatch(/"message":"watcher_initialized".*workspace/);
    }, 60000);
});
