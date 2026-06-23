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

    ipcMain.handle('yodaman:install-dependency', async (event, component) => {
        try {
            const result = await postJson('/api/health/install', { component });
            return result;
        } catch (error) {
            return { ok: false, component, message: error.message };
        }
    });

    ipcMain.handle('yodaman:open-dev-tools', () => {
        if (mainWindow) mainWindow.webContents.openDevTools();
    });
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

function diagnosticsPage({ title, message, status, logs = '' }) {
    const logoSrc = logoDataUri();
    const runtimeUrl = RUNTIME_URL;
    const initialStatus = JSON.stringify(status || {});

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>YodaMan — Diagnostics</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #0b1020; color: #eef4ff; }
    .container { max-width: 840px; margin: 0 auto; padding: 48px 24px; }

    .logo { width: 54px; height: 54px; border-radius: 14px; background: #101a2d; border: 1px solid #263244; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: 0 0 28px rgba(46,144,250,0.22); overflow: hidden; }
    .logo img { width: 42px; height: 42px; object-fit: contain; }

    h1 { margin: 0 0 6px; font-size: 26px; font-weight: 600; }
    .subtitle { color: #8892a8; font-size: 14px; margin: 0 0 24px; line-height: 1.5; }

    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
    .status-ok { background: #0d3a1e; color: #4ade80; border: 1px solid #166534; }
    .status-degraded { background: #3a2a0d; color: #facc15; border: 1px solid #713f12; }
    .status-error { background: #3a0d0d; color: #f87171; border: 1px solid #711212; }
    .status-loading { background: #0d1d3a; color: #60a5fa; border: 1px solid #1e3a5f; }

    table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 16px 0; border: 1px solid #1e293b; border-radius: 10px; overflow: hidden; }
    th { background: #0f172a; text-align: left; padding: 10px 16px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; border-bottom: 1px solid #1e293b; }
    td { padding: 10px 16px; font-size: 13px; border-bottom: 1px solid #1e293b; }
    tr:last-child td { border-bottom: none; }
    .check-name { display: flex; align-items: center; gap: 8px; }
    .check-icon { font-size: 16px; width: 20px; text-align: center; }
    .check-ok { color: #4ade80; }
    .check-fail { color: #f87171; }
    .check-warn { color: #facc15; }
    .check-pending { color: #64748b; }
    .check-msg { color: #94a3b8; font-size: 12px; }
    .check-action { text-align: right; }
    .btn-install { border: 0; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 600; color: #fff; background: #2e90fa; cursor: pointer; }
    .btn-install:disabled { opacity: 0.5; cursor: wait; }
    .btn-install:not(:disabled):hover { background: #1a7ae0; }

    .log-section { margin-top: 16px; border: 1px solid #1e293b; border-radius: 10px; overflow: hidden; }
    .log-header { background: #0f172a; padding: 10px 16px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
    .log-header:hover { background: #1a2332; }
    .log-body { padding: 0; max-height: 0; overflow: hidden; transition: max-height 0.2s ease; }
    .log-body.open { max-height: 300px; }
    .log-body pre { margin: 0; padding: 12px 16px; background: #060a14; color: #94a3b8; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.6; white-space: pre-wrap; overflow-y: auto; max-height: 276px; }

    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 24px; }
    .actions button { border: 0; border-radius: 8px; padding: 11px 18px; font-weight: 600; font-size: 13px; color: #fff; background: #2e90fa; cursor: pointer; }
    .actions button:hover { background: #1a7ae0; }
    .actions button.secondary { background: transparent; border: 1px solid #334155; color: #cbd5e1; }
    .actions button.secondary:hover { background: #1e293b; }
    .actions button.danger { background: #dc2626; }
    .actions button.danger:hover { background: #b91c1c; }

    .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500; z-index: 100; opacity: 0; transition: opacity 0.3s ease; }
    .toast.show { opacity: 1; }
    .toast.info { background: #1e3a5f; color: #93c5fd; border: 1px solid #2563eb; }
    .toast.error { background: #3a0d0d; color: #fca5a5; border: 1px solid #dc2626; }
    .toast.success { background: #0d3a1e; color: #86efac; border: 1px solid #16a34a; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">${logoSrc ? `<img src="${logoSrc}" alt="YodaMan" />` : 'Y'}</div>

    <h1>${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(message)}</p>

    <div id="status-badge" class="status-badge status-loading">⟳ Checking dependencies…</div>

    <table>
      <thead><tr><th>Dependency</th><th>Status</th><th></th></tr></thead>
      <tbody id="checks-body">
        <tr><td class="check-name"><span class="check-icon check-pending">⟳</span> Node.js</td><td class="check-pending">checking…</td><td></td></tr>
        <tr><td class="check-name"><span class="check-icon check-pending">⟳</span> Graphify</td><td class="check-pending">checking…</td><td></td></tr>
        <tr><td class="check-name"><span class="check-icon check-pending">⟳</span> Ollama</td><td class="check-pending">checking…</td><td class="check-action" id="action-ollama"></td></tr>
        <tr><td class="check-name"><span class="check-icon check-pending">⟳</span> Context Expert (ctx)</td><td class="check-pending">checking…</td><td class="check-action" id="action-ctx"></td></tr>
        <tr><td class="check-name"><span class="check-icon check-pending">⟳</span> Config</td><td class="check-pending">checking…</td><td></td></tr>
        <tr><td class="check-name"><span class="check-icon check-pending">⟳</span> Runtime</td><td class="check-pending">checking…</td><td></td></tr>
      </tbody>
    </table>

    <div class="log-section">
      <div class="log-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <span>⟳ Runtime Logs</span>
        <span style="font-size:11px;text-transform:none;letter-spacing:0;" id="log-count">${logs ? logs.split('\n').filter(Boolean).length : 0} lines</span>
      </div>
      <div class="log-body ${logs ? 'open' : ''}" id="log-body">
        <pre id="log-content">${escapeHtml(logs)}</pre>
      </div>
    </div>

    <div class="actions">
      <button id="try-again">⟳ Try Again</button>
      <button class="secondary" id="copy-error">📋 Copy Error</button>
      <button class="secondary" id="open-dev-tools">🔧 Dev Tools</button>
    </div>

    <div id="toast" class="toast"></div>
  </div>

  <script>
    const RUNTIME_URL = ${JSON.stringify(runtimeUrl)};
    const LOGS = ${JSON.stringify(logs || '')};

    function showToast(msg, type) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.className = 'toast ' + type + ' show';
      setTimeout(() => t.classList.remove('show'), 4000);
    }

    function statusIcon(ok) {
      if (ok === true) return '<span class="check-ok">✓</span>';
      if (ok === false) return '<span class="check-fail">✗</span>';
      return '<span class="check-pending">⟳</span>';
    }

    function statusLabel(ok, msg) {
      if (ok === true) return '<span class="check-ok">OK</span>';
      if (ok === false) return '<span class="check-fail">FAIL</span> — <span class="check-msg">' + (msg || 'unknown') + '</span>';
      return '<span class="check-pending">' + (msg || 'checking…') + '</span>';
    }

    function makeInstallBtn(component, label) {
      const btn = document.createElement('button');
      btn.className = 'btn-install';
      btn.textContent = 'Install ' + (label || component);
      btn.onclick = async function() {
        this.disabled = true; this.textContent = 'Installing…';
        showToast('Installing ' + component + '…', 'info');
        try {
          let result;
          if (window.yodamanDesktop && window.yodamanDesktop.installDependency) {
            result = await window.yodamanDesktop.installDependency(component);
          } else {
            const resp = await fetch(RUNTIME_URL + '/api/health/install', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ component })
            });
            result = await resp.json();
          }
          if (result && result.ok) {
            showToast(component + ' installed! Restart the runtime.', 'success');
            this.textContent = '✓ Installed — Restart';
            this.onclick = () => document.getElementById('try-again').click();
          } else {
            showToast('Installation failed: ' + (result.message || 'unknown error'), 'error');
            this.textContent = 'Install Failed';
            this.disabled = false;
          }
        } catch (err) {
          showToast('Install error: ' + err.message, 'error');
          this.textContent = 'Install ' + (label || component);
          this.disabled = false;
        }
      };
      return btn;
    }

    function updateTable(checks, status) {
      const rows = document.querySelectorAll('#checks-body tr');
      const checkKeys = ['node', 'graphify', 'ollama', 'ctx', 'config', 'runtime'];

      // Runtime check: if runtime is started, it's OK
      if (checks && !checks.runtime) {
        checks.runtime = { ok: status === 'degraded' || status === 'ok', message: 'PID active' };
      }

      checkKeys.forEach((key, idx) => {
        const ch = checks ? checks[key] : null;
        if (!ch || idx >= rows.length) return;
        const cells = rows[idx].cells;
        const ok = ch.ok;
        // Icon
        cells[0].querySelector('.check-icon').outerHTML = statusIcon(ok);
        // Status text
        cells[1].innerHTML = statusLabel(ok, ch.message);

        // Action buttons (Ollama and ctx only)
        if (key === 'ollama' && ok === false) {
          const actionCell = document.getElementById('action-ollama');
          if (actionCell) { actionCell.innerHTML = ''; actionCell.appendChild(makeInstallBtn('ollama')); }
        } else if (key === 'ctx' && ok === false) {
          const actionCell = document.getElementById('action-ctx');
          if (actionCell) { actionCell.innerHTML = ''; actionCell.appendChild(makeInstallBtn('ctx', 'ctx CLI')); }
        }
      });

      // Overall status badge
      const badge = document.getElementById('status-badge');
      const allOk = checks && Object.values(checks).every(c => c && c.ok === true);
      const anyFail = checks && Object.values(checks).some(c => c && c.ok === false);
      if (allOk) {
        badge.className = 'status-badge status-ok';
        badge.textContent = '✓ All systems OK';
      } else if (anyFail && status === 'degraded') {
        badge.className = 'status-badge status-degraded';
        badge.textContent = '⚠ Running in degraded mode — some dependencies missing';
      } else if (anyFail) {
        badge.className = 'status-badge status-error';
        badge.textContent = '✗ Some dependencies failed';
      } else {
        badge.className = 'status-badge status-loading';
        badge.textContent = '⟳ Checking dependencies…';
      }
    }

    async function pollHealth() {
      try {
        const resp = await fetch(RUNTIME_URL + '/api/health');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        updateTable(data.checks || {}, data.status);

        // If everything checks out and runtime is ok, redirect to app
        const allOk = data.checks && Object.values(data.checks).every(c => c && c.ok === true);
        if (allOk && data.started) {
          window.location.href = RUNTIME_URL;
          return;
        }
      } catch (err) {
        // Runtime not responding yet — keep polling
        console.log('health poll pending:', err.message);
      }
      setTimeout(pollHealth, 2000);
    }

    function appendLog(line) {
      const pre = document.getElementById('log-content');
      const count = document.getElementById('log-count');
      if (pre) {
        const text = pre.textContent || '';
        pre.textContent = text + (text ? '\\n' : '') + line;
        pre.scrollTop = pre.scrollHeight;
      }
      if (count) {
        const n = (pre.textContent || '').split('\\n').filter(Boolean).length;
        count.textContent = n + ' lines';
      }
    }

    // — Event handlers —
    document.getElementById('try-again').addEventListener('click', async () => {
      const btn = document.getElementById('try-again');
      btn.disabled = true; btn.textContent = '⟳ Restarting…';
      try {
        if (window.yodamanDesktop && window.yodamanDesktop.retryRuntime) {
          const result = await window.yodamanDesktop.retryRuntime();
          if (result && result.ok === false) {
            btn.disabled = false; btn.textContent = '⟳ Try Again';
            showToast('Restart failed: ' + result.error, 'error');
          } else {
            showToast('Runtime restarted!', 'success');
          }
          return;
        }
        window.location.href = RUNTIME_URL;
      } catch (err) {
        btn.disabled = false; btn.textContent = '⟳ Try Again';
        showToast('Restart error: ' + err.message, 'error');
      }
    });

    document.getElementById('copy-error').addEventListener('click', async () => {
      const healthText = document.querySelector('table')?.innerText || '';
      const logText = document.getElementById('log-content')?.textContent || '';
      const copyText = 'YodaMan Diagnostics\\n\\n' + healthText + '\\n\\nRuntime Logs:\\n' + logText;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(copyText);
        } else {
          const area = document.createElement('textarea');
          area.value = copyText; area.style.position = 'fixed'; area.style.left = '-9999px';
          document.body.appendChild(area); area.focus(); area.select();
          document.execCommand('copy'); area.remove();
        }
        showToast('Diagnostics copied to clipboard', 'success');
      } catch (err) {
        showToast('Copy failed', 'error');
      }
    });

    document.getElementById('open-dev-tools').addEventListener('click', () => {
      if (window.yodamanDesktop && window.yodamanDesktop.openDevTools) {
        window.yodamanDesktop.openDevTools();
      }
    });

    // — Boot —
    pollHealth();
  </script>
</body>
</html>`;
}

function loadLoadingState(message = 'Starting the local YodaMan runtime...') {
    if (!mainWindow) return;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(diagnosticsPage({
        title: 'Starting YodaMan',
        message: message + ' The dashboard will update automatically as services come online.',
        status: { started: false },
        logs: runtimeLogBuffer.join('\n')
    }))}`);
}

function loadRuntimeUnavailable(error) {
    if (!mainWindow) return;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(diagnosticsPage({
        title: 'YodaMan — Diagnostics Dashboard',
        message: 'The runtime is running but some dependencies need attention. Use the options below to resolve.',
        status: { started: true },
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
        // Show diagnostics dashboard first — it polls /api/health and
        // auto-redirects to the main app when all checks pass.
        loadLoadingState();
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
