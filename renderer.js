// renderer.js
const form = document.getElementById('run-form');
const logs = document.getElementById('logs');

if (!window.api) {
    console.error('window.api не определён! Проверьте preload.js');
}

form.addEventListener('submit', e => {
    e.preventDefault();
    logs.textContent = '';
    const cfg = {
        api_key: form.api_key.value,
        ext: form.ext.value,
        tone_sample_len: Number(form.tone_sample_len.value),
        batch_size: Number(form.batch_size.value),
        n_jobs: form.n_jobs.value ? Number(form.n_jobs.value) : null,
        providers: form.providers.value.trim().split(/\s+/),
    };
    console.log('[Renderer] Calling runContainer with config:', cfg);
    window.api.runContainer(cfg);
});

window.api.onLog(line => {
    console.log('[Renderer] Log:', line.trim());
    logs.textContent += line + '\n';
    logs.scrollTop = logs.scrollHeight;
});

window.api.onDone(() => {
    console.log('[Renderer] Done event received');
    logs.textContent += '✅ Done\n';
});

