// main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Docker = require('dockerode');
const ProgressBar = require('electron-progressbar');
const { PassThrough } = require('stream');

// Выбор пути к Docker-сокету: на Windows — named pipe, иначе — Unix socket
const dockerSocket = process.platform === 'win32'
    ? '//./pipe/docker_engine'
    : '/var/run/docker.sock';
console.log(`Используется Docker-сокет: ${dockerSocket}`);

// Инициализация клиента Docker
const docker = new Docker({ socketPath: dockerSocket });
let mainWindow;

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

    // Опционально открыть DevTools
    // mainWindow.webContents.openDevTools({ mode: 'detach' });

    mainWindow.loadFile('index.html');
}

/**
 * Скачивает образ Docker с прогресс-баром и пишет ход в лог.
 * Образ будет загружен только один раз при отсутствии локально.
 * @param {string} image — имя Docker-образа
 */
async function pullImage(image) {
    const wc = mainWindow.webContents;
    wc.send('container-log', `Образ "${image}" не найден локально. Загрузка начнётся один раз…`);

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
}

/**
 * Запускает контейнер с указанными параметрами и транслирует логи в UI
 * @param {object} cfg — { api_key, ext, tone_sample_len, batch_size, n_jobs, providers }
 */
async function runContainer(cfg) {
    const wc = mainWindow.webContents;
    wc.send('container-log', `Получена конфигурация: ${JSON.stringify(cfg)}`);

    const image = 'selector/voiceover';
    try {
        // Проверяем наличие образа
        const imgs = await docker.listImages({ filters: { reference: [image] } });
        if (imgs.length === 0) {
            wc.send('container-log', `Образ "${image}" не найден, начинаю загрузку…`);
            await pullImage(image);
        } else {
            wc.send('container-log', `Образ "${image}" найден локально, загрузку пропускаю.`);
        }

        // Формируем аргументы
        const args = [
            '--api_key', cfg.api_key,
            '--ext', cfg.ext,
            '--tone_sample_len', String(cfg.tone_sample_len),
            '--batch_size', String(cfg.batch_size),
        ];
        if (cfg.n_jobs)    args.push('--n_jobs', String(cfg.n_jobs));
        if (cfg.providers && cfg.providers.length) args.push('--providers', ...cfg.providers);

        wc.send('container-log', `Аргументы для контейнера: ${args.join(' ')}`);

        // Создаём контейнер
        const container = await docker.createContainer({
            Image: image,
            Cmd: args,
            HostConfig: { AutoRemove: true },
        });
        wc.send('container-log', `Создан контейнер с ID: ${container.id}`);

        // Прикрепляемся и демультиплексируем потоки
        const raw = await container.attach({ stream: true, stdout: true, stderr: true });
        const out = new PassThrough(), errStream = new PassThrough();
        docker.modem.demuxStream(raw, out, errStream);

        out.on('data', chunk => wc.send('container-log', chunk.toString()));
        errStream.on('data', chunk => wc.send('container-log', chunk.toString()));

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
app.whenReady().then(async () => {
    try {
        // Проверяем Docker-демон
        await docker.ping();
        console.log('Docker-демон доступен');
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
        console.error('Docker-демон недоступен', err);
        // Предлагаем установить или запустить Docker
        const { response } = await dialog.showMessageBox({
            type: 'error',
            title: 'Docker недоступен',
            message: 'Не удалось подключиться к Docker-демону.',
            detail:
                `Ошибка: ${err.message}\n` +
                'Установите Docker или запустите его (Docker Desktop / systemctl start docker).',
            buttons: ['Скачать Docker', 'Закрыть'],
            defaultId: 0,
            cancelId: 1,
        });
        if (response === 0) {
            shell.openExternal('https://www.docker.com/get-started');
        }
        app.quit();
    }
});

// Закрываем приложение при закрытии всех окон (кроме macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
