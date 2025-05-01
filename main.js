const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Docker = require('dockerode');
const ProgressBar = require('electron-progressbar');

// Выбор socketPath для Docker: Unix socket на Linux/macOS, named pipe на Windows
const dockerSocket = process.platform === 'win32'
    ? '//./pipe/docker_engine'
    : '/var/run/docker.sock';
console.log(`[Main] Using Docker socket: ${dockerSocket}`);

// Инициализация Docker клиента
const docker = new Docker({ socketPath: dockerSocket });
let mainWindow;

/**
 * Проверяет соединение с Docker daemon и логирует результат
 */
async function checkDocker() {
    try {
        await docker.ping();
        console.log('[Main] Docker daemon is reachable');
        mainWindow.webContents.send('container-log', '[Main] Docker daemon is reachable');
    } catch (err) {
        console.error('[Main] Docker ping failed', err);
        dialog.showErrorBox('Docker Error', `Cannot connect to Docker daemon:\n${err.message}`);
        mainWindow.webContents.send('container-log', `❌ Docker ping failed: ${err.message}`);
    }
}

/**
 * Создает главное окно приложения
 */
function createWindow() {
    console.log('[Main] Creating main window');
    mainWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Открываем DevTools для отладки
    mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('[Main] Renderer finished loading');
        checkDocker();
    });
}

/**
 * Скачивает Docker образ с прогресс-баром и логирует прогресс
 * @param {string} image - имя образа
 */
async function pullImage(image) {
    const wc = mainWindow.webContents;
    wc.send('container-log', `[Main] pullImage: pull "${image}"`);
    console.log(`[Main] pullImage: pulling "${image}"`);

    try {
        const bar = new ProgressBar({
            text: `Pulling ${image}`,
            detail: 'Starting…',
            browserWindow: { parent: mainWindow, modal: true },
        });
        const stream = await docker.pull(image);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(
                stream,
                (err) => {
                    if (err) {
                        console.error('[Main] pullImage error', err);
                        wc.send('container-log', `❌ pullImage error: ${err.message}`);
                        return reject(err);
                    }
                    bar.setCompleted();
                    console.log(`[Main] pullImage: obtained "${image}"`);
                    wc.send('container-log', `[Main] pullImage: obtained "${image}"`);
                    resolve();
                },
                (evt) => {
                    bar.detail = evt.status;
                    if (evt.progressDetail && evt.progressDetail.total) {
                        bar.value = (evt.progressDetail.current / evt.progressDetail.total) * 100;
                    }
                }
            );
        });
    } catch (err) {
        dialog.showErrorBox('Image Pull Error', err.message);
        throw err;
    }
}

/**
 * Запускает контейнер с параметрами и стримит логи в UI
 * @param {object} cfg - конфигурация
 */
async function runContainer(cfg) {
    const wc = mainWindow.webContents;
    console.log('[Main] runContainer called with config:', cfg);
    wc.send('container-log', `[Main] runContainer config: ${JSON.stringify(cfg)}`);

    const image = 'selector/voiceover';
    try {
        // Проверяем наличие образа
        const imgs = await docker.listImages({ filters: { reference: [image] } });
        if (imgs.length === 0) {
            wc.send('container-log', `[Main] Image "${image}" not found locally, pulling...`);
            await pullImage(image);
        } else {
            wc.send('container-log', `[Main] Image "${image}" is local, skipping pull.`);
        }

        // Формируем аргументы для entrypoint.py
        const args = [
            '--api_key', cfg.api_key,
            '--ext', cfg.ext,
            '--tone_sample_len', String(cfg.tone_sample_len),
            '--batch_size', String(cfg.batch_size),
        ];
        if (cfg.n_jobs) args.push('--n_jobs', String(cfg.n_jobs));
        if (Array.isArray(cfg.providers) && cfg.providers.length) args.push('--providers', ...cfg.providers);

        console.log('[Main] Container args:', args);
        wc.send('container-log', `[Main] Container args: ${args.join(' ')}`);

        // Создаём контейнер, передавая только аргументы (ENTRYPOINT уже задан в образе)
        const container = await docker.createContainer({
            Image: image,
            Cmd: args,
            HostConfig: { AutoRemove: true },
        });
        console.log('[Main] Created container ID:', container.id);
        wc.send('container-log', `[Main] Created container ID: ${container.id}`);

        const stream = await container.attach({ stream: true, stdout: true, stderr: true });
        stream.on('data', chunk => {
            const msg = chunk.toString();
            console.log('[Container]', msg.trim());
            wc.send('container-log', msg);
        });

        await container.start();
        console.log('[Main] Container started');
        wc.send('container-log', `[Main] Container started`);

        await container.wait();
        console.log('[Main] Container finished execution');
        wc.send('container-log', `[Main] Container finished execution`);
        wc.send('container-done');
    } catch (err) {
        console.error('[Main] runContainer error', err);
        wc.send('container-log', `❌ Error: ${err.message}`);
    }
}

// Запуск приложения
app.whenReady().then(() => {
    console.log('[Main] App is ready');
    createWindow();
    ipcMain.on('run-container', (_evt, cfg) => {
        console.log('[Main] Received run-container');
        runContainer(cfg);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
