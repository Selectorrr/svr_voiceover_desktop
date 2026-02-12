const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    runContainer: cfg       => ipcRenderer.send('run-container', cfg),
    // payload format:
    //  - container-log:  { runToken, line }
    //  - container-done: { runToken, reason, statusCode?, error? }
    onLog:       cb         => ipcRenderer.on('container-log', (_e, payload) => cb(payload)),
    onDone:      cb         => ipcRenderer.on('container-done', (_e, payload) => cb(payload)),
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    closeWindow: ()         => ipcRenderer.send('close-window'),
    selectWorkdir: () => ipcRenderer.invoke('select-workdir'),
    stopContainer: () => ipcRenderer.send('stop-container'),
    populateSample: (dir)  => ipcRenderer.invoke('populate-sample', dir),
    openWorkdir:      dir   => ipcRenderer.invoke('open-workdir', dir),

    // Docker image update notifications
    onImageUpdate: cb => ipcRenderer.on('image-update', (_e, payload) => cb(payload)),
    checkImageUpdateNow: () => ipcRenderer.invoke('check-image-update-now'),
    pullImageUpdate: () => ipcRenderer.invoke('pull-image-update'),
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
