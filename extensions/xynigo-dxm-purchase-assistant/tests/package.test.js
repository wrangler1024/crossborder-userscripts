'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const contentScript = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');

test('is an independent Manifest V3 extension scoped to Dianxiaomi', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.name, /店小秘运营采购助手/);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://dianxiaomi.com/*',
    'https://*.dianxiaomi.com/*',
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/core.js', 'src/content.js']);
});

test('development package uses local storage and does not contain Feishu credentials', () => {
  assert.match(contentScript, /local-dev-mock|本地开发模式/);
  assert.doesNotMatch(contentScript, /app_secret|tenant_access_token|飞书应用密钥/i);
});

test('blocks audit only when the explicit gate setting is enabled', () => {
  assert.match(contentScript, /if \(!settings\.gateEnabled\) return/);
  assert.match(contentScript, /label === '批量审核'/);
  assert.match(contentScript, /label !== '审核'/);
});

test('appends a purchase-detail tab and renders the form in the native detail content region', () => {
  assert.match(contentScript, /order-detail-content__nav/);
  assert.match(contentScript, /order-detail-content__nav-item/);
  assert.match(contentScript, /xynigo-dxm-purchase-tab/);
  assert.match(contentScript, /injectEmbeddedTab/);
  assert.match(contentScript, /openEmbeddedEditor/);
  assert.match(contentScript, /purchaseLink/);
  assert.match(contentScript, /mainSpec/);
  assert.match(contentScript, /subSpec/);
  assert.match(contentScript, /guidePrice/);
  assert.match(contentScript, /purchaseQty/);
});
