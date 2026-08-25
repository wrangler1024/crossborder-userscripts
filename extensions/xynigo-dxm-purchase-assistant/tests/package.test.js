'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const contentScript = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
const backgroundScript = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');

test('is an independent Manifest V3 extension scoped to Dianxiaomi', () => {
  assert.equal(manifest.version, '0.11.0');
  assert.equal(manifest.version_name, '0.11.0-xynigo-test');
  assert.equal(packageInfo.version, manifest.version);
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.name, /店小秘运营采购助手/);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://dianxiaomi.com/*',
    'https://*.dianxiaomi.com/*',
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/core.js', 'src/content.js']);
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
  assert.deepEqual(manifest.externally_connectable.matches, ['http://127.0.0.1/*']);
});

test('package proxies only to the Xynigo loopback bridge and contains no cloud or Feishu credentials', () => {
  assert.match(backgroundScript, /http:\/\/127\.0\.0\.1/);
  assert.match(backgroundScript, /api\/extension\/v1\/purchase-orders\/draft/);
  assert.match(backgroundScript, /api\/extension\/v1\/purchase-orders\/submit/);
  assert.match(backgroundScript, /text\/plain;charset=UTF-8/);
  assert.doesNotMatch(backgroundScript, /X-Purchase-Token/);
  assert.doesNotMatch(`${contentScript}\n${backgroundScript}`, /app_secret|tenant_access_token|飞书应用密钥/i);
  assert.doesNotMatch(backgroundScript, /apiToken|Authorization\s*:\s*['"]Bearer/i);
});

test('never gates, clicks, unlocks or disables Dianxiaomi audit actions', () => {
  assert.doesNotMatch(contentScript, /gateEnabled|批量审核|xynigo-dxm-audit-locked|aria-disabled/);
  assert.doesNotMatch(contentScript, /解锁审核|审核不可用/);
  assert.match(contentScript, /未触发店小秘审核/);
  assert.match(contentScript, /xynigo-dxm:submit/);
});

test('appends a purchase-detail tab and renders the form in the native detail content region', () => {
  assert.match(contentScript, /order-detail-content__nav/);
  assert.match(contentScript, /order-detail-content__nav-item/);
  assert.match(contentScript, /xynigo-dxm-purchase-tab/);
  assert.match(contentScript, /injectEmbeddedTab/);
  assert.match(contentScript, /openEmbeddedEditor/);
  assert.match(contentScript, /purchaseLink/);
  assert.match(contentScript, /productImageUrl/);
  assert.match(contentScript, /mainSpec/);
  assert.match(contentScript, /subSpec/);
  assert.match(contentScript, /guidePrice/);
  assert.match(contentScript, /purchaseQty/);
});
