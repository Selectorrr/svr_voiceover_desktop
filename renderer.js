// renderer.js
window.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('run-form');
    const runBtn = document.getElementById('runBtn');
    const runSpinner = document.getElementById('runSpinner');
    const stopBtn = document.getElementById('stopBtn');
    const stopSpinner = document.getElementById('stopSpinner');
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    const copyLogsBtn = document.getElementById('copyLogsBtn');
    const logLimitEl = document.getElementById('logLimit');
    const logsEl = document.getElementById('logs');
    const progressInline = document.getElementById('progressInline');
    const progressBar = progressInline.querySelector('.progress-bar');
    const progressLabel = document.getElementById('progressLabel');
    const toastContainer = document.getElementById('toastContainer');
    const infoModal = new bootstrap.Modal(document.getElementById('infoModal'));
    const infoModalBody = document.getElementById('infoModalBody');
    const updateBanner = document.getElementById('updateBanner');
    const updateImageBtn = document.getElementById('updateImageBtn');
    const updateImageSpinner = document.getElementById('updateImageSpinner');
    const imageStatusEl = document.getElementById('imageStatus');
    const restartModal = new bootstrap.Modal(document.getElementById('restartModal'));
    const restartModalBody = document.getElementById('restartModalBody');
    const restartNowBtn = document.getElementById('restartNowBtn');
    const themeToggle = document.getElementById('themeToggle');
    const closeBtn = document.getElementById('closeBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');
    const chooseDirBtn = document.getElementById('chooseDirBtn');
    const workdirInput = document.getElementById('workdir');
    const logsCollapse = document.getElementById('logsCollapse');
    const logsToggleIcon = document.getElementById('logsToggleIcon');
    const populateSampleBtn = document.getElementById('populateSampleBtn');
    const openDirBtn = document.getElementById('openDirBtn');
    const charCountEl = document.getElementById('charCount');
    const alignBtn = document.getElementById('alignBtn');
    const mixingBtn = document.getElementById('mixingBtn');
    const alignSpinner = document.getElementById('alignSpinner');
    const mixingSpinner = document.getElementById('mixingSpinner');

    // --- запуск/остановка: защита от "поздних" событий от прошлых запусков ---
    let runSeq = 0;
    let activeRunToken = null;

    // --- docker image update / restart flow ---
    let lastRunCfg = null;        // последняя конфигурация запуска (для перезапуска)
    let pendingRestartCfg = null; // если попросили перезапуск после stop

    function setImageStatus(state, {quiet = true} = {}) {
        if (!imageStatusEl) return;

        // reset badge classes
        imageStatusEl.classList.remove('text-bg-secondary', 'text-bg-success', 'text-bg-warning', 'text-bg-info', 'text-bg-danger', 'text-dark');

        let text = 'Образ: ?';
        let cls = 'text-bg-secondary';
        let extra = '';

        if (state === 'checking') {
            text = 'Образ: проверка…';
            cls = 'text-bg-info';
        } else if (state === 'fresh') {
            text = 'Образ: свежий';
            cls = 'text-bg-success';
        } else if (state === 'missing') {
            text = 'Образ: не скачан';
            cls = 'text-bg-danger';
        } else if (state === 'stale') {
            text = 'Образ: есть обновление';
            cls = 'text-bg-warning';
            extra = ' text-dark';
        } else if (state === 'unknown') {
            text = 'Образ: неизвестно';
            cls = 'text-bg-secondary';
        }

        imageStatusEl.textContent = text;
        imageStatusEl.classList.add(cls);
        if (extra) imageStatusEl.classList.add('text-dark');

        if (!quiet) {
            // просто на будущее: если захочешь делать тосты отсюда
        }
    }

    // начальное состояние
    setImageStatus('unknown');

    // --- элементы доп. параметров ---
    const nJobsInput = document.getElementById('n_jobs');
    const nJobsAuto = document.getElementById('n_jobs_auto');
    const prosodyRange = document.getElementById('prosody_cond_range');
    const prosodyNumber = document.getElementById('prosody_cond');

    // VC default alpha (показываем только когда vc_type=default)
    const vcTypeSelect = document.getElementById('vc_type');
    const vcAlphaWrap = document.getElementById('vc_default_alpha_wrap');
    const vcAlphaRange = document.getElementById('vc_default_alpha_range');
    const vcAlphaNumber = document.getElementById('vc_default_alpha');
    const vcMinTargetNumber = document.getElementById('min_target_sec');

    // Шкалы допусков по длине (центр = конец семпла)
    // Короткие
    const gapLeftShort = document.getElementById('gap_left_short');   // насколько можно короче
    const gapRightShort = document.getElementById('gap_right_short');  // насколько можно длиннее
    const gapFillLeftShort = document.getElementById('gapFillLeftShort');
    const gapFillRightShort = document.getElementById('gapFillRightShort');
    const gapAtempoShort = document.getElementById('gapAtempoShort');
    const gapLeftLabelShort = document.getElementById('gapLeftLabelShort');
    const gapRightLabelShort = document.getElementById('gapRightLabelShort');

    // Длинные
    const gapLeftLong = document.getElementById('gap_left_long');
    const gapRightLong = document.getElementById('gap_right_long');
    const gapFillLeftLong = document.getElementById('gapFillLeftLong');
    const gapFillRightLong = document.getElementById('gapFillRightLong');
    const gapAtempoLong = document.getElementById('gapAtempoLong');
    const gapLeftLabelLong = document.getElementById('gapLeftLabelLong');
    const gapRightLabelLong = document.getElementById('gapRightLabelLong');

    // Подписи с текущими “потолками” шкалы (зависят от мин/макс скорости)
    // - левый потолок: насколько вообще можно быть короче
    // - правый потолок: насколько вообще можно быть длиннее
    const gapCapLeftLabel = document.getElementById('gapCapLeftLabel');
    const gapCapRightLabel = document.getElementById('gapCapRightLabel');

    const SETTINGS_KEY = 'svr_voiceover_desktop_settings_v1';

    function safeParseJson(s) {
        try {
            return JSON.parse(s);
        } catch {
            return null;
        }
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
        if (vcAlphaRange) vcAlphaRange.disabled = !isDefault;
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
    prosodyRange?.addEventListener('input', () => {
        syncProsody('range');
        saveSettings();
    });
    prosodyNumber?.addEventListener('input', () => {
        syncProsody('number');
        saveSettings();
    });

    // VC default alpha
    syncVcAlpha('number');
    updateVcAlphaVisibility();
    vcTypeSelect?.addEventListener('change', () => {
        updateVcAlphaVisibility();
        saveSettings();
    });
    vcAlphaRange?.addEventListener('input', () => {
        syncVcAlpha('range');
        saveSettings();
    });
    vcAlphaNumber?.addEventListener('input', () => {
        syncVcAlpha('number');
        saveSettings();
    });

    // сохраняем основные поля
    const idsToPersist = [
        'api_key', 'path_filter', 'ext', 'csv_delimiter', 'device', 'batch_size', 'tone_sample_len', 'is_respect_mos',
        'put_yo',
        'reinit_every', 'min_prosody_len', 'speed_clip_max', 'speed_clip_min', 'speed_adjust_step_pct',
        'speed_search_attempts', 'max_extra_speed',
        // допуски по длине результата
        'len_t_short', 'len_t_long', 'max_longer_pct_short', 'max_longer_pct_long', 'max_shorter_pct_short', 'max_shorter_pct_long',
        'vc_type', 'vc_default_alpha', 'min_target_sec'
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

    // ---------- Единая шкала допусков ----------
    function fmtFrac(x) {
        // 0.05 / 0.15 и т.п. без лишних нулей
        const n = Number(x);
        if (!Number.isFinite(n)) return '0';
        const s = n.toFixed(3);
        return s.replace(/\.?0+$/, '');
    }


    // --- Шкалы допусков по длине (в процентах) ---
    // Здесь проценты вводятся в долях: 0.15 = 15%.
    // На шкале показываем целые проценты (например 15 = 15%).


    // --- Шкалы допусков по длине (в процентах) ---
    // В конфиге доли: 0.15 = 15%.
    // В UI показываем проценты целым числом.
    //
    // Диапазон шкал автоматически подстраивается под "Мин. скорость" и "Макс. скорость":
    // - Чем выше "Макс. скорость", тем больше можно сделать короче (левый ползунок).
    // - Чем ниже "Мин. скорость", тем больше можно сделать длиннее (правый ползунок).

    function _num(id, defVal) {
        // Пользователи часто вводят числа с запятой (например 0,8).
        // Number('0,8') -> NaN, поэтому приводим запятую к точке.
        const raw = document.getElementById(id)?.value;
        const v = Number(String(raw ?? '').trim().replace(',', '.'));
        return Number.isFinite(v) ? v : defVal;
    }

    function getGapCapsPctInt() {
        const sMin = _num('speed_clip_min', 0.5); // медленнее => длиннее
        const sMax = _num('speed_clip_max', 2.0); // быстрее  => короче

        // Сколько максимум можно "длиннее" / "короче" в процентах, если смотреть только на пределы скорости.
        // Длительность примерно обратно пропорциональна speed.
        // - Для "длиннее": замедление до sMin даёт увеличение длительности примерно (1/sMin - 1)
        // - Для "короче": ускорение до sMax даёт уменьшение длительности примерно (1 - 1/sMax)
        let capLonger = (sMin > 0) ? (1.0 / sMin - 1.0) : 0.0;     // доля
        let capShorter = (sMax > 0) ? (1.0 - 1.0 / sMax) : 0.0;     // доля

        // В проценты, с ограничением 0..50
        let capRight = Math.round(capLonger * 100);
        let capLeft = Math.round(capShorter * 100);

        if (!Number.isFinite(capRight)) capRight = 0;
        if (!Number.isFinite(capLeft)) capLeft = 0;
        capRight = Math.max(0, capRight);
        capLeft = Math.max(0, capLeft);

        return {capLeft, capRight};
    }

    function clampInt(v, lo, hi) {
        v = Number(v) || 0;
        return Math.max(lo, Math.min(hi, v));
    }

    function fmtPctLabel(v, sign) {
        const n = clampInt(v, 0, 999);
        return `${sign}${n}%`;
    }

    function pctIntFromInput(id, cap) {
        const el = document.getElementById(id);
        const v = Number(String(el?.value ?? 0).trim().replace(',', '.')); // 0.15
        const pct = Math.round(v * 100);                  // 15
        return clampInt(pct, 0, cap);
    }

    function setInputFromPctInt(id, pctInt) {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = fmtFrac((Number(pctInt) || 0) / 100);
    }

    function updateGapUi(kind, leftPctInt, rightPctInt, capLeft, capRight) {
        // kind: 'short' | 'long'
        const isShort = kind === 'short';

        const leftLabel = isShort ? gapLeftLabelShort : gapLeftLabelLong;
        const rightLabel = isShort ? gapRightLabelShort : gapRightLabelLong;
        const fillLeft = isShort ? gapFillLeftShort : gapFillLeftLong;
        const fillRight = isShort ? gapFillRightShort : gapFillRightLong;

        if (leftLabel) leftLabel.textContent = fmtPctLabel(leftPctInt, '-');
        if (rightLabel) rightLabel.textContent = fmtPctLabel(rightPctInt, '+');

        // Заливка вокруг центра:
        // левая/правая половины — это 50% ширины каждая.
        const leftW = (capLeft > 0) ? (leftPctInt / capLeft) * 50 : 0;   // 0..50
        const rightW = (capRight > 0) ? (rightPctInt / capRight) * 50 : 0;   // 0..50

        if (fillLeft) {
            fillLeft.style.left = `${50 - leftW}%`;
            fillLeft.style.width = `${leftW}%`;
        }
        if (fillRight) {
            fillRight.style.left = `50%`;
            fillRight.style.width = `${rightW}%`;
        }

        // Маркер “макс. доп. ускорение”:
        // показывает точку, которая находится левее правого ползунка на max_extra_speed%.
        // Это визуальная подсказка: если результат оказался ближе к правому краю, часть можно "дожать" ускорением.
        const extraPctInt = Math.max(0, Math.round(_num('max_extra_speed', 0.0) * 100));
        const markerPctInt = Math.max(0, rightPctInt - extraPctInt);
        const markerX = 50 + ((capRight > 0) ? (markerPctInt / capRight) * 50 : 0);

        const atempoMarker = isShort ? gapAtempoShort : gapAtempoLong;
        if (atempoMarker) {
            atempoMarker.style.left = `${markerX}%`;
            atempoMarker.style.display = (rightPctInt > 0 && extraPctInt > 0) ? 'block' : 'none';
        }
    }

    function setSliderCaps({capLeft, capRight}) {
        // max для левых/правых ползунков
        [gapLeftShort, gapLeftLong].forEach(el => {
            if (el) el.max = String(capLeft);
        });
        [gapRightShort, gapRightLong].forEach(el => {
            if (el) el.max = String(capRight);
        });

        // показываем пользователю текущие максимальные границы шкалы
        if (gapCapLeftLabel) gapCapLeftLabel.textContent = `-${capLeft}%`;
        if (gapCapRightLabel) gapCapRightLabel.textContent = `+${capRight}%`;
    }

    function applyInputsToSliders() {
        const {capLeft, capRight} = getGapCapsPctInt();
        setSliderCaps({capLeft, capRight});

        // Короткие
        const shortLeft = pctIntFromInput('max_shorter_pct_short', capLeft);
        const shortRight = pctIntFromInput('max_longer_pct_short', capRight);
        if (gapLeftShort) gapLeftShort.value = String(shortLeft);
        if (gapRightShort) gapRightShort.value = String(shortRight);
        updateGapUi('short', shortLeft, shortRight, capLeft, capRight);

        // Длинные
        const longLeft = pctIntFromInput('max_shorter_pct_long', capLeft);
        const longRight = pctIntFromInput('max_longer_pct_long', capRight);
        if (gapLeftLong) gapLeftLong.value = String(longLeft);
        if (gapRightLong) gapRightLong.value = String(longRight);
        updateGapUi('long', longLeft, longRight, capLeft, capRight);
    }

    function applySlidersToInputs(kind) {
        const {capLeft, capRight} = getGapCapsPctInt();
        setSliderCaps({capLeft, capRight});

        const isShort = kind === 'short';

        const leftSlider = isShort ? gapLeftShort : gapLeftLong;
        const rightSlider = isShort ? gapRightShort : gapRightLong;

        const leftPctInt = clampInt(leftSlider?.value, 0, capLeft);
        const rightPctInt = clampInt(rightSlider?.value, 0, capRight);

        if (isShort) {
            setInputFromPctInt('max_shorter_pct_short', leftPctInt);
            setInputFromPctInt('max_longer_pct_short', rightPctInt);
        } else {
            setInputFromPctInt('max_shorter_pct_long', leftPctInt);
            setInputFromPctInt('max_longer_pct_long', rightPctInt);
        }

        updateGapUi(kind, leftPctInt, rightPctInt, capLeft, capRight);
    }

    // Если пользователь поменял min/max speed — диапазон шкал меняется.
    // Подстраиваем max у ползунков и поджимаем текущие значения, если они выходят за новые границы.
    function onSpeedClipChanged() {
        const {capLeft, capRight} = getGapCapsPctInt();
        setSliderCaps({capLeft, capRight});

        // поджимаем скрытые значения-конфиги, если стали больше капа
        const curShorterShort = pctIntFromInput('max_shorter_pct_short', capLeft);
        const curShorterLong = pctIntFromInput('max_shorter_pct_long', capLeft);
        const curLongerShort = pctIntFromInput('max_longer_pct_short', capRight);
        const curLongerLong = pctIntFromInput('max_longer_pct_long', capRight);

        setInputFromPctInt('max_shorter_pct_short', curShorterShort);
        setInputFromPctInt('max_shorter_pct_long', curShorterLong);
        setInputFromPctInt('max_longer_pct_short', curLongerShort);
        setInputFromPctInt('max_longer_pct_long', curLongerLong);

        // и обновляем сами шкалы
        applyInputsToSliders();
        saveSettings();
    }

    // Инициализация и синхронизация шкал
    applyInputsToSliders();

    // На изменение min/max скорости пересчитываем границы шкалы
    const speedMinEl = document.getElementById('speed_clip_min');
    const speedMaxEl = document.getElementById('speed_clip_max');
    // В разных вариантах ввода (стрелки, колесо, ручной ввод) события могут отличаться,
    // поэтому слушаем и input, и change.
    speedMinEl?.addEventListener('input', onSpeedClipChanged);
    speedMinEl?.addEventListener('change', onSpeedClipChanged);
    speedMaxEl?.addEventListener('input', onSpeedClipChanged);
    speedMaxEl?.addEventListener('change', onSpeedClipChanged);

    // При нажатии поднимаем активный ползунок выше второго (чтобы хваталось предсказуемо)
    function bringToFront(el, other) {
        if (!el || !other) return;
        el.style.zIndex = '6';
        other.style.zIndex = '5';
    }

    gapLeftShort?.addEventListener('pointerdown', () => bringToFront(gapLeftShort, gapRightShort));
    gapRightShort?.addEventListener('pointerdown', () => bringToFront(gapRightShort, gapLeftShort));
    gapLeftLong?.addEventListener('pointerdown', () => bringToFront(gapLeftLong, gapRightLong));
    gapRightLong?.addEventListener('pointerdown', () => bringToFront(gapRightLong, gapLeftLong));

    gapLeftShort?.addEventListener('input', () => {
        applySlidersToInputs('short');
        saveSettings();
    });
    gapRightShort?.addEventListener('input', () => {
        applySlidersToInputs('short');
        saveSettings();
    });

    gapLeftLong?.addEventListener('input', () => {
        applySlidersToInputs('long');
        saveSettings();
    });
    gapRightLong?.addEventListener('input', () => {
        applySlidersToInputs('long');
        saveSettings();
    });

    // если значения поменялись “снаружи” (из настроек) — обновляем шкалы
    ['max_longer_pct_short', 'max_shorter_pct_short', 'max_longer_pct_long', 'max_shorter_pct_long']
        .forEach(id => document.getElementById(id)?.addEventListener('input', () => {
            applyInputsToSliders();
        }));

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
    closeBtn.onclick = () => window.api.closeWindow();
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
            new bootstrap.Collapse(document.getElementById('advancedOptions'), {toggle: true});
        }
    });

    // Логи
    clearLogsBtn.onclick = () => {
        logBuffer = [];
        pendingLines = [];
        logRemainder = '';
        logsEl.textContent = '';
    };
    copyLogsBtn.onclick = () => {
        navigator.clipboard.writeText(logsEl.textContent);
        showToast('Логи скопированы', 'success');
    };

    function showToast(msg, type = 'info') {
        const t = document.createElement('div');
        t.className = `toast align-items-center text-white bg-${type} border-0`;
        t.setAttribute('role', 'alert');
        t.setAttribute('aria-live', 'assertive');
        t.setAttribute('aria-atomic', 'true');
        t.innerHTML = `
      <div class="d-flex align-items-center">
        <div class="toast-body">${msg}</div>
        <button type="button" class="btn-close btn-close-white ms-auto me-2"
                data-bs-dismiss="toast" aria-label="Закрыть"></button>
      </div>`;
        toastContainer.append(t);
        const bsToast = new bootstrap.Toast(t, {delay: 3000});
        bsToast.show();
        t.addEventListener('hidden.bs.toast', () => t.remove());
    }

    // UI state
    function startRun(mode) {
        activeRunToken = ++runSeq;
        // выключаем все кнопки
        runBtn.disabled = true;
        alignBtn.disabled = true;
        mixingBtn.disabled = true;

        // скрываем все спиннеры
        runSpinner.classList.add('d-none');
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
        } else if (mode === 'align') {
            alignSpinner.classList.remove('d-none');
        } else if (mode === 'mixing') {
            mixingSpinner.classList.remove('d-none');
        }

        stopBtn.disabled = false;
        stopSpinner.classList.add('d-none');

        return activeRunToken;
    }

    function endRun() {
        runBtn.disabled = false;
        alignBtn.disabled = false;
        mixingBtn.disabled = false;

        runSpinner.classList.add('d-none');
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
    } catch (_e) {
    }

    if (logLimitEl) {
        logLimitEl.value = String(maxLogLines);
        logLimitEl.addEventListener('change', () => {
            const v = Number(logLimitEl.value) || 2000;
            maxLogLines = Math.max(100, v);
            try {
                localStorage.setItem(LOG_LIMIT_KEY, String(maxLogLines));
            } catch (_e) {
            }
            trimLogs();
            renderLogs(true);
        });
    }

    let logBuffer = [];        // обычные строки лога
    let pendingLines = [];
    let flushScheduled = false;
    let logsDirty = false;
    let logRemainder = '';

    // --- "живые" строки прогресса (чтобы 2 tqdm-бара не перетирали друг друга) ---
    // tqdm в терминале рисует прогресс бар через \r/перемещение курсора.
    // В текстовом поле мы вместо "перерисовать последнюю строку" держим 2 отдельные строки:
    //  - общий прогресс
    //  - прогресс текущего батча/джоба
    let liveOverall = null;
    let liveJob = null;
    let liveDirty = false;

    function stripAnsi(s) {
        return String(s ?? '')
            .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '');
    }

    function trimLogs() {
        if (logBuffer.length > maxLogLines) {
            logBuffer.splice(0, logBuffer.length - maxLogLines);
        }
    }

    function renderLogs(forceScroll = false) {
        const atBottom = forceScroll || (logsEl.scrollTop + logsEl.clientHeight >= logsEl.scrollHeight - 10);

        const out = [];
        if (logBuffer.length) out.push(...logBuffer);
        if (liveOverall) out.push(liveOverall);
        if (liveJob) out.push(liveJob);

        logsEl.textContent = out.length ? (out.join('\n') + '\n') : '';
        if (atBottom) logsEl.scrollTop = logsEl.scrollHeight;
    }

    function scheduleFlush() {
        if (flushScheduled) return;
        flushScheduled = true;

        const flush = () => {
            flushScheduled = false;
            if (!logsDirty && !liveDirty) return;
            if (pendingLines.length) {
                logBuffer.push(...pendingLines);
                pendingLines = [];
                trimLogs();
            }
            renderLogs(false);
            logsDirty = false;
            liveDirty = false;
        };

        (window.requestAnimationFrame || window.setTimeout)(flush, 0);
    }

    function addLogLine(line) {
        logsDirty = true;
        pendingLines.push(line);
        scheduleFlush();
        handleLogLine(line);
    }


    function setLive(which, line) {
        line = String(line ?? '').replace(/\s+$/, '');
        if (!line) return;
        if (which === 'overall') liveOverall = line;
        else liveJob = line;
        liveDirty = true;
        scheduleFlush();
        handleLogLine(line);
    }

    function handleLogLine(line) {
        if (line.startsWith('❌')) {
            endRun();
            showToast(line, 'danger');
        }
        if (line.includes('Контейнер остановлен и удалён.')) {
            stopBtn.disabled = true;
            stopSpinner.classList.add('d-none');
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
            const pct = Number(pm[1]) || 0;
            const elapsed = pm[2];
            const eta = pm[3];
            const rate = pm[4];

            progressBar.style.width = pct + '%';
            progressInline.classList.remove('d-none');
            progressLabel.classList.remove('d-none');
            progressLabel.innerText = `${pct}% — ${elapsed}<${eta}, ${rate}`;
        }
    }

    window.api.onLog(payload => {
        // payload: { runToken, line }
        let token = null;
        let chunk = payload;
        if (payload && typeof payload === 'object' && ('line' in payload)) {
            token = payload.runToken;
            chunk = payload.line;
        }
        // игнорируем события не от текущего запуска
        if (activeRunToken !== null && token !== null && token !== activeRunToken) return;

        // контейнер шлёт stdout/stderr кусками, собираем из них строки
        if (typeof chunk !== 'string') chunk = String(chunk ?? '');

        // NOTE: tqdm often обновляет прогресс без "\n" (только "\r").
        // Поэтому парсим поток посимвольно и реагируем и на "\n", и на "\r".
        logRemainder += chunk;

        function handleParsedLine(raw, overwrite) {
            raw = stripAnsi(raw);
            // tqdm может слать несколько "\r" подряд — берём только финальный кусок
            if (raw.includes('\r')) raw = raw.split('\r').pop() ?? '';
            raw = raw.replace(/\s+$/, '');
            if (!raw) return;

            const isTqdm = /\d+%\|/.test(raw) && raw.includes('[') && raw.includes(']');

            // overwrite=true значит строка "живая" (перерисовывается) —
            // даже если мы не распознали tqdm, показываем её в live-слоте.
            if (isTqdm || overwrite) {
                if (/^\s*Общий\s+прогресс\s*:/i.test(raw)) {
                    setLive('overall', raw);
                } else if (/Доступно\s+\d+\s+символ/i.test(raw) || /\bjob_n\b/i.test(raw)) {
                    setLive('job', raw);
                } else {
                    setLive('job', raw);
                }
            } else {
                addLogLine(raw);
            }
        }

        let cur = '';
        for (let i = 0; i < logRemainder.length; i++) {
            const ch = logRemainder[i];
            if (ch === '\n' || ch === '\r') {
                handleParsedLine(cur, ch === '\r');
                cur = '';
            } else {
                cur += ch;
            }
        }
        logRemainder = cur;
    });
    window.api.onDone(payload => {
        // payload: { runToken, reason }
        const token = (payload && typeof payload === 'object') ? payload.runToken : null;
        if (activeRunToken !== null && token !== null && token !== activeRunToken) return;

        if (logRemainder) {
            addLogLine(logRemainder);
            logRemainder = '';
        }

        // фиксируем прогрессбары (убираем "живые" строки после завершения)
        liveOverall = null;
        liveJob = null;
        liveDirty = true;
        scheduleFlush();

        const reason = (payload && typeof payload === 'object') ? payload.reason : 'finished';
        if (reason === 'finished') showToast('Готово', 'success');
        // reason === 'error' — тост уже показан по строке "❌ ..."

        endRun();
        stopBtn.disabled = true;
        stopSpinner.classList.add('d-none');

        // сбрасываем активный токен — поздние логи этого запуска нас уже не волнуют
        activeRunToken = null;

        // если это был stop ради перезапуска — стартуем снова
        if (reason === 'stopped' && pendingRestartCfg) {
            const cfgToRestart = pendingRestartCfg;
            pendingRestartCfg = null;
            startFromSavedCfg(cfgToRestart);
        }
    });

    function setUpdateBannerVisible(isVisible) {
        if (!updateBanner) return;
        updateBanner.classList.toggle('d-none', !isVisible);
    }

    async function startImagePull() {
        if (!window.api?.pullImageUpdate) {
            showToast('Обновление Docker-образа не поддерживается в этой сборке', 'warning');
            return;
        }
        try {
            updateImageBtn?.setAttribute('disabled', 'disabled');
            updateImageSpinner?.classList.remove('d-none');
            await window.api.pullImageUpdate();
        } finally {
            updateImageBtn?.removeAttribute('disabled');
            updateImageSpinner?.classList.add('d-none');
        }
    }

    updateImageBtn?.addEventListener('click', () => {
        startImagePull().catch(() => {
        });
    });

    // клик по статусу образа (справа сверху) — ручная проверка
    imageStatusEl?.addEventListener('click', async () => {
        if (!window.api?.checkImageUpdateNow) {
            showToast('Проверка обновления недоступна в этой сборке', 'warning');
            return;
        }
        try {
            setImageStatus('checking');
            await window.api.checkImageUpdateNow();
        } catch {
            // не шумим
        }
    });

    // уведомления об обновлении docker-образа
    window.api.onImageUpdate?.((p) => {
        if (!p) return;

        if (p.type === 'status' && p.state) {
            setImageStatus(p.state);
            return;
        }

        if (p.type === 'available') {
            // показываем баннер с кнопкой
            setUpdateBannerVisible(true);
            if (p.message) showToast(p.message, 'warning');
            return;
        }

        if (p.type === 'updated') {
            // спрячем баннер, т.к. уже обновились
            setUpdateBannerVisible(false);
            if (p.message) showToast(p.message, 'success');
            return;
        }

        if (p.type === 'restart-offer') {
            // показать модалку: перезапуск
            if (restartModalBody && p.message) restartModalBody.innerText = p.message;
            restartModal?.show();
            return;
        }

        if (p.type === 'pull-start') {
            if (p.message) showToast(p.message, 'info');
            return;
        }

        // дефолт
        if (p.message) showToast(p.message, (p.type === 'danger') ? 'danger' : 'info');
    });

    function cloneCfgWithoutToken(cfg) {
        if (!cfg) return null;
        const copy = JSON.parse(JSON.stringify(cfg));
        delete copy._runToken;
        return copy;
    }

    function startFromSavedCfg(cfgNoToken) {
        const base = cloneCfgWithoutToken(cfgNoToken);
        if (!base || !base.mode) {
            showToast('Не знаю, что перезапускать (нет последнего запуска)', 'warning');
            return;
        }
        logsEl.textContent = '';
        const token = startRun(base.mode);
        const cfg = { ...base, _runToken: token };
        lastRunCfg = cloneCfgWithoutToken(cfg);
        window.api.runContainer(cfg);
    }

    restartNowBtn?.addEventListener('click', () => {
        restartModal?.hide();

        const target = cloneCfgWithoutToken(lastRunCfg);
        if (!target) {
            showToast('Не могу перезапустить: нет данных последнего запуска', 'warning');
            return;
        }

        // если озвучка сейчас бежит — сначала остановим, потом поднимем снова
        if (activeRunToken !== null) {
            pendingRestartCfg = target;
            showToast('Останавливаю озвучку…', 'info');
            window.api.stopContainer();
        } else {
            startFromSavedCfg(target);
        }
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
        logsEl.textContent = '';
        const token = startRun('synthesize');

        const device = document.getElementById('device').value;
        const providers = device === 'CUDAExecutionProvider'
            ? ['CUDAExecutionProvider', 'CPUExecutionProvider']
            : ['CPUExecutionProvider'];


        const cfg = {
            _runToken: token,
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
            put_yo: document.getElementById('put_yo')?.checked ?? true,

            reinit_every: Number(document.getElementById('reinit_every').value),
            prosody_cond: Number(prosodyNumber.value),
            min_prosody_len: Number(document.getElementById('min_prosody_len').value),
            speed_search_attempts: Number(document.getElementById('speed_search_attempts').value),
            speed_adjust_step_pct: Number(document.getElementById('speed_adjust_step_pct').value),
            speed_clip_min: Number(document.getElementById('speed_clip_min').value),
            speed_clip_max: Number(document.getElementById('speed_clip_max').value),
            max_extra_speed: Number(document.getElementById('max_extra_speed').value),

            // допуски по длине результата (зависят от длины реплики)
            len_t_short: Number(document.getElementById('len_t_short').value),
            len_t_long: Number(document.getElementById('len_t_long').value),
            max_longer_pct_short: Number(document.getElementById('max_longer_pct_short').value),
            max_longer_pct_long: Number(document.getElementById('max_longer_pct_long').value),
            max_shorter_pct_short: Number(document.getElementById('max_shorter_pct_short').value),
            max_shorter_pct_long: Number(document.getElementById('max_shorter_pct_long').value),

            vc_type: document.getElementById('vc_type').value,
            vc_default_alpha: Number((vcAlphaNumber?.value ?? '0.6')),
            min_target_sec: Number((vcMinTargetNumber?.value ?? '3.0')),
        };
        lastRunCfg = cloneCfgWithoutToken(cfg);
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
            workdir: workdirInput.value || null,
            csv_delimiter: document.getElementById('csv_delimiter').value,
            providers,
            // api_key тут не нужен, скрипты align/mixing его не используют
        };
    }

    alignBtn.onclick = () => {
        if (!ensureWorkdirOrToast()) return;
        logsEl.textContent = '';
        const token = startRun('align');
        const cfg = {
            ...buildBaseCfg(),
            _runToken: token,
            mode: 'align',
            align_use_voice_len: true,
        };
        lastRunCfg = cloneCfgWithoutToken(cfg);
        window.api.runContainer(cfg);
    };

    mixingBtn.onclick = () => {
        if (!ensureWorkdirOrToast()) return;
        logsEl.textContent = '';
        const token = startRun('mixing');
        const cfg = {
            ...buildBaseCfg(),
            _runToken: token,
            mode: 'mixing',
        };
        lastRunCfg = cloneCfgWithoutToken(cfg);
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
