'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const core = fs.readFileSync(path.join(root, 'src', 'core.js'), 'utf8');
const session = fs.readFileSync(path.join(root, 'src', 'page-session.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
const panelCss = fs.readFileSync(path.join(root, 'src', 'panel.css'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build.sh'), 'utf8');
const install = fs.readFileSync(path.join(root, 'INSTALL.md'), 'utf8');

test('manifest is MV3 and injects a main-world session observer plus isolated UI', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.1.3');
  assert.match(manifest.name, /Vine 推广标注助手/);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/page-session.js']);
  assert.equal(manifest.content_scripts[0].world, 'MAIN');
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.deepEqual(manifest.content_scripts[1].js, ['src/core.js', 'src/content.js']);
  assert.equal(manifest.content_scripts[1].world, 'ISOLATED');
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://erp.lingxing.com/erp/*']);
  assert.deepEqual(manifest.icons, {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  });
  for (const iconPath of Object.values(manifest.icons)) {
    assert.equal(fs.existsSync(path.join(root, iconPath)), true, `${iconPath} must exist`);
  }
});

test('session transport is restricted to the two verified order endpoints', () => {
  assert.match(session, /ORDER_LIST_PATH = '\/amz-order\/api\/order\/OrderList'/);
  assert.match(session, /SET_ASSESS_PATH = '\/amz-order\/api\/order\/setAssess'/);
  assert.match(session, /!\[ORDER_LIST_PATH, SET_ASSESS_PATH\]\.includes\(path\)/);
  assert.doesNotMatch(session, /delAssess|setRemark|refundOrder|setOrderFee|request_review/);
});

test('write transport requires explicit confirmation and only sends native identity fields', () => {
  assert.match(session, /payload\?\.confirmed !== true/);
  assert.match(session, /orders\.length > 20/);
  assert.match(session, /return \{ sid, amazonOrderId, purchaseDateLocal \};/);
  assert.doesNotMatch(session, /promotionType\s*:/);
});

test('tokens remain in page memory and are never written to extension storage', () => {
  assert.match(session, /auth-token/);
  assert.doesNotMatch(session, /chrome\.storage/);
  const storageWrites = [...content.matchAll(/storageSet\(\{([\s\S]*?)\}\)/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(storageWrites, /auth|token|cookie|buyer/i);
  assert.match(content, /不保存买家、令牌或请求头/);
});

test('UI strips buyer data before render and has the final confirmation gate', () => {
  assert.doesNotMatch(content, /buyerName|buyerEmail/);
  assert.match(content, /confirmChecked/);
  assert.match(content, /dialogConfirm\.disabled = !elements\.confirmChecked\.checked/);
  assert.match(content, /Core\.preflightSelection/);
  assert.match(content, /不自动重复提交/);
});

test('floating launcher expands on hover and supports persisted vertical movement', () => {
  assert.match(content, /LAUNCHER_POSITION_STORAGE_KEY/);
  assert.match(content, /setPointerCapture/);
  assert.match(content, /pointermove/);
  assert.match(content, /window\.addEventListener\('pointermove'/);
  assert.match(content, /ArrowUp/);
  assert.match(content, /ArrowDown/);
  assert.match(content, /上下拖动可调整位置/);
  assert.match(panelCss, /\.launcher:hover/);
  assert.match(panelCss, /\.launcher\.is-dragging/);
  assert.match(panelCss, /touch-action: none/);
  assert.match(panelCss, /width: max-content/);
  assert.match(panelCss, /max-width: 190px/);
  assert.doesNotMatch(panelCss, /border-radius: 14px 0 0 14px/);
});

test('core owns Vine classification, paging, readback and default promotion type', () => {
  assert.match(core, /VINE_PROMOTION_PREFIX = 'vine\.enrollment\.'/);
  assert.match(core, /isAssessed !== 1/);
  assert.match(core, /promotionId: 0, typeName: '默认'/);
  assert.match(core, /evaluateReadback/);
  assert.match(core, /MAX_PAGES = 50/);
});

test('build and documentation stay aligned with the package version', () => {
  assert.equal(packageJson.name, 'lingxing-vine-promotion-assistant');
  assert.equal(packageJson.version, manifest.version);
  assert.match(install, /版本：`0\.1\.3`/);
  assert.match(build, /lingxing-vine-promotion-assistant-v\$VERSION/);
  assert.match(build, /lingxing-vine-promotion-assistant-dev/);
  assert.match(build, /node --test/);
  assert.match(build, /icons\/icon128\.png/);
  assert.match(panelCss, /@media \(max-width: 820px\)/);
  assert.match(panelCss, /@media \(max-width: 650px\)/);
});
