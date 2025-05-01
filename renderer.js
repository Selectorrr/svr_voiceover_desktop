window.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('run-form');
    const runBtn = document.getElementById('runBtn');
    const runSpinner = document.getElementById('runSpinner');
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    const copyLogsBtn = document.getElementById('copyLogsBtn');
    const logsEl = document.getElementById('logs');
    const progressBar = document.getElementById('progressBar');
    const toastContainer = document.getElementById('toastContainer');
    const infoModal = new bootstrap.Modal(document.getElementById('infoModal'));
    const infoModalBody = document.getElementById('infoModalBody');

    // Theme toggle
    const toggle = document.getElementById('themeToggle');
    toggle.addEventListener('click', () => {
        const html = document.documentElement;
        html.dataset.bsTheme = html.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    });


    // Info popups
    document.querySelectorAll('.info-trigger').forEach(el => {
        el.addEventListener('click', () => {
            infoModalBody.innerText = el.dataset.info;
            infoModal.show();
        });
    });

    // Hotkeys
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            logsEl.textContent = '';
        }
        if (e.key === 'Escape') {
            new bootstrap.Collapse(document.getElementById('advancedOptions'), {toggle: true});
        }
    });

    // Logs controls
    clearLogsBtn.addEventListener('click', () => logsEl.textContent = '');
    copyLogsBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(logsEl.textContent);
        showToast('Логи скопированы', 'success');
    });

    // Toast helper
    function showToast(msg, type = 'info') {
        const toastEl = document.createElement('div');
        toastEl.className = `toast align-items-center text-white bg-${type} border-0`;
        toastEl.role = 'alert';
        toastEl.ariaLive = 'assertive';
        toastEl.ariaAtomic = 'true';
        toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto"
                data-bs-dismiss="toast"></button>
      </div>`;
        toastContainer.append(toastEl);
        const t = new bootstrap.Toast(toastEl, {delay: 3000});
        t.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    }

    // UI state helpers
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

    // IPC handlers
    if (!window.api) {
        console.error('api не найден');
        return;
    }
    api.onLog(line => {
        logsEl.textContent += line + '\n';
        logsEl.scrollTop = logsEl.scrollHeight;
        if (line.startsWith('❌')) {
            endRun();
            showToast(line, 'danger');
        }
    });
    api.onDone(() => {
        showToast('Готово', 'success');
        endRun();
    });

    // Form submit
    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            return;
        }
        logsEl.textContent = '';
        form.classList.remove('was-validated');
        startRun();
        const cfg = {
            api_key: document.getElementById('api_key').value,
            ext: document.getElementById('ext').value,
            tone_sample_len: Number(document.getElementById('tone_sample_len').value),
            batch_size: Number(document.getElementById('batch_size').value),
            n_jobs: document.getElementById('n_jobs').value ? Number(document.getElementById('n_jobs').value) : null,
            providers: document.getElementById('providers').value.trim().split(/\s+/)
        };
        api.runContainer(cfg);
    });
});
