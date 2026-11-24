const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('./helpers');

const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const I18N = new vm.Script(`${read('public/i18n.js')}\n;I18N`).runInNewContext({});
const fr = I18N.fr;
const en = I18N.en;
const placeholders = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const keysUsedIn = (source, pattern) => [...source.matchAll(pattern)].map(m => m[1]);

test('French and English define exactly the same keys', () => {
  const missingInEn = Object.keys(fr).filter(k => !(k in en));
  const missingInFr = Object.keys(en).filter(k => !(k in fr));
  assert.deepEqual(missingInEn, [], 'missing in en');
  assert.deepEqual(missingInFr, [], 'missing in fr');
});

test('every translation is non-empty and keeps the same placeholders', () => {
  for (const key of Object.keys(fr)) {
    assert.ok(fr[key].trim() && en[key].trim(), `empty translation: ${key}`);
    assert.deepEqual(placeholders(fr[key]), placeholders(en[key]), `placeholders differ: ${key}`);
  }
});

test('every key referenced in the HTML exists', () => {
  for (const file of ['public/index.html', 'public/login.html', 'public/status.html']) {
    for (const key of keysUsedIn(read(file), /data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
      assert.ok(key in fr, `${file}: unknown key ${key}`);
    }
  }
});

test('every key referenced in the scripts exists', () => {
  for (const file of ['public/app.js', 'public/login.js', 'public/status.js', 'public/theme.js']) {
    const source = read(file);
    for (const key of keysUsedIn(source, /\bt\(\s*'([^']+)'/g)) {
      assert.ok(key in fr, `${file}: unknown key ${key}`);
    }
    for (const key of keysUsedIn(source, /\btp\(\s*'([^']+)'/g)) {
      assert.ok(`${key}.one` in fr && `${key}.other` in fr, `${file}: unknown plural key ${key}`);
    }
  }
});

test('dynamic keys are covered: environments, server error codes, audit actions, themes', () => {
  for (const env of ['integration', 'recette', 'preprod', 'production']) assert.ok(`env.${env}` in fr, env);
  for (const mode of ['dark', 'light', 'system']) assert.ok(`theme.${mode}` in fr, mode);

  const server = read('server.js');
  const errorBlock = server.match(/const ERROR_MESSAGES = \{([\s\S]*?)\n\};/)[1];
  for (const code of keysUsedIn(errorBlock, /^\s*(\w+):/gm)) assert.ok(`err.${code}` in fr, `err.${code}`);
  for (const code of keysUsedIn(server, /errorCode: '(\w+)'/g)) assert.ok(`err.${code}` in fr, `err.${code}`);
  for (const action of new Set(keysUsedIn(server, /logAudit\([^,]+,\s*'([^']+)'/g))) {
    assert.ok(`audit.action.${action}` in fr, `audit.action.${action}`);
  }
});
