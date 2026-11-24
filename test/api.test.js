const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ADMIN_PASSWORD, PORTAINER_TOKEN, startApp, client, startMockPortainer, freePort } = require('./helpers');

describe('API', () => {
  let app, mock, admin;

  before(async () => {
    mock = await startMockPortainer();
    app = await startApp({ METRICS_TOKEN: 'metrics-secret' });
    admin = client(app.base);
  });

  after(async () => {
    await app?.stop();
    await mock?.close();
  });

  test('sends security headers', async () => {
    const res = await client(app.base).get('/login');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'(;|$)/);
    assert.match(csp, /frame-ancestors 'none'/);
  });

  test('rejects unauthenticated access', async () => {
    const anon = client(app.base);
    const api = await anon.get('/api/instances');
    assert.equal(api.status, 401);
    assert.equal(api.json.code, 'unauthenticated');
    const page = await anon.get('/');
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login');
  });

  test('rejects a wrong password with a translatable code', async () => {
    const res = await client(app.base).login('nope');
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'bad_password');
  });

  test('logs in with a hardened session cookie', async () => {
    const res = await admin.login();
    assert.equal(res.status, 200);
    const cookie = res.setCookie.find(c => c.startsWith('connect.sid='));
    assert.ok(cookie, 'session cookie set');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const me = await admin.get('/api/auth/me');
    assert.deepEqual(me.json, { username: 'admin', method: 'local', role: 'admin' });
  });

  test('issues a new session id on each login (no session fixation)', async () => {
    const browser = client(app.base);
    await browser.login();
    const first = browser.cookie;
    await browser.login();
    assert.notEqual(browser.cookie, first);

    const stale = client(app.base);
    stale.cookie = first;
    assert.equal((await stale.get('/api/instances')).status, 401, 'old session id no longer valid');
  });

  let instanceId;

  test('creates an instance and keeps its token encrypted at rest', async () => {
    const res = await admin.post('/api/instances', { name: 'Mock', url: `${mock.url}/`, token: PORTAINER_TOKEN, environment: 'production', notes: 'n' });
    assert.equal(res.status, 201);
    assert.equal(res.json.url, mock.url, 'trailing slash removed');
    assert.equal(res.json.token, undefined, 'token never returned');
    instanceId = res.json.id;

    const stored = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'instances.json'), 'utf8'));
    assert.match(stored[0].token, /^enc:/);
    assert.ok(!JSON.stringify(stored).includes(PORTAINER_TOKEN));

    const list = await admin.get('/api/instances');
    assert.equal(list.json.length, 1);
    assert.equal(list.json[0].token, undefined);
  });

  test('validates instance input', async () => {
    assert.equal((await admin.post('/api/instances', { url: 'http://x' })).json.code, 'url_token_required');
    const dup = await admin.post('/api/instances', { url: mock.url, token: 't' });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, 'duplicate_url');
    assert.equal((await admin.put('/api/instances/missing', { name: 'x' })).json.code, 'not_found');
  });

  test('fetches live data from Portainer', async () => {
    const res = await admin.get(`/api/instances/${instanceId}/data`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      online: true, version: '2.20.0', dockerVersion: '27.0.1', endpointsCount: 1, stacksCount: 2,
      runningContainers: 4, stoppedContainers: 1, totalContainers: 5, servicesCount: 0,
    });
  });

  test('reports an unreachable instance as offline', async () => {
    const port = await freePort();
    const created = await admin.post('/api/instances', { name: 'Down', url: `http://127.0.0.1:${port}`, token: 't' });
    const res = await admin.get(`/api/instances/${created.json.id}/data`);
    assert.equal(res.json.online, false);
    assert.ok(res.json.error);
    assert.equal((await admin.del(`/api/instances/${created.json.id}`)).status, 200);
  });

  test('searches containers and stacks across instances', async () => {
    assert.equal((await admin.get('/api/search?q=w')).json.code, 'query_too_short');
    const res = await admin.get('/api/search?q=web');
    assert.equal(res.json.results.length, 1);
    assert.deepEqual(res.json.results[0].stacks, [{ id: 1, name: 'web-stack' }]);
    assert.equal(res.json.results[0].containers[0].name, 'web-frontend');
  });

  test('protects and serves Prometheus metrics', async () => {
    const anon = client(app.base);
    assert.equal((await anon.get('/metrics')).status, 401);
    assert.equal((await anon.get('/metrics', { authorization: 'Bearer wrong' })).status, 401);
    const res = await anon.get('/metrics', { authorization: 'Bearer metrics-secret' });
    assert.equal(res.status, 200);
    assert.match(res.text, /portainer_manager_instances_total 1/);
    assert.match(res.text, /portainer_manager_instance_up\{instance="Mock",environment="production"\} 1/);
    assert.equal((await anon.get('/metrics?token=metrics-secret')).status, 200);
  });

  test('serves the public status without authentication', async () => {
    const res = await client(app.base).get('/api/status/public');
    assert.equal(res.status, 200);
    assert.equal(res.json.total, 1);
    assert.equal(res.json.online, 1);
  });

  test('stores the webhook notification language', async () => {
    let res = await admin.put('/api/config', { webhookUrl: '', webhookLanguage: 'en', uptimeRetention: 100 });
    assert.equal(res.json.webhookLanguage, 'en');
    res = await admin.put('/api/config', { webhookLanguage: 'de' });
    assert.equal(res.json.webhookLanguage, 'fr', 'unknown language falls back to French');
    assert.equal((await admin.post('/api/config/test-webhook', {})).json.code, 'missing_url');
  });

  test('records actions in the audit log', async () => {
    const res = await admin.get('/api/audit');
    const actions = res.json.map(e => e.action);
    assert.ok(actions.includes('instance:create'));
    assert.ok(actions.includes('auth:login_failed'));
  });

  test('deletes an instance', async () => {
    assert.equal((await admin.del(`/api/instances/${instanceId}`)).status, 200);
    assert.equal((await admin.get(`/api/instances/${instanceId}/data`)).json.code, 'not_found');
  });

  test('logs out', async () => {
    await admin.post('/api/auth/logout');
    assert.equal((await admin.get('/api/instances')).status, 401);
  });
});

describe('login rate limiting', () => {
  let app;

  before(async () => { app = await startApp({ LOGIN_MAX_ATTEMPTS: '3' }); });
  after(async () => { await app?.stop(); });

  test('locks password login after too many failures', async () => {
    const attacker = client(app.base);
    assert.equal((await attacker.login('a')).status, 401);
    assert.equal((await attacker.login('b')).status, 401);

    const locked = await attacker.login('c');
    assert.equal(locked.status, 429);
    assert.equal(locked.json.code, 'too_many_attempts');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);

    const evenCorrect = await client(app.base).login(ADMIN_PASSWORD);
    assert.equal(evenCorrect.status, 429, 'the right password is refused too while locked');

    const audit = fs.readFileSync(path.join(app.dataDir, 'audit.log'), 'utf8');
    assert.match(audit, /auth:login_locked/);
  });
});
