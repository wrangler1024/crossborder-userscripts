'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const packageInfo = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
const content = fs.readFileSync(path.join(extensionDir, 'src', 'content.js'), 'utf8');
const contentStyle = fs.readFileSync(path.join(extensionDir, 'src', 'content.css'), 'utf8');
const core = fs.readFileSync(path.join(extensionDir, 'src', 'core.js'), 'utf8');
const importTools = fs.readFileSync(path.join(extensionDir, 'src', 'import.js'), 'utf8');
const templateData = fs.readFileSync(path.join(extensionDir, 'src', 'template-data.js'), 'utf8');
const popup = fs.readFileSync(path.join(extensionDir, 'popup', 'popup.html'), 'utf8');
const readme = fs.readFileSync(path.join(extensionDir, 'README.md'), 'utf8');
const build = fs.readFileSync(path.join(extensionDir, 'build.sh'), 'utf8');

test('is an independent scoped Manifest V3 extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Xynigo 店小秘物流助手');
  assert.equal(manifest.version, '0.3.0');
  assert.equal(packageInfo.version, manifest.version);
  assert.match(popup, new RegExp(`v${manifest.version.replace(/\./g, '\\.')}`));
  assert.deepEqual(manifest.permissions, []);
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.icons, {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  });
  assert.deepEqual(manifest.action.default_icon, {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
  });
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://dianxiaomi.com/web/order/*',
    'https://*.dianxiaomi.com/web/order/*',
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, [
    'vendor/jszip.min.js',
    'src/core.js',
    'src/import.js',
    'src/template-data.js',
    'src/content.js',
  ]);
  assert.equal(manifest.background, undefined);
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['icons/icon48.png'],
    matches: ['https://dianxiaomi.com/*', 'https://*.dianxiaomi.com/*'],
  }]);
  ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'].forEach((filename) => {
    assert.equal(fs.existsSync(path.join(extensionDir, 'icons', filename)), true);
  });
  assert.equal(fs.existsSync(path.join(extensionDir, 'icons', 'xynigo-logistics-assistant-source.png')), true);
  assert.equal(fs.existsSync(path.join(extensionDir, 'vendor', 'jszip.min.js')), true);
  assert.equal(fs.existsSync(path.join(extensionDir, 'templates', 'Xynigo店小秘物流助手导入模板.xlsx')), true);
  assert.equal(fs.existsSync(path.join(extensionDir, 'src', 'template-data.js')), true);
});

test('removes legacy credentials and third-party logistics-center dependencies', () => {
  const source = `${content}\n${core}\n${readme}`;
  assert.doesNotMatch(source, /Basic\s+\$\{|username|password|43\.138\.130\.198|shipment-pre-dxm\/buy_b_express/i);
  assert.doesNotMatch(source, /samforo\.icu\/drf/i);
  assert.doesNotMatch(JSON.stringify(manifest), /<all_urls>|https:\/\/\*\/\*/);
  assert.doesNotMatch(content, /chrome\.storage\.(sync|local)/);
});

test('uses exact detail preflight and explicit irreversible confirmation', () => {
  assert.match(content, /\/api\/order\/detail\.json/);
  assert.match(content, /\/api\/order\/splitedOrderDetail\.json/);
  assert.match(content, /\/api\/order\/batchSplitOrder\.json/);
  assert.match(content, /\/api\/order\/withOutPrintShippingList\.json/);
  assert.match(content, /\/api\/package\/withOutPrintShip\.json/);
  assert.match(content, /\/api\/package\/commitPlatform\.json/);
  assert.doesNotMatch(content, /SHIPMENT_ENDPOINT = '\/package\/withOutPrintShip\.json'/);
  assert.match(content, /Core\.matchEntries/);
  assert.match(content, /我已逐行核对订单号、物流单号及店小秘平台承运商/);
  assert.match(content, /确认并执行发货/);
  assert.match(content, /禁止直接重试/);
  assert.match(content, /credentials: 'include'/);
  assert.match(content, /Core\.resolvePlatformProvider/);
  assert.match(content, /Core\.carrierNameMatches/);
  assert.match(content, /activateSearchMode/);
  assert.match(content, /搜索结果未收敛到本批订单/);
  assert.match(content, /displayedSearchResultCount/);
  assert.match(content, /displayedSearchResultCount\(visibleRows\.ids\.length, expectedMaximum\)/);
  assert.match(core, /requestedProviderName === 'iMile'/);
  assert.match(core, /option\.providerName === 'iMile'/);
  assert.match(content, /readVisibleOrders\(searchEntries/);
  assert.match(content, /已受理订单仍需到店小秘/);
  assert.match(content, /已安全排除/);
  assert.match(content, /只对可发货订单/);
  assert.match(content, /state: 'skipped'/);
  assert.match(content, /失败单重提/);
  assert.match(content, /拆单分批发货/);
  assert.match(content, /Core\.parseSplitInput/);
  assert.match(content, /Core\.assignSplitPackages/);
  assert.match(content, /Core\.buildBatchSplitPlan/);
  assert.match(content, /executeSplitPlans/);
  assert.match(content, /拆单期间不会发货/);
  assert.match(content, /正在回读新包裹/);
  assert.match(content, /select-package-card/);
  assert.match(content, /activate-purchase-sub-order/);
  assert.match(content, /clear-package-mapping/);
  assert.doesNotMatch(content, /data-role="package-select"/);
  assert.match(content, /当前只回读到 1 个待发货包裹/);
  assert.match(core, /packageFirstShipmentBlockReason/);
  assert.match(content, /未映射包裹/);
  assert.match(content, /isFailureListPage/);
});

test('supports local Excel and CSV template import without direct shipment', () => {
  assert.match(content, /download-template/);
  assert.match(content, /upload-file/);
  assert.match(templateData, /Xynigo店小秘物流助手导入模板\.xlsx/);
  assert.match(content, /ImportTools\.rowsToInput/);
  assert.match(content, /blobFromTemplateData/);
  assert.match(content, /atob\(base64\)/);
  assert.match(content, /triggerBlobDownload/);
  assert.doesNotMatch(content, /IMPORT_TEMPLATE_URL|chrome\.runtime\.getURL\('templates\//);
  const encodedTemplate = templateData.match(/base64: '([^']+)'/)?.[1];
  assert.ok(encodedTemplate);
  assert.deepEqual(
    Buffer.from(encodedTemplate, 'base64'),
    fs.readFileSync(path.join(extensionDir, 'templates', 'Xynigo店小秘物流助手导入模板.xlsx')),
  );
  assert.match(content, /尚未发货，请继续执行预检/);
  assert.match(importTools, /订单号/);
  assert.match(importTools, /采购子单号/);
  assert.match(importTools, /物流单号/);
  assert.match(importTools, /物流商渠道/);
  assert.match(importTools, /tracking_number_not_text/);
  assert.match(importTools, /tracking_scientific_notation/);
  assert.match(core, /const MAX_ENTRIES = 300/);
});

test('uses the same movable right-edge expandable entry pattern as the purchaser assistant', () => {
  assert.match(content, /xynigo-dxm-logistics-entry/);
  assert.match(content, /bindFloatingDrag/);
  assert.match(content, /setPointerCapture/);
  assert.match(content, /suppressFloatingClick/);
  assert.match(content, /clampFloatingTop/);
  assert.match(content, /XynigoDxmLogisticsAssets\?\.icon48/);
  assert.match(content, /chrome\?\.runtime\?\.getURL\?\.\('icons\/icon48\.png'\)/);
  assert.match(contentStyle, /right: 0 !important/);
  assert.match(contentStyle, /border-radius: 999px 0 0 999px/);
  assert.match(contentStyle, /button:hover/);
  assert.match(contentStyle, /width: 124px !important/);
  assert.match(contentStyle, /height: 44px !important/);
  assert.match(contentStyle, /background: #003864 !important/);
  assert.match(contentStyle, /background: transparent !important/);
  assert.match(contentStyle, /cursor: grab !important/);
  assert.match(contentStyle, /xynigo-dxm-logistics-mode/);
  assert.doesNotMatch(content, /order-detail-content__nav/);
});

test('uses selectable bounded concurrency with automatic safety fallback', () => {
  assert.match(content, /const DEFAULT_SHIPMENT_CONCURRENCY = 2/);
  assert.match(content, /const MAX_SHIPMENT_CONCURRENCY = 4/);
  assert.match(content, /name="xynigo-dxm-logistics-concurrency" value="2" checked/);
  assert.match(content, /executeShipmentQueue\(matches, requestedConcurrency/);
  assert.match(content, /concurrency = 1/);
  assert.match(content, /if \(result\.state === 'unknown'\) paused = true/);
  assert.match(content, /data-role="execution-metrics"/);
  assert.match(content, /formatExecutionDuration/);
  assert.match(content, /firstBusyIndex/);
  assert.match(content, /\[data-stage="preview"\] > \.xynigo-dxm-logistics-summary/);
  assert.match(content, /执行时长/);
  assert.match(content, /失败单重提/);
  assert.match(content, /const maxBusyRetries = 5/);
  assert.match(content, /if \(!interpreted\.retryable\) return interpreted/);
  assert.match(content, /state: 'unknown'/);
  assert.match(contentStyle, /xynigo-dxm-logistics-execution-settings/);
  assert.match(contentStyle, /xynigo-dxm-logistics-execution-metrics/);
  assert.match(contentStyle, /data-result="paused"/);
  assert.doesNotMatch(content, /Promise\.all\(matches\.map\([^)]*submitShipment/);
});

test('builds stable unpacked and release packages', () => {
  assert.match(build, /--dev\|--release\|--all/);
  assert.match(build, /xynigo-dxm-logistics-assistant-dev/);
  assert.match(build, /xynigo-dxm-logistics-assistant-v\$VERSION/);
  assert.match(build, /icons\/icon128\.png/);
  assert.match(build, /vendor\/jszip\.min\.js/);
  assert.match(build, /src\/template-data\.js/);
  assert.match(build, /Xynigo店小秘物流助手导入模板\.xlsx/);
});
