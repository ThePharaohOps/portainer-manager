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
};

const ENV_ORDER = ['production', 'preprod', 'recette', 'integration', null];
const ENV_LABELS = { integration: 'Intégration', recette: 'Recette', preprod: 'Pré-production', production: 'Production' };
const ENV_CLASSES = { integration: 'env-integration', recette: 'env-recette', preprod: 'env-preprod', production: 'env-production' };

/* ── DOM ───────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── API ───────────────────────────────────────────────────────────────────── */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 401) { window.location.href = '/login'; throw new Error('Non authentifié'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
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
  catch (e) { showToast('Impossible de charger les instances : ' + e.message, 'error'); }
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
    state.liveData[instance.id] = { online: false, error: 'Requête échouée' };
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

      const label = env ? ENV_LABELS[env] : 'Non défini';
      const cls   = env ? ENV_CLASSES[env] : '';
      const header = document.createElement('div');
      header.className = 'env-section-header';
      header.innerHTML = `<span class="env-badge ${cls}">${label}</span><span class="env-section-count">${groups[key].length} instance${groups[key].length > 1 ? 's' : ''}</span>`;
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
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text-muted)">Aucune instance</td></tr>`;
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
      ? `<span class="env-badge ${ENV_CLASSES[inst.environment]}">${ENV_LABELS[inst.environment]}</span>`
      : '<span style="color:var(--text-muted)">—</span>';

    let portainerVer = '—';
    if (d?.version) {
      const versionBadge = `<span class="version-badge portainer-badge" style="display:inline-flex"><img src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/portainer.png" width="12" height="12" style="display:block" /> v${d.version}</span>`;
      let updateBadgeHtml = '';
      let showUpdateBtn = false;
      if (state.latestVersion) {
        const outdated = isOutdated(d.version, state.latestVersion);
        const updateTitle = outdated ? `v${d.version} → v${state.latestVersion}` : `v${d.version}`;
        updateBadgeHtml = `<span class="update-badge ${outdated ? 'outdated' : 'up-to-date'}" title="${updateTitle}">${outdated ? `v${state.latestVersion} disponible` : 'À jour'}</span>`;
        showUpdateBtn = outdated;
      }
      portainerVer = `<div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">${versionBadge}${updateBadgeHtml}${showUpdateBtn ? `<button type="button" class="update-btn list-update-btn">Mettre à jour</button>` : ''}</div>`;
    }

    const dockerVer = d?.dockerVersion
      ? `<span style="font-size:12px;color:#60b8f5;font-variant-numeric:tabular-nums">v${d.dockerVersion}</span>` : '—';

    const uptimeDots = up?.history
      ? up.history.map(u => `<span class="list-uptime-dot ${u ? 'up' : 'down'}"></span>`).join('')
      : '';
    const uptimeHtml = up
      ? `<div style="display:flex;align-items:center;gap:6px">
           <div class="list-uptime-bar">${uptimeDots}</div>
           <span style="font-size:11px;font-weight:700;color:var(--text-dim)">${up.percent}%</span>
         </div>`
      : '<span style="color:var(--text-muted);font-size:12px">—</span>';

    tr.innerHTML = `
      <td><span class="list-status-dot ${statusClass}"></span></td>
      <td>
        <div class="list-name">${inst.name}</div>
        ${inst.notes ? `<div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:2px">${inst.notes}</div>` : ''}
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
          <button class="icon-btn open-btn" title="Ouvrir">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </button>
          <button class="icon-btn edit-btn" title="Modifier">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="icon-btn delete-btn" title="Supprimer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </td>
    `;

    tr.querySelector('.open-btn').addEventListener('click', () => window.open(inst.url, '_blank', 'noopener,noreferrer'));
    tr.querySelector('.edit-btn').addEventListener('click', () => openEditModal(inst));
    tr.querySelector('.delete-btn').addEventListener('click', () => deleteInstance(inst.id, inst.name));
    tr.querySelector('.list-update-btn')?.addEventListener('click', () => openUpdateGuide(inst, d));
    tbody.appendChild(tr);
  }
  updateStats();
}

/* ── Build card ────────────────────────────────────────────────────────────── */
function buildCard(inst) {
  const tpl = document.getElementById('cardTemplate');
  const card = tpl.content.cloneNode(true).querySelector('.card');
  const d  = state.liveData[inst.id];
  const up = state.uptime[inst.id];

  card.dataset.id = inst.id;

  // Border color
  if (!d)       card.classList.add('loading');
  else if (d.online)  card.classList.add('status-online');
  else          card.classList.add('status-offline');

  // Status badge
  const badge = card.querySelector('.status-badge');
  if (!d) { badge.textContent = 'Chargement…'; badge.className = 'status-badge loading'; }
  else if (d.online)  { badge.textContent = 'En ligne';   badge.className = 'status-badge online'; }
  else                { badge.textContent = 'Hors ligne'; badge.className = 'status-badge offline'; }

  card.querySelector('.card-name').textContent = inst.name;
  card.querySelector('.card-url').textContent  = inst.url;

  // Env badge
  const envBadge = card.querySelector('.env-badge');
  if (inst.environment && ENV_LABELS[inst.environment]) {
    envBadge.textContent  = ENV_LABELS[inst.environment];
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
      updateBadge.textContent = outdated ? `v${state.latestVersion} disponible` : 'À jour';
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
  if (d && !d.online && d.error) { errEl.textContent = d.error; errEl.title = d.error; }

  // Actions
  card.querySelector('.open-btn').addEventListener('click', () => window.open(inst.url, '_blank', 'noopener,noreferrer'));
  card.querySelector('.edit-btn').addEventListener('click', () => openEditModal(inst));
  card.querySelector('.delete-btn').addEventListener('click', () => deleteInstance(inst.id, inst.name));

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
    const envHtml = inst.environment ? `<span class="alert-item-env env-badge ${ENV_CLASSES[inst.environment]}">${ENV_LABELS[inst.environment]}</span>` : '';
    li.innerHTML = `
      <span class="alert-item-rank rank-${idx + 1}">${idx + 1}</span>
      <div class="alert-item-info">
        <div class="alert-item-name">${inst.name}</div>
        <div class="alert-item-versions">v${version} → <strong>v${state.latestVersion}</strong></div>
      </div>${envHtml}`;
    list.appendChild(li);
  });
}

/* ── CRUD ──────────────────────────────────────────────────────────────────── */
async function addInstance(name, url, token, environment, notes) {
  const btn = $('submitBtn');
  btn.disabled = true; btn.textContent = 'Ajout en cours…';
  $('formError').textContent = '';
  try {
    const inst = await apiFetch('/api/instances', { method: 'POST', body: JSON.stringify({ name, url, token, environment, notes }) });
    state.instances.push(inst);
    closeModal();
    showToast(`Instance "${inst.name}" ajoutée`, 'success');
    renderAll();
    fetchLiveData(inst).then(() => { updateStats(); renderAll(); });
  } catch (e) { $('formError').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Ajouter'; }
}

async function editInstance(id, name, url, token, environment, notes) {
  const btn = $('submitBtn');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  $('formError').textContent = '';
  try {
    const updated = await apiFetch(`/api/instances/${id}`, { method: 'PUT', body: JSON.stringify({ name, url, environment, notes, ...(token ? { token } : {}) }) });
    const idx = state.instances.findIndex(i => i.id === id);
    if (idx !== -1) state.instances[idx] = updated;
    closeModal();
    showToast(`Instance "${updated.name}" modifiée`, 'success');
    fetchLiveData(updated).then(() => { updateStats(); renderAll(); });
  } catch (e) { $('formError').textContent = e.message; }
  finally { btn.disabled = false; btn.textContent = 'Enregistrer'; }
}

async function deleteInstance(id, name) {
  if (!confirm(`Supprimer l'instance "${name}" ?`)) return;
  try {
    await apiFetch(`/api/instances/${id}`, { method: 'DELETE' });
    state.instances = state.instances.filter(i => i.id !== id);
    delete state.liveData[id];
    delete state.uptime[id];
    showToast(`Instance "${name}" supprimée`, 'info');
    renderAll(); updateStats();
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

/* ── Modal add/edit ────────────────────────────────────────────────────────── */
function openModal() {
  state.editId = null;
  $('addForm').reset();
  $('formError').textContent = '';
  $('modalTitle').textContent          = 'Ajouter une instance Portainer';
  $('labelToken').innerHTML            = 'API Token <span class="required">*</span>';
  $('fieldToken').required             = true;
  $('fieldToken').placeholder          = 'ptr_…';
  $('tokenHint').textContent           = "Le token est stocké côté serveur et n'est jamais transmis au navigateur.";
  $('fieldEnvironment').value          = '';
  $('submitBtn').textContent           = 'Ajouter';
  $('modalOverlay').classList.add('open');
  $('fieldUrl').focus();
}

function openEditModal(inst) {
  state.editId = inst.id;
  $('addForm').reset();
  $('formError').textContent = '';
  $('modalTitle').textContent          = `Modifier "${inst.name}"`;
  $('fieldId').value                   = inst.id;
  $('fieldName').value                 = inst.name;
  $('fieldUrl').value                  = inst.url;
  $('fieldEnvironment').value          = inst.environment || '';
  $('fieldNotes').value                = inst.notes || '';
  $('labelToken').innerHTML            = 'Nouveau token (optionnel)';
  $('fieldToken').required             = false;
  $('fieldToken').placeholder          = "Laisser vide pour conserver l'actuel";
  $('tokenHint').textContent           = 'Laissez vide si vous ne souhaitez pas changer le token.';
  $('submitBtn').textContent           = 'Enregistrer';
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
    if (!url) { $('formError').textContent = 'URL requise.'; return; }
    editInstance(state.editId, name, url, token, env, notes);
  } else {
    if (!url || !token) { $('formError').textContent = 'URL et token requis.'; return; }
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
  container.innerHTML = Object.keys(ENV_LABELS).map(env => `
    <label class="checkbox-chip ${selected.includes(env) ? 'checked' : ''}" data-env="${env}">
      <input type="checkbox" value="${env}" ${selected.includes(env) ? 'checked' : ''} />
      ${ENV_LABELS[env]}
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
  el.textContent = 'Chargement…';
  try {
    const methods = await apiFetch('/api/auth/methods');
    if (methods.oidc) {
      el.innerHTML = `<span class="status-dot on"></span> Activé — <strong>${methods.oidcLabel}</strong> <a href="/auth/oidc/login" target="_blank" class="settings-hint" style="color:var(--primary)">Tester →</a>`;
    } else {
      el.innerHTML = `<span class="status-dot off"></span> Désactivé <span class="settings-hint">(variables OIDC_* absentes de .env)</span>`;
    }
  } catch {
    el.textContent = 'Impossible de récupérer le statut';
  }
}

async function openSettings() {
  $('settingsError').textContent = '';
  $('refreshInterval').value = String(state.refreshInterval);
  try {
    const config = await apiFetch('/api/config');
    $('webhookUrl').value  = config.webhookUrl || '';
    $('webhookType').value = config.webhookType || 'slack';
    renderWebhookEnvChecks(config.webhookEnvironments || []);
    $('uptimeRetention').value = config.uptimeRetention || 288;
    $('uptimeRetentionHint').textContent = `(~${Math.round((config.uptimeRetention || 288) * state.refreshInterval / 3600000 * 10) / 10}h au rythme actuel)`;
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
  $('uptimeRetentionHint').textContent = `(~${Math.round(points * interval / 3600000 * 10) / 10}h au rythme actuel)`;
});

$('saveSettingsBtn').addEventListener('click', async () => {
  $('settingsError').textContent = '';
  try {
    await apiFetch('/api/config', {
      method: 'PUT',
      body: JSON.stringify({
        webhookUrl: $('webhookUrl').value.trim(),
        webhookType: $('webhookType').value,
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
    showToast('Paramètres enregistrés', 'success');
  } catch (e) { $('settingsError').textContent = e.message; }
});

$('testWebhookBtn').addEventListener('click', async () => {
  $('settingsError').textContent = '';
  const btn = $('testWebhookBtn');
  btn.disabled = true; btn.textContent = 'Test…';
  try {
    await apiFetch('/api/config/test-webhook', { method: 'POST', body: JSON.stringify({ webhookUrl: $('webhookUrl').value.trim(), webhookType: $('webhookType').value }) });
    showToast('Webhook testé avec succès !', 'success');
  } catch (e) { $('settingsError').textContent = 'Échec : ' + e.message; }
  finally { btn.disabled = false; btn.textContent = 'Tester le webhook'; }
});

$('exportConfigBtn').addEventListener('click', async () => {
  try {
    const backup = await apiFetch('/api/backup/export');
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `portainer-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    showToast('Sauvegarde exportée', 'success');
  } catch (e) { $('settingsError').textContent = 'Échec de l\'export : ' + e.message; }
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
    showToast(`Import : ${result.added} ajoutée(s), ${result.updated} mise(s) à jour${result.skipped ? `, ${result.skipped} ignorée(s)` : ''}`, 'success');
    closeSettings();
    await loadInstances();
  } catch (e) {
    $('settingsError').textContent = 'Échec de l\'import : ' + e.message;
  } finally {
    $('importConfigFile').value = '';
  }
});

/* ── Update guide modal ────────────────────────────────────────────────────── */
function openUpdateGuide(inst, d) {
  const isSwarm  = (d?.servicesCount ?? 0) > 0;
  const from     = d?.version;
  const to       = state.latestVersion;

  $('updateGuideTitle').textContent    = `Mettre à jour "${inst.name}"`;
  $('updateGuideSubtitle').textContent = `v${from} → v${to}`;
  $('updateGuideMode').textContent     = isSwarm ? 'Mode détecté : Docker Swarm' : 'Mode détecté : Docker standalone';
  $('updateGuideMode').className       = `update-guide-mode ${isSwarm ? 'swarm' : 'standalone'}`;

  let code, note;
  if (isSwarm) {
    code = [
      `# Sur un nœud manager du swarm`,
      `docker service update \\`,
      `  --image portainer/portainer-ce:${to} \\`,
      `  --force \\`,
      `  <nom_du_service_portainer>`,
    ].join('\n');
    note = "Remplacez <nom_du_service_portainer> par le nom réel du service (ex. portainer_agent ou portainer). Trouvez-le avec `docker service ls | grep portainer`.";
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
    note = "Adaptez le nom du conteneur (--name) et le volume de données (portainer_data) s'ils diffèrent de votre installation actuelle.";
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
    showToast('Commandes copiées', 'success');
  } catch { showToast('Impossible de copier', 'error'); }
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
$('exportBtn').addEventListener('click', () => {
  const headers = ['Nom', 'Environnement', 'URL', 'Statut', 'Version Portainer', 'Version Docker', 'Environnements', 'Conteneurs actifs', 'Conteneurs arrêtés', 'Stacks', 'Services', 'Uptime %', 'Date ajout'];
  const rows = state.instances.map(inst => {
    const d  = state.liveData[inst.id];
    const up = state.uptime[inst.id];
    return [
      inst.name,
      ENV_LABELS[inst.environment] || '',
      inst.url,
      !d ? 'Chargement' : d.online ? 'En ligne' : 'Hors ligne',
      d?.version || '',
      d?.dockerVersion || '',
      d?.endpointsCount ?? '',
      d?.runningContainers ?? '',
      d?.stoppedContainers ?? '',
      d?.stacksCount ?? '',
      d?.servicesCount ?? '',
      up ? up.percent + '%' : '',
      new Date(inst.createdAt).toLocaleDateString('fr-FR'),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv  = [headers.join(','), ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href  = URL.createObjectURL(blob);
  link.download = `portainer-manager-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  showToast('Export CSV téléchargé', 'success');
});

/* ── Escape key ────────────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeSettings(); closeUpdateGuide(); }
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
      el.innerHTML = `Connecté en tant que <strong>${user.username}</strong>${user.method === 'oidc' ? ' (SSO)' : ''}`;
      el.style.display = '';
    }
  } catch {}
}

/* ── Init ──────────────────────────────────────────────────────────────────── */
Promise.all([fetchLatestVersion(), fetchUptime(), loadCurrentUser()])
  .then(() => loadInstances())
  .then(() => scheduleRefresh());
