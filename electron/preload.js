/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT".
 *
 * Electron preload script. Loaded by path, not by import, from electron/main.js:
 *     webPreferences: { preload: path.join(__dirname, 'preload.js') }
 * It is the only bridge exposing the yodamanDesktop API to the renderer.
 *
 * See docs/dead-code.md for the full list of files in this category.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yodamanDesktop', {
    pickWorkspaceFolder: () => ipcRenderer.invoke('yodaman:pick-project-folder'),
    retryRuntime: () => ipcRenderer.invoke('yodaman:retry-runtime'),
    installDependency: (component) => ipcRenderer.invoke('yodaman:install-dependency', component),
    openDevTools: () => ipcRenderer.invoke('yodaman:open-dev-tools')
});
