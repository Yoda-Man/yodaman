const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const RUNTIME_PORT = Number(process.env.YODAMAN_PORT || 3090);
const RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}`;

let mainWindow;
let backendProcess;
let spawnedBackend = false;

function checkRuntime() {
    return new Promise((resolve) => {
        const req = http.get(RUNTIME_URL, (res) => {
            res.resume();
            resolve(true);
        });

        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

function waitForRuntime(timeoutMs = 15000) {
    const start = Date.now();

    return new Promise((resolve, reject) => {
        const tick = async () => {
            if (await checkRuntime()) {
                resolve();
                return;
            }

            if (Date.now() - start > timeoutMs) {
                reject(new Error(`YodaMan runtime did not start at ${RUNTIME_URL}`));
                return;
            }

            setTimeout(tick, 250);
        };

        tick();
    });
}

async function ensureBackend() {
    if (await checkRuntime()) {
        return;
    }

    const serverPath = path.join(__dirname, '..', 'server.js');
    backendProcess = spawn(process.execPath, [serverPath], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            NODE_ENV: 'production',
            ELECTRON_RUN_AS_NODE: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    spawnedBackend = true;

    backendProcess.stdout.on('data', (data) => {
        console.log(`[runtime] ${data.toString().trim()}`);
    });

    backendProcess.stderr.on('data', (data) => {
        console.error(`[runtime] ${data.toString().trim()}`);
    });

    backendProcess.on('exit', (code) => {
        if (!app.isQuitting && code !== 0) {
            console.error(`YodaMan runtime exited with code ${code}`);
        }
    });

    await waitForRuntime();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 960,
        minHeight: 640,
        title: 'YodaMan',
        backgroundColor: '#0b1020',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadURL(RUNTIME_URL);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

async function startDesktop() {
    await ensureBackend();
    createWindow();
}

app.whenReady().then(() => {
    startDesktop().catch((error) => {
        console.error(error);
        app.quit();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('before-quit', () => {
    app.isQuitting = true;

    if (spawnedBackend && backendProcess && !backendProcess.killed) {
        backendProcess.kill();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

