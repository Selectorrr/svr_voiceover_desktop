// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Docker = require('dockerode');
const ProgressBar = require('electron-progressbar');

// Выбор пути к Docker-сокету: на Windows — named pipe, иначе — Unix socket
const dockerSocket = process.platform === 'win32'
    ? '//./pipe/docker_engine'
    : '/var/run/docker.sock';
console.log(`Используется Docker-сокет: ${dockerSocket}`);

// Инициализация клиента Docker
const docker = new Docker({ socketPath: dockerSocket });
let mainWindow;

/**
 * Проверяет доступность Docker-демона и пишет результат в лог
 */
async function checkDocker() {
    try {
        await docker.ping();
        console.log('Docker-демон доступен');
        mainWindow.webContents.send('container-log', 'Docker-демон доступен');
    } catch (err) {
        console.error('Не удалось подключиться к Docker-демону', err);
        dialog.showErrorBox('Ошибка Docker', `Не удалось подключиться к Docker-демону:\n${err.message}`);
        mainWindow.webContents.send('container-log', `❌ Не удалось подключиться к Docker-демону: ${err.message}`);
    }
}

/**
 * Создаёт главное окно приложения без системной рамки
 */
function createWindow() {
    console.log('Создаётся главное окно');
    mainWindow = new BrowserWindow({
        width: 800,
        height: 640,
        frame: false,
        autoHideMenuBar: true,
        resizable: false,
        maximizable: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Опционально: открыть DevTools
    mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Рендерер завершил загрузку');
        checkDocker();
    });
}

/**
 * Скачивает образ Docker с прогресс-баром и пишет ход в лог
 * Образ будет загружен только один раз при отсутствии локально
 * @param {string} image — имя Docker-образа
 */
async function pullImage(image) {
    const wc = mainWindow.webContents;
    wc.send('container-log', `Образ "${image}" не найден локально. Сейчас он будет загружен один раз…`);

    try {
        const bar = new ProgressBar({
            text: `Загрузка образа ${image}`,
            detail: 'Подготовка…',
            browserWindow: { parent: mainWindow, modal: true },
        });

        const stream = await docker.pull(image);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(
                stream,
                err => {
                    if (err) {
                        console.error('Ошибка загрузки образа', err);
                        wc.send('container-log', `❌ Ошибка при загрузке образа: ${err.message}`);
                        return reject(err);
                    }
                    bar.setCompleted();
                    wc.send('container-log', `Образ "${image}" успешно загружен.`);
                    resolve();
                },
                evt => {
                    bar.detail = evt.status;
                    if (evt.progressDetail && evt.progressDetail.total) {
                        bar.value = (evt.progressDetail.current / evt.progressDetail.total) * 100;
                    }
                }
            );
        });
    } catch (err) {
        dialog.showErrorBox('Ошибка загрузки образа', err.message);
        throw err;
    }
}

/**
 * Запускает контейнер с указанными параметрами и транслирует логи в UI
 * @param {object} cfg — объект конфигурации (api_key, ext, tone_sample_len, batch_size, n_jobs, providers)
 */
async function runContainer(cfg) {
    const wc = mainWindow.webContents;
    wc.send('container-log', `Получена конфигурация: ${JSON.stringify(cfg)}`);

    const image = 'selector/voiceover';
    try {
        // Проверяем, есть ли образ локально
        const images = await docker.listImages({ filters: { reference: [image] } });
        if (images.length === 0) {
            wc.send('container-log', `Образ "${image}" не найден локально, начинаем загрузку…`);
            await pullImage(image);
        } else {
            wc.send('container-log', `Образ "${image}" найдён локально, пропускаем загрузку.`);
        }

        // Формируем аргументы для запуска entrypoint.py
        const args = [
            '--api_key', cfg.api_key,
            '--ext', cfg.ext,
            '--tone_sample_len', String(cfg.tone_sample_len),
            '--batch_size', String(cfg.batch_size),
        ];
        if (cfg.n_jobs)    args.push('--n_jobs', String(cfg.n_jobs));
        if (cfg.providers && cfg.providers.length) args.push('--providers', ...cfg.providers);

        wc.send('container-log', `Аргументы контейнера: ${args.join(' ')}`);

        // Создаём и запускаем контейнер
        const container = await docker.createContainer({
            Image: image,
            Cmd: args,
            HostConfig: { AutoRemove: true },
        });
        wc.send('container-log', `Создан контейнер с ID: ${container.id}`);

        const logStream = await container.attach({ stream: true, stdout: true, stderr: true });
        logStream.on('data', chunk => {
            wc.send('container-log', chunk.toString());
        });

        await container.start();
        wc.send('container-log', 'Контейнер запущен');

        await container.wait();
        wc.send('container-log', 'Контейнер завершил выполнение');
        wc.send('container-done');
    } catch (err) {
        console.error('Ошибка при запуске контейнера', err);
        wc.send('container-log', `❌ Ошибка при запуске контейнера: ${err.message}`);
    }
}

// Точка входа приложения
app.whenReady().then(() => {
    createWindow();

    ipcMain.on('run-container', (_evt, cfg) => {
        runContainer(cfg);
    });

    // Обработчик сворачивания окна
    ipcMain.on('minimize-window', () => {
        const w = BrowserWindow.getFocusedWindow();
        if (w) w.minimize();
    });

    // Обработчик закрытия окна
    ipcMain.on('close-window', () => {
        const w = BrowserWindow.getFocusedWindow();
        if (w) w.close();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Закрываем приложение, когда все окна закрыты (кроме macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
