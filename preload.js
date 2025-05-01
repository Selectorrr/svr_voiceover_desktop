const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    runContainer: cfg       => ipcRenderer.send('run-container', cfg),
    onLog:       cb         => ipcRenderer.on('container-log', (_e, line) => cb(line)),
    onDone:      cb         => ipcRenderer.on('container-done', () => cb()),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    closeWindow: ()         => ipcRenderer.send('close-window'),
    selectWorkdir: () => ipcRenderer.invoke('select-workdir'),
});

window.addEventListener('DOMContentLoaded', () => {
    ['chrome','node','electron'].forEach(name => {
        const el = document.getElementById(`${name}-version`);
        if (el) el.innerText = process.versions[name] || 'unknown';
    });
});
