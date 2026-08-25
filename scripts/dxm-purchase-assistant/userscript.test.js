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
const runtime = require('./userscript-runtime.js');

test('publishes one-click Tampermonkey metadata with automatic updates', () => {
  assert.match(userscript, /^\/\/ ==UserScript==/);
  assert.match(userscript, new RegExp(`^// @version\\s+${manifest.version.replaceAll('.', '\\.')}\\s*$`, 'm'));
  assert.match(userscript, /^\/\/ @match\s+https:\/\/dianxiaomi\.com\/\*$/m);
  assert.match(userscript, /^\/\/ @match\s+https:\/\/\*\.dianxiaomi\.com\/\*$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_getValue$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_registerMenuCommand$/m);
  assert.match(userscript, /^\/\/ @run-at\s+document-start$/m);
  assert.match(userscript, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\//m);
  assert.match(userscript, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\//m);
});

test('generated userscript embeds the exact shared core, content and stylesheet', () => {
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
});
