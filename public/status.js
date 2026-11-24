async function refresh() {
  const updated = document.getElementById('statUpdated');
  try {
    const res = await fetch('/api/status/public');
    const d = await res.json();
    document.getElementById('statTotal').textContent = d.total;
    document.getElementById('statOnline').textContent = d.online;
    document.getElementById('statOffline').textContent = d.offline;
    updated.removeAttribute('data-i18n');
    updated.textContent = t('status.updatedAt', { time: new Date(d.updatedAt).toLocaleTimeString(i18n.locale) });
  } catch {
    updated.textContent = t('status.unavailable');
  }
}

refresh();
setInterval(refresh, 30000);
