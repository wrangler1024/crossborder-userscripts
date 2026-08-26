'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const contentScript = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
const contentStyle = fs.readFileSync(path.join(root, 'src', 'content.css'), 'utf8');
const backgroundScript = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');
const loginScript = fs.readFileSync(path.join(root, 'login', 'login.js'), 'utf8');

test('is an independent Manifest V3 extension scoped to Dianxiaomi', () => {
  const icons = {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  };
  assert.equal(manifest.version, '0.12.1');
  assert.equal(manifest.version_name, '0.12.1-standalone-cloud-login-test');
  assert.equal(packageInfo.version, manifest.version);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'clipboardWrite']);
  assert.match(manifest.name, /店小秘运营采购助手/);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://dianxiaomi.com/*',
    'https://*.dianxiaomi.com/*',
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/core.js', 'src/content.js']);
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.deepEqual(manifest.host_permissions, ['https://xynigo.samforo.icu/*']);
  assert.deepEqual(manifest.icons, icons);
  assert.deepEqual(manifest.action.default_icon, { 16: icons[16], 32: icons[32] });
  Object.values(icons).forEach((iconPath) => assert.equal(fs.existsSync(path.join(root, iconPath)), true));
  assert.equal(manifest.externally_connectable, undefined);
});

test('package signs in directly through cloud without Feishu credentials or persistent bearer storage', () => {
  assert.match(backgroundScript, /https:\/\/xynigo\.samforo\.icu/);
  assert.match(backgroundScript, /v1\/auth\/local\/start/);
  assert.match(backgroundScript, /v1\/auth\/local\/poll/);
  assert.match(backgroundScript, /v1\/purchase-orders\/draft/);
  assert.match(backgroundScript, /v1\/purchase-orders\/submit/);
  assert.match(backgroundScript, /storage\.session/);
  assert.doesNotMatch(backgroundScript, /storage\.local/);
  assert.doesNotMatch(backgroundScript, /X-Purchase-Token/);
  assert.doesNotMatch(`${contentScript}\n${backgroundScript}\n${loginScript}`, /app_secret|tenant_access_token|飞书应用密钥/i);
  assert.doesNotMatch(loginScript, /本机服务|127\.0\.0\.1|localhost/);
  assert.match(loginScript, /chrome\.tabs\.getCurrent/);
  assert.match(loginScript, /chrome\.tabs\.remove/);
  assert.match(loginScript, /正在自动关闭此页面/);
  assert.doesNotMatch(contentScript, /sessionToken|Authorization\s*:/);
});

test('never gates, clicks, unlocks or disables Dianxiaomi audit actions', () => {
  assert.doesNotMatch(contentScript, /gateEnabled|批量审核|xynigo-dxm-audit-locked|aria-disabled/);
  assert.doesNotMatch(contentScript, /解锁审核|审核不可用/);
  assert.match(contentScript, /XYP2/);
  assert.match(contentScript, /prefillNativeRemark/);
  assert.match(contentScript, /核对后点击店小秘保存/);
  assert.match(contentScript, /未写入客服备注/);
  assert.match(contentScript, /正在检查原客服备注/);
  assert.match(contentScript, /预计 3–8 秒/);
  assert.match(contentScript, /IMPORTANT_ERROR_TOAST_MS = 8000/);
  assert.match(contentScript, /durationMs: IMPORTANT_ERROR_TOAST_MS/);
  assert.match(contentStyle, /#xynigo-dxm-toast\[data-busy="true"\]/);
  assert.match(contentStyle, /xynigo-dxm-toast-spin/);
  assert.match(contentScript, /extension_context_invalidated/);
  assert.match(contentScript, /请刷新当前店小秘页面/);
  assert.match(contentScript, /xynigo-dxm:get-order/);
  assert.match(contentScript, /复制已提交XYP2/);
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
