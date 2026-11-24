/* Loaded in <head> so the theme is set before first paint. Default stays dark. */
(function () {
  const MODES = ['dark', 'light', 'system'];
  const media = window.matchMedia('(prefers-color-scheme: light)');

  let mode = 'dark';
  try {
    const saved = localStorage.getItem('theme');
    if (MODES.includes(saved)) mode = saved;
  } catch {}

  function updateButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.dataset.mode = mode;
    const label = window.t ? window.t('theme.title', { mode: window.t(`theme.${mode}`) }) : mode;
    btn.title = label;
    btn.setAttribute('aria-label', label);
  }

  function apply() {
    const resolved = mode === 'system' ? (media.matches ? 'light' : 'dark') : mode;
    document.documentElement.dataset.theme = resolved;
    updateButton();
  }

  media.addEventListener('change', () => { if (mode === 'system') apply(); });
  apply();

  document.addEventListener('DOMContentLoaded', () => {
    updateButton();
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem('theme', mode); } catch {}
      apply();
    });
  });
})();
