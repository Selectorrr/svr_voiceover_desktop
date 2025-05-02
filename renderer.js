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
    const progressInline = document.getElementById('progressInline');
    const progressBar    = progressInline.querySelector('.progress-bar');
    const progressLabel  = document.getElementById('progressLabel');
    const toastContainer = document.getElementById('toastContainer');
    const infoModal      = new bootstrap.Modal(document.getElementById('infoModal'));
    const infoModalBody  = document.getElementById('infoModalBody');
    const themeToggle    = document.getElementById('themeToggle');
    const closeBtn       = document.getElementById('closeBtn');
    const minimizeBtn    = document.getElementById('minimizeBtn');
    const chooseDirBtn   = document.getElementById('chooseDirBtn');
    const workdirInput   = document.getElementById('workdir');
    const logsCollapse = document.getElementById('logsCollapse');
    const logsToggleIcon = document.getElementById('logsToggleIcon');


    logsCollapse.addEventListener('show.bs.collapse', () => {
        logsToggleIcon.classList.replace('bi-chevron-down', 'bi-chevron-up');
    });
    logsCollapse.addEventListener('hide.bs.collapse', () => {
        logsToggleIcon.classList.replace('bi-chevron-up', 'bi-chevron-down');
    });
// сразу свернём
    logsCollapse.classList.remove('show');

    // Тема
    themeToggle.onclick = () => {
        document.documentElement.dataset.bsTheme =
            document.documentElement.dataset.bsTheme === 'dark' ? 'light' : 'dark';
    };
    // Окно
    closeBtn.onclick    = () => window.api.closeWindow();
    minimizeBtn.onclick = () => window.api.minimizeWindow();

    // Выбор папки
    chooseDirBtn.onclick = async () => {
        const dir = await window.api.selectWorkdir();
        if (dir) workdirInput.value = dir;
    };

    // Подсказки
    document.querySelectorAll('.info-trigger').forEach(el => {
        el.onclick = () => {
            infoModalBody.innerText = el.dataset.info;
            infoModal.show();
        };
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
    clearLogsBtn.onclick = () => { logsEl.textContent = ''; };
    copyLogsBtn.onclick  = () => {
        navigator.clipboard.writeText(logsEl.textContent);
        showToast('Логи скопированы', 'success');
    };

    function showToast(msg, type='info') {
        const t = document.createElement('div');
        t.className = `toast align-items-center text-white bg-${type} border-0`;
        t.setAttribute('role','alert');
        t.setAttribute('aria-live','assertive');
        t.setAttribute('aria-atomic','true');
        t.innerHTML = `
      <div class="d-flex align-items-center">
        <div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white ms-auto me-2"
                data-bs-dismiss="toast" aria-label="Закрыть"></button>
      </div>`;
        toastContainer.append(t);
        const bsToast = new bootstrap.Toast(t,{delay:3000});
        bsToast.show();
        t.addEventListener('hidden.bs.toast',()=>t.remove());
    }

    // UI state
    function startRun(){
        runBtn.disabled = true;
        runSpinner.classList.remove('d-none');
        progressInline.classList.remove('d-none');
        stopBtn.disabled = false;
        stopSpinner.classList.add('d-none');
    }
    function endRun(){
        runBtn.disabled = false;
        runSpinner.classList.add('d-none');
        progressInline.classList.add('d-none');
    }

    // Stop
    stopBtn.onclick = () => {
        stopBtn.disabled = true;
        stopSpinner.classList.remove('d-none');
        window.api.stopContainer();
    };

    // IPC
    if (!window.api) return console.error('API не найдено');
    window.api.onLog(line => {
        logsEl.textContent += line + '\n';
        logsEl.scrollTop = logsEl.scrollHeight;
        if (line.startsWith('❌')) {
            endRun(); showToast(line,'danger');
        }
        if (line.includes('Контейнер остановлен и удалён.')) {
            stopBtn.disabled=true; stopSpinner.classList.add('d-none');
        }
        if (line.includes('Общий прогресс:')) {
            // пример: "Общий прогресс:   45%|#####     | 360/80683 [00:45<10:20,  1.23s/it]"
            const m = line.match(/(\d+)%\|.*\[\s*([0-9:]+)<([^,]+),\s*([^\]]+)\]/);
            if (m) {
                const pct     = Number(m[1]);
                const elapsed = m[2];      // "00:45"
                const eta     = m[3];      // "10:20"
                const rate    = m[4];      // "1.23s/it"
                // обновляем бар
                progressBar.style.width = pct + '%';
                // показываем и обновляем лейбл
                progressLabel.innerText = `${pct}% — ${elapsed}<${eta}, ${rate}`;
                progressInline.classList.remove('d-none');
                progressLabel.classList.remove('d-none');
            }
        }
    });
    window.api.onDone(() => {
        showToast('Готово','success');
        endRun();
        stopBtn.disabled = true;
    });

    // Submit
    form.onsubmit = e => {
        e.preventDefault();
        if (!form.checkValidity()) return form.classList.add('was-validated');
        form.classList.remove('was-validated');
        logsEl.textContent='';
        startRun();
        const cfg = {
            api_key:       document.getElementById('api_key').value,
            is_strict_len: document.getElementById('is_strict_len').checked,
            ext:           document.getElementById('ext').value,
            batch_size:    Number(document.getElementById('batch_size').value),
            n_jobs:        Number(document.getElementById('n_jobs').value),
            csv_delimiter: document.getElementById('csv_delimiter').value,
            workdir:       workdirInput.value || null,
            providers:     [ document.getElementById('device').value ]
        };
        window.api.runContainer(cfg);
    };
});
