// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const ProgressBar = require('electron-progressbar');
const { PassThrough } = require('stream');
const fs = require('fs/promises');

const Docker = require('dockerode');


// для дебага — просто посмотреть, что видит процесс
console.log('DOCKER_HOST =', process.env.DOCKER_HOST);
console.log('DOCKER_CONTEXT =', process.env.DOCKER_CONTEXT);

// пусть dockerode сам решает, как коннектиться (как docker CLI)
const docker = new Docker();

let mainWindow;
let currentContainerId = null; // хранит ID активного контейнера
let currentRunToken = null;    // токен активного запуска (передаём из renderer)

function createWindow() {
    let iconName;
    if (process.platform === 'darwin') {
        iconName = 'icon.icns';
    } else if (process.platform === 'win32') {
        iconName = 'icon.ico';
    } else {
        iconName = 'icon.png';
    }
    let iconPath = path.join(__dirname, 'assets', iconName);

    mainWindow = new BrowserWindow({
        title: 'SVR Voiceover Desktop',
        width: 575,
        height: 730,
        frame: false,
        autoHideMenuBar: true,
        resizable: false,
        maximizable: false,
        icon: iconPath,
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
            currentRunToken = null;
        }
    });
}

async function pullImage(image, sendLog) {
    sendLog(`Образ "${image}" не найден. Скачиваем…`);
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
                    sendLog(`❌ Ошибка скачивания: ${err.message}`);
                    return reject(err);
                }
                bar.setCompleted();
                sendLog(`Образ "${image}" загружен.`);
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
    const mode = cfg.mode || 'synthesize';

    // токен запуска приходит из renderer; нужен, чтобы игнорировать "поздние" done/log от прошлого запуска
    const runToken = cfg?._runToken ?? null;

    const sendLog = (line) => wc.send('container-log', { runToken, line: String(line ?? '') });
    const sendDone = (reason, extra = {}) => wc.send('container-done', { runToken, reason, ...extra });

    // помечаем текущий запуск
    currentRunToken = runToken;

    sendLog(`Режим: ${mode}`);
    sendLog(`Получена конфигурация: ${JSON.stringify(cfg)}`);

    const image = 'selector/voiceover:latest';
    let localContainerId = null;
    try {
        const imgs = await docker.listImages({ filters: { reference: [image] } });
        if (!imgs.length) await pullImage(image, sendLog);

        const hostConfig = { AutoRemove: true };
        if (cfg.workdir) {
            hostConfig.Binds = [`${cfg.workdir}:/workspace/SynthVoiceRu/workspace`];
        }

        // GPU только для основной озвучки (если нужно — можешь оставить и для других)
        if (cfg.providers && cfg.providers.includes('CUDAExecutionProvider')) {
            hostConfig.DeviceRequests = [{
                Driver: 'nvidia',
                Count: -1,
                Capabilities: [['gpu']],
            }];
            sendLog('Используем все доступные GPU (--gpus all)');
        }

        let createOptions = { Image: image, HostConfig: hostConfig };


        if (mode === 'synthesize') {
            const pushArg = (arr, key, value) => {
                if (value === undefined || value === null) return;
                const v = String(value);
                if (v === 'NaN' || v.trim() === '') return;
                arr.push(key, v);
            };

            const args = [
                '--api_key', cfg.api_key,
                '--ext', cfg.ext,
                '--batch_size', String(cfg.batch_size),
                '--csv_delimiter', cfg.csv_delimiter || ',',
                '--path_filter', cfg.path_filter || '',
            ];

            if (cfg.n_jobs)    args.push('--n_jobs', String(cfg.n_jobs));
            if (cfg.providers) args.push('--providers', ...cfg.providers);

            // MOS: включить/выключить
            if (cfg.is_respect_mos === false) args.push('--no_respect_mos');
            else args.push('--is_respect_mos');

            pushArg(args, '--tone_sample_len', cfg.tone_sample_len);
            pushArg(args, '--reinit_every', cfg.reinit_every);
            pushArg(args, '--prosody_cond', cfg.prosody_cond);
            pushArg(args, '--min_prosody_len', cfg.min_prosody_len);
            pushArg(args, '--speed_search_attempts', cfg.speed_search_attempts);
            pushArg(args, '--speed_adjust_step_pct', cfg.speed_adjust_step_pct);
            pushArg(args, '--speed_clip_min', cfg.speed_clip_min);
            pushArg(args, '--speed_clip_max', cfg.speed_clip_max);
            pushArg(args, '--max_extra_speed', cfg.max_extra_speed);

            // Допуски по длине результата (зависят от длины реплики)
            pushArg(args, '--len_t_short', cfg.len_t_short);
            pushArg(args, '--len_t_long', cfg.len_t_long);
            pushArg(args, '--max_longer_pct_short', cfg.max_longer_pct_short);
            pushArg(args, '--max_longer_pct_long', cfg.max_longer_pct_long);
            pushArg(args, '--max_shorter_pct_short', cfg.max_shorter_pct_short);
            pushArg(args, '--max_shorter_pct_long', cfg.max_shorter_pct_long);
            pushArg(args, '--vc_type', cfg.vc_type);

            sendLog(`Аргументы entrypoint: ${args.join(' ')}`);

            // для основной озвучки не трогаем Entrypoint — используем тот, что в образе
            createOptions.Cmd = args;

        } else if (mode === 'lipsync') {
            sendLog('Запуск lipsync.py');
            createOptions.Entrypoint = ['python', 'lipsync.py'];
            createOptions.Cmd = [];

        } else if (mode === 'align') {
            sendLog('Запуск align.py');
            const cmd = [];
            if (cfg.align_use_voice_len) {
                cmd.push('--use-voice-len');
            }
            createOptions.Entrypoint = ['python', 'align.py'];
            createOptions.Cmd = cmd;

        } else if (mode === 'mixing') {
            sendLog('Запуск mixing.py');
            createOptions.Entrypoint = ['python', 'mixing.py'];
            createOptions.Cmd = [];

        } else {
            throw new Error(`Неизвестный режим: ${mode}`);
        }

        const container = await docker.createContainer(createOptions);
        localContainerId = container.id;
        currentContainerId = container.id;
        sendLog(`Создан контейнер ${container.id}`);

        const raw = await container.attach({ stream: true, stdout: true, stderr: true });
        const out = new PassThrough(), errStream = new PassThrough();
        docker.modem.demuxStream(raw, out, errStream);
        const norm = (b) => b.toString('utf8').replace(/\r/g, '\n');

        out.on('data', chunk => sendLog(norm(chunk)));
        errStream.on('data', chunk => sendLog(norm(chunk)));


        await container.start();
        sendLog('Контейнер запущен');
        const result = await container.wait();
        sendLog('Контейнер завершил работу');
        sendDone('finished', { statusCode: result?.StatusCode });
    } catch (err) {
        sendLog(`❌ Ошибка: ${err.message}`);
        sendDone('error', { error: err.message });
    } finally {
        // не затираем состояние, если уже начат новый запуск
        if (currentRunToken === runToken) {
            currentContainerId = null;
            currentRunToken = null;
        }
    }
}


ipcMain.on('stop-container', async () => {
    const wc = mainWindow.webContents;
    const token = currentRunToken;
    const sendLog = (line) => wc.send('container-log', { runToken: token, line: String(line ?? '') });
    const sendDone = (reason, extra = {}) => wc.send('container-done', { runToken: token, reason, ...extra });

    if (!currentContainerId) {
        sendLog('⚠ Нет активного контейнера.');
        return;
    }
    const cid = currentContainerId;
    try {
        const container = docker.getContainer(cid);
        await container.stop();
        await container.remove().catch(()=>{});
        sendLog('🛑 Контейнер остановлен и удалён.');
    } catch (err) {
        sendLog(`❌ Не удалось остановить контейнер: ${err.message}`);
    }
    finally {
        // завершаем именно текущий запуск
        if (currentContainerId === cid) currentContainerId = null;
        if (currentRunToken === token) currentRunToken = null;
        sendDone('stopped');
    }
});

ipcMain.handle('select-workdir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return canceled ? null : filePaths[0];
});

app.whenReady().then(async () => {
    try {
        await docker.ping();
        console.log('docker.ping OK');
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
        console.error('docker.ping error:', err);
        const { response } = await dialog.showMessageBox({
            type: 'error',
            title: 'Docker недоступен',
            message: 'Не удалось подключиться к Docker-демону.',
            detail: `Ошибка: ${err.message}`,
            buttons: ['Скачать Docker', 'Закрыть'],
            defaultId: 0, cancelId: 1,
        });
        if (response === 0) {
            await shell.openExternal('https://www.docker.com/get-started');
        }
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});


async function copyRecursive(srcDir, destDir) {
    await fs.mkdir(destDir, { recursive: true });
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath  = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            // рекурсивно копируем вложенную папку
            await copyRecursive(srcPath, destPath);
        } else if (entry.isFile()) {
            // проверяем перезапись
            let exists = false;
            try {
                await fs.access(destPath);
                exists = true;
            } catch {}
            if (exists) {
                const { response } = await dialog.showMessageBox({
                    type: 'question',
                    buttons: ['Перезаписать','Пропустить','Отмена'],
                    defaultId: 0, cancelId: 2,
                    title: 'Перезапись файла',
                    message: `Файл "${entry.name}" уже есть.`,
                    detail: 'Что сделать?'
                });
                if (response === 2) throw new Error('Операция отменена');
                if (response === 1) continue; // пропустить
            }
            await fs.copyFile(srcPath, destPath);
        }
    }
}

ipcMain.handle('populate-sample', async (_e, targetDir) => {
    try {
        const samplesDir = path.join(__dirname, 'samples');
        await copyRecursive(samplesDir, targetDir);
        return { success: true };
    } catch (err) {
        const msg = err.message === 'Операция отменена'
            ? 'Копирование отменено'
            : err.message;
        return { success: false, message: msg };
    }
});

ipcMain.handle('open-workdir', async (_e, targetDir) => {
    if (!targetDir) return { success: false, message: 'Папка не выбрана' };
    try {
        await shell.openPath(targetDir);
        return { success: true };
    } catch (err) {
        console.error('open-workdir error', err);
        return { success: false, message: err.message };
    }
});