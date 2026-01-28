// renderer.js
window.addEventListener('DOMContentLoaded', () => {
    const form           = document.getElementById('run-form');
    const runBtn         = document.getElementById('runBtn');
    const runSpinner     = document.getElementById('runSpinner');
    const stopBtn        = document.getElementById('stopBtn');
    const stopSpinner    = document.getElementById('stopSpinner');
    const clearLogsBtn   = document.getElementById('clearLogsBtn');
    const copyLogsBtn    = document.getElementById('copyLogsBtn');
    const logLimitEl     = document.getElementById('logLimit');
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
    const populateSampleBtn  = document.getElementById('populateSampleBtn');
    const openDirBtn        = document.getElementById('openDirBtn');
    const charCountEl = document.getElementById('charCount');
    const lipsyncBtn    = document.getElementById('lipsyncBtn');
    const alignBtn      = document.getElementById('alignBtn');
    const mixingBtn     = document.getElementById('mixingBtn');
    const lipsyncSpinner = document.getElementById('lipsyncSpinner');
    const alignSpinner   = document.getElementById('alignSpinner');
    const mixingSpinner  = document.getElementById('mixingSpinner');

    // --- элементы доп. параметров ---
    const nJobsInput     = document.getElementById('n_jobs');
    const nJobsAuto      = document.getElementById('n_jobs_auto');
    const prosodyRange   = document.getElementById('prosody_cond_range');
    const prosodyNumber  = document.getElementById('prosody_cond');

    // VC default alpha (показываем только когда vc_type=default)
    const vcTypeSelect   = document.getElementById('vc_type');
    const vcAlphaWrap    = document.getElementById('vc_default_alpha_wrap');
    const vcAlphaRange   = document.getElementById('vc_default_alpha_range');
    const vcAlphaNumber  = document.getElementById('vc_default_alpha');
    const vcMinTargetNumber  = document.getElementById('min_target_sec');

    const SETTINGS_KEY = 'svr_voiceover_desktop_settings_v1';

    function safeParseJson(s) {
        try { return JSON.parse(s); } catch { return null; }
    }

    function saveSettings() {
        const cfg = collectCfgForSave();
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
    }

    function loadSettings() {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw ? safeParseJson(raw) : null;
    }

    function setIfExists(id, value) {
        const el = document.getElementById(id);
        if (!el || value === undefined || value === null) return;
        if (el.type === 'checkbox') el.checked = !!value;
        else {
            const v = String(value);
            // если это select и значения нет среди option — мягко откатываемся на дефолт
            if (el.tagName === 'SELECT') {
                const has = Array.from(el.options || []).some(o => o.value === v);
                el.value = has ? v : (el.options?.[0]?.value ?? '');
            } else {
                el.value = v;
            }
        }
    }

    function setAutoJobsUi(isAuto) {
        if (!nJobsInput || !nJobsAuto) return;
        nJobsAuto.checked = !!isAuto;
        nJobsInput.disabled = !!isAuto;
        if (isAuto) {
            nJobsInput.value = '';
            nJobsInput.placeholder = 'Авто';
        } else if (!nJobsInput.value) {
            nJobsInput.value = '1';
        }
    }

    function syncProsody(from) {
        if (!prosodyRange || !prosodyNumber) return;
        if (from === 'range') prosodyNumber.value = prosodyRange.value;
        if (from === 'number') prosodyRange.value = prosodyNumber.value;
    }

    function syncVcAlpha(from) {
        if (!vcAlphaRange || !vcAlphaNumber) return;
        if (from === 'range') vcAlphaNumber.value = vcAlphaRange.value;
        if (from === 'number') vcAlphaRange.value = vcAlphaNumber.value;
    }

    function updateVcAlphaVisibility() {
        if (!vcAlphaWrap || !vcTypeSelect) return;
        const isDefault = (vcTypeSelect.value || '') === 'default';
        vcAlphaWrap.style.display = isDefault ? '' : 'none';

        // чтобы не мешались в табе и не выглядели активными
        if (vcAlphaRange)  vcAlphaRange.disabled  = !isDefault;
        if (vcAlphaNumber) vcAlphaNumber.disabled = !isDefault;
    }

    // подтягиваем сохранённые настройки
    const saved = loadSettings();
    if (saved) {
        Object.entries(saved).forEach(([k, v]) => setIfExists(k, v));
    }

    // авто-потоки
    setAutoJobsUi(saved?.n_jobs_auto ?? true);
    nJobsAuto?.addEventListener('change', () => {
        setAutoJobsUi(nJobsAuto.checked);
        saveSettings();
    });
    nJobsInput?.addEventListener('input', saveSettings);

    // синхронизируем просодию
    syncProsody('number');
    prosodyRange?.addEventListener('input', () => { syncProsody('range'); saveSettings(); });
    prosodyNumber?.addEventListener('input', () => { syncProsody('number'); saveSettings(); });

    // VC default alpha
    syncVcAlpha('number');
    updateVcAlphaVisibility();
    vcTypeSelect?.addEventListener('change', () => { updateVcAlphaVisibility(); saveSettings(); });
    vcAlphaRange?.addEventListener('input', () => { syncVcAlpha('range'); saveSettings(); });
    vcAlphaNumber?.addEventListener('input', () => { syncVcAlpha('number'); saveSettings(); });

    // сохраняем основные поля
    const idsToPersist = [
        'api_key','path_filter','ext','csv_delimiter','device','batch_size','tone_sample_len','is_respect_mos',
        'reinit_every','min_prosody_len','speed_clip_max','speed_clip_min','speed_adjust_step_pct',
        'speed_search_attempts','max_extra_speed','vc_type','vc_default_alpha', 'min_target_sec'
    ];
    idsToPersist.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
        el.addEventListener(evt, saveSettings);
    });

    function collectCfgForSave() {
        const out = {};
        // сохраняем только то, что у нас есть на форме
        idsToPersist.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            out[id] = (el.type === 'checkbox') ? el.checked : el.value;
        });
        out.n_jobs_auto = nJobsAuto?.checked ?? true;
        out.n_jobs = nJobsInput?.value ?? '';
        out.prosody_cond_range = prosodyRange?.value ?? '';
        return out;
    }

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
        if (dir) {
            workdirInput.value = dir;
            openDirBtn.disabled = false;
            workdirInput.classList.remove('is-invalid');
            populateSampleBtn.classList.remove('d-none');
        }
    };

    // по клику открываем папку
    openDirBtn.addEventListener('click', async () => {
        const dir = workdirInput.value;
        const result = await window.api.openWorkdir(dir);
        if (!result.success) {
            showToast(`Ошибка открытия: ${result.message}`, 'danger');
        }
    });

    // Если пользователь кликает «Заполнить примером» — кладём туда демонстрационные файлы
    populateSampleBtn.addEventListener('click', () => {
        window.api.populateSample(dir => {
            workdirInput.value = dir;
            showToast('Папка заполнена примером', 'success');
        });
    });

    // Подсказки
    document.querySelectorAll('.info-trigger').forEach(el => {
        el.onclick = () => {
            infoModalBody.innerHTML = el.dataset.info;
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
    clearLogsBtn.onclick = () => {
        logBuffer = [];
        pendingLines = [];
        logRemainder = '';
        logsEl.textContent = '';
    };
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
    function startRun(mode){
        // выключаем все кнопки
        runBtn.disabled     = true;
        lipsyncBtn.disabled = true;
        alignBtn.disabled   = true;
        mixingBtn.disabled  = true;

        // скрываем все спиннеры
        runSpinner.classList.add('d-none');
        lipsyncSpinner.classList.add('d-none');
        alignSpinner.classList.add('d-none');
        mixingSpinner.classList.add('d-none');

        // сброс прогресса
        progressBar.style.width = '0%';
        progressInline.classList.remove('d-none');
        progressLabel.classList.add('d-none');
        progressLabel.innerText = '';

        // показываем спиннер только для активного режима
        if (mode === 'synthesize') {
            runSpinner.classList.remove('d-none');
        } else if (mode === 'lipsync') {
            lipsyncSpinner.classList.remove('d-none');
        } else if (mode === 'align') {
            alignSpinner.classList.remove('d-none');
        } else if (mode === 'mixing') {
            mixingSpinner.classList.remove('d-none');
        }

        stopBtn.disabled = false;
        stopSpinner.classList.add('d-none');
    }

    function endRun(){
        runBtn.disabled     = false;
        lipsyncBtn.disabled = false;
        alignBtn.disabled   = false;
        mixingBtn.disabled  = false;

        runSpinner.classList.add('d-none');
        lipsyncSpinner.classList.add('d-none');
        alignSpinner.classList.add('d-none');
        mixingSpinner.classList.add('d-none');

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
        // --- Логи: буфер на N строк, чтобы интерфейс не тормозил ---
    const LOG_LIMIT_KEY = 'svr.logLimitLines';
    let maxLogLines = 2000;

    try {
        const saved = Number(localStorage.getItem(LOG_LIMIT_KEY));
        if (Number.isFinite(saved) && saved > 0) maxLogLines = saved;
    } catch (_e) {}

    if (logLimitEl) {
        logLimitEl.value = String(maxLogLines);
        logLimitEl.addEventListener('change', () => {
            const v = Number(logLimitEl.value) || 2000;
            maxLogLines = Math.max(100, v);
            try { localStorage.setItem(LOG_LIMIT_KEY, String(maxLogLines)); } catch (_e) {}
            trimLogs();
            renderLogs(true);
        });
    }

    let logBuffer = [];
    let pendingLines = [];
    let flushScheduled = false;
    let logRemainder = '';

    function trimLogs() {
        if (logBuffer.length > maxLogLines) {
            logBuffer.splice(0, logBuffer.length - maxLogLines);
        }
    }

    function renderLogs(forceScroll=false) {
        const atBottom = forceScroll || (logsEl.scrollTop + logsEl.clientHeight >= logsEl.scrollHeight - 10);
        logsEl.textContent = logBuffer.length ? (logBuffer.join('\n') + '\n') : '';
        if (atBottom) logsEl.scrollTop = logsEl.scrollHeight;
    }

    function scheduleFlush() {
        if (flushScheduled) return;
        flushScheduled = true;

        const flush = () => {
            flushScheduled = false;
            if (!pendingLines.length) return;
            logBuffer.push(...pendingLines);
            pendingLines = [];
            trimLogs();
            renderLogs(false);
        };

        (window.requestAnimationFrame || window.setTimeout)(flush, 0);
    }

    function addLogLine(line) {
        pendingLines.push(line);
        scheduleFlush();
        handleLogLine(line);
    }

    function handleLogLine(line) {
            if (line.startsWith('❌')) {
                endRun(); showToast(line,'danger');
            }
            if (line.includes('Контейнер остановлен и удалён.')) {
                stopBtn.disabled=true; stopSpinner.classList.add('d-none');
            }

            // --- обновляем баланс символов ---
            const m = line.match(/Доступно\s+(\d+)\s+символ/);
            if (m) {
                const available = Number(m[1]);
                charCountEl.innerHTML = '&nbsp;' + available.toLocaleString('ru-RU');
                // ВАЖНО: не выходим, но ниже при парсинге прогресса эту строку отфильтруем
            }

            // --- прогресс: игнорируем строки "Доступно ... символа: XX%|..." ---
            const pm = line.match(/(\d+)%\|.*\[\s*([0-9:]+)<([^,]+),\s*([^\]]+)]/);
            if (pm && !/Доступно\s+\d+\s+символ/.test(line)) {
                const pct     = Number(pm[1]) || 0;
                const elapsed = pm[2];
                const eta     = pm[3];
                const rate    = pm[4];

                progressBar.style.width = pct + '%';
                progressInline.classList.remove('d-none');
                progressLabel.classList.remove('d-none');
                progressLabel.innerText = `${pct}% — ${elapsed}<${eta}, ${rate}`;
            }
    }

    window.api.onLog(chunk => {
        // контейнер шлёт stdout/stderr кусками, собираем из них строки
        if (typeof chunk !== 'string') chunk = String(chunk ?? '');
        logRemainder += chunk;

        const parts = logRemainder.split(/\r?\n/);
        logRemainder = parts.pop() ?? '';

        for (const raw of parts) {
            addLogLine(raw.replace(/\r$/, ''));
        }
    });
    window.api.onDone(() => {
        if (logRemainder) { addLogLine(logRemainder); logRemainder = ''; }
        scheduleFlush();
        showToast('Готово','success');
        endRun();
        stopBtn.disabled = true;
    });

    // Submit
    form.onsubmit = e => {
        e.preventDefault();
        if (!workdirInput.value) {
            workdirInput.classList.add('is-invalid');
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (!form.checkValidity()) return form.classList.add('was-validated');
        form.classList.remove('was-validated');
        logsEl.textContent='';
        startRun('synthesize');

        const device = document.getElementById('device').value;
        const providers = device === 'CUDAExecutionProvider'
            ? ['CUDAExecutionProvider', 'CPUExecutionProvider']
            : ['CPUExecutionProvider'];


        const cfg = {
            mode: 'synthesize',
            api_key: document.getElementById('api_key').value,
            path_filter: document.getElementById('path_filter').value,
            ext: document.getElementById('ext').value,
            batch_size: Number(document.getElementById('batch_size').value),
            n_jobs: (nJobsAuto && nJobsAuto.checked) ? null : Number(nJobsInput.value),
            csv_delimiter: document.getElementById('csv_delimiter').value,
            workdir: workdirInput.value || null,
            providers,

            // --- недостающие параметры entrypoint.py ---
            tone_sample_len: Number(document.getElementById('tone_sample_len').value),
            is_respect_mos: document.getElementById('is_respect_mos').checked,

            reinit_every: Number(document.getElementById('reinit_every').value),
            prosody_cond: Number(prosodyNumber.value),
            min_prosody_len: Number(document.getElementById('min_prosody_len').value),
            speed_search_attempts: Number(document.getElementById('speed_search_attempts').value),
            speed_adjust_step_pct: Number(document.getElementById('speed_adjust_step_pct').value),
            speed_clip_min: Number(document.getElementById('speed_clip_min').value),
            speed_clip_max: Number(document.getElementById('speed_clip_max').value),
            max_extra_speed: Number(document.getElementById('max_extra_speed').value),
            vc_type: document.getElementById('vc_type').value,
            vc_default_alpha: Number((vcAlphaNumber?.value ?? '0.6')),
            min_target_sec: Number((vcMinTargetNumber?.value ?? '3.0')),
        };
        logsEl.textContent += e + '\n';
        window.api.runContainer(cfg);
    };

    function ensureWorkdirOrToast() {
        if (!workdirInput.value) {
            workdirInput.classList.add('is-invalid');
            showToast('Сначала выбери рабочую папку', 'warning');
            return false;
        }
        return true;
    }

    function buildBaseCfg() {
        const device = document.getElementById('device').value;
        const providers = device === 'CUDAExecutionProvider'
            ? ['CUDAExecutionProvider', 'CPUExecutionProvider']
            : ['CPUExecutionProvider'];
        return {
            workdir:       workdirInput.value || null,
            csv_delimiter: document.getElementById('csv_delimiter').value,
            providers,
            // api_key тут не нужен, скрипты lipsync/align/mixing его не используют
        };
    }

    lipsyncBtn.onclick = () => {
        if (!ensureWorkdirOrToast()) return;
        logsEl.textContent = '';
        startRun('lipsync');
        const cfg = {
            ...buildBaseCfg(),
            mode: 'lipsync',
        };
        window.api.runContainer(cfg);
    };

    alignBtn.onclick = () => {
        if (!ensureWorkdirOrToast()) return;
        logsEl.textContent = '';
        startRun('align');
        const cfg = {
            ...buildBaseCfg(),
            mode: 'align',
            align_use_voice_len: true,
        };
        window.api.runContainer(cfg);
    };

    mixingBtn.onclick = () => {
        if (!ensureWorkdirOrToast()) return;
        logsEl.textContent = '';
        startRun('mixing');
        const cfg = {
            ...buildBaseCfg(),
            mode: 'mixing',
        };
        window.api.runContainer(cfg);
    };



    populateSampleBtn.addEventListener('click', async () => {
        const dir = workdirInput.value;
        const result = await window.api.populateSample(dir);
        if (result.success) {
            showToast('Папка заполнена примером данных', 'success');
        } else {
            showToast(`Ошибка примера: ${result.message}`, 'danger');
        }
    });
});
