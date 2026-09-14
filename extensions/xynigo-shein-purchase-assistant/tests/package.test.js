'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(root, 'src', 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(root, 'src', 'content.css'), 'utf8');
const popupHtml = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8');
const popupCss = fs.readFileSync(path.join(root, 'popup', 'popup.css'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup', 'popup.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'build.sh'), 'utf8');
test('is a Manifest V3 extension scoped to SHEIN US/Mexico and localhost', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.10.0');
  assert.match(manifest.name, /SHEIN 采购助手/);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, [
    'http://xynigo.localhost/*',
    'http://127.0.0.1/*',
    'http://localhost/*',
  ]);
  assert.match(background, /PURCHASE_ASSISTANT_API_PREFIX = '\/api\/purchase-assistant\/v1'/);
  assert.match(background, /EXECUTOR_DISCOVERY_PORTS/);
  assert.match(background, /8765 \+ index/);
  assert.match(background, /discoverExecutorBaseUrl/);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/core.js', 'src/purchase-details.js', 'src/content.js']);
  assert.deepEqual(manifest.content_scripts[0].css, ['src/content.css']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://www.shein.com.mx/*', 'https://m.shein.com.mx/*', 'https://us.shein.com/*']);
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
  assert.deepEqual(manifest.commands, {
    'open-purchase-assistant': {
      suggested_key: { default: 'Alt+Shift+P' },
      description: '打开 SHEIN 采购助手窗口',
    },
  });
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['icons/icon48.png'],
    matches: ['https://www.shein.com.mx/*', 'https://m.shein.com.mx/*', 'https://us.shein.com/*'],
  }]);
  for (const size of [16, 32, 48, 128]) {
    const icon = fs.readFileSync(path.join(root, 'icons', `icon${size}.png`));
    assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});

test('uses session storage for the short-lived token and local storage only for non-sensitive settings', () => {
  assert.match(background, /chrome\.storage\.session/);
  assert.match(background, /executorBaseUrl/);
  assert.match(background, /PURCHASE_ASSISTANT_API_PREFIX \+ '\/session'/);
  assert.match(background, /X-Xynigo-Pairing/);
  assert.doesNotMatch(background, /case 'SAVE_SESSION'/);
  assert.doesNotMatch(background, /case 'CLEAR_SESSION'/);
  assert.doesNotMatch(background, /recipientName[^]*chrome\.storage\.local\.set/);
  assert.doesNotMatch(background, /addressLine1[^]*chrome\.storage\.local\.set/);
  assert.match(background, /legacy\.personalSheetUrl/);
  assert.doesNotMatch(background, /next\s*=\s*\{[^}]*personalSheetUrl/);
});

test('does not submit, save or continue checkout', () => {
  assert.doesNotMatch(content, /requestSubmit\s*\(/);
  assert.doesNotMatch(content, /\.submit\s*\(/);
  assert.doesNotMatch(content, /GUARDAR[^]{0,160}\.click\s*\(/i);
  assert.doesNotMatch(content, /CONTINUAR[^]{0,160}\.click\s*\(/i);
  assert.match(content, /fieldLabels:\s*\[['"]CURP/);
  assert.match(content, /读取当前订单提供的 CURP/);
});

test('fetches the full recipient only after a user click', () => {
  assert.match(content, /fill-button[^]{0,200}addEventListener\('click', runFill\)/);
  assert.match(content, /type:\s*'GET_RECIPIENT'/);
  assert.match(content, /recipient = null/);
});

test('renders an in-page recipient fallback with per-field copy and clears it on task changes', () => {
  assert.match(content, /data-role="recipient-card"/);
  assert.match(content, /data-role="recipient-fields"/);
  assert.match(content, /function renderRecipientCard/);
  assert.match(content, /navigator\.clipboard\.writeText/);
  assert.match(content, /document\.execCommand\('copy'\)/);
  assert.match(content, /\['收货人姓名', recipient\.recipientName\]/);
  assert.match(content, /stepByKey\('firstName'\)\.label \+ '（SHEIN）', values\.firstName/);
  assert.match(content, /stepByKey\('lastName'\)\.label \+ '（SHEIN）', values\.lastName/);
  assert.match(content, /\['收货人电话', recipient\.recipientPhone\]/);
  assert.match(content, /'地址1（原始）'/);
  assert.match(content, /'地址2（原始）'/);
  assert.match(content, /stepByKey\('address1'\)\.label \+ '（SHEIN）', values\.address1/);
  assert.match(content, /\['地址补充（SHEIN）', values\.address2\]/);
  assert.match(content, /鼠标点击任一字段即复制当前显示值/);
  assert.match(content, /function clearRecipientCard/);
  assert.match(content, /async function loadRecipientPreview/);
  assert.match(content, /void loadRecipientPreview\(task\)/);
  assert.match(content, /selectedTask\.taskKey !== task\.taskKey/);
  assert.match(content, /仅当前页面临时显示/);
  assert.ok(
    content.indexOf('type: \'GET_RECIPIENT\'') < content.indexOf('renderRecipientCard(response.recipient, validation)'),
    '收件信息只能在用户点击后获取并显示',
  );
});

test('requires a task search instead of rendering the entire collaboration sheet', () => {
  assert.match(content, /data-role="task-query"/);
  assert.match(content, /LIST_TASKS', query/);
  assert.match(content, /仅显示前 20 个/);
  assert.doesNotMatch(background, /\/api\/tasks\?buyer=/);
});

test('does not expose a manual session-token field to ordinary users', () => {
  assert.doesNotMatch(popupHtml, /id="sessionToken"/);
  assert.match(popupHtml, /桌面端托管/);
  assert.ok(popupHtml.includes('v' + manifest.version));
  assert.match(popupHtml, /\.\.\/icons\/icon48\.png/);
  assert.ok(content.includes("CONTENT_VERSION = '" + manifest.version + "'"));
  assert.match(content, /BUSINESS_ICON_URL = chrome\.runtime\.getURL\('icons\/icon48\.png'\)/);
  assert.match(content, /xpa-mark"><img src="' \+ BUSINESS_ICON_URL/);
  assert.match(content, /function clampVerticalTop/);
  assert.match(content, /function applyVerticalPosition/);
  assert.match(content, /function bindVerticalDrag/);
  assert.match(content, /event\.clientY - drag\.startY/);
  assert.match(content, /window\.innerHeight - Math\.max\(1, elementHeight\)/);
  assert.match(content, /bindVerticalDrag\(fab, 'fab'\)/);
  assert.match(content, /bindVerticalDrag\(header, 'panel'\)/);
  assert.doesNotMatch(content, /event\.clientX - drag\.startX/);
  assert.match(contentCss, /\.is-collapsed \{ right: 0;/);
  assert.match(contentCss, /border-radius: 999px 0 0 999px/);
  assert.match(contentCss, /\.is-collapsed \.xpa-fab \{[^}]*width: 64px;/);
  assert.match(contentCss, /\.xpa-fab:hover,[^}]*width: 138px;/);
  assert.match(contentCss, /\.xpa-fab b \{[^}]*max-width: 0;/);
  assert.match(contentCss, /\.xpa-fab:hover b,[^}]*max-width: 64px;/);
  assert.match(contentCss, /prefers-reduced-motion: reduce/);
  assert.match(content, /function collapsePanel\(\)/);
  assert.match(content, /document\.addEventListener\('keydown',[^]*event\.key === 'Escape'[^]*collapsePanel\(\)[^]*}, true\)/);
  assert.match(content, /\[data-role="close"\]'\)\.addEventListener\('click', collapsePanel\)/);
  assert.match(content, /existing\.remove\(\)/);
  assert.match(content, /host\.classList\.add\('is-collapsed'\)/);
  assert.doesNotMatch(content, /let panelOpen/);
  assert.match(content, /PRE_LOCATION_TEXT_KEYS = \['phone'\]/);
  assert.match(content, /POST_LOCATION_TEXT_KEYS = \['address1', 'address2'\]/);
  assert.match(content, /async function fillNamePair/);
  assert.match(content, /姓名组合替换后回读不一致/);
  assert.match(content, /async function executeStepsSequentially/);
  assert.match(content, /正在成组填写/);
  assert.match(content, /getAttribute\('aria-invalid'\) === 'true'/);
  assert.match(content, /!field\.checkValidity\(\)/);
  assert.match(content, /async function retryMismatchedTextFields/);
  assert.match(content, /检测到文本字段被页面重置/);
  assert.match(content, /function isRenderedElement/);
  assert.match(content, /\.filter\(isRenderedElement\)/);
  assert.match(content, /\['keyboard', 'native', 'hybrid'\]/);
  assert.match(content, /inputType: 'insertReplacementText'/);
  assert.match(content, /step\.key === 'address2' \? 700 : 450/);
  assert.match(content, /正在填写自动拆分后的两行地址/);
  assert.match(content, /长地址已自动拆分为两行/);
  assert.match(content, /executeStepsSequentially\(POST_LOCATION_TEXT_KEYS, validation\.values\)/);
  assert.doesNotMatch(content, /Promise\.all\([^]*POST_LOCATION_TEXT_KEYS/);
  assert.match(content, /正在等待邮编自动带出州和城市/);
  assert.match(content, /const results = new Map\(\)/);
  assert.match(content, /async function executeStep/);
  assert.doesNotMatch(content, /throw new Error\(result\.error\)/);
  assert.match(content, /async function fillPostalCode/);
  assert.match(content, /visiblePostalSuggestion/);
  assert.match(content, /waitForStableFieldValue/);
  assert.match(content, /document\.execCommand\('insertText'/);
  assert.match(content, /compareVersions\(existing\.dataset\.xynigoVersion, CONTENT_VERSION\) >= 0/);
  assert.match(content, /Xynigo · v' \+ CONTENT_VERSION/);
  assert.match(content, /field\.closest\('\.sui-input-titlewarp'\)/);
  assert.match(content, /optionsInMenu\(menu\)/);
  assert.ok(
    content.indexOf('正在最终核对邮编') < content.indexOf('正在依次填写街道地址'),
    '街道地址必须在邮编与州市联动稳定后填写',
  );
});

test('uses desktop-managed data sources without exposing plugin-side writes', () => {
  assert.match(popupHtml, /id="sourceTitle"/);
  assert.match(popupHtml, /id="openDesktopSettings"/);
  assert.match(popupHtml, /插件不再保存飞书表格链接/);
  assert.doesNotMatch(popupHtml, /data-source-mode=/);
  assert.doesNotMatch(popupHtml, /personalSheetUrl/);
  assert.doesNotMatch(popupHtml, /personalSheetSelect/);
  assert.match(background, /case 'GET_DATA_SOURCE'/);
  assert.match(background, /case 'OPEN_DESKTOP_SETTINGS'/);
  assert.doesNotMatch(background, /case 'INSPECT_DATA_SOURCE'/);
  assert.doesNotMatch(background, /case 'VALIDATE_DATA_SOURCE'/);
  assert.doesNotMatch(background, /case 'SAVE_DATA_SOURCE'/);
  assert.doesNotMatch(background, /\/data-source\/inspect/);
  assert.doesNotMatch(background, /\/data-source\/validate/);
  assert.doesNotMatch(background, /\/data-source\/save/);
  assert.match(background, /desktopDataSourceSupport/);
  assert.match(background, /xynigo:\/\/settings/);
  assert.match(popupJs, /function renderSource/);
  assert.match(popupJs, /environment_binding/);
  assert.match(popupJs, /data_source_mapping_required/);
  assert.doesNotMatch(popupHtml + popupJs + background, /spreadsheetToken/);
  assert.doesNotMatch(popupHtml + popupJs + background, /sheetId/);
});

test('gives the extension popup an intrinsic width during Chromium auto-sizing', () => {
  assert.match(popupHtml, /class="health-grid"/);
  assert.match(popupHtml, /class="source-card"/);
  assert.match(popupHtml, /class="detail-grid"/);
  assert.match(popupCss, /html \{[^}]*width: 600px;[^}]*min-width: 600px;/);
  assert.match(popupCss, /max-height: 600px;/);
  assert.match(popupCss, /overflow-y: auto;/);
  assert.match(popupCss, /\.source-meta \{/);
  assert.doesNotMatch(popupCss, /(?:max-width|width): 100vw/);
  assert.doesNotMatch(popupCss, /@media \(max-width:/);
  assert.doesNotMatch(popupCss, /body \{ width: 340px;/);
});

test('opens the purchase assistant with a configurable browser shortcut', () => {
  assert.match(background, /chrome\.commands\.onCommand\.addListener/);
  assert.match(background, /command !== 'open-purchase-assistant'/);
  assert.match(background, /chrome\.tabs\.query\(\{ active: true, lastFocusedWindow: true \}/);
  assert.match(background, /OPEN_PURCHASE_ASSISTANT/);
  assert.match(content, /function openPanel\(\)/);
  assert.match(content, /message\.type === 'OPEN_PURCHASE_ASSISTANT'[^]*openPanel\(\)/);
  assert.match(popupHtml, /id="shortcutValue"/);
  assert.match(popupHtml, /id="openShortcutSettings"/);
  assert.match(popupJs, /chrome\.commands\.getAll/);
  assert.match(popupJs, /chrome:\/\/extensions\/shortcuts/);
});

test('keeps HubStudio automation in the backend without exposing in-page controls', () => {
  assert.match(background, /requestExecutor\('\/capabilities'\)/);
  assert.match(background, /hubAutomationSupport\(health\)/);
  assert.match(background, /reasonCode: support\.reasonCode/);
  assert.match(background, /executor_feature_inconsistent/);
  assert.doesNotMatch(background, /capabilities\.error \|\| '接口不存在'/);
  assert.match(background, /local_access_disabled/);
  assert.match(background, /Xynigo 主执行器未运行/);
  assert.match(background, /若终端已显示运行，请开启团队偏好的“本地访问”/);
  assert.match(background, /if \(!capabilities\.ok\)/);
  assert.match(background, /hubStudio: capabilities\.hubStudio/);
  assert.match(content, /const health = await refreshExecutorStatus\(\)/);
  assert.match(content, /if \(!health\.ok\)/);
  assert.doesNotMatch(content, /if \(!health\.hubStudio/);
  assert.match(popupHtml, /id="hubStatus"/);
  assert.match(popupJs, /HubStudio Local API 已就绪/);
  assert.match(background, /case 'HUB_ENV_LOCATE'/);
  assert.match(background, /case 'HUB_ENV_CONTROL'/);
  assert.match(background, /case 'HUB_ENV_BATCH'/);
  assert.match(background, /\/hub\/environments\/locate\?identifier=/);
  assert.match(background, /\/hub\/environments\/batch/);
  assert.match(background, /只能在 SHEIN 页面操作 HubStudio 环境/);
  assert.doesNotMatch(content, /data-role="hub-capability"/);
  assert.doesNotMatch(content, /data-role="hub-controls"/);
  assert.doesNotMatch(content, /runHubEnvironmentAction/);
  assert.doesNotMatch(content, /HubStudio 增强操作/);
  assert.doesNotMatch(contentCss, /\.xpa-hub-(?:capability|controls)/);
  assert.doesNotMatch(background + content + popupJs, /127\.0\.0\.1:6873/);
  assert.doesNotMatch(background + content + popupJs, /local-api-key/i);
});

test('keeps the in-page executor status consistent with the settings popup', () => {
  const connectedText = 'localhost 执行器已连接 · 自动配对完成';
  const disconnectedText = 'localhost 执行器未连接';
  assert.ok(content.includes(connectedText));
  assert.ok(content.includes(disconnectedText));
  assert.match(popupJs, /Xynigo 本地执行器已连接/);
  assert.match(popupJs, /未找到 Xynigo 本地执行器/);
  assert.match(content, /let connectionRevision = 0/);
  assert.match(content, /if \(revision !== connectionRevision\) return false/);
  assert.match(content, /function openPanel\(\)[^]*void refreshExecutorStatus\(\)/);
  assert.match(content, /type: 'LIST_TASKS'[^]*confirmExecutorConnected\(\)/);
  assert.match(content, /type: 'GET_RECIPIENT'[^]*confirmExecutorConnected\(\)/);
  assert.match(content, /EXECUTOR_CONNECTION_ERROR_CODES\.has\(code\)/);
  assert.match(content, /function setSourceSummary/);
});

test('builds an extension-only package including the evidence UI', () => {
  assert.match(buildScript, /purchase-details\.js/);
  assert.match(buildScript, /copy_extension_files/);
  assert.doesNotMatch(buildScript, /cp -- .*executor\/config\.json/);
});
