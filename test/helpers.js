const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ADMIN_PASSWORD = 'test-password';
const PORTAINER_TOKEN = 'ptr_test';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Runs server.js in a throwaway data dir. cwd is that dir too, so dotenv never loads the repo's .env.
async function startApp(extraEnv = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(OIDC_|METRICS_TOKEN|TRUST_PROXY|LOGIN_MAX_ATTEMPTS|HOST_IP)/.test(key)) delete env[key];
  }
  Object.assign(env, {
    PORT: String(port),
    DATA_DIR: dataDir,
    ADMIN_PASSWORD,
    SESSION_SECRET: 'test-session-secret-0123456789',
    ...extraEnv,
  });

  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: dataDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      if ((await fetch(`${base}/api/auth/methods`)).ok) break;
    } catch {}
    if (i > 100) throw new Error(`server did not start:\n${output}`);
    await new Promise(r => setTimeout(r, 100));
  }

  return {
    base,
    dataDir,
    output: () => output,
    async stop() {
      child.kill();
      await once(child, 'exit');
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// Minimal HTTP client with a cookie jar, one per simulated browser.
function client(base) {
  const jar = {
    cookie: '',
    async request(method, url, body, headers = {}) {
      const res = await fetch(base + url, {
        method,
        redirect: 'manual',
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(jar.cookie ? { cookie: jar.cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie();
      if (setCookie.length) jar.cookie = setCookie.map(c => c.split(';')[0]).join('; ');
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, headers: res.headers, json, text, setCookie };
    },
    get: (url, headers) => jar.request('GET', url, undefined, headers),
    post: (url, body) => jar.request('POST', url, body ?? {}),
    put: (url, body) => jar.request('PUT', url, body),
    del: (url) => jar.request('DELETE', url),
    login: (password = ADMIN_PASSWORD) => jar.post('/api/auth/login', { password }),
  };
  return jar;
}

function startMockPortainer() {
  const srv = http.createServer((req, res) => {
    const send = obj => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers['x-api-key'] !== PORTAINER_TOKEN) { res.writeHead(401); return res.end(); }
    const url = req.url.split('?')[0];
    if (url === '/api/status') return send({ Version: '2.20.0' });
    if (url === '/api/endpoints') {
      return send([{ Id: 1, Name: 'local', Snapshots: [{ RunningContainerCount: 4, StoppedContainerCount: 1, ServiceCount: 0, DockerVersion: '27.0.1' }] }]);
    }
    if (url === '/api/stacks') return send([{ Id: 1, Name: 'web-stack' }, { Id: 2, Name: 'db' }]);
    if (url === '/api/endpoints/1/docker/containers/json') {
      return send([{ Names: ['/web-frontend'], Image: 'nginx:1.27', State: 'running' }]);
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${srv.address().port}`,
      close: () => new Promise(r => srv.close(r)),
    }));
  });
}

module.exports = { ROOT, ADMIN_PASSWORD, PORTAINER_TOKEN, startApp, client, startMockPortainer, freePort };
