// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Docker = require('dockerode');
const ProgressBar = require('electron-progressbar');
const { PassThrough } = require('stream');

const dockerSocket = process.platform === 'win32'
    ? '//./pipe/docker_engine'
    : '/var/run/docker.sock';
console.log(`Используется Docker-сокет: ${dockerSocket}`);

const docker = new Docker({ socketPath: dockerSocket });
let mainWindow;
let currentContainerId = null; // хранит ID активного контейнера

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 575,
        height: 450,
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

    mainWindow.loadFile('index.html');

    // При закрытии окна — пытаемся остановить контейнер
    mainWindow.on('close', () => {
        if (currentContainerId) {
            const container = docker.getContainer(currentContainerId);
            container.stop().catch(()=>{});
            container.remove().catch(()=>{});
            currentContainerId = null;
        }
    });
}

async function pullImage(image) {
    const wc = mainWindow.webContents;
    wc.send('container-log', `Образ "${image}" не найден. Скачиваем…`);
    const bar = new ProgressBar({
        text: `Загрузка ${image}`,
        detail: 'Подготовка…',
        browserWindow: { parent: mainWindow, modal: true },
    });
    const stream = await docker.pull(image);
    await new Promise((resolve, reject) => {
        docker.modem.followProgress(
            stream,
            err => {
                if (err) {
                    wc.send('container-log', `❌ Ошибка скачивания: ${err.message}`);
                    return reject(err);
                }
                bar.setCompleted();
                wc.send('container-log', `Образ "${image}" загружен.`);
                resolve();
            },
            evt => {
                bar.detail = evt.status;
                if (evt.progressDetail?.total) {
                    bar.value = (evt.progressDetail.current / evt.progressDetail.total) * 100;
                }
            }
        );
    });
}

async function runContainer(cfg) {
    const wc = mainWindow.webContents;
    wc.send('container-log', `Получена конфигурация: ${JSON.stringify(cfg)}`);

    const image = 'selector/voiceover';
    try {
        const imgs = await docker.listImages({ filters: { reference: [image] } });
        if (!imgs.length) await pullImage(image);

        const args = [
            '--api_key', cfg.api_key,
            '--ext', cfg.ext,
            '--batch_size', String(cfg.batch_size),
        ];
        if (cfg.n_jobs)        args.push('--n_jobs', String(cfg.n_jobs));
        if (cfg.providers)     args.push('--providers', ...cfg.providers);
        if (cfg.csv_delimiter) args.push('--csv_delimiter', cfg.csv_delimiter);

        const hostConfig = { AutoRemove: true };
        if (cfg.workdir) {
            hostConfig.Binds = [`${cfg.workdir}:/workspace/SynthVoiceRu/workspace`];
        }

        // Если выбрано GPU, добавляем --gpus all
        if (cfg.providers.includes('CUDAExecutionProvider')) {
            hostConfig.DeviceRequests = [{
                Driver: 'nvidia',
                Count: -1,            // -1 означает "все GPU"
                Capabilities: [['gpu']],
            }];
            wc.send('container-log', 'Используем все доступные GPU (--gpus all)');
        }

        wc.send('container-log', `Аргументы: ${args.join(' ')}`);
        const container = await docker.createContainer({ Image: image, Cmd: args, HostConfig: hostConfig });
        currentContainerId = container.id;
        wc.send('container-log', `Создан контейнер ${container.id}`);

        const raw = await container.attach({ stream: true, stdout: true, stderr: true });
        const out = new PassThrough(), errStream = new PassThrough();
        docker.modem.demuxStream(raw, out, errStream);
        out.on('data', chunk => wc.send('container-log', chunk.toString()));
        errStream.on('data', chunk => wc.send('container-log', chunk.toString()));

        await container.start();
        wc.send('container-log', 'Контейнер запущен');
        await container.wait();
        wc.send('container-log', 'Контейнер завершил работу');
        wc.send('container-done');
    } catch (err) {
        wc.send('container-log', `❌ Ошибка: ${err.message}`);
    } finally {
        currentContainerId = null;
    }
}

ipcMain.on('stop-container', async () => {
    if (!currentContainerId) {
        mainWindow.webContents.send('container-log', '⚠ Нет активного контейнера.');
        return;
    }
    const cid = currentContainerId;
    currentContainerId = null;
    try {
        const container = docker.getContainer(cid);
        await container.stop();
        await container.remove().catch(()=>{});
        mainWindow.webContents.send('container-log', '🛑 Контейнер остановлен и удалён.');
    } catch (err) {
        mainWindow.webContents.send('container-log', `❌ Не удалось остановить контейнер: ${err.message}`);
    }
});

ipcMain.handle('select-workdir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return canceled ? null : filePaths[0];
});

app.whenReady().then(async () => {
    try {
        await docker.ping();
        createWindow();

        ipcMain.on('run-container', (_e, cfg) => runContainer(cfg));
        ipcMain.on('minimize-window', () => {
            const w = BrowserWindow.getFocusedWindow();
            if (w) w.minimize();
        });
        ipcMain.on('close-window', () => {
            const w = BrowserWindow.getFocusedWindow();
            if (w) w.close();
        });

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    } catch (err) {
        const { response } = await dialog.showMessageBox({
            type: 'error',
            title: 'Docker недоступен',
            message: 'Не удалось подключиться к Docker-демону.',
            detail: `Ошибка: ${err.message}`,
            buttons: ['Скачать Docker', 'Закрыть'],
            defaultId: 0, cancelId: 1,
        });
        if (response === 0) shell.openExternal('https://www.docker.com/get-started');
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
