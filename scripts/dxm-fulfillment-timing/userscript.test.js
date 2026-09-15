'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const extensionDir = path.join(repoRoot, 'extensions', 'xynigo-dxm-fulfillment-timing');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(path.join(scriptDir, 'xynigo_dxm_fulfillment_timing.user.js'), 'utf8');
const core = fs.readFileSync(path.join(extensionDir, 'src', 'core.js'), 'utf8').trim();
const inject = fs.readFileSync(path.join(extensionDir, 'src', 'inject.js'), 'utf8').trim();
const content = fs.readFileSync(path.join(extensionDir, 'src', 'content.js'), 'utf8').trim();
const css = fs.readFileSync(path.join(extensionDir, 'src', 'panel.css'), 'utf8');
const runtime = require('./userscript-runtime.js');

test('publishes one-click Tampermonkey metadata with automatic updates', () => {
  assert.match(userscript, /^\/\/ ==UserScript==/);
  assert.match(userscript, new RegExp(`^// @version\\s+${manifest.version.replaceAll('.', '\\.')}\\s*$`, 'm'));
  assert.match(userscript, /^\/\/ @match\s+https:\/\/dianxiaomi\.com\/web\/otherFeatures\/tracking\*$/m);
  assert.match(userscript, /^\/\/ @match\s+https:\/\/\*\.dianxiaomi\.com\/web\/otherFeatures\/tracking\*$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_getValue$/m);
  assert.match(userscript, /^\/\/ @grant\s+GM_setValue$/m);
  assert.match(userscript, /^\/\/ @run-at\s+document-start$/m);
  assert.match(userscript, /^\/\/ @icon\s+https:\/\/raw\.githubusercontent\.com\//m);
  assert.match(userscript, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/wrangler1024\/crossborder-userscripts\/main\/scripts\/dxm-fulfillment-timing\/xynigo_dxm_fulfillment_timing\.user\.js$/m);
  assert.match(userscript, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/wrangler1024\/crossborder-userscripts\/main\/scripts\/dxm-fulfillment-timing\/xynigo_dxm_fulfillment_timing\.user\.js$/m);
});

test('generated userscript embeds the exact shared core, bridge, content and stylesheet', () => {
  assert.ok(userscript.includes(core));
  assert.ok(userscript.includes(content));
  assert.ok(userscript.includes(JSON.stringify(css).slice(1, -1)));
  assert.match(userscript, /Generated from the shared Manifest V3 source/);
  // 主世界桥接脚本以字符串形式传给 boot,页面级守卫必须存在(扩展/油猴共存只装一次)
  assert.ok(userscript.includes(JSON.stringify(inject).slice(1, -1)));
  assert.ok(inject.includes('__xftBridgeInstalled'));
});

test('chrome shim provides storage callbacks, change events and manifest version', async () => {
  const values = new Map();
  const root = {};
  const changes = [];
  runtime.installChromeShim(root, {
    getValue(key, fallback) { return values.has(key) ? values.get(key) : fallback; },
    setValue(key, value) { values.set(key, value); },
    deleteValue(key) { values.delete(key); },
    listValues() { return [...values.keys()]; },
  }, manifest.version);
  assert.equal(root.chrome.runtime.getManifest().version, manifest.version);
  root.chrome.storage.onChanged.addListener((next, area) => changes.push({ next, area }));

  await new Promise((resolve) => root.chrome.storage.local.set({ 'xft.thresholds': [120, 144, 192] }, resolve));
  const all = await new Promise((resolve) => root.chrome.storage.local.get(null, resolve));
  assert.deepEqual(all, { 'xft.thresholds': [120, 144, 192] });
  assert.deepEqual(
    await new Promise((resolve) => root.chrome.storage.local.get(['xft.thresholds', 'missing'], resolve)),
    { 'xft.thresholds': [120, 144, 192], missing: undefined },
  );
  assert.equal(changes.at(-1).area, 'local');
  await new Promise((resolve) => root.chrome.storage.local.remove('xft.thresholds', resolve));
  assert.deepEqual(await new Promise((resolve) => root.chrome.storage.local.get(null, resolve)), {});
});

test('chrome shim never clobbers a real extension chrome object', () => {
  const realGetManifest = () => ({ version: '9.9.9' });
  const realLocal = { get() {}, set() {} };
  const root = { chrome: { runtime: { getManifest: realGetManifest }, storage: { local: realLocal } } };
  const returned = runtime.installChromeShim(root, {
    getValue() { return 1; }, setValue() {}, deleteValue() {}, listValues() { return []; },
  }, '0.0.1');
  assert.equal(returned, root.chrome);
  assert.equal(root.chrome.runtime.getManifest, realGetManifest);
  assert.equal(root.chrome.storage.local, realLocal);
  assert.equal(root.chrome.runtime.getManifest().version, '9.9.9');
});

function fakeDocument() {
  const appended = [];
  return {
    appended,
    createElement(tag) {
      return { tag, textContent: '', id: '' };
    },
    head: { appendChild(el) { appended.push(el); } },
    documentElement: { appendChild(el) { appended.push(el); } },
  };
}

test('boot injects bridge script then stylesheet and is idempotent', () => {
  const root = { document: fakeDocument() };
  const adapters = {
    getValue() { return undefined; }, setValue() {}, deleteValue() {}, listValues() { return []; },
  };
  const chrome = runtime.boot(root, { css: 'body{}', injectSource: 'window.__xftBridgeInstalled = true;', version: manifest.version }, adapters);
  assert.ok(chrome && chrome.runtime.getManifest);
  assert.equal(chrome.runtime.getManifest().version, manifest.version);
  const tags = root.document.appended.map((el) => el.tag);
  assert.deepEqual(tags, ['script', 'style']);
  assert.equal(root.document.appended[0].textContent, 'window.__xftBridgeInstalled = true;');
  assert.ok(root.document.appended[1].textContent.includes('body{}'));
  // 重复 boot 不再注入
  assert.equal(runtime.boot(root, { css: 'x', injectSource: 'y', version: '0' }, adapters), null);
  assert.equal(root.document.appended.length, 2);
});

test('coexistence: panel guard and bridge guard both present in shared sources', () => {
  // 面板级守卫:扩展与油猴谁先建 #xft-ball,另一方退出
  assert.ok(content.includes("if ($('xft-ball')) return;"));
});
