/**
 * Electron main process used only by DesktopRenderSmoke.test.js.
 *
 * Loads the runtime URL the desktop app loads, waits for React to mount, and
 * prints one JSON line the test parses. Nothing imports this — Electron is
 * handed the path on the command line.
 */
const { app, BrowserWindow } = require('electron');

const PROBE_URL = process.env.PROBE_URL;
const MOUNT_TIMEOUT_MS = Number(process.env.PROBE_MOUNT_TIMEOUT_MS || 20000);

const consoleErrors = [];

function recordConsole(level, message, sourceId, line) {
    // Electron levels: 0 verbose, 1 info, 2 warning, 3 error.
    if (Number(level) >= 3) {
        consoleErrors.push(`${message} (${sourceId}:${line})`);
    }
}

function report(result) {
    console.log(`PROBE_RESULT ${JSON.stringify(result)}`);
    app.exit(0);
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 820,
        webPreferences: { contextIsolation: true, nodeIntegration: false }
    });

    // The signature changed across Electron majors: older builds pass positional
    // args, newer ones a details object. Accept both so the probe survives upgrades.
    win.webContents.on('console-message', (...args) => {
        if (args.length >= 2 && args[1] && typeof args[1] === 'object') {
            const details = args[1];
            recordConsole(details.level === 'error' ? 3 : 0, details.message, details.sourceId, details.lineNumber);
        } else {
            const [, level, message, line, sourceId] = args;
            recordConsole(level, message, sourceId, line);
        }
    });

    const failures = [];
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
        failures.push(`did-fail-load ${code} ${description} ${url}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
        failures.push(`render-process-gone ${JSON.stringify(details)}`);
    });

    try {
        await win.loadURL(PROBE_URL);
    } catch (error) {
        report({ ok: false, reason: `loadURL failed: ${error.message}`, consoleErrors, failures });
        return;
    }

    // React mounts asynchronously — poll rather than guess a single sleep.
    //
    // AppErrorBoundary renders INTO #root, so "#root has children" is true even
    // when the UI has crashed. Every check below must therefore also confirm the
    // boundary is not what is on screen.
    const deadline = Date.now() + MOUNT_TIMEOUT_MS;
    let mounted = { rootChildren: 0, bodyTextLength: 0, rootMissing: false, errorBoundary: null };

    while (Date.now() < deadline) {
        try {
            mounted = JSON.parse(await win.webContents.executeJavaScript(`
                (() => {
                    const root = document.getElementById('root');
                    const text = (document.body.innerText || '').trim();
                    // Matches AppErrorBoundary's heading; the <pre> holds the message.
                    const crashed = text.includes('YodaMan hit a display error');
                    const detail = document.querySelector('#root pre');
                    return JSON.stringify({
                        rootMissing: !root,
                        rootChildren: root ? root.childElementCount : 0,
                        bodyTextLength: text.length,
                        errorBoundary: crashed ? ((detail && detail.textContent) || 'shown, message unavailable') : null
                    });
                })()
            `));
        } catch (error) {
            failures.push(`executeJavaScript failed: ${error.message}`);
            break;
        }

        // A crash is terminal — stop polling and report it rather than waiting out
        // the timeout for a render that is never coming.
        if (mounted.errorBoundary) break;
        if (mounted.rootChildren > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    report({
        ok: mounted.rootChildren > 0 && !mounted.errorBoundary && failures.length === 0,
        ...mounted,
        title: win.webContents.getTitle(),
        consoleErrors,
        failures
    });
});
