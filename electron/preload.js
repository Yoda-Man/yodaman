const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yodamanDesktop', {
    pickWorkspaceFolder: () => ipcRenderer.invoke('yodaman:pick-project-folder'),
    retryRuntime: () => ipcRenderer.invoke('yodaman:retry-runtime')
});
