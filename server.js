require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = require('./package.json').version;
const GITHUB_REPO = 'ThePharaohOps/portainer-manager';
const DATA_FILE    = path.join(__dirname, 'data', 'instances.json');
const CONFIG_FILE  = path.join(__dirname, 'data', 'config.json');
const UPTIME_FILE  = path.join(__dirname, 'data', 'uptime.json');
const AUDIT_FILE   = path.join(__dirname, 'data', 'audit.log');
const SESSION_DIR  = path.join(__dirname, 'data', 'sessions');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const METRICS_TOKEN = process.env.METRICS_TOKEN || null;

// ── OIDC config (optional SSO) ────────────────────────────────────────────────
const OIDC_ISSUER_URL    = process.env.OIDC_ISSUER_URL;
const OIDC_CLIENT_ID     = process.env.OIDC_CLIENT_ID;
const OIDC_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET;
const OIDC_REDIRECT_URI  = process.env.OIDC_REDIRECT_URI;
const OIDC_SCOPE         = process.env.OIDC_SCOPE || 'openid profile email';
const OIDC_DISPLAY_NAME  = process.env.OIDC_DISPLAY_NAME || 'SSO';
const OIDC_ALLOW_INSECURE = process.env.OIDC_ALLOW_INSECURE === 'true';
const OIDC_ENABLED = !!(OIDC_ISSUER_URL && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET && OIDC_REDIRECT_URI);
const OIDC_ROLE_CLAIM  = process.env.OIDC_ROLE_CLAIM || 'groups';
const OIDC_ADMIN_GROUP = process.env.OIDC_ADMIN_GROUP || null;
let oidcModule = null;
let oidcConfig = null;

function determineOidcRole(claims) {
  if (!OIDC_ADMIN_GROUP) return 'admin'; // no restriction configured: every SSO user is admin
  const raw = claims?.[OIDC_ROLE_CLAIM];
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return values.includes(OIDC_ADMIN_GROUP) ? 'admin' : 'viewer';
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

app.use(express.json());
app.use(session({
  store: new FileStore({ path: SESSION_DIR, retries: 5, retryInterval: 100, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'pm-secret-' + Math.random().toString(36),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true },
}));

// ── Auth middleware ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (/\.(css|js|png|ico|jpg|svg|woff2?)$/.test(req.path)) return next();
  if (req.path === '/login' || req.path === '/api/auth/login') return next();
  if (req.path === '/api/auth/methods') return next();
  if (req.path === '/auth/oidc/login' || req.path === '/auth/oidc/callback') return next();
  if (req.path === '/status' || req.path === '/api/status/public') return next();
  if (req.path === '/metrics') return next(); // own auth check inside the route (bearer token or session)
  if (req.session?.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non authentifié' });
  res.redirect('/login');
});

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'viewer') return res.status(403).json({ error: 'Action réservée aux administrateurs' });
  next();
}

app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──────────────────────────────────────────────────────────────
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function loadInstances() {
  ensureDataFile();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

function saveInstances(instances) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(instances, null, 2), 'utf8');
}

function stripToken({ token, ...safe }) { return safe; }

// ── Token encryption at rest (AES-256-GCM, key derived from SESSION_SECRET) ──
const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(process.env.SESSION_SECRET || 'pm-insecure-default-key')
  .digest();

function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function decryptToken(stored) {
  if (!stored || !stored.startsWith('enc:')) return stored; // legacy plaintext, pre-migration
  const [, ivB64, tagB64, dataB64] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

function migrateTokenEncryption() {
  const instances = loadInstances();
  let changed = false;
  for (const inst of instances) {
    if (inst.token && !inst.token.startsWith('enc:')) {
      inst.token = encryptToken(inst.token);
      changed = true;
    }
  }
  if (changed) saveInstances(instances);
}

migrateTokenEncryption();

const DEFAULT_CONFIG = { webhookUrl: null, webhookType: 'slack', webhookEnvironments: [], uptimeRetention: 288 };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// ── Uptime tracking (in-memory + flush to disk every 5 min) ──────────────────
let uptimeStore = {};

try {
  if (fs.existsSync(UPTIME_FILE))
    uptimeStore = JSON.parse(fs.readFileSync(UPTIME_FILE, 'utf8'));
} catch {}

let uptimeDirty = false;

function recordUptime(id, online) {
  const maxPoints = loadConfig().uptimeRetention || DEFAULT_CONFIG.uptimeRetention;
  if (!uptimeStore[id]) uptimeStore[id] = [];
  uptimeStore[id].push({ ts: Date.now(), online });
  if (uptimeStore[id].length > maxPoints)
    uptimeStore[id] = uptimeStore[id].slice(-maxPoints);
  uptimeDirty = true;
}

setInterval(() => {
  if (!uptimeDirty) return;
  fs.writeFileSync(UPTIME_FILE, JSON.stringify(uptimeStore), 'utf8');
  uptimeDirty = false;
}, 5 * 60 * 1000);

// ── Audit log (append-only JSONL) ─────────────────────────────────────────────
const MAX_AUDIT_ENTRIES_RETURNED = 200;

function logAudit(user, action, target) {
  const entry = { ts: new Date().toISOString(), user: user || 'inconnu', action, target: target || null };
  try {
    fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[audit] Échec d\'écriture:', e.message);
  }
}

function loadAudit(limit = MAX_AUDIT_ENTRIES_RETURNED) {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).reverse().map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// ── Webhook on status change ──────────────────────────────────────────────────
const statusCache = {};
const liveDataCache = {}; // last known /api/instances/:id/data result per instance, feeds /metrics

async function sendWebhook(id, name, online, url, environment) {
  const config = loadConfig();
  if (!config.webhookUrl) return;
  if (config.webhookEnvironments?.length && !config.webhookEnvironments.includes(environment)) return;

  const emoji = online ? '🟢' : '🔴';
  const statusText = online ? 'est revenue en ligne' : 'est passée hors ligne';
  const envText = environment ? ` [${environment.toUpperCase()}]` : '';
  const ts = new Date().toLocaleString('fr-FR');

  let payload;

  if (config.webhookType === 'slack') {
    payload = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${name}*${envText} ${statusText}`,
          },
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `${url}  •  ${ts}` }],
        },
      ],
    };
  } else if (config.webhookType === 'teams') {
    payload = {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      themeColor: online ? '22c55e' : 'ef4444',
      summary: `${name} ${online ? 'en ligne' : 'hors ligne'}`,
      sections: [{
        activityTitle: `${emoji} ${name}${envText}`,
        activitySubtitle: `Portainer Manager — ${ts}`,
        facts: [
          { name: 'Statut', value: online ? 'En ligne' : 'Hors ligne' },
          { name: 'URL', value: url },
        ],
      }],
    };
  } else {
    payload = { event: 'status_change', instanceId: id, name, url, environment, online, timestamp: new Date().toISOString() };
  }

  try {
    await axios.post(config.webhookUrl, payload, { timeout: 5000 });
  } catch (e) {
    console.error(`[webhook] Échec pour ${name}: ${e.message}`);
  }
}

function checkStatusChange(id, name, online, url, environment) {
  const prev = statusCache[id];
  statusCache[id] = online;
  if (prev !== undefined && prev !== online) {
    sendWebhook(id, name, online, url, environment);
  }
}

// ── Portainer API helper ──────────────────────────────────────────────────────
async function portainerGet(baseUrl, token, endpoint) {
  return axios.get(`${baseUrl}${endpoint}`, {
    headers: { 'X-API-Key': token },
    timeout: 10000,
    httpsAgent,
  });
}

// ── Latest Portainer CE version (cached 1h) ───────────────────────────────────
let latestVersionCache = { version: null, fetchedAt: 0 };

app.get('/api/portainer/latest-version', async (req, res) => {
  const ONE_HOUR = 3_600_000;
  if (latestVersionCache.version && Date.now() - latestVersionCache.fetchedAt < ONE_HOUR)
    return res.json({ version: latestVersionCache.version });
  try {
    const r = await axios.get(
      'https://api.github.com/repos/portainer/portainer/releases/latest',
      { headers: { 'User-Agent': 'portainer-manager' }, timeout: 8000 }
    );
    const version = r.data.tag_name?.replace(/^v/, '') ?? null;
    latestVersionCache = { version, fetchedAt: Date.now() };
    res.json({ version });
  } catch {
    if (latestVersionCache.version) return res.json({ version: latestVersionCache.version });
    res.status(503).json({ version: null });
  }
});

// ── App version (self) — cached 1h, latest Git tag on GitHub ─────────────────
let appLatestVersionCache = { version: null, fetchedAt: 0 };

app.get('/api/app/version', async (req, res) => {
  const ONE_HOUR = 3_600_000;
  if (appLatestVersionCache.version && Date.now() - appLatestVersionCache.fetchedAt < ONE_HOUR) {
    return res.json({ current: APP_VERSION, latest: appLatestVersionCache.version });
  }
  try {
    const r = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/tags`,
      { headers: { 'User-Agent': 'portainer-manager' }, timeout: 8000 }
    );
    const versions = (r.data || []).map(t => t.name?.replace(/^v/, '')).filter(Boolean);
    versions.sort((a, b) => {
      const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) { const d = (pb[i] ?? 0) - (pa[i] ?? 0); if (d) return d; }
      return 0;
    });
    appLatestVersionCache = { version: versions[0] ?? null, fetchedAt: Date.now() };
    res.json({ current: APP_VERSION, latest: appLatestVersionCache.version });
  } catch {
    res.json({ current: APP_VERSION, latest: appLatestVersionCache.version });
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/auth/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.user = { username: 'admin', method: 'local', role: 'admin' };
    logAudit('admin', 'auth:login', 'local');
    return res.json({ success: true });
  }
  logAudit('anonyme', 'auth:login_failed', 'local');
  res.status(401).json({ error: 'Mot de passe incorrect' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json(req.session?.user || null);
});

app.get('/api/auth/methods', (req, res) => {
  res.json({ local: true, oidc: OIDC_ENABLED, oidcLabel: OIDC_DISPLAY_NAME });
});

// ── OIDC (SSO) ─────────────────────────────────────────────────────────────────
function logOidcError(prefix, e) {
  const parts = [e.message];
  if (e.error) parts.push(`error=${e.error}`);
  if (e.error_description) parts.push(`error_description="${e.error_description}"`);
  if (e.status) parts.push(`status=${e.status}`);
  console.error(prefix, parts.join(' | '));
}

app.get('/auth/oidc/login', async (req, res) => {
  if (!OIDC_ENABLED || !oidcConfig) return res.status(503).send('OIDC non configuré');
  try {
    const code_verifier = oidcModule.randomPKCECodeVerifier();
    const code_challenge = await oidcModule.calculatePKCECodeChallenge(code_verifier);
    const state = oidcModule.randomState();
    req.session.oidc = { code_verifier, state };
    const redirectTo = oidcModule.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: OIDC_REDIRECT_URI,
      scope: OIDC_SCOPE,
      code_challenge,
      code_challenge_method: 'S256',
      state,
    });
    res.redirect(redirectTo.href);
  } catch (e) {
    logOidcError('[oidc] Échec de démarrage de connexion:', e);
    res.redirect('/login?error=oidc');
  }
});

app.get('/auth/oidc/callback', async (req, res) => {
  if (!OIDC_ENABLED || !oidcConfig || !req.session.oidc) return res.redirect('/login?error=oidc');
  try {
    const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
    const tokens = await oidcModule.authorizationCodeGrant(oidcConfig, currentUrl, {
      pkceCodeVerifier: req.session.oidc.code_verifier,
      expectedState: req.session.oidc.state,
    });
    const claims = tokens.claims();
    delete req.session.oidc;
    req.session.authenticated = true;
    const username = claims?.email || claims?.preferred_username || claims?.name || claims?.sub || 'utilisateur SSO';
    req.session.user = { username, method: 'oidc', role: determineOidcRole(claims) };
    logAudit(username, 'auth:login', 'oidc');
    res.redirect('/');
  } catch (e) {
    logOidcError('[oidc] Échec de connexion:', e);
    res.redirect('/login?error=oidc');
  }
});

// ── Config (webhook) ──────────────────────────────────────────────────────────
app.get('/api/config', requireAdmin, (req, res) => res.json(loadConfig()));

app.put('/api/config', requireAdmin, (req, res) => {
  const retention = parseInt(req.body.uptimeRetention, 10);
  const config = {
    webhookUrl:  req.body.webhookUrl  || null,
    webhookType: req.body.webhookType || 'slack',
    webhookEnvironments: Array.isArray(req.body.webhookEnvironments)
      ? req.body.webhookEnvironments.filter(e => VALID_ENVS.includes(e))
      : [],
    uptimeRetention: Number.isFinite(retention) ? Math.min(Math.max(retention, 10), 5000) : DEFAULT_CONFIG.uptimeRetention,
  };
  saveConfig(config);
  logAudit(req.session.user?.username, 'config:update', config.webhookUrl ? `webhook ${config.webhookType}` : 'webhook désactivé');
  res.json(config);
});

app.post('/api/config/test-webhook', requireAdmin, async (req, res) => {
  const { webhookUrl, webhookType } = req.body;
  if (!webhookUrl) return res.status(400).json({ error: 'URL manquante' });

  let payload;
  if (webhookType === 'slack') {
    payload = { text: '✅ *Portainer Manager* — Test de webhook réussi !' };
  } else if (webhookType === 'teams') {
    payload = { '@type': 'MessageCard', themeColor: '13BEF9', summary: 'Test webhook', sections: [{ activityTitle: '✅ Portainer Manager', activitySubtitle: 'Test de webhook réussi !' }] };
  } else {
    payload = { event: 'test', message: 'Portainer Manager webhook test', timestamp: new Date().toISOString() };
  }

  try {
    await axios.post(webhookUrl, payload, { timeout: 5000 });
    res.json({ success: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Backup (export/import) ────────────────────────────────────────────────────
app.get('/api/backup/export', requireAdmin, (req, res) => {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    instances: loadInstances(),
    config: loadConfig(),
  };
  res.setHeader('Content-Disposition', `attachment; filename="portainer-manager-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(backup);
});

function normalizeImportedInstance(raw, existing) {
  const url = raw.url ? String(raw.url).trim().replace(/\/$/, '') : null;
  if (!url) return null;
  const rawToken = raw.token ? String(raw.token) : null;
  const token = rawToken ? (rawToken.startsWith('enc:') ? rawToken : encryptToken(rawToken)) : existing?.token;
  if (!token) return null; // no way to reach this instance without a token

  return {
    id: (raw.id && typeof raw.id === 'string') ? raw.id : (existing?.id || uuidv4()),
    name: (raw.name ? String(raw.name).trim() : '') || existing?.name || url,
    url,
    environment: VALID_ENVS.includes(raw.environment) ? raw.environment : (existing?.environment ?? null),
    notes: raw.notes === undefined
      ? (existing?.notes ?? null)
      : (raw.notes ? String(raw.notes).trim() || null : null),
    token,
    createdAt: existing?.createdAt || raw.createdAt || new Date().toISOString(),
  };
}

app.post('/api/backup/import', requireAdmin, (req, res) => {
  const { instances: incoming, config } = req.body;
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'Format invalide : "instances" doit être un tableau' });

  const current = loadInstances();
  let added = 0, updated = 0, skipped = 0;

  for (const raw of incoming) {
    const existingIdx = current.findIndex(i => i.id === raw.id || i.url === (raw.url || '').trim().replace(/\/$/, ''));
    const normalized = normalizeImportedInstance(raw, existingIdx !== -1 ? current[existingIdx] : null);
    if (!normalized) { skipped++; continue; }
    if (existingIdx !== -1) { current[existingIdx] = normalized; updated++; }
    else { current.push(normalized); added++; }
  }

  saveInstances(current);

  if (config && typeof config === 'object') {
    saveConfig({ ...loadConfig(), ...config, webhookEnvironments: Array.isArray(config.webhookEnvironments) ? config.webhookEnvironments.filter(e => VALID_ENVS.includes(e)) : [] });
  }

  logAudit(req.session.user?.username, 'backup:import', `${added} ajoutée(s), ${updated} mise(s) à jour, ${skipped} ignorée(s)`);
  res.json({ success: true, added, updated, skipped });
});

// ── Audit log ──────────────────────────────────────────────────────────────────
app.get('/api/audit', requireAdmin, (req, res) => {
  res.json(loadAudit());
});

// ── Uptime ────────────────────────────────────────────────────────────────────
app.get('/api/uptime', (req, res) => {
  const result = {};
  for (const [id, history] of Object.entries(uptimeStore)) {
    if (!history.length) continue;
    const onlineCount = history.filter(h => h.online).length;
    result[id] = {
      percent: Math.round((onlineCount / history.length) * 100),
      history: history.slice(-40).map(h => h.online),
    };
  }
  res.json(result);
});

// ── Public status page (no auth, aggregate counts only) ──────────────────────
app.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'status.html'));
});

app.get('/api/status/public', (req, res) => {
  const total = loadInstances().length;
  const known = Object.values(statusCache);
  const online = known.filter(v => v === true).length;
  const offline = known.filter(v => v === false).length;
  res.json({ total, online, offline, unknown: total - known.length, updatedAt: new Date().toISOString() });
});

// ── Prometheus metrics ─────────────────────────────────────────────────────────
function promEscape(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function semverLt(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

app.get('/metrics', (req, res) => {
  if (METRICS_TOKEN) {
    const auth = req.get('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if ((bearer || req.query.token) !== METRICS_TOKEN) return res.status(401).type('text/plain').send('Unauthorized\n');
  } else if (!req.session?.authenticated) {
    return res.status(401).type('text/plain').send('Unauthorized — configurez METRICS_TOKEN pour le scraping sans session, ou utilisez une session authentifiée\n');
  }

  const instances = loadInstances();
  const latest = latestVersionCache.version;
  const lines = [
    '# HELP portainer_manager_app_info Informations sur l\'application (toujours à 1).',
    '# TYPE portainer_manager_app_info gauge',
    `portainer_manager_app_info{version="${promEscape(APP_VERSION)}"} 1`,
    '# HELP portainer_manager_instances_total Nombre total d\'instances configurées.',
    '# TYPE portainer_manager_instances_total gauge',
    `portainer_manager_instances_total ${instances.length}`,
    '# HELP portainer_manager_instance_up Dernier statut connu : joignable (1) ou non (0).',
    '# TYPE portainer_manager_instance_up gauge',
    '# HELP portainer_manager_instance_containers_running Conteneurs actifs.',
    '# TYPE portainer_manager_instance_containers_running gauge',
    '# HELP portainer_manager_instance_containers_stopped Conteneurs arrêtés.',
    '# TYPE portainer_manager_instance_containers_stopped gauge',
    '# HELP portainer_manager_instance_stacks Nombre de stacks.',
    '# TYPE portainer_manager_instance_stacks gauge',
    '# HELP portainer_manager_instance_uptime_ratio Ratio de disponibilité sur l\'historique conservé (0 à 1).',
    '# TYPE portainer_manager_instance_uptime_ratio gauge',
    '# HELP portainer_manager_instance_portainer_outdated Mise à jour Portainer disponible (1) ou non (0).',
    '# TYPE portainer_manager_instance_portainer_outdated gauge',
  ];

  for (const inst of instances) {
    const labels = `instance="${promEscape(inst.name)}",environment="${promEscape(inst.environment || '')}"`;
    const up = statusCache[inst.id];
    if (up !== undefined) lines.push(`portainer_manager_instance_up{${labels}} ${up ? 1 : 0}`);

    const cached = liveDataCache[inst.id];
    if (cached?.online) {
      lines.push(`portainer_manager_instance_containers_running{${labels}} ${cached.runningContainers}`);
      lines.push(`portainer_manager_instance_containers_stopped{${labels}} ${cached.stoppedContainers}`);
      lines.push(`portainer_manager_instance_stacks{${labels}} ${cached.stacksCount}`);
      if (latest && cached.version) {
        lines.push(`portainer_manager_instance_portainer_outdated{${labels}} ${semverLt(cached.version, latest) ? 1 : 0}`);
      }
    }

    const history = uptimeStore[inst.id];
    if (history?.length) {
      const ratio = history.filter(h => h.online).length / history.length;
      lines.push(`portainer_manager_instance_uptime_ratio{${labels}} ${ratio.toFixed(4)}`);
    }
  }

  res.type('text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n') + '\n');
});

// ── Instances REST API ────────────────────────────────────────────────────────
const VALID_ENVS = ['integration', 'recette', 'preprod', 'production'];

app.get('/api/instances', (req, res) => {
  res.json(loadInstances().map(stripToken));
});

app.post('/api/instances', requireAdmin, (req, res) => {
  const { name, url, token, environment, notes } = req.body;
  if (!url || !token) return res.status(400).json({ error: 'url et token requis' });

  const normalizedUrl = url.replace(/\/$/, '');
  const instances = loadInstances();
  if (instances.some(i => i.url === normalizedUrl))
    return res.status(409).json({ error: 'Une instance avec cette URL existe déjà' });

  const instance = {
    id: uuidv4(),
    name: name?.trim() || normalizedUrl,
    url: normalizedUrl,
    environment: VALID_ENVS.includes(environment) ? environment : null,
    notes: notes?.trim() || null,
    token: encryptToken(token),
    createdAt: new Date().toISOString(),
  };

  instances.push(instance);
  saveInstances(instances);
  logAudit(req.session.user?.username, 'instance:create', instance.name);
  res.status(201).json(stripToken(instance));
});

app.put('/api/instances/:id', requireAdmin, (req, res) => {
  const { name, url, token, environment, notes } = req.body;
  const instances = loadInstances();
  const idx = instances.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Instance introuvable' });

  const normalizedUrl = url ? url.replace(/\/$/, '') : instances[idx].url;
  if (url && instances.some((i, j) => j !== idx && i.url === normalizedUrl))
    return res.status(409).json({ error: 'Une instance avec cette URL existe déjà' });

  instances[idx] = {
    ...instances[idx],
    name: name?.trim() || instances[idx].name,
    url: normalizedUrl,
    environment: VALID_ENVS.includes(environment) ? environment : (environment === '' ? null : instances[idx].environment),
    notes: notes !== undefined ? (notes?.trim() || null) : instances[idx].notes,
    ...(token ? { token: encryptToken(token) } : {}),
  };

  saveInstances(instances);
  logAudit(req.session.user?.username, 'instance:update', instances[idx].name);
  res.json(stripToken(instances[idx]));
});

app.delete('/api/instances/:id', requireAdmin, (req, res) => {
  const instances = loadInstances();
  const idx = instances.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Instance introuvable' });

  const deletedName = instances[idx].name;
  instances.splice(idx, 1);
  saveInstances(instances);
  delete uptimeStore[req.params.id];
  delete statusCache[req.params.id];
  delete liveDataCache[req.params.id];
  uptimeDirty = true;
  logAudit(req.session.user?.username, 'instance:delete', deletedName);
  res.json({ success: true });
});

app.get('/api/instances/:id/data', async (req, res) => {
  const instances = loadInstances();
  const instance = instances.find(i => i.id === req.params.id);
  if (!instance) return res.status(404).json({ error: 'Instance introuvable' });

  let token;
  try {
    token = decryptToken(instance.token);
  } catch {
    console.error(`[crypto] Token illisible pour "${instance.name}" — SESSION_SECRET différent de celui utilisé au chiffrement (ex. restauration d'une sauvegarde sur une autre machine sans copier le même SESSION_SECRET).`);
    recordUptime(instance.id, false);
    checkStatusChange(instance.id, instance.name, false, instance.url, instance.environment);
    const result = {
      online: false,
      error: 'Token illisible (SESSION_SECRET incorrect)',
      version: null, dockerVersion: null, endpointsCount: 0, stacksCount: 0,
      runningContainers: 0, stoppedContainers: 0, totalContainers: 0, servicesCount: 0,
    };
    liveDataCache[instance.id] = { ...result, name: instance.name, environment: instance.environment, updatedAt: Date.now() };
    return res.json(result);
  }

  const [statusResult, endpointsResult, stacksResult] = await Promise.allSettled([
    portainerGet(instance.url, token, '/api/status'),
    portainerGet(instance.url, token, '/api/endpoints?limit=100'),
    portainerGet(instance.url, token, '/api/stacks'),
  ]);

  const online = statusResult.status === 'fulfilled';
  recordUptime(instance.id, online);
  checkStatusChange(instance.id, instance.name, online, instance.url, instance.environment);

  if (!online) {
    const errMsg = statusResult.reason?.code || statusResult.reason?.message || 'Unreachable';
    const result = { online: false, error: errMsg, version: null, dockerVersion: null, endpointsCount: 0, stacksCount: 0, runningContainers: 0, stoppedContainers: 0, totalContainers: 0, servicesCount: 0 };
    liveDataCache[instance.id] = { ...result, name: instance.name, environment: instance.environment, updatedAt: Date.now() };
    return res.json(result);
  }

  const version   = statusResult.value?.data?.Version ?? 'Unknown';
  const endpoints = endpointsResult.status === 'fulfilled' ? (endpointsResult.value?.data ?? []) : [];
  const stacks    = stacksResult.status === 'fulfilled'    ? (stacksResult.value?.data    ?? []) : [];

  let runningContainers = 0, stoppedContainers = 0, servicesCount = 0;
  const dockerVersions = new Set();

  for (const ep of endpoints) {
    const snap = ep.Snapshots?.[0];
    if (snap) {
      runningContainers += snap.RunningContainerCount ?? 0;
      stoppedContainers += snap.StoppedContainerCount ?? 0;
      servicesCount     += snap.ServiceCount          ?? 0;
      if (snap.DockerVersion) dockerVersions.add(snap.DockerVersion);
    }
  }

  const dockerVersion = dockerVersions.size === 1
    ? [...dockerVersions][0]
    : dockerVersions.size > 1 ? [...dockerVersions].join(', ') : null;

  const result = { online: true, version, dockerVersion, endpointsCount: endpoints.length, stacksCount: stacks.length, runningContainers, stoppedContainers, totalContainers: runningContainers + stoppedContainers, servicesCount };
  liveDataCache[instance.id] = { ...result, name: instance.name, environment: instance.environment, updatedAt: Date.now() };
  res.json(result);
});

// ── Recherche globale (conteneurs/stacks à travers tout le parc) ─────────────
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  if (q.length < 2) return res.status(400).json({ error: 'Requête trop courte (2 caractères minimum)' });

  const instances = loadInstances();

  const settled = await Promise.allSettled(instances.map(async (inst) => {
    const token = decryptToken(inst.token);
    const match = { instanceId: inst.id, instanceName: inst.name, environment: inst.environment, containers: [], stacks: [] };

    const [endpointsRes, stacksRes] = await Promise.allSettled([
      portainerGet(inst.url, token, '/api/endpoints?limit=100'),
      portainerGet(inst.url, token, '/api/stacks'),
    ]);

    if (stacksRes.status === 'fulfilled') {
      for (const stack of stacksRes.value.data ?? []) {
        if ((stack.Name || '').toLowerCase().includes(q)) {
          match.stacks.push({ id: stack.Id, name: stack.Name });
        }
      }
    }

    const endpoints = endpointsRes.status === 'fulfilled' ? (endpointsRes.value.data ?? []) : [];
    const containerLists = await Promise.allSettled(
      endpoints.map(ep => portainerGet(inst.url, token, `/api/endpoints/${ep.Id}/docker/containers/json?all=true`))
    );
    endpoints.forEach((ep, i) => {
      const cRes = containerLists[i];
      if (cRes.status !== 'fulfilled') return;
      for (const c of cRes.value.data ?? []) {
        const name = (c.Names?.[0] || '').replace(/^\//, '');
        if (name.toLowerCase().includes(q)) {
          match.containers.push({ name, image: c.Image, state: c.State, endpoint: ep.Name });
        }
      }
    });

    return match;
  }));

  const results = settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(m => m.containers.length > 0 || m.stacks.length > 0);

  res.json({ query: q, instancesSearched: instances.length, results });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
  let oidcStatus = 'désactivé';
  if (OIDC_ENABLED) {
    try {
      oidcModule = await import('openid-client');
      const discoveryOptions = OIDC_ALLOW_INSECURE ? { execute: [oidcModule.allowInsecureRequests] } : undefined;
      oidcConfig = await oidcModule.discovery(
        new URL(OIDC_ISSUER_URL),
        OIDC_CLIENT_ID,
        OIDC_CLIENT_SECRET,
        undefined,
        discoveryOptions
      );
      // authorizationCodeGrant() re-derives redirect_uri for the token request from the
      // incoming request's protocol/host (stripping the query string) instead of reusing
      // OIDC_REDIRECT_URI. Behind a reverse proxy — or whenever Express doesn't see exactly
      // the externally-registered URL — that derived value mismatches what's registered at
      // the IdP, causing "invalid_grant: Incorrect redirect_uri". Force the configured value.
      oidcConfig[oidcModule.customFetch] = (url, options) => {
        if (options?.body instanceof URLSearchParams && options.body.get('grant_type') === 'authorization_code') {
          options.body.set('redirect_uri', OIDC_REDIRECT_URI);
        }
        return fetch(url, options);
      };
      oidcStatus = `activé (${OIDC_ISSUER_URL})`;
    } catch (e) {
      oidcStatus = `échec de la découverte — ${e.message}`;
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    const hostIp = process.env.HOST_IP;
    console.log(`\nPortainer Manager — port ${PORT}`);
    console.log(`  Local:   http://localhost:${PORT}`);
    if (hostIp) {
      console.log(`  Network: http://${hostIp}:${PORT}`);
    } else {
      const { networkInterfaces } = require('os');
      Object.values(networkInterfaces()).flat()
        .filter(n => n.family === 'IPv4' && !n.internal)
        .forEach(n => console.log(`  Network: http://${n.address}:${PORT}`));
    }
    console.log(`  Mot de passe: ${ADMIN_PASSWORD === 'admin' ? 'admin ⚠️  (définir ADMIN_PASSWORD dans .env)' : '***'}`);
    console.log(`  OIDC: ${oidcStatus}`);
    if (!process.env.SESSION_SECRET) {
      console.log('  ⚠️  SESSION_SECRET non défini : les tokens Portainer chiffrés deviendront illisibles au prochain redémarrage.');
    }
    console.log('');
  });
}

start();
