const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, shell, Tray } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const RUNTIME_PORT = Number(process.env.YODAMAN_PORT || 3090);
const RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}`;

let mainWindow;
let backendProcess;
let spawnedBackend = false;
let suppressRuntimeExitHandler = false;
let notificationPoller;
let tray;
const notifiedTaskStates = new Map();
const runtimeLogBuffer = [];

function rememberRuntimeLog(line) {
    runtimeLogBuffer.push(line);
    if (runtimeLogBuffer.length > 40) runtimeLogBuffer.shift();
}

function checkRuntime() {
    return new Promise((resolve) => {
        const req = http.get(`${RUNTIME_URL}/api/desktop/diagnostics`, (res) => {
            res.resume();
            resolve(res.statusCode < 500);
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

    if (backendProcess && !backendProcess.killed) {
        await waitForRuntime();
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
        const line = data.toString().trim();
        rememberRuntimeLog(line);
        console.log(`[runtime] ${line}`);
    });

    backendProcess.stderr.on('data', (data) => {
        const line = data.toString().trim();
        rememberRuntimeLog(line);
        console.error(`[runtime] ${line}`);
    });

    backendProcess.on('exit', (code) => {
        if (suppressRuntimeExitHandler) {
            suppressRuntimeExitHandler = false;
            return;
        }
        if (!app.isQuitting && code !== 0) {
            rememberRuntimeLog(`Runtime exited with code ${code}`);
            console.error(`YodaMan runtime exited with code ${code}`);
            if (mainWindow) {
                loadRuntimeUnavailable(new Error(`The managed runtime stopped unexpectedly with exit code ${code}.`));
            }
        }
    });

    await waitForRuntime();
}

async function restartBackend() {
    if (!spawnedBackend) {
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            message: 'YodaMan is using an already-running runtime.',
            detail: 'Start the desktop app without an external runtime if you want Electron to manage restarts.'
        });
        return;
    }

    if (backendProcess && !backendProcess.killed) {
        suppressRuntimeExitHandler = backendProcess.kill();
    }

    backendProcess = null;
    spawnedBackend = false;
    try {
        if (mainWindow) loadLoadingState('Restarting YodaMan runtime...');
        await ensureBackend();
        if (mainWindow) {
            await mainWindow.loadURL(RUNTIME_URL);
        }
    } catch (error) {
        if (mainWindow) loadRuntimeUnavailable(error);
        throw error;
    }
}

async function retryRuntime() {
    if (backendProcess && !backendProcess.killed) {
        suppressRuntimeExitHandler = backendProcess.kill();
    }

    backendProcess = null;
    spawnedBackend = false;

    if (mainWindow) loadLoadingState('Retrying YodaMan runtime...');

    try {
        await ensureBackend();
        if (mainWindow) {
            await mainWindow.loadURL(RUNTIME_URL);
        }
        startNotificationPolling();
        return { ok: true };
    } catch (error) {
        if (mainWindow) loadRuntimeUnavailable(error);
        return { ok: false, error: error.message };
    }
}

function postJson(pathname, body = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request(`${RUNTIME_URL}${pathname}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(responseBody || `Request failed with ${res.statusCode}`));
                    return;
                }
                resolve(JSON.parse(responseBody));
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function getJson(pathname) {
    return new Promise((resolve, reject) => {
        const req = http.get(`${RUNTIME_URL}${pathname}`, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(responseBody || `Request failed with ${res.statusCode}`));
                    return;
                }
                resolve(JSON.parse(responseBody));
            });
        });

        req.on('error', reject);
        req.setTimeout(2000, () => {
            req.destroy();
            reject(new Error('Runtime request timed out'));
        });
    });
}

async function copyPairingLink() {
    try {
        const pairing = await postJson('/api/pairing', { runtimeUrl: RUNTIME_URL });
        clipboard.writeText(pairing.link);
        dialog.showMessageBox(mainWindow, {
            type: 'info',
            message: 'Mobile pairing link copied.',
            detail: pairing.link
        });
    } catch (error) {
        dialog.showErrorBox('YodaMan pairing failed', error.message);
    }
}

async function addProjectFolder() {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Add YodaMan Project Folder'
    });

    if (result.canceled || result.filePaths.length === 0) return;

    try {
        const added = await postJson('/api/projects', { path: result.filePaths[0] });
        new Notification({
            title: 'YodaMan project added',
            body: added.path || result.filePaths[0]
        }).show();
        if (mainWindow) mainWindow.reload();
    } catch (error) {
        dialog.showErrorBox('YodaMan project add failed', error.message);
    }
}

async function pickProjectFolder() {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Choose YodaMan Project Folder'
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
}

async function pollTaskNotifications() {
    try {
        const tasks = await getJson('/api/agent/tasks');
        for (const task of tasks) {
            if (!task.taskId) continue;
            const previousStatus = notifiedTaskStates.get(task.taskId);
            if (previousStatus === task.status) continue;

            notifiedTaskStates.set(task.taskId, task.status);

            if (task.status === 'awaiting_approval') {
                new Notification({
                    title: 'YodaMan needs approval',
                    body: task.task || task.taskId
                }).show();
            }

            if (task.status === 'completed' && previousStatus && previousStatus !== 'completed') {
                new Notification({
                    title: 'YodaMan task completed',
                    body: task.task || task.taskId
                }).show();
            }
        }
    } catch (error) {
        console.error(`[desktop] notification poll failed: ${error.message}`);
    }
}

function startNotificationPolling() {
    if (!Notification.isSupported() || notificationPoller) return;
    notificationPoller = setInterval(pollTaskNotifications, 5000);
    pollTaskNotifications();
}

function installMenu() {
    const template = [
        {
            label: 'YodaMan',
            submenu: [
                {
                    label: 'Restart Managed Runtime',
                    click: () => restartBackend().catch((error) => dialog.showErrorBox('YodaMan restart failed', error.message))
                },
                {
                    label: 'Copy Mobile Pairing Link',
                    click: copyPairingLink
                },
                {
                    label: 'Add Project Folder',
                    click: () => addProjectFolder().catch((error) => dialog.showErrorBox('YodaMan folder picker failed', error.message))
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installIpcHandlers() {
    ipcMain.handle('yodaman:pick-project-folder', pickProjectFolder);
    ipcMain.handle('yodaman:retry-runtime', retryRuntime);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function logoDataUri() {
    const candidates = [
        path.join(__dirname, '..', 'public', 'logo.png'),
        path.join(__dirname, 'assets', 'yodaman.png')
    ];

    for (const candidate of candidates) {
        try {
            return `data:image/png;base64,${fs.readFileSync(candidate).toString('base64')}`;
        } catch (error) {
            // Try the packaged fallback below.
        }
    }

    return '';
}

function recoveryPage({ title, message, detail, logs = '' }) {
    const copyText = [title, message, detail, logs].filter(Boolean).join('\n\n');
    const logoSrc = logoDataUri();

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; background: #0b1020; color: #eef4ff; display: grid; place-items: center; }
    main { width: min(720px, calc(100vw - 48px)); }
    .mark { width: 54px; height: 54px; border-radius: 14px; background: #101a2d; border: 1px solid #263244; display: grid; place-items: center; margin-bottom: 22px; box-shadow: 0 0 28px rgba(46, 144, 250, 0.22); overflow: hidden; }
    .mark img { width: 42px; height: 42px; object-fit: contain; }
    h1 { margin: 0 0 10px; font-size: 28px; letter-spacing: 0; }
    p { color: #a7b0c0; font-size: 15px; line-height: 1.6; margin: 0 0 18px; }
    .panel { border: 1px solid #263244; background: #121a2b; border-radius: 8px; padding: 18px; margin-top: 18px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    button { border: 0; border-radius: 6px; padding: 11px 14px; font-weight: 700; color: #fff; background: #2e90fa; cursor: pointer; }
    button.secondary { background: transparent; border: 1px solid #52637a; color: #eef4ff; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { white-space: pre-wrap; color: #cbd5e1; font-size: 12px; line-height: 1.5; max-height: 220px; overflow: auto; margin: 0; }
  </style>
</head>
<body>
  <main>
    <div class="mark">${logoSrc ? `<img src="${logoSrc}" alt="YodaMan" />` : 'Y'}</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <div class="panel">
      <p>${escapeHtml(detail)}</p>
      ${logs ? `<pre>${escapeHtml(logs)}</pre>` : ''}
    </div>
    <div class="actions">
      <button id="try-again">Try Again</button>
      <button class="secondary" onclick="window.open('${RUNTIME_URL}/api/status')">Open Runtime Status</button>
      <button class="secondary" id="copy-error">Copy Error</button>
    </div>
  </main>
  <script>
    const copyError = ${JSON.stringify(copyText)};
    document.getElementById('try-again').addEventListener('click', async () => {
      const button = document.getElementById('try-again');
      button.disabled = true;
      button.textContent = 'Retrying...';
      try {
        if (window.yodamanDesktop && window.yodamanDesktop.retryRuntime) {
          const result = await window.yodamanDesktop.retryRuntime();
          if (result && result.ok === false) {
            button.disabled = false;
            button.textContent = 'Try Again';
          }
          return;
        }
        location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Try Again';
      }
    });
    document.getElementById('copy-error').addEventListener('click', async () => {
      const button = document.getElementById('copy-error');
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(copyError);
        } else {
          const area = document.createElement('textarea');
          area.value = copyError;
          area.style.position = 'fixed';
          area.style.left = '-9999px';
          document.body.appendChild(area);
          area.focus();
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy Error'; }, 1400);
      } catch (error) {
        button.textContent = 'Copy Failed';
        setTimeout(() => { button.textContent = 'Copy Error'; }, 1800);
      }
    });
  </script>
</body>
</html>`;
}

function loadLoadingState(message = 'Starting the local YodaMan runtime...') {
    if (!mainWindow) return;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryPage({
        title: 'Starting YodaMan',
        message,
        detail: `The desktop app is checking ${RUNTIME_URL} and will open automatically when the runtime is ready.`
    }))}`);
}

function loadRuntimeUnavailable(error) {
    if (!mainWindow) return;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(recoveryPage({
        title: 'YodaMan runtime could not start',
        message: 'The desktop app is still open, but the local runtime service is not responding yet.',
        detail: `${error.message}\n\nUse YodaMan > Restart Managed Runtime, or run "yodaman" from Terminal and then try again.`,
        logs: runtimeLogBuffer.join('\n')
    }))}`);
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
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    loadLoadingState();

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });
}

function createTray() {
    const iconPath = path.join(__dirname, '..', 'public', 'favicon.png');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show YodaMan',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                }
            }
        },
        {
            label: 'Restart Managed Runtime',
            click: () => restartBackend().catch((error) => dialog.showErrorBox('YodaMan restart failed', error.message))
        },
        {
            label: 'Copy Mobile Pairing Link',
            click: copyPairingLink
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);
    tray.setToolTip('YodaMan');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
            }
        }
    });
}

async function startDesktop() {
    installMenu();
    installIpcHandlers();
    createWindow();
    createTray();
    try {
        await ensureBackend();
        await mainWindow.loadURL(RUNTIME_URL);
        startNotificationPolling();
    } catch (error) {
        console.error(error);
        loadRuntimeUnavailable(error);
    }
}

app.whenReady().then(() => {
    startDesktop();

    app.on('activate', () => {
        if (mainWindow) {
            mainWindow.show();
        } else if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('before-quit', () => {
    app.isQuitting = true;

    if (spawnedBackend && backendProcess && !backendProcess.killed) {
        backendProcess.kill();
    }

    if (notificationPoller) {
        clearInterval(notificationPoller);
    }

    if (tray) {
        tray.destroy();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
