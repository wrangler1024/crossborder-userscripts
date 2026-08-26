'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const extensionDir = path.join(repoRoot, 'extensions', 'xynigo-dxm-purchase-assistant');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(path.join(scriptDir, 'xynigo_dxm_purchase_assistant.user.js'), 'utf8');
const core = fs.readFileSync(path.join(extensionDir, 'src', 'core.js'), 'utf8').trim();
const content = fs.readFileSync(path.join(extensionDir, 'src', 'content.js'), 'utf8').trim();
const css = fs.readFileSync(path.join(extensionDir, 'src', 'content.css'), 'utf8');
const background = fs.readFileSync(path.join(extensionDir, 'src', 'background.js'), 'utf8').trim();
const Background = require(path.join(extensionDir, 'src', 'background.js'));
const runtime = require('./userscript-runtime.js');

test('publishes one-click Tampermonkey metadata with automatic updates', () => {
  assert.match(userscript, /^\/\/ ==UserScript==/);
  assert.match(userscript, new RegExp(`^// @version\\s+${manifest.version.replaceAll('.', '\\.')}\\s*$`, 'm'));
  assert.match(userscript, /^\/\/ @match\s+https:\/\/dianxiaomi\.com\/\*$/m);
  assert.match(userscript, /^\/\/ @match\s+https:\/\/\*\.dianxiaomi\.com\/\*$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_getValue$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_setClipboard$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_registerMenuCommand$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_openInTab$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_notification$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_xmlhttpRequest$/m);
  assert.match(userscript, /^\/\/ @connect\s+xynigo\.samforo\.icu$/m);
  assert.match(userscript, /^\/\/ @run-at\s+document-start$/m);
  assert.match(userscript, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\//m);
  assert.match(userscript, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\//m);
});

test('generated userscript embeds the exact shared cloud runtime, core, content and stylesheet', () => {
  assert.ok(userscript.includes(background));
  assert.ok(userscript.includes(core));
  assert.ok(userscript.includes(content));
  assert.ok(userscript.includes(JSON.stringify(css)));
  assert.match(userscript, /Generated from the shared Manifest V3 source/);
});

test('GM storage bridge implements chrome.storage callbacks and change events', async () => {
  const values = new Map();
  const root = {};
  const changes = [];
  runtime.installStorageBridge(root, {
    getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    setValue(key, value) { values.set(key, value); },
    deleteValue(key) { values.delete(key); },
    listValues() { return [...values.keys()]; },
  }, manifest.version);
  root.chrome.storage.onChanged.addListener((next, area) => changes.push({ next, area }));

  await new Promise((resolve) => root.chrome.storage.local.set({ alpha: 1, beta: { ok: true } }, resolve));
  const all = await new Promise((resolve) => root.chrome.storage.local.get(null, resolve));
  assert.deepEqual(all, { alpha: 1, beta: { ok: true } });
  assert.equal(changes.at(-1).area, 'local');
  assert.deepEqual(changes.at(-1).next.alpha, { oldValue: undefined, newValue: 1 });

  await new Promise((resolve) => root.chrome.storage.local.remove('alpha', resolve));
  const defaults = await new Promise((resolve) => root.chrome.storage.local.get({ alpha: 9, beta: null }, resolve));
  assert.deepEqual(defaults, { alpha: 9, beta: { ok: true } });
  assert.equal(root.chrome.runtime.getManifest().version, manifest.version);
  assert.equal(root.chrome.runtime.__xynigoDxmRuntime, 'userscript');
  assert.equal(root.chrome.storage.session, root.chrome.storage.local);
});

test('userscript runtime routes Feishu login and cloud purchase requests through the shared background', async () => {
  const values = new Map();
  const root = {};
  const bridge = runtime.installStorageBridge(root, {
    getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    setValue(key, value) { values.set(key, value); },
    deleteValue(key) { values.delete(key); },
    listValues() { return [...values.keys()]; },
  }, manifest.version);
  const sessionToken = 'synthetic_session_token_1234567890_abcd';
  const pollToken = 'synthetic_poll_token_1234567890_abcdef';
  const identity = {
    user: { id: 'user-id', name: '合成运营', avatarUrl: '', status: 'active' },
    tenant: { id: 'tenant-id', name: '测试组织' },
    roles: ['operator'],
    permissions: ['procurement.request.save', 'procurement.request.submit'],
  };
  Background.install(bridge.chrome, async (url, options) => {
    const response = (data, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      async json() { return data; },
    });
    if (url.endsWith('/v1/auth/local/start')) return response({
      loginUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=synthetic',
      pollToken,
      expiresIn: 300,
    }, 201);
    if (url.endsWith('/v1/auth/local/poll')) return response({
      status: 'authenticated',
      sessionToken,
      sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      identity,
    });
    if (url.endsWith('/v1/auth/me')) return response(identity);
    if (url.endsWith('/v1/purchase-orders/submit')) {
      assert.equal(options.headers.Authorization, `Bearer ${sessionToken}`);
      return response({ ok: true, data: { orderKey: 'ORDER-DEMO', submissionStatus: 'submitted' } });
    }
    throw new Error(`unexpected request: ${url}`);
  });

  const started = await runtime.runtimeMessage(bridge.runtime, { type: runtime.AUTH_START_MESSAGE });
  assert.equal(started.expiresIn, 300);
  const loggedIn = await runtime.runtimeMessage(bridge.runtime, { type: runtime.AUTH_POLL_MESSAGE });
  assert.equal(loggedIn.identity.user.name, '合成运营');
  const connection = await runtime.runtimeMessage(bridge.runtime, { type: runtime.STATUS_MESSAGE });
  assert.equal(connection.authenticated, true);
  const submitted = await runtime.runtimeMessage(bridge.runtime, {
    type: 'xynigo-dxm:submit',
    draft: { orderKey: 'ORDER-DEMO' },
  });
  assert.equal(submitted.submissionStatus, 'submitted');
});

test('GM transport sends anonymous cross-origin requests and parses JSON', async () => {
  let details;
  const gmFetch = runtime.createGmFetch((next) => {
    details = next;
    queueMicrotask(() => next.onload({ status: 200, responseText: '{"ok":true}' }));
    return { abort() {} };
  });
  const response = await gmFetch('https://xynigo.samforo.icu/v1/auth/me', {
    method: 'GET',
    headers: { Authorization: 'Bearer synthetic' },
  });
  assert.equal(details.anonymous, true);
  assert.equal(details.url, 'https://xynigo.samforo.icu/v1/auth/me');
  assert.equal(details.headers.Authorization, 'Bearer synthetic');
  assert.deepEqual(await response.json(), { ok: true });
});
