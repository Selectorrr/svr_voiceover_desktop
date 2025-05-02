const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    runContainer: cfg       => ipcRenderer.send('run-container', cfg),
    onLog:       cb         => ipcRenderer.on('container-log', (_e, line) => cb(line)),
    onDone:      cb         => ipcRenderer.on('container-done', () => cb()),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    closeWindow: ()         => ipcRenderer.send('close-window'),
    selectWorkdir: () => ipcRenderer.invoke('select-workdir'),
    stopContainer: () => ipcRenderer.send('stop-container'),
    populateSample: (dir)  => ipcRenderer.invoke('populate-sample', dir),
    openWorkdir:      dir   => ipcRenderer.invoke('open-workdir', dir),
});

window.addEventListener('DOMContentLoaded', () => {
    ['chrome','node','electron'].forEach(name => {
        const el = document.getElementById(`${name}-version`);
        if (el) el.innerText = process.versions[name] || 'unknown';
    });
    const tooltipTriggerList = [].slice.call(
        document.querySelectorAll('[data-bs-toggle="tooltip"]')
    );
    tooltipTriggerList.forEach(el => new bootstrap.Tooltip(el));
});
