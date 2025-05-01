// renderer.js
window.addEventListener('DOMContentLoaded', () => {
    // Элементы UI
    const form        = document.getElementById('run-form');
    const runBtn      = document.getElementById('runBtn');
    const runSpinner  = document.getElementById('runSpinner');
    const clearLogsBtn= document.getElementById('clearLogsBtn');
    const copyLogsBtn = document.getElementById('copyLogsBtn');
    const logsEl      = document.getElementById('logs');
    const progressBar = document.getElementById('progressBar');
    const toastContainer = document.getElementById('toastContainer');
    const infoModal   = new bootstrap.Modal(document.getElementById('infoModal'));
    const infoModalBody = document.getElementById('infoModalBody');
    const themeToggle = document.getElementById('themeToggle');
    const closeBtn    = document.getElementById('closeBtn');

    // Переключение темы
    themeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        html.dataset.bsTheme = html.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    });

    // Собственная кнопка закрытия
    closeBtn.addEventListener('click', () => {
        window.api.closeWindow();
    });

    // Подсказки через модалку
    document.querySelectorAll('.info-trigger').forEach(el => {
        el.addEventListener('click', () => {
            infoModalBody.innerText = el.dataset.info;
            infoModal.show();
        });
    });

    // Горячие клавиши: Ctrl+L — очистка логов, Esc — сворачивание доп. настроек
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            logsEl.textContent = '';
        }
        if (e.key === 'Escape') {
            new bootstrap.Collapse(document.getElementById('advancedOptions'), { toggle: true });
        }
    });

    // Кнопки работы с логами
    clearLogsBtn.addEventListener('click', () => {
        logsEl.textContent = '';
    });
    copyLogsBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(logsEl.textContent);
        showToast('Логи скопированы', 'success');
    });

    // Функция показа тостов
    function showToast(msg, type = 'info') {
        // контейнер для тостов должен быть с классом toast-container
        // и куда-то в html:
        // <div id="toastContainer" class="toast-container position-fixed bottom-0 end-0 p-3"></div>
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
              data-bs-dismiss="toast"
              aria-label="Закрыть"></button>
    </div>
  `;
        toastContainer.append(toastEl);
        const t = new bootstrap.Toast(toastEl, { delay: 3000 });
        t.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    }


    // UI-стейт при старте/завершении
    function startRun() {
        runBtn.disabled = true;
        runSpinner.classList.remove('d-none');
        progressBar.classList.remove('d-none');
    }
    function endRun() {
        runBtn.disabled = false;
        runSpinner.classList.add('d-none');
        progressBar.classList.add('d-none');
    }

    // IPC-события от main
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
    });
    window.api.onDone(() => {
        showToast('Готово', 'success');
        endRun();
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
            api_key:       document.getElementById('api_key').value,
            ext:           document.getElementById('ext').value,
            tone_sample_len: Number(document.getElementById('tone_sample_len').value),
            batch_size:    Number(document.getElementById('batch_size').value),
            n_jobs:        document.getElementById('n_jobs').value
                ? Number(document.getElementById('n_jobs').value)
                : null,
            providers:     document.getElementById('providers').value
                .trim().split(/\s+/)
        };
        window.api.runContainer(cfg);
    });

    document.getElementById('minimizeBtn')
        .addEventListener('click', () => window.api.minimizeWindow());
});
