const { contextBridge, ipcRenderer } = require('electron');

// Экспонируем API для рендера до загрузки DOM
contextBridge.exposeInMainWorld('api', {
    runContainer: (cfg) => ipcRenderer.send('run-container', cfg),
    onLog: (cb) => ipcRenderer.on('container-log', (_evt, line) => cb(line)),
    onDone: (cb) => ipcRenderer.once('container-done', () => cb()),
});

// После загрузки страницы вставляем версии зависимостей
window.addEventListener('DOMContentLoaded', () => {
    /**
     * Заменяет текст в элементе с указанным ID
     * @param {string} selector - ID элемента
     * @param {string} text - текст для вставки
     */
    const replaceText = (selector, text) => {
        const el = document.getElementById(selector);
        if (el) el.innerText = text;
    };

    for (const name of ['chrome', 'node', 'electron']) {
        replaceText(`${name}-version`, process.versions[name] || 'unknown');
    }
});