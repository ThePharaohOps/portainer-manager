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
const DATA_FILE    = path.join(__dirname, 'data', 'instances.json');
const CONFIG_FILE  = path.join(__dirname, 'data', 'config.json');
const UPTIME_FILE  = path.join(__dirname, 'data', 'uptime.json');
const SESSION_DIR  = path.join(__dirname, 'data', 'sessions');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

app.use(express.json());
app.use(session({
  store: new FileStore({ path: SESSION_DIR, retries: 0, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'pm-secret-' + Math.random().toString(36),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, httpOnly: true },
}));

// ── Auth middleware ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (/\.(css|js|png|ico|jpg|svg|woff2?)$/.test(req.path)) return next();
  if (req.path === '/login' || req.path === '/api/auth/login') return next();
  if (req.session?.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non authentifié' });
  res.redirect('/login');
});

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

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {}
  return { webhookUrl: null, webhookType: 'slack' };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// ── Uptime tracking (in-memory + flush to disk every 5 min) ──────────────────
let uptimeStore = {};
const MAX_UPTIME = 288; // ~2.4h at 30s intervals

try {
  if (fs.existsSync(UPTIME_FILE))
    uptimeStore = JSON.parse(fs.readFileSync(UPTIME_FILE, 'utf8'));
} catch {}

let uptimeDirty = false;

function recordUptime(id, online) {
  if (!uptimeStore[id]) uptimeStore[id] = [];
  uptimeStore[id].push({ ts: Date.now(), online });
  if (uptimeStore[id].length > MAX_UPTIME)
    uptimeStore[id] = uptimeStore[id].slice(-MAX_UPTIME);
  uptimeDirty = true;
}

setInterval(() => {
  if (!uptimeDirty) return;
  fs.writeFileSync(UPTIME_FILE, JSON.stringify(uptimeStore), 'utf8');
  uptimeDirty = false;
}, 5 * 60 * 1000);

// ── Webhook on status change ──────────────────────────────────────────────────
const statusCache = {};

async function sendWebhook(id, name, online, url, environment) {
  const config = loadConfig();
  if (!config.webhookUrl) return;

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

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  if (req.session?.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/auth/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Mot de passe incorrect' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── Config (webhook) ──────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => res.json(loadConfig()));

app.put('/api/config', (req, res) => {
  const config = {
    webhookUrl:  req.body.webhookUrl  || null,
    webhookType: req.body.webhookType || 'slack',
  };
  saveConfig(config);
  res.json(config);
});

app.post('/api/config/test-webhook', async (req, res) => {
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

// ── Instances REST API ────────────────────────────────────────────────────────
const VALID_ENVS = ['integration', 'recette', 'preprod', 'production'];

app.get('/api/instances', (req, res) => {
  res.json(loadInstances().map(stripToken));
});

app.post('/api/instances', (req, res) => {
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
  res.status(201).json(stripToken(instance));
});

app.put('/api/instances/:id', (req, res) => {
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
  res.json(stripToken(instances[idx]));
});

app.delete('/api/instances/:id', (req, res) => {
  const instances = loadInstances();
  const idx = instances.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Instance introuvable' });

  instances.splice(idx, 1);
  saveInstances(instances);
  delete uptimeStore[req.params.id];
  delete statusCache[req.params.id];
  uptimeDirty = true;
  res.json({ success: true });
});

app.get('/api/instances/:id/data', async (req, res) => {
  const instances = loadInstances();
  const instance = instances.find(i => i.id === req.params.id);
  if (!instance) return res.status(404).json({ error: 'Instance introuvable' });

  const token = decryptToken(instance.token);
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
    return res.json({ online: false, error: errMsg, version: null, dockerVersion: null, endpointsCount: 0, stacksCount: 0, runningContainers: 0, stoppedContainers: 0, totalContainers: 0, servicesCount: 0 });
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

  res.json({ online: true, version, dockerVersion, endpointsCount: endpoints.length, stacksCount: stacks.length, runningContainers, stoppedContainers, totalContainers: runningContainers + stoppedContainers, servicesCount });
});

// ── Start ─────────────────────────────────────────────────────────────────────
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
  if (!process.env.SESSION_SECRET) {
    console.log('  ⚠️  SESSION_SECRET non défini : les tokens Portainer chiffrés deviendront illisibles au prochain redémarrage.');
  }
  console.log('');
});
