/**
 * Electron main process used only by GraphRenderSmoke.test.js.
 *
 * Loads a Graphify artifact and reports whether the rendering library actually
 * executed. Nothing imports this — Electron is handed the path on the command
 * line.
 *
 * "The endpoint returned HTML" is not the same as "the graph renders". In 0.5.1
 * the artifact was served correctly, 2.1MB of it, with every node and edge
 * present — and the canvas was empty, because the one <script> that draws it
 * had been blocked. Only a real browser can tell those apart.
 */
const { app, BrowserWindow } = require('electron');

const PROBE_URL = process.env.PROBE_URL;
const RENDER_TIMEOUT_MS = Number(process.env.PROBE_RENDER_TIMEOUT_MS || 20000);

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

    // Signature differs across Electron majors — accept both shapes.
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

    // The library loads and draws asynchronously — poll rather than guess.
    const deadline = Date.now() + RENDER_TIMEOUT_MS;
    let state = { visDefined: false, hasNetwork: false, hasDataSet: false, canvases: 0 };

    while (Date.now() < deadline) {
        try {
            state = JSON.parse(await win.webContents.executeJavaScript(`
                (() => JSON.stringify({
                    visDefined: typeof vis !== 'undefined',
                    hasNetwork: typeof vis !== 'undefined' && !!vis.Network,
                    hasDataSet: typeof vis !== 'undefined' && !!vis.DataSet,
                    // The canvas is what a blocked script fails to produce, and
                    // what an empty Graph Studio is missing.
                    canvases: document.querySelectorAll('canvas').length
                }))()
            `));
        } catch (error) {
            failures.push(`executeJavaScript failed: ${error.message}`);
            break;
        }

        if (state.canvases > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    report({
        ok: state.visDefined && state.hasNetwork && state.canvases > 0 && failures.length === 0,
        ...state,
        consoleErrors,
        failures
    });
});
