'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const scriptDir = __dirname;
const repoRoot = path.resolve(scriptDir, '..', '..');
const extensionDir = path.join(repoRoot, 'extensions', 'xynigo-dxm-logistics-assistant');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(path.join(scriptDir, 'xynigo_dxm_logistics_assistant.user.js'), 'utf8');
const vendor = fs.readFileSync(path.join(extensionDir, 'vendor', 'jszip.min.js'), 'utf8').trim();
const core = fs.readFileSync(path.join(extensionDir, 'src', 'core.js'), 'utf8').trim();
const importTools = fs.readFileSync(path.join(extensionDir, 'src', 'import.js'), 'utf8').trim();
const templateData = fs.readFileSync(path.join(extensionDir, 'src', 'template-data.js'), 'utf8').trim();
const content = fs.readFileSync(path.join(extensionDir, 'src', 'content.js'), 'utf8').trim();
const css = fs.readFileSync(path.join(extensionDir, 'src', 'content.css'), 'utf8');

test('publishes a public one-click Tampermonkey installer with automatic updates', () => {
  assert.match(userscript, /^\/\/ ==UserScript==/);
  assert.match(userscript, new RegExp(`^// @version\\s+${manifest.version.replaceAll('.', '\\.')}$`, 'm'));
  assert.match(userscript, /^\/\/ @match\s+https:\/\/dianxiaomi\.com\/web\/order\/paid\*$/m);
  assert.match(userscript, /^\/\/ @match\s+https:\/\/\*\.dianxiaomi\.com\/web\/order\/paid\*$/m);
  assert.match(userscript, /^\/\/ @grant\s+none$/m);
  assert.match(userscript, /^\/\/ @run-at\s+document-idle$/m);
  assert.match(userscript, /^\/\/ @noframes$/m);
  assert.match(userscript, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\//m);
  assert.match(userscript, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\//m);
});

test('generated userscript embeds the exact shared logic, template and stylesheet', () => {
  assert.ok(userscript.includes(vendor));
  assert.ok(userscript.includes(core));
  assert.ok(userscript.includes(importTools));
  assert.ok(userscript.includes(templateData));
  assert.ok(userscript.includes(content));
  assert.ok(userscript.includes(JSON.stringify(css)));
  assert.match(userscript, /data:image\/png;base64,/);
  assert.match(userscript, /Generated from the shared Manifest V3 source/);
});

test('runs without chrome.runtime and downloads the embedded template through a Blob URL', () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://www.dianxiaomi.com/web/order/paid?go=m100',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  window.fetch = async (url) => { throw new Error(`模板下载不应请求 ${url}`); };
  let downloadedHref = '';
  let downloadedName = '';
  window.URL.createObjectURL = () => 'blob:https://www.dianxiaomi.com/userscript-template';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function clickDownload() {
    downloadedHref = this.href;
    downloadedName = this.download;
  };

  window.eval(userscript);
  const entry = window.document.querySelector('#xynigo-dxm-logistics-entry button');
  assert.ok(entry);
  assert.match(entry.querySelector('img').src, /^data:image\/png;base64,/);
  assert.match(window.document.querySelector('style[data-xynigo-dxm-logistics="userscript"]').textContent, /xynigo-dxm-logistics-entry/);
  entry.click();
  window.document.querySelector('[data-action="download-template"]').click();

  assert.equal(downloadedHref, 'blob:https://www.dianxiaomi.com/userscript-template');
  assert.equal(downloadedName, 'Xynigo店小秘物流助手导入模板.xlsx');
  assert.doesNotMatch(downloadedHref, /chrome-extension:|comet-extension:/);
  dom.window.close();
});

test('preserves shipment safety boundaries and contains no credentials', () => {
  assert.match(userscript, /我已逐行核对订单号、物流单号及店小秘平台承运商/);
  assert.match(userscript, /确认并执行发货/);
  assert.match(userscript, /\/api\/package\/withOutPrintShip\.json/);
  assert.match(userscript, /\/api\/package\/commitPlatform\.json/);
  assert.doesNotMatch(userscript, /@connect|GM_xmlhttpRequest|GM_setValue|chrome\.storage/);
  assert.doesNotMatch(userscript, /Basic\s+\$\{|username|password|43\.138\.130\.198|samforo\.icu\/drf/i);
});
