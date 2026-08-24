'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const extensionDir = path.join(repoRoot, 'extensions', 'xynigo-shein-store-otp-assistant');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(path.join(scriptDir, 'xynigo_shein_store_otp_assistant.user.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(scriptDir, 'userscript-runtime.js'), 'utf8').trim();
const coreSource = fs.readFileSync(path.join(extensionDir, 'src', 'otp-core.js'), 'utf8').trim();
const pageStateSource = fs.readFileSync(path.join(extensionDir, 'src', 'page-state.js'), 'utf8').trim();
const contentSource = fs.readFileSync(path.join(extensionDir, 'src', 'content.js'), 'utf8').trim();
const css = fs.readFileSync(path.join(extensionDir, 'src', 'content.css'), 'utf8');
const core = require(path.join(extensionDir, 'src', 'otp-core.js'));
const runtime = require('./userscript-runtime.js');

function sendMessage(root, message) {
  return new Promise((resolve) => root.chrome.runtime.sendMessage(message, resolve));
}

test('publishes one-click Tampermonkey metadata with automatic updates', () => {
  assert.match(userscript, /^\/\/ ==UserScript==/);
  assert.match(userscript, new RegExp(`^// @version\\s+${manifest.version.replaceAll('.', '\\.')}\\s*$`, 'm'));
  assert.match(userscript, /^\/\/ @match\s+https:\/\/sellerhub\.shein\.com\/\*$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_xmlhttpRequest$/m);
  assert.match(userscript, /^\/\/ @connect\s+api\.68sms\.com$/m);
  assert.match(userscript, /^\/\/ @run-at\s+document-start$/m);
  assert.match(userscript, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\//m);
  assert.match(userscript, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\//m);
});

test('generated userscript embeds the exact shared page logic and stylesheet', () => {
  assert.ok(userscript.includes(runtimeSource));
  assert.ok(userscript.includes(coreSource));
  assert.ok(userscript.includes(pageStateSource));
  assert.ok(userscript.includes(contentSource));
  assert.ok(userscript.includes(JSON.stringify(css)));
  assert.match(userscript, /Generated from the shared Manifest V3 source/);
});

test('Tampermonkey bridge stores settings and fetches OTP through GM_xmlhttpRequest', async () => {
  const values = new Map();
  const changes = [];
  const root = {};
  const adapters = {
    getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    setValue(key, value) { values.set(key, value); },
    deleteValue(key) { values.delete(key); },
    xmlHttpRequest(options) {
      options.onload({
        status: 200,
        responseHeaders: 'content-type: application/json; charset=utf-8',
        responseText: '{"code":200,"msg":"OK","data":"[SHEIN] Login verification code: 842731, account: DEMO***00"}',
      });
    },
  };
  runtime.installChromeBridge(root, adapters, core, manifest.version);
  root.chrome.storage.onChanged.addListener((next, area) => changes.push({ next, area }));

  const saved = await sendMessage(root, {
    type: 'SAVE_CONFIG',
    receiverUrl: 'https://api.68sms.com/api/sms/get?key=test-key',
  });
  assert.equal(saved.ok, true);
  assert.equal((await sendMessage(root, { type: 'GET_STATUS' })).configured, true);

  const snapshot = await sendMessage(root, { type: 'FETCH_OTP' });
  assert.deepEqual(
    { ok: snapshot.ok, found: snapshot.found, code: snapshot.code, digits: snapshot.digits },
    { ok: true, found: true, code: '842731', digits: 6 },
  );
  assert.equal(changes.at(-1).area, 'local');
  assert.equal(root.chrome.runtime.getManifest().version, manifest.version);
});

test('Tampermonkey menus configure, test and clear without exposing the saved URL', () => {
  const menus = [];
  const root = {};
  runtime.installChromeBridge(root, {
    getValue() { return undefined; },
    setValue() {},
    deleteValue() {},
    xmlHttpRequest() {},
  }, core, manifest.version);
  runtime.registerMenus(root, root.chrome.runtime, {
    registerMenuCommand(label, callback) { menus.push({ label, callback }); },
  });
  assert.deepEqual(menus.map(({ label }) => label), [
    '配置 SHEIN 接码链接',
    '测试 SHEIN 接码链接',
    '清除 SHEIN 接码链接',
  ]);
  assert.doesNotMatch(menus.map(({ label }) => label).join('\n'), /api\.68sms\.com|key=/);
});

test('generated userscript preserves the manual-confirm safety boundary and contains no real credentials', () => {
  assert.doesNotMatch(userscript, /requestSubmit\s*\(/);
  assert.doesNotMatch(userscript, /\.submit\s*\(/);
  assert.doesNotMatch(userscript, /确认[^\n]{0,120}\.click\s*\(/);
  assert.doesNotMatch(userscript, /key=[a-f0-9]{20,}/i);
  assert.doesNotMatch(userscript, /495189|GS\*+66/);
});
