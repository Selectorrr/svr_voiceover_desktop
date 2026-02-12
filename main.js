// main.js
const {app, BrowserWindow, ipcMain, dialog, shell} = require('electron');
const path = require('path');
const ProgressBar = require('electron-progressbar');
const {PassThrough} = require('stream');
const fs = require('fs/promises');

const Docker = require('dockerode');
const https = require('https');

// --- Docker image auto-update (safe, non-spammy) ---
const VOICEOVER_IMAGE = 'selector/voiceover:latest';
// interval can be changed later if needed
const IMAGE_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
let imageUpdateTimer = null;
let imageUpdateInProgress = false;
let lastNotifiedRemoteDigest = null;
let lastNotifiedMissing = false;


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
            container.stop().catch(() => {
            });
            container.remove().catch(() => {
            });
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
        browserWindow: {parent: mainWindow, modal: true},
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

async function inspectImageIdSafe(image) {
    try {
        const info = await docker.getImage(image).inspect();
        return info?.Id || null;
    } catch {
        return null;
    }
}

function inspectImageDigestSafe(image) {
    return docker.getImage(image).inspect().then(info => {
        const digs = Array.isArray(info?.RepoDigests) ? info.RepoDigests : [];
        // ожидаем что-то вроде: selector/voiceover@sha256:...
        const hit = digs.find(d => (d || '').startsWith('selector/voiceover@sha256:'));
        return hit ? hit.split('@')[1] : null;
    }).catch(() => null);
}

function httpsRequest(opts) {
    return new Promise((resolve, reject) => {
        const req = https.request(opts, (res) => {
            const chunks = [];
            res.on('data', (d) => chunks.push(d));
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        req.on('error', reject);
        req.end();
    });
}

// Получить digest манифеста Docker Hub для selector/voiceover:latest
async function getRemoteDigestDockerHubSafe() {
    try {
        // 1) токен
        const tokenRes = await httpsRequest({
            method: 'GET',
            host: 'auth.docker.io',
            path: '/token?service=registry.docker.io&scope=repository:selector/voiceover:pull',
            headers: { 'User-Agent': 'svr-voiceover-desktop' },
        });
        if (tokenRes.statusCode !== 200) return null;
        const token = JSON.parse(tokenRes.body || '{}')?.token;
        if (!token) return null;

        // 2) HEAD по манифесту, чтобы взять Docker-Content-Digest
        const manRes = await httpsRequest({
            method: 'HEAD',
            host: 'registry-1.docker.io',
            path: '/v2/selector/voiceover/manifests/latest',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
                'User-Agent': 'svr-voiceover-desktop',
            },
        });
        const digest = manRes?.headers?.['docker-content-digest'];
        return digest || null;
    } catch {
        return null;
    }
}

// Проверка наличия обновления (без pull). Никогда не кидает ошибки в UI.
async function checkImageUpdateSafe({manual = false} = {}) {
    if (!mainWindow) return;
    if (imageUpdateInProgress) return;

    imageUpdateInProgress = true;
    const wc = mainWindow.webContents;
    const notify = (payload) => {
        try {
            wc.send('image-update', payload);
        } catch {
        }
    };

    try {
        const localId = await inspectImageIdSafe(VOICEOVER_IMAGE);
        const localDigest = localId ? await inspectImageDigestSafe(VOICEOVER_IMAGE) : null;
        const remoteDigest = await getRemoteDigestDockerHubSafe();

        // Всегда отправляем «тихий» статус для UI (бейдж справа сверху)
        // state:
        //  - fresh: локальный digest совпадает с удалённым
        //  - stale: есть обновление
        //  - unknown: не удалось определить (нет docker/сети/образа)
        let state = 'unknown';
        if (!localId) {
            state = 'missing';
        } else if (localDigest && remoteDigest) {
            state = (localDigest === remoteDigest) ? 'fresh' : 'stale';
        }
        notify({type: 'status', state, localDigest, remoteDigest});

        // Если образ не скачан локально — предлагаем скачать (это тот же pull)
        if (!localId) {
            if (manual || !lastNotifiedMissing) {
                lastNotifiedMissing = true;
                notify({
                    type: 'available',
                    message: 'Docker-образ не найден локально. Нажми «Обновить», чтобы скачать его.',
                    localDigest: null,
                    remoteDigest,
                });
            }
            return;
        }

        if (localDigest && remoteDigest && localDigest !== remoteDigest) {
            // не спамим: уведомляем один раз на новый digest
            if (lastNotifiedRemoteDigest !== remoteDigest) {
                lastNotifiedRemoteDigest = remoteDigest;
                notify({
                    type: 'available',
                    message: 'Доступно обновление Docker-образа (selector/voiceover:latest).',
                    localDigest,
                    remoteDigest,
                });
            }
        } else if (manual) {
            notify({
                type: 'info',
                message: remoteDigest ? 'Docker-образ уже актуален.' : 'Docker-образ уже актуален (не удалось проверить digest на Docker Hub).'
            });
        }
    } catch (err) {
        // важно: не шумим ошибками в UI, только если ручная проверка
        console.warn('image update check failed:', err?.message || err);
        // UI-бейдж: «не удалось проверить»
        try {
            notify({type: 'status', state: 'unknown'});
        } catch {
        }
        if (manual) {
            notify({
                type: 'info',
                message: 'Не удалось проверить обновление Docker-образа (можно проигнорировать).'
            });
        }
    } finally {
        imageUpdateInProgress = false;
    }
}

// Реальное обновление: docker pull. По завершению — предлагаем перезапуск, если контейнер был запущен.
async function pullImageUpdateSafe() {
    if (!mainWindow) return {ok: false};
    if (imageUpdateInProgress) return {ok: false};

    imageUpdateInProgress = true;
    const wc = mainWindow.webContents;
    const notify = (payload) => {
        try {
            wc.send('image-update', payload);
        } catch {
        }
    };

    const wasRunning = !!currentContainerId;

    try {
        notify({type: 'pull-start', message: 'Обновляю Docker-образ…'});

        const stream = await docker.pull(VOICEOVER_IMAGE);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
        });

        // после pull сбрасываем анти-спам, чтобы следующая проверка могла снова сообщить, если появится новый digest
        lastNotifiedRemoteDigest = null;

        notify({type: 'updated', message: 'Docker-образ обновлён.'});

        // обновим статус в UI сразу после pull
        try {
            const localDigest = await inspectImageDigestSafe(VOICEOVER_IMAGE);
            const remoteDigest = await getRemoteDigestDockerHubSafe();
            let state = 'unknown';
            if (localDigest && remoteDigest) {
                state = (localDigest === remoteDigest) ? 'fresh' : 'stale';
            }
            notify({type: 'status', state, localDigest, remoteDigest});
        } catch {
            // молча
        }

        if (wasRunning) {
            notify({type: 'restart-offer', message: 'Озвучка сейчас запущена. Перезапустить, чтобы применить обновление?'});
        }
        return {ok: true, wasRunning};
    } catch (err) {
        console.warn('image pull failed:', err?.message || err);
        notify({type: 'danger', message: 'Не удалось обновить Docker-образ (можно попробовать позже).'});
        return {ok: false, error: err?.message || String(err)};
    } finally {
        imageUpdateInProgress = false;
    }
}

async function runContainer(cfg) {
    const wc = mainWindow.webContents;
    const mode = cfg.mode || 'synthesize';

    // токен запуска приходит из renderer; нужен, чтобы игнорировать "поздние" done/log от прошлого запуска
    const runToken = cfg?._runToken ?? null;

    const sendLog = (line) => wc.send('container-log', {runToken, line: String(line ?? '')});
    const sendDone = (reason, extra = {}) => wc.send('container-done', {runToken, reason, ...extra});

    // помечаем текущий запуск
    currentRunToken = runToken;

    sendLog(`Режим: ${mode}`);
    sendLog(`Получена конфигурация: ${JSON.stringify(cfg)}`);

    const image = VOICEOVER_IMAGE;
    let localContainerId = null;
    try {
        const imgs = await docker.listImages({filters: {reference: [image]}});
        if (!imgs.length) await pullImage(image, sendLog);

        const hostConfig = {AutoRemove: true};
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

        let createOptions = {Image: image, HostConfig: hostConfig};


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

            if (cfg.n_jobs) args.push('--n_jobs', String(cfg.n_jobs));
            if (cfg.providers) args.push('--providers', ...cfg.providers);

            // MOS: включить/выключить
            if (cfg.is_respect_mos === false) args.push('--no_respect_mos');
            else args.push('--is_respect_mos');

            pushArg(args, '--put_yo', cfg.put_yo);
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

        const raw = await container.attach({stream: true, stdout: true, stderr: true});
        const out = new PassThrough(), errStream = new PassThrough();
        docker.modem.demuxStream(raw, out, errStream);
        const stripAnsi = (s) => {
            // basic ANSI escape removal (tqdm, colors, cursor controls)
            return s
                .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
                .replace(/\x1b\][^\x07]*\x07/g, '');
        };
// IMPORTANT: do NOT convert \r into \n here — renderer uses \r to "overwrite" progress lines (tqdm)
        const norm = (b) => stripAnsi(b.toString('utf8'));

        out.on('data', chunk => sendLog(norm(chunk)));
        errStream.on('data', chunk => sendLog(norm(chunk)));


        await container.start();
        sendLog('Контейнер запущен');
        const result = await container.wait();
        sendLog('Контейнер завершил работу');
        sendDone('finished', {statusCode: result?.StatusCode});
    } catch (err) {
        sendLog(`❌ Ошибка: ${err.message}`);
        sendDone('error', {error: err.message});
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
    const sendLog = (line) => wc.send('container-log', {runToken: token, line: String(line ?? '')});
    const sendDone = (reason, extra = {}) => wc.send('container-done', {runToken: token, reason, ...extra});

    if (!currentContainerId) {
        sendLog('⚠ Нет активного контейнера.');
        return;
    }
    const cid = currentContainerId;
    try {
        const container = docker.getContainer(cid);
        await container.stop();
        await container.remove().catch(() => {
        });
        sendLog('🛑 Контейнер остановлен и удалён.');
    } catch (err) {
        sendLog(`❌ Не удалось остановить контейнер: ${err.message}`);
    } finally {
        // завершаем именно текущий запуск
        if (currentContainerId === cid) currentContainerId = null;
        if (currentRunToken === token) currentRunToken = null;
        sendDone('stopped');
    }
});

ipcMain.handle('select-workdir', async () => {
    const {canceled, filePaths} = await dialog.showOpenDialog(mainWindow, {properties: ['openDirectory']});
    return canceled ? null : filePaths[0];
});

app.whenReady().then(async () => {
    try {
        await docker.ping();
        console.log('docker.ping OK');
        createWindow();

        // первая проверка сразу после старта (тихо, без ошибок в UI)
        // небольшая задержка — чтобы окно успело отрисоваться
        setTimeout(() => {
            checkImageUpdateSafe({manual: false}).catch(() => {
            });
        }, 1500);

        // периодическая проверка обновлений docker-образа (без pull и без ошибок в UI)
        // стартуем не сразу, чтобы не мешать холодному старту
        setTimeout(() => {
            checkImageUpdateSafe({manual: false}).catch(() => {
            });
        }, 30_000);
        imageUpdateTimer = setInterval(() => {
            checkImageUpdateSafe({manual: false}).catch(() => {
            });
        }, IMAGE_UPDATE_INTERVAL_MS);

        // ручная проверка (например, по кнопке в UI)
        ipcMain.handle('check-image-update-now', async () => {
            await checkImageUpdateSafe({manual: true});
            return {ok: true};
        });

        // реальное обновление (docker pull) по кнопке
        ipcMain.handle('pull-image-update', async () => {
            return await pullImageUpdateSafe();
        });

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
        const {response} = await dialog.showMessageBox({
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
    if (imageUpdateTimer) {
        clearInterval(imageUpdateTimer);
        imageUpdateTimer = null;
    }
    if (process.platform !== 'darwin') app.quit();
});


async function copyRecursive(srcDir, destDir) {
    await fs.mkdir(destDir, {recursive: true});
    const entries = await fs.readdir(srcDir, {withFileTypes: true});
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
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
            } catch {
            }
            if (exists) {
                const {response} = await dialog.showMessageBox({
                    type: 'question',
                    buttons: ['Перезаписать', 'Пропустить', 'Отмена'],
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
        return {success: true};
    } catch (err) {
        const msg = err.message === 'Операция отменена'
            ? 'Копирование отменено'
            : err.message;
        return {success: false, message: msg};
    }
});

ipcMain.handle('open-workdir', async (_e, targetDir) => {
    if (!targetDir) return {success: false, message: 'Папка не выбрана'};
    try {
        await shell.openPath(targetDir);
        return {success: true};
    } catch (err) {
        console.error('open-workdir error', err);
        return {success: false, message: err.message};
    }
});