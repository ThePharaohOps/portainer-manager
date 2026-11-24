/* ── State ─────────────────────────────────────────────────────────────────── */
const state = {
  instances: [],
  liveData: {},
  uptime: {},
  latestVersion: null,
  filter: 'all',
  search: '',
  sort: localStorage.getItem('sort') || 'name',
  view: localStorage.getItem('view') || 'grid',
  groupByEnv: localStorage.getItem('groupByEnv') === 'true',
  refreshInterval: parseInt(localStorage.getItem('refreshInterval'), 10) || 30000,
  refreshTimer: null,
  countdown: 30,
  countdownTimer: null,
  editId: null,
  isViewer: false,
  selected: new Set(),
  appVersion: null,
};

const ENV_ORDER = ['production', 'preprod', 'recette', 'integration', null];
const ENVS = ['integration', 'recette', 'preprod', 'production'];
const envLabel = env => t(`env.${env}`);
const ENV_CLASSES = { integration: 'env-integration', recette: 'env-recette', preprod: 'env-preprod', production: 'env-production' };

/* ── DOM ───────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

// Container/image names come from each instance's Docker API — external data, not just
// what an admin typed — so escape before interpolating into innerHTML.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── API ───────────────────────────────────────────────────────────────────── */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 401) { window.location.href = '/login'; throw new Error(t('err.unauthenticated')); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(i18n.errorMessage(body, res.status));
  }
  return res.json();
}

/* ── Data ──────────────────────────────────────────────────────────────────── */
async function fetchLatestVersion() {
  try {
    const data = await apiFetch('/api/portainer/latest-version');
    state.latestVersion = data.version;
    $('statLatestVersion').textContent = state.latestVersion ? 'v' + state.latestVersion : '—';
  } catch { $('statLatestVersion').textContent = '—'; }
}

async function fetchUptime() {
  try { state.uptime = await apiFetch('/api/uptime'); } catch {}
}

async function loadInstances() {
  try { state.instances = await apiFetch('/api/instances'); }
  catch (e) { showToast(t('instance.loadFailed', { msg: e.message }), 'error'); }
  renderAll();
  refreshAllLiveData();
}

async function refreshAllLiveData() {
  await Promise.allSettled(state.instances.map(fetchLiveData));
  await fetchUptime();
  updateStats();
  renderAll();
  updateAlertBell();
}

async function fetchLiveData(instance) {
  try {
    state.liveData[instance.id] = await apiFetch(`/api/instances/${instance.id}/data`);
  } catch {
    state.liveData[instance.id] = { online: false, error: t('card.requestFailed') };
  }
}

/* ── Stats ─────────────────────────────────────────────────────────────────── */
function updateStats() {
  let online = 0, offline = 0, containers = 0, stacks = 0;
  for (const inst of state.instances) {
    const d = state.liveData[inst.id];
    if (!d) continue;
    if (d.online) { online++; containers += d.totalContainers ?? 0; stacks += d.stacksCount ?? 0; }
    else offline++;
  }
  $('statTotal').textContent      = state.instances.length;
  $('statOnline').textContent     = online;
  $('statOffline').textContent    = offline;
  $('statContainers').textContent = containers;
  $('statStacks').textContent     = stacks;
}

/* ── Filter / Sort ─────────────────────────────────────────────────────────── */
function filteredSorted() {
  return state.instances
    .filter(inst => {
      const d = state.liveData[inst.id];
      const status = !d ? 'loading' : d.online ? 'online' : 'offline';
      if (state.filter === 'online'  && status !== 'online')  return false;
      if (state.filter === 'offline' && status !== 'offline') return false;
      if (state.filter === 'outdated' && !(d?.online && d.version && state.latestVersion && isOutdated(d.version, state.latestVersion))) return false;
      const q = state.search.toLowerCase();
      if (q && !inst.name.toLowerCase().includes(q) && !inst.url.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      const da = state.liveData[a.id], db = state.liveData[b.id];
      switch (state.sort) {
        case 'status': {
          const sa = !da ? 2 : da.online ? 0 : 1;
          const sb = !db ? 2 : db.online ? 0 : 1;
          return sa - sb || a.name.localeCompare(b.name);
        }
        case 'environment': {
          const ea = ENV_ORDER.indexOf(a.environment ?? null);
          const eb = ENV_ORDER.indexOf(b.environment ?? null);
          return ea - eb || a.name.localeCompare(b.name);
        }
        case 'version': {
          const va = da?.version || 'z';
          const vb = db?.version || 'z';
          return va.localeCompare(vb) || a.name.localeCompare(b.name);
        }
        case 'date':
          return new Date(b.createdAt) - new Date(a.createdAt);
        default:
          return a.name.localeCompare(b.name);
      }
    });
}

/* ── Render ────────────────────────────────────────────────────────────────── */
function renderAll() {
  if (state.view === 'list') renderList();
  else renderGrid();
  updateBulkToolbar();
}

function renderGrid() {
  const grid = $('instanceGrid');
  Array.from(grid.children).forEach(c => { if (c.id !== 'emptyState') c.remove(); });
  // Also clear group sections if any
  const gridView = $('gridView');
  Array.from(gridView.querySelectorAll('.env-section')).forEach(s => s.remove());

  const visible = filteredSorted();

  if (visible.length === 0) {
    $('emptyState').style.display = 'flex';
    updateStats();
    return;
  }
  $('emptyState').style.display = 'none';

  if (state.groupByEnv) {
    // Group by environment
    const groups = {};
    for (const inst of visible) {
      const key = inst.environment || '__none__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(inst);
    }

    ENV_ORDER.forEach(env => {
      const key = env || '__none__';
      if (!groups[key]) return;
      const section = document.createElement('div');
      section.className = 'env-section';

      const label = env ? envLabel(env) : t('env.none');
      const cls   = env ? ENV_CLASSES[env] : '';
      const header = document.createElement('div');
      header.className = 'env-section-header';
      header.innerHTML = `<span class="env-badge ${cls}">${escapeHtml(label)}</span><span class="env-section-count">${escapeHtml(tp('group.count', groups[key].length))}</span>`;
      section.appendChild(header);

      const subGrid = document.createElement('div');
      subGrid.className = 'grid';
      groups[key].forEach(inst => subGrid.appendChild(buildCard(inst)));
      section.appendChild(subGrid);
      gridView.appendChild(section);
    });
  } else {
    visible.forEach(inst => grid.appendChild(buildCard(inst)));
  }

  updateStats();
}

function renderList() {
  const tbody = $('listBody');
  tbody.innerHTML = '';
  const visible = filteredSorted();

  if (visible.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="list-empty">${escapeHtml(t('empty.noMatch'))}</td></tr>`;
    updateStats();
    return;
  }

  for (const inst of visible) {
    const d = state.liveData[inst.id];
    const up = state.uptime[inst.id];
    const online = d?.online;
    const statusClass = !d ? 'loading' : online ? 'online' : 'offline';

    const tr = document.createElement('tr');
    tr.className = `row-${statusClass}`;

    const envHtml = inst.environment
      ? `<span class="env-badge ${ENV_CLASSES[inst.environment]}">${envLabel(inst.environment)}</span>`
      : '<span style="color:var(--text-muted)">—</span>';

    let portainerVer = '—';
    if (d?.version) {
      const versionBadge = `<span class="version-badge portainer-badge" style="display:inline-flex"><img class="vb-logo" src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/portainer.png" width="12" height="12" alt="" /> v${escapeHtml(d.version)}</span>`;
      let updateBadgeHtml = '';
      let showUpdateBtn = false;
      if (state.latestVersion) {
        const outdated = isOutdated(d.version, state.latestVersion);
        const updateTitle = outdated ? `v${d.version} → v${state.latestVersion}` : `v${d.version}`;
        updateBadgeHtml = `<span class="update-badge ${outdated ? 'outdated' : 'up-to-date'}" title="${escapeHtml(updateTitle)}">${escapeHtml(outdated ? t('card.updateAvailable', { v: state.latestVersion }) : t('card.upToDate'))}</span>`;
        showUpdateBtn = outdated;
      }
      portainerVer = `<div class="list-versions">${versionBadge}${updateBadgeHtml}${showUpdateBtn ? `<button type="button" class="update-btn list-update-btn">${escapeHtml(t('card.update'))}</button>` : ''}</div>`;
    }

    const dockerVer = d?.dockerVersion
      ? `<span class="list-docker">v${escapeHtml(d.dockerVersion)}</span>` : '—';

    const uptimeDots = up?.history
      ? up.history.map(u => `<span class="list-uptime-dot ${u ? 'up' : 'down'}"></span>`).join('')
      : '';
    const uptimeHtml = up
      ? `<div class="list-uptime">
           <div class="list-uptime-bar">${uptimeDots}</div>
           <span class="list-uptime-percent">${up.percent}%</span>
         </div>`
      : '<span style="color:var(--text-muted);font-size:12px">—</span>';

    tr.innerHTML = `
      <td class="admin-only"><input type="checkbox" class="row-select" ${state.selected.has(inst.id) ? 'checked' : ''} /></td>
      <td><span class="list-status-dot ${statusClass}"></span></td>
      <td>
        <div class="list-name">${escapeHtml(inst.name)}</div>
        ${inst.notes ? `<div class="list-notes">${escapeHtml(inst.notes)}</div>` : ''}
      </td>
      <td>${envHtml}</td>
      <td>${portainerVer}</td>
      <td>${dockerVer}</td>
      <td class="list-num">${online ? (d.endpointsCount ?? '—') : '—'}</td>
      <td class="list-num running">${online ? (d.runningContainers ?? '—') : '—'}</td>
      <td class="list-num">${online ? (d.stoppedContainers ?? '—') : '—'}</td>
      <td class="list-num">${online ? (d.stacksCount ?? '—') : '—'}</td>
      <td class="list-num services">${online && d.servicesCount > 0 ? d.servicesCount : '—'}</td>
      <td>${uptimeHtml}</td>
      <td>
        <div class="list-actions">
          <button class="icon-btn open-btn" title="${escapeHtml(t('card.open'))}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button class="icon-btn edit-btn" title="${escapeHtml(t('card.edit'))}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn delete-btn" title="${escapeHtml(t('card.delete'))}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </td>
    `;

    tr.querySelector('.open-btn').addEventListener('click', () => window.open(inst.url, '_blank', 'noopener,noreferrer'));
    if (state.isViewer) {
      tr.querySelector('.edit-btn').style.display = 'none';
      tr.querySelector('.delete-btn').style.display = 'none';
    } else {
      tr.querySelector('.edit-btn').addEventListener('click', () => openEditModal(inst));
      tr.querySelector('.delete-btn').addEventListener('click', () => deleteInstance(inst.id, inst.name));
      tr.querySelector('.row-select').addEventListener('change', e => toggleSelect(inst.id, e.target.checked));
    }
    tr.querySelector('.list-update-btn')?.addEventListener('click', () => openUpdateGuide(inst, d));
    tbody.appendChild(tr);
  }
  updateStats();
}

/* ── Build card ────────────────────────────────────────────────────────────── */
function buildCard(inst) {
  const tpl = document.getElementById('cardTemplate');
  const card = tpl.content.cloneNode(true).querySelector('.card');
  i18n.apply(card);
  const d  = state.liveData[inst.id];
  const up = state.uptime[inst.id];

  card.dataset.id = inst.id;

  // Border color
  if (!d)       card.classList.add('loading');
  else if (d.online)  card.classList.add('status-online');
  else          card.classList.add('status-offline');

  // Status badge
  const badge = card.querySelector('.status-badge');
  if (!d) { badge.textContent = t('common.loading'); badge.className = 'status-badge loading'; }
  else if (d.online)  { badge.textContent = t('common.online');  badge.className = 'status-badge online'; }
  else                { badge.textContent = t('common.offline'); badge.className = 'status-badge offline'; }

  card.querySelector('.card-name').textContent = inst.name;
  card.querySelector('.card-url').textContent  = inst.url;

  // Env badge
  const envBadge = card.querySelector('.env-badge');
  if (inst.environment && ENV_CLASSES[inst.environment]) {
    envBadge.textContent  = envLabel(inst.environment);
    envBadge.className    = `env-badge ${ENV_CLASSES[inst.environment]}`;
    envBadge.style.display = '';
  }

  // Notes
  if (inst.notes) {
    const notesEl = card.querySelector('.card-notes');
    notesEl.textContent    = inst.notes;
    notesEl.style.display  = '';
  }

  // Metrics helper
  const set = (sel, val) => {
    const el = card.querySelector(sel);
    if (val === null || val === undefined) { el.textContent = '—'; el.classList.add('skeleton'); }
    else { el.textContent = val; el.classList.remove('skeleton'); }
  };

  if (d?.online) {
    set('.env-count',     d.endpointsCount);
    set('.running-count', d.runningContainers);
    set('.stopped-count', d.stoppedContainers);
    set('.stacks-count',  d.stacksCount);
    if (d.servicesCount > 0) {
      set('.services-count', d.servicesCount);
      card.querySelector('.services-metric').style.display = '';
    }
  } else if (d && !d.online) {
    ['.env-count', '.running-count', '.stopped-count', '.stacks-count'].forEach(s => {
      const el = card.querySelector(s);
      el.textContent = '—';
      el.classList.remove('skeleton');
    });
  } else {
    ['.env-count', '.running-count', '.stopped-count', '.stacks-count'].forEach(s => set(s, null));
  }

  // Uptime sparkline
  if (up) {
    const uptimeRow  = card.querySelector('.uptime-row');
    const dotsEl     = card.querySelector('.uptime-dots');
    const percentEl  = card.querySelector('.uptime-percent');
    dotsEl.innerHTML = up.history.map(u => `<span class="uptime-dot ${u ? 'up' : 'down'}"></span>`).join('');
    const color = up.percent >= 95 ? 'var(--online)' : up.percent >= 80 ? 'var(--warning)' : 'var(--offline)';
    percentEl.textContent  = up.percent + '%';
    percentEl.style.color  = color;
    uptimeRow.style.display = '';
  }

  // Version badges
  const portainerBadge = card.querySelector('.portainer-badge');
  const updateBadge    = card.querySelector('.update-badge');
  if (d?.online && d.version) {
    card.querySelector('.portainer-version').textContent = 'v' + d.version;
    portainerBadge.style.display = '';
    if (state.latestVersion) {
      const outdated = isOutdated(d.version, state.latestVersion);
      updateBadge.textContent = outdated ? t('card.updateAvailable', { v: state.latestVersion }) : t('card.upToDate');
      updateBadge.className   = `update-badge ${outdated ? 'outdated' : 'up-to-date'}`;
      updateBadge.title       = outdated ? `v${d.version} → v${state.latestVersion}` : `v${d.version}`;
      updateBadge.style.display = '';
    }
  }

  const dockerBadge = card.querySelector('.docker-badge');
  if (d?.online && d.dockerVersion) {
    card.querySelector('.docker-version').textContent = 'v' + d.dockerVersion;
    dockerBadge.style.display = '';
  }

  // Update button
  const updateBtn = card.querySelector('.update-btn');
  if (d?.online && d.version && state.latestVersion && isOutdated(d.version, state.latestVersion)) {
    updateBtn.style.display = '';
    updateBtn.addEventListener('click', () => openUpdateGuide(inst, d));
  }

  // Error
  const errEl = card.querySelector('.card-error');
  if (d && !d.online && d.error) {
    const msg = d.errorCode ? t(`err.${d.errorCode}`) : d.error;
    errEl.textContent = msg; errEl.title = msg;
  }

  // Actions
  card.querySelector('.open-btn').addEventListener('click', () => window.open(inst.url, '_blank', 'noopener,noreferrer'));
  if (state.isViewer) {
    card.querySelector('.edit-btn').style.display = 'none';
    card.querySelector('.delete-btn').style.display = 'none';
  } else {
    card.querySelector('.edit-btn').addEventListener('click', () => openEditModal(inst));
    card.querySelector('.delete-btn').addEventListener('click', () => deleteInstance(inst.id, inst.name));
  }

  // Bulk selection
  const selectBox = card.querySelector('.card-select');
  if (state.isViewer) {
    selectBox.style.display = 'none';
  } else {
    selectBox.checked = state.selected.has(inst.id);
    selectBox.addEventListener('change', () => toggleSelect(inst.id, selectBox.checked));
  }

  return card;
}

/* ── Semver ────────────────────────────────────────────────────────────────── */
function semverCompare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isOutdated(current, latest) {
  if (!current || !latest) return null;
  return semverCompare(current, latest) < 0;
}

/* ── Alert bell ────────────────────────────────────────────────────────────── */
function updateAlertBell() {
  if (!state.latestVersion) return;

  const outdated = state.instances
    .filter(inst => { const d = state.liveData[inst.id]; return d?.online && d.version && isOutdated(d.version, state.latestVersion); })
    .map(inst => ({ inst, version: state.liveData[inst.id].version }))
    .sort((a, b) => semverCompare(a.version, b.version));

  const wrap = $('alertWrap');
  if (outdated.length === 0) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';
  $('alertBadge').textContent = outdated.length;
  $('alertLatestVersion').textContent = 'v' + state.latestVersion;

  const list = $('alertList');
  list.innerHTML = '';
  outdated.forEach(({ inst, version }, idx) => {
    const li = document.createElement('li');
    li.className = 'alert-item';
    const envHtml = inst.environment ? `<span class="alert-item-env env-badge ${ENV_CLASSES[inst.environment]}">${envLabel(inst.environment)}</span>` : '';
    li.innerHTML = `
      <span class="alert-item-rank rank-${idx + 1}">${idx + 1}</span>
      <div class="alert-item-info">
        <div class="alert-item-name">${escapeHtml(inst.name)}</div>
        <div class="alert-item-versions">v${escapeHtml(version)} → <strong>v${escapeHtml(state.latestVersion)}</strong></div>
      </div>${envHtml}`;
    list.appendChild(li);
  });
}

/* ── CRUD ──────────────────────────────────────────────────────────────────── */
async function addInstance(name, url, token, environment, notes) {
  const btn = $('submitBtn');
  btn.disabled = true; btn.textContent = t('instance.adding');
  $('formError').textContent = '';
  try {
    const inst = await apiFetch('/api/instances', { method: 'POST', body: JSON.stringify({ name, url, token, environment, notes }) });
    state.instances.push(inst);
    closeModal();
    showToast(t('instance.added', { name: inst.name }), 'success');
    renderAll();
    fetchLiveData(inst).then(() => { updateStats(); renderAll(); });
  } catch (e) { $('formError').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = t('header.add'); }
}

async function editInstance(id, name, url, token, environment, notes) {
  const btn = $('submitBtn');
  btn.disabled = true; btn.textContent = t('instance.saving');
  $('formError').textContent = '';
  try {
    const updated = await apiFetch(`/api/instances/${id}`, { method: 'PUT', body: JSON.stringify({ name, url, environment, notes, ...(token ? { token } : {}) }) });
    const idx = state.instances.findIndex(i => i.id === id);
    if (idx !== -1) state.instances[idx] = updated;
    closeModal();
    showToast(t('instance.updated', { name: updated.name }), 'success');
    fetchLiveData(updated).then(() => { updateStats(); renderAll(); });
  } catch (e) { $('formError').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = t('common.save'); }
}

async function deleteInstance(id, name) {
  if (!confirm(t('instance.confirmDelete', { name }))) return;
  try {
    await apiFetch(`/api/instances/${id}`, { method: 'DELETE' });
    state.instances = state.instances.filter(i => i.id !== id);
    delete state.liveData[id];
    delete state.uptime[id];
    showToast(t('instance.deleted', { name }), 'info');
    renderAll(); updateStats();
  } catch (e) { showToast(t('common.error', { msg: e.message }), 'error'); }
}

/* ── Modal add/edit ────────────────────────────────────────────────────────── */
function openModal() {
  state.editId = null;
  $('addForm').reset();
  $('formError').textContent = '';
  $('modalTitle').textContent          = t('instance.addTitle');
  $('labelTokenText').textContent      = t('instance.token');
  $('tokenRequiredMark').hidden        = false;
  $('fieldToken').required             = true;
  $('fieldToken').placeholder          = 'ptr_…';
  $('tokenHint').textContent           = t('instance.tokenHint');
  $('fieldEnvironment').value          = '';
  $('submitBtn').textContent           = t('header.add');
  $('modalOverlay').classList.add('open');
  $('fieldUrl').focus();
}

function openEditModal(inst) {
  state.editId = inst.id;
  $('addForm').reset();
  $('formError').textContent = '';
  $('modalTitle').textContent          = t('instance.editTitle', { name: inst.name });
  $('fieldId').value                   = inst.id;
  $('fieldName').value                 = inst.name;
  $('fieldUrl').value                  = inst.url;
  $('fieldEnvironment').value          = inst.environment || '';
  $('fieldNotes').value                = inst.notes || '';
  $('labelTokenText').textContent      = t('instance.newToken');
  $('tokenRequiredMark').hidden        = true;
  $('fieldToken').required             = false;
  $('fieldToken').placeholder          = t('instance.tokenKeepPlaceholder');
  $('tokenHint').textContent           = t('instance.tokenKeepHint');
  $('submitBtn').textContent           = t('common.save');
  $('modalOverlay').classList.add('open');
  $('fieldName').focus();
}

function closeModal() {
  $('modalOverlay').classList.remove('open');
  state.editId = null;
}

$('addBtn').addEventListener('click', openModal);
$('cancelBtn').addEventListener('click', closeModal);
$('modalClose').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });

$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const name  = $('fieldName').value.trim();
  const url   = $('fieldUrl').value.trim();
  const token = $('fieldToken').value.trim();
  const env   = $('fieldEnvironment').value;
  const notes = $('fieldNotes').value.trim();
  if (state.editId) {
    if (!url) { $('formError').textContent = t('instance.urlRequired'); return; }
    editInstance(state.editId, name, url, token, env, notes);
  } else {
    if (!url || !token) { $('formError').textContent = t('instance.urlTokenRequired'); return; }
    addInstance(name, url, token, env, notes);
  }
});

$('tokenToggle').addEventListener('click', () => {
  const input = $('fieldToken');
  input.type = input.type === 'password' ? 'text' : 'password';
});

/* ── Settings modal (webhook, affichage, uptime, SSO, sauvegarde) ────────────── */
function renderWebhookEnvChecks(selected) {
  const container = $('webhookEnvChecks');
  container.innerHTML = ENVS.map(env => `
    <label class="checkbox-chip ${selected.includes(env) ? 'checked' : ''}" data-env="${env}">
      <input type="checkbox" value="${env}" ${selected.includes(env) ? 'checked' : ''} />
      ${envLabel(env)}
    </label>
  `).join('');
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => cb.closest('.checkbox-chip').classList.toggle('checked', cb.checked));
  });
}

function getSelectedWebhookEnvs() {
  return Array.from($('webhookEnvChecks').querySelectorAll('input:checked')).map(cb => cb.value);
}

async function loadSsoStatus() {
  const el = $('ssoStatus');
  el.textContent = t('common.loading');
  try {
    const methods = await apiFetch('/api/auth/methods');
    if (methods.oidc) {
      el.innerHTML = `<span class="status-dot on"></span> ${escapeHtml(t('settings.ssoOn'))} — <strong>${escapeHtml(methods.oidcLabel)}</strong> <a href="/auth/oidc/login" target="_blank" class="settings-link">${escapeHtml(t('settings.ssoTest'))}</a>`;
    } else {
      el.innerHTML = `<span class="status-dot off"></span> ${escapeHtml(t('settings.ssoOff'))} <span class="settings-hint">${escapeHtml(t('settings.ssoOffHint'))}</span>`;
    }
  } catch {
    el.textContent = t('settings.statusUnavailable');
  }
}

async function openSettings() {
  $('settingsError').textContent = '';
  $('refreshInterval').value = String(state.refreshInterval);
  try {
    const config = await apiFetch('/api/config');
    $('webhookUrl').value  = config.webhookUrl || '';
    $('webhookType').value = config.webhookType || 'slack';
    $('webhookLanguage').value = config.webhookLanguage || 'fr';
    renderWebhookEnvChecks(config.webhookEnvironments || []);
    $('uptimeRetention').value = config.uptimeRetention || 288;
    $('uptimeRetentionHint').textContent = t('settings.uptimeHint', { h: Math.round((config.uptimeRetention || 288) * state.refreshInterval / 3600000 * 10) / 10 });
  } catch {}
  loadSsoStatus();
  $('settingsOverlay').classList.add('open');
}

function closeSettings() { $('settingsOverlay').classList.remove('open'); }

$('settingsBtn').addEventListener('click', openSettings);
$('settingsCancelBtn').addEventListener('click', closeSettings);
$('settingsClose').addEventListener('click', closeSettings);
$('settingsOverlay').addEventListener('click', e => { if (e.target === $('settingsOverlay')) closeSettings(); });

$('uptimeRetention').addEventListener('input', () => {
  const interval = parseInt($('refreshInterval').value, 10);
  const points = parseInt($('uptimeRetention').value, 10) || 0;
  $('uptimeRetentionHint').textContent = t('settings.uptimeHint', { h: Math.round(points * interval / 3600000 * 10) / 10 });
});

$('saveSettingsBtn').addEventListener('click', async () => {
  $('settingsError').textContent = '';
  try {
    await apiFetch('/api/config', {
      method: 'PUT',
      body: JSON.stringify({
        webhookUrl: $('webhookUrl').value.trim(),
        webhookType: $('webhookType').value,
        webhookLanguage: $('webhookLanguage').value,
        webhookEnvironments: getSelectedWebhookEnvs(),
        uptimeRetention: parseInt($('uptimeRetention').value, 10) || 288,
      }),
    });
    const newInterval = parseInt($('refreshInterval').value, 10);
    if (newInterval !== state.refreshInterval) {
      state.refreshInterval = newInterval;
      localStorage.setItem('refreshInterval', String(newInterval));
      scheduleRefresh();
    }
    closeSettings();
    showToast(t('settings.saved'), 'success');
  } catch (e) { $('settingsError').textContent = e.message; }
});

$('testWebhookBtn').addEventListener('click', async () => {
  $('settingsError').textContent = '';
  const btn = $('testWebhookBtn');
  btn.disabled = true; btn.textContent = t('settings.testing');
  try {
    await apiFetch('/api/config/test-webhook', { method: 'POST', body: JSON.stringify({ webhookUrl: $('webhookUrl').value.trim(), webhookType: $('webhookType').value, webhookLanguage: $('webhookLanguage').value }) });
    showToast(t('settings.webhookTested'), 'success');
  } catch (e) { $('settingsError').textContent = t('settings.failed', { msg: e.message }); }
  finally { btn.disabled = false; btn.textContent = t('settings.testWebhook'); }
});

$('exportConfigBtn').addEventListener('click', async () => {
  try {
    const backup = await apiFetch('/api/backup/export');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `portainer-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    showToast(t('settings.exported'), 'success');
  } catch (e) { $('settingsError').textContent = t('settings.exportFailed', { msg: e.message }); }
});

$('importConfigBtn').addEventListener('click', () => $('importConfigFile').click());

$('importConfigFile').addEventListener('change', async () => {
  const file = $('importConfigFile').files[0];
  if (!file) return;
  $('settingsError').textContent = '';
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    const result = await apiFetch('/api/backup/import', { method: 'POST', body: JSON.stringify(backup) });
    showToast(t('settings.imported', result) + (result.skipped ? t('settings.importedSkipped', result) : ''), 'success');
    closeSettings();
    await loadInstances();
  } catch (e) {
    $('settingsError').textContent = t('settings.importFailed', { msg: e.message });
  } finally {
    $('importConfigFile').value = '';
  }
});

/* ── Update guide modal ────────────────────────────────────────────────────── */
function openUpdateGuide(inst, d) {
  const isSwarm  = (d?.servicesCount ?? 0) > 0;
  const from     = d?.version;
  const to       = state.latestVersion;

  $('updateGuideTitle').textContent    = t('guide.titleFor', { name: inst.name });
  $('updateGuideSubtitle').textContent = `v${from} → v${to}`;
  $('updateGuideMode').textContent     = isSwarm ? t('guide.modeSwarm') : t('guide.modeStandalone');
  $('updateGuideMode').className       = `update-guide-mode ${isSwarm ? 'swarm' : 'standalone'}`;

  let code, note;
  if (isSwarm) {
    code = [
      t('guide.swarmComment'),
      `docker service update \\`,
      `  --image portainer/portainer-ce:${to} \\`,
      `  --force \\`,
      `  ${t('guide.serviceName')}`,
    ].join('\n');
    note = t('guide.swarmNote', { placeholder: t('guide.serviceName') });
  } else {
    code = [
      `docker pull portainer/portainer-ce:${to}`,
      `docker stop portainer`,
      `docker rm portainer`,
      `docker run -d -p 8000:8000 -p 9443:9443 \\`,
      `  --name portainer --restart=always \\`,
      `  -v /var/run/docker.sock:/var/run/docker.sock \\`,
      `  -v portainer_data:/data \\`,
      `  portainer/portainer-ce:${to}`,
    ].join('\n');
    note = t('guide.standaloneNote');
  }

  $('updateGuideCode').textContent = code;
  $('updateGuideNote').textContent = note;
  $('updateGuideOverlay').classList.add('open');
}

function closeUpdateGuide() { $('updateGuideOverlay').classList.remove('open'); }

$('updateGuideClose').addEventListener('click', closeUpdateGuide);
$('updateGuideCloseBtn').addEventListener('click', closeUpdateGuide);
$('updateGuideOverlay').addEventListener('click', e => { if (e.target === $('updateGuideOverlay')) closeUpdateGuide(); });
$('updateGuideCopyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('updateGuideCode').textContent);
    showToast(t('guide.copied'), 'success');
  } catch { showToast(t('guide.copyFailed'), 'error'); }
});

/* ── Audit log modal ───────────────────────────────────────────────────────── */
function auditLabel(action) {
  const key = `audit.action.${action}`;
  const label = t(key);
  return label === key ? action : label;
}

async function openAuditLog() {
  $('auditOverlay').classList.add('open');
  const list = $('auditList');
  list.innerHTML = `<li class="audit-empty">${escapeHtml(t('common.loading'))}</li>`;
  try {
    const entries = await apiFetch('/api/audit');
    if (!entries.length) { list.innerHTML = `<li class="audit-empty">${escapeHtml(t('audit.empty'))}</li>`; return; }
    list.innerHTML = entries.map(e => `
      <li class="audit-item">
        <span class="audit-ts">${new Date(e.ts).toLocaleString(i18n.locale)}</span>
        <span class="audit-user">${escapeHtml(e.user)}</span>
        <span class="audit-action">${escapeHtml(auditLabel(e.action))}</span>
        ${e.target ? `<span class="audit-target">${escapeHtml(e.target)}</span>` : ''}
      </li>
    `).join('');
  } catch (e) {
    list.innerHTML = `<li class="audit-empty">${escapeHtml(t('common.error', { msg: e.message }))}</li>`;
  }
}

function closeAuditLog() { $('auditOverlay').classList.remove('open'); }

$('auditBtn').addEventListener('click', openAuditLog);
$('auditClose').addEventListener('click', closeAuditLog);
$('auditOverlay').addEventListener('click', e => { if (e.target === $('auditOverlay')) closeAuditLog(); });

/* ── Recherche globale ─────────────────────────────────────────────────────── */
function openSearch() {
  $('searchOverlay').classList.add('open');
  $('globalSearchInput').focus();
}

function closeSearch() { $('searchOverlay').classList.remove('open'); }

function renderSearchResults(data) {
  $('searchMeta').textContent = t('search.meta', { found: data.results.length, total: data.instancesSearched });
  if (!data.results.length) {
    $('searchResults').innerHTML = `<p class="audit-empty">${escapeHtml(t('search.none'))}</p>`;
    return;
  }
  $('searchResults').innerHTML = data.results.map(r => {
    const inst = state.instances.find(i => i.id === r.instanceId);
    const envHtml = r.environment ? `<span class="env-badge ${ENV_CLASSES[r.environment]}">${envLabel(r.environment)}</span>` : '';
    const stackItems = r.stacks.map(s => `
      <li>
        <div class="search-item-name" title="${escapeHtml(s.name)}">📚 ${escapeHtml(s.name)}</div>
        <div class="search-item-meta"><span class="search-tag">${escapeHtml(t('search.stack'))}</span></div>
      </li>
    `);
    const containerItems = r.containers.map(c => `
      <li>
        <div class="search-item-name" title="${escapeHtml(c.name)}">📦 ${escapeHtml(c.name)}</div>
        <div class="search-item-meta">
          <span class="search-tag">${escapeHtml(c.state)}</span>
          <span class="search-image" title="${escapeHtml(c.image)}">${escapeHtml(c.image)}</span>
        </div>
      </li>
    `);
    return `
      <div class="search-group">
        <div class="search-group-header">
          <strong>${escapeHtml(r.instanceName)}</strong> ${envHtml}
          ${inst ? `<a href="${escapeHtml(inst.url)}" target="_blank" rel="noopener noreferrer" class="search-open">${escapeHtml(t('search.open'))}</a>` : ''}
        </div>
        <ul class="search-items">${[...stackItems, ...containerItems].join('')}</ul>
      </div>
    `;
  }).join('');
}

$('searchOpenBtn').addEventListener('click', openSearch);
$('searchClose').addEventListener('click', closeSearch);
$('searchOverlay').addEventListener('click', e => { if (e.target === $('searchOverlay')) closeSearch(); });

$('searchForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('globalSearchInput').value.trim();
  if (q.length < 2) { showToast(t('search.minChars'), 'error'); return; }
  const btn = $('globalSearchBtn');
  btn.disabled = true; btn.textContent = t('search.searching');
  $('searchMeta').textContent = '';
  $('searchResults').innerHTML = `<p class="audit-empty">${escapeHtml(t('search.inProgress'))}</p>`;
  try {
    const data = await apiFetch('/api/search?q=' + encodeURIComponent(q));
    renderSearchResults(data);
  } catch (err) {
    $('searchResults').innerHTML = `<p class="audit-empty">${escapeHtml(t('common.error', { msg: err.message }))}</p>`;
  } finally {
    btn.disabled = false; btn.textContent = t('search.submit');
  }
});

/* ── Alert bell ────────────────────────────────────────────────────────────── */
$('alertBtn').addEventListener('click', e => {
  e.stopPropagation();
  $('alertDropdown').classList.toggle('open');
});
document.addEventListener('click', () => $('alertDropdown').classList.remove('open'));

/* ── Logout ────────────────────────────────────────────────────────────────── */
$('logoutBtn').addEventListener('click', async () => {
  await apiFetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
});

/* ── Search & filters ──────────────────────────────────────────────────────── */
$('searchInput').addEventListener('input', () => { state.search = $('searchInput').value; renderAll(); });

document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderAll();
  });
});

/* ── Sort ──────────────────────────────────────────────────────────────────── */
$('sortSelect').value = state.sort;
$('sortSelect').addEventListener('change', () => {
  state.sort = $('sortSelect').value;
  localStorage.setItem('sort', state.sort);
  renderAll();
});

/* ── Group by env ──────────────────────────────────────────────────────────── */
const groupBtn = $('groupEnvBtn');
if (state.groupByEnv) groupBtn.classList.add('active');
groupBtn.addEventListener('click', () => {
  state.groupByEnv = !state.groupByEnv;
  groupBtn.classList.toggle('active', state.groupByEnv);
  localStorage.setItem('groupByEnv', state.groupByEnv);
  renderAll();
});

/* ── View toggle ───────────────────────────────────────────────────────────── */
function applyView(view) {
  state.view = view;
  localStorage.setItem('view', view);
  $('gridView').style.display = view === 'grid' ? '' : 'none';
  $('listView').style.display = view === 'list' ? '' : 'none';
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderAll();
}

document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => applyView(btn.dataset.view));
});
applyView(state.view);

/* ── Export CSV ────────────────────────────────────────────────────────────── */
function exportInstancesToCSV(instances, filenameSuffix = '') {
  const headers = ['name', 'environment', 'url', 'status', 'portainer', 'docker', 'envs', 'running', 'stopped', 'stacks', 'services', 'uptime', 'added']
    .map(k => `"${t(`csv.${k}`).replace(/"/g, '""')}"`);
  const rows = instances.map(inst => {
    const d  = state.liveData[inst.id];
    const up = state.uptime[inst.id];
    return [
      inst.name,
      inst.environment ? envLabel(inst.environment) : '',
      inst.url,
      !d ? t('common.loading') : d.online ? t('common.online') : t('common.offline'),
      d?.version || '',
      d?.dockerVersion || '',
      d?.endpointsCount ?? '',
      d?.runningContainers ?? '',
      d?.stoppedContainers ?? '',
      d?.stacksCount ?? '',
      d?.servicesCount ?? '',
      up ? up.percent + '%' : '',
      new Date(inst.createdAt).toLocaleDateString(i18n.locale),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href  = URL.createObjectURL(blob);
  link.download = `portainer-manager${filenameSuffix}-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  showToast(t('csv.downloaded'), 'success');
}

$('exportBtn').addEventListener('click', () => exportInstancesToCSV(state.instances));

/* ── Bulk selection ────────────────────────────────────────────────────────── */
function toggleSelect(id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  updateBulkToolbar();
}

function updateBulkToolbar() {
  const count = state.selected.size;
  const toolbar = $('bulkToolbar');
  if (state.isViewer || count === 0) { toolbar.style.display = 'none'; return; }
  toolbar.style.display = '';
  $('bulkCount').textContent = tp('bulk.selected', count);
}

$('selectAllCheckbox').addEventListener('change', e => {
  const visible = filteredSorted();
  if (e.target.checked) visible.forEach(inst => state.selected.add(inst.id));
  else visible.forEach(inst => state.selected.delete(inst.id));
  renderAll();
});

$('bulkClearBtn').addEventListener('click', () => {
  state.selected.clear();
  renderAll();
});

$('bulkExportBtn').addEventListener('click', () => {
  const selectedInstances = state.instances.filter(i => state.selected.has(i.id));
  exportInstancesToCSV(selectedInstances, '-selection');
});

$('bulkApplyEnvBtn').addEventListener('click', async () => {
  const value = $('bulkEnvSelect').value;
  if (!value) { showToast(t('bulk.chooseEnv'), 'error'); return; }
  const environment = value === '__clear__' ? '' : value;
  const ids = Array.from(state.selected);
  const btn = $('bulkApplyEnvBtn');
  btn.disabled = true; btn.textContent = t('bulk.applying');
  try {
    const results = await Promise.allSettled(ids.map(id => {
      const inst = state.instances.find(i => i.id === id);
      return apiFetch(`/api/instances/${id}`, { method: 'PUT', body: JSON.stringify({ name: inst.name, url: inst.url, environment, notes: inst.notes || '' }) });
    }));
    const failed = results.filter(r => r.status === 'rejected').length;
    showToast(failed ? t('bulk.partial', { ok: ids.length - failed, failed }) : tp('bulk.updated', ids.length), failed ? 'error' : 'success');
    state.selected.clear();
    $('bulkEnvSelect').value = '';
    await loadInstances();
  } finally {
    btn.disabled = false; btn.textContent = t('bulk.apply');
  }
});

/* ── Escape key ────────────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeSettings(); closeUpdateGuide(); closeAuditLog(); closeSearch(); }
});

/* ── Auto-refresh ──────────────────────────────────────────────────────────── */
const countdownEl = $('refreshCountdown');

function formatCountdown(seconds) {
  if (seconds >= 60) return Math.ceil(seconds / 60) + 'min';
  return seconds + 's';
}

function startCountdown() {
  clearInterval(state.countdownTimer);
  state.countdown = Math.round(state.refreshInterval / 1000);
  countdownEl.textContent = formatCountdown(state.countdown);
  state.countdownTimer = setInterval(() => {
    state.countdown--;
    countdownEl.textContent = formatCountdown(Math.max(state.countdown, 0));
    if (state.countdown <= 0) clearInterval(state.countdownTimer);
  }, 1000);
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  startCountdown();
  state.refreshTimer = setTimeout(async () => {
    await refreshAllLiveData();
    scheduleRefresh();
  }, state.refreshInterval);
}

/* ── Toast ─────────────────────────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/* ── Current user ──────────────────────────────────────────────────────────── */
async function loadCurrentUser() {
  try {
    const user = await apiFetch('/api/auth/me');
    if (user?.username) {
      const el = $('currentUser');
      const name = escapeHtml(user.username);
      const tags = [user.method === 'oidc' ? 'SSO' : '', user.role === 'viewer' ? t('user.readOnly') : ''].filter(Boolean).join(' · ');
      el.title = t('user.connectedAs', { name: user.username });
      el.innerHTML = `<span class="user-avatar">${escapeHtml(user.username.charAt(0).toUpperCase())}</span>
        <span class="user-text"><strong>${name}</strong>${tags ? `<span class="user-tags">${escapeHtml(tags)}</span>` : ''}</span>`;
      el.style.display = '';
    }
    state.isViewer = user?.role === 'viewer';
    if (state.isViewer) {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }
  } catch {}
}

/* ── App version ───────────────────────────────────────────────────────────── */
async function loadAppVersion() {
  try {
    state.appVersion = await apiFetch('/api/app/version');
    const badge = $('appVersionBadge');
    const outdated = isOutdated(state.appVersion.current, state.appVersion.latest);
    badge.textContent = 'v' + state.appVersion.current;
    badge.classList.toggle('outdated', !!outdated);
    if (outdated) badge.title = t('app.availableOnGithub', { v: state.appVersion.latest });
    renderAboutStatus();
  } catch {}
}

function renderAboutStatus() {
  const el = $('aboutStatus');
  if (!el || !state.appVersion) return;
  const { current, latest } = state.appVersion;
  const outdated = isOutdated(current, latest);
  el.innerHTML = outdated
    ? `<span class="status-dot off"></span> ${escapeHtml(t('about.version'))} <strong>v${escapeHtml(current)}</strong> — <strong class="text-warning">${escapeHtml(t('card.updateAvailable', { v: latest }))}</strong>`
    : `<span class="status-dot on"></span> ${escapeHtml(t('about.version'))} <strong>v${escapeHtml(current)}</strong> — ${escapeHtml(t('about.upToDate'))}`;
}

/* ── Init ──────────────────────────────────────────────────────────────────── */
Promise.all([fetchLatestVersion(), fetchUptime(), loadCurrentUser(), loadAppVersion()])
  .then(() => loadInstances())
  .then(() => scheduleRefresh());
