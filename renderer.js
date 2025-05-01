// renderer.js
window.addEventListener('DOMContentLoaded', () => {
    const form           = document.getElementById('run-form');
    const runBtn         = document.getElementById('runBtn');
    const runSpinner     = document.getElementById('runSpinner');
    const stopBtn        = document.getElementById('stopBtn');
    const stopSpinner    = document.getElementById('stopSpinner');
    const clearLogsBtn   = document.getElementById('clearLogsBtn');
    const copyLogsBtn    = document.getElementById('copyLogsBtn');
    const logsEl         = document.getElementById('logs');
    const progressBar    = document.getElementById('progressBar');
    const toastContainer = document.getElementById('toastContainer');
    const infoModal      = new bootstrap.Modal(document.getElementById('infoModal'));
    const infoModalBody  = document.getElementById('infoModalBody');
    const themeToggle    = document.getElementById('themeToggle');
    const closeBtn       = document.getElementById('closeBtn');
    const minimizeBtn    = document.getElementById('minimizeBtn');
    const chooseDirBtn   = document.getElementById('chooseDirBtn');
    const workdirInput   = document.getElementById('workdir');
    const csvDelimInput  = document.getElementById('csv_delimiter');

    // Тема
    themeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        html.dataset.bsTheme = html.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    });

    // Закрыть/свернуть
    closeBtn.addEventListener('click',   () => window.api.closeWindow());
    minimizeBtn.addEventListener('click',() => window.api.minimizeWindow());

    // Выбор директории
    chooseDirBtn.addEventListener('click', async () => {
        const dir = await window.api.selectWorkdir();
        if (dir) workdirInput.value = dir;
    });

    // Подсказки
    document.querySelectorAll('.info-trigger').forEach(el => {
        el.addEventListener('click', () => {
            infoModalBody.innerText = el.dataset.info;
            infoModal.show();
        });
    });

    // Горячие клавиши
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            logsEl.textContent = '';
        }
        if (e.key === 'Escape') {
            new bootstrap.Collapse(document.getElementById('advancedOptions'), { toggle: true });
        }
    });

    // Логи
    clearLogsBtn.addEventListener('click', () => {
        logsEl.textContent = '';
    });
    copyLogsBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(logsEl.textContent);
        showToast('Логи скопированы', 'success');
    });

    // Показать тост
    function showToast(msg, type = 'info') {
        const toastEl = document.createElement('div');
        toastEl.className = `toast align-items-center text-white bg-${type} border-0`;
        toastEl.setAttribute('role', 'alert');
        toastEl.setAttribute('aria-live', 'assertive');
        toastEl.setAttribute('aria-atomic', 'true');
        toastEl.innerHTML = `
      <div class="d-flex align-items-center">
        <div class="toast-body">${msg}</div>
        <button type="button"
                class="btn-close btn-close-white ms-auto me-2"
                data-bs-dismiss="toast" aria-label="Закрыть"></button>
      </div>`;
        toastContainer.append(toastEl);
        const t = new bootstrap.Toast(toastEl, { delay: 3000 });
        t.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    }

    // UI при старте/конце работы
    function startRun() {
        runBtn.disabled = true;
        runSpinner.classList.remove('d-none');
        progressBar.classList.remove('d-none');
        // разрешаем стоп
        stopBtn.disabled = false;
        stopSpinner.classList.add('d-none');
    }
    function endRun() {
        runBtn.disabled = false;
        runSpinner.classList.add('d-none');
        progressBar.classList.add('d-none');
    }

    // Стоп-кнопка
    stopBtn.addEventListener('click', () => {
        stopBtn.disabled = true;
        stopSpinner.classList.remove('d-none');
        window.api.stopContainer();
    });

    // IPC от main
    if (!window.api) {
        console.error('API не найдено');
        return;
    }
    window.api.onLog(line => {
        logsEl.textContent += line + '\n';
        logsEl.scrollTop = logsEl.scrollHeight;
        if (line.startsWith('❌')) {
            endRun();
            showToast(line, 'danger');
        }
        if (line.includes('Контейнер остановлен и удалён.')) {
            stopBtn.disabled = false;
            stopSpinner.classList.add('d-none');
        }
    });
    window.api.onDone(() => {
        showToast('Готово', 'success');
        endRun();
        // после полного завершения — блокируем стоп
        stopBtn.disabled = true;
    });

    // Отправка формы
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            return;
        }
        form.classList.remove('was-validated');
        logsEl.textContent = '';
        startRun();
        const cfg = {
            api_key:         document.getElementById('api_key').value,
            ext:             document.getElementById('ext').value,
            tone_sample_len: Number(document.getElementById('tone_sample_len').value),
            batch_size:      Number(document.getElementById('batch_size').value),
            n_jobs:          document.getElementById('n_jobs').value
                ? Number(document.getElementById('n_jobs').value)
                : null,
            providers:       document.getElementById('providers').value.trim().split(/\s+/),
            workdir:         workdirInput.value || null,
            csv_delimiter:   csvDelimInput.value || ','
        };
        window.api.runContainer(cfg);
    });
});
