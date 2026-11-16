'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '../..');
const build = path.join(root, 'build-userscript.mjs');
const userPath = path.join(root, 'lingxing-vine-promotion-assistant.user.js');
const metaPath = path.join(root, 'lingxing-vine-promotion-assistant.meta.js');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'extensions/lingxing-vine-promotion-assistant/manifest.json'), 'utf8'));

execFileSync(process.execPath, [build], { stdio: 'pipe' });
const user = fs.readFileSync(userPath, 'utf8');
const meta = fs.readFileSync(metaPath, 'utf8');

test('userscript metadata is installable and updates from the repository main branch', () => {
  assert.match(user, /^\/\/ ==UserScript==/);
  assert.match(user, new RegExp(`^// @version\\s+${manifest.version.replaceAll('.', '\\.')}$`, 'm'));
  assert.match(user, /^\/\/ @match\s+https:\/\/erp\.lingxing\.com\/erp\/\*$/m);
  assert.match(user, /^\/\/ @run-at\s+document-start$/m);
  assert.match(user, /^\/\/ @grant\s+none$/m);
  assert.match(user, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/wrangler1024\/crossborder-userscripts\/main\//m);
  assert.match(user, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/wrangler1024\/crossborder-userscripts\/main\//m);
  assert.doesNotMatch(user, /^\/\/ @require\s+/m);
});

test('single-file userscript embeds UI, styles and the verified request paths', () => {
  assert.match(user, /__LINGXING_VINE_INLINE_CSS__/);
  assert.match(user, /Vine 推广标注助手/);
  assert.match(user, /\/amz-order\/api\/order\/OrderList/);
  assert.match(user, /\/amz-order\/api\/order\/setAssess/);
  assert.match(user, /xynigo:lingxing-vine:/);
  assert.match(user, /confirmChecked/);
  assert.match(user, /不自动重复提交/);
});

test('meta file contains metadata only', () => {
  assert.match(meta, /^\/\/ ==UserScript==/);
  assert.match(meta, new RegExp(`^// @version\\s+${manifest.version.replaceAll('.', '\\.')}$`, 'm'));
  assert.doesNotMatch(meta, /__LINGXING_VINE_INLINE_CSS__/);
  assert.doesNotMatch(meta, /\/amz-order\/api\/order\/OrderList/);
});

test('generated userscript is valid JavaScript', () => {
  execFileSync(process.execPath, ['--check', userPath], { stdio: 'pipe' });
});

test('Tampermonkey storage shim supports callback storage without persisting session headers', async () => {
  const values = new Map();
  const localStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const { createChromeShim } = require('../userscript-runtime.js');
  const chrome = createChromeShim({ localStorage }, { prefix: 'test:lingxing-vine:' });
  assert.ok(chrome.storage.local);
  await new Promise((resolve) => chrome.storage.local.set({ launcherTop: 420, history: [{ count: 3 }] }, resolve));
  const stored = await new Promise((resolve) => chrome.storage.local.get(['launcherTop', 'history', 'missing'], resolve));
  assert.deepEqual(stored, { launcherTop: 420, history: [{ count: 3 }] });
  assert.doesNotMatch([...values.keys()].join('\n'), /auth-token|cookie/i);
  await new Promise((resolve) => chrome.storage.local.remove(['launcherTop'], resolve));
  const defaults = await new Promise((resolve) => chrome.storage.local.get({ launcherTop: 100 }, resolve));
  assert.deepEqual(defaults, { launcherTop: 100 });
});
