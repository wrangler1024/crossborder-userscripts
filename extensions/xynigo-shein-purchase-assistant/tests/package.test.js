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
const popupJs = fs.readFileSync(path.join(root, 'popup', 'popup.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'build.sh'), 'utf8');

test('is a Manifest V3 extension scoped to SHEIN Mexico and localhost', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '0.5.2');
  assert.match(manifest.name, /SHEIN 采购助手/);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, [
    'http://xynigo.localhost/*',
    'http://127.0.0.1/*',
    'http://localhost/*',
  ]);
  assert.match(background, /XYNIGO_EXECUTOR_BASE_URL = 'http:\/\/xynigo\.localhost:8766'/);
  assert.match(background, /PURCHASE_ASSISTANT_API_PREFIX = '\/api\/purchase-assistant\/v1'/);
  assert.match(background, /migrateLegacyExecutorBaseUrl/);
  assert.deepEqual(manifest.content_scripts[0].js, ['src/core.js', 'src/content.js']);
  assert.deepEqual(manifest.content_scripts[0].css, ['src/content.css']);
  assert.ok(manifest.content_scripts[0].matches.every((value) => value.includes('shein.com.mx')));
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
    matches: ['https://www.shein.com.mx/*', 'https://m.shein.com.mx/*'],
  }]);
  for (const size of [16, 32, 48, 128]) {
    const icon = fs.readFileSync(path.join(root, 'icons', `icon${size}.png`));
    assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});

test('delegates credentials and HubStudio control to the localhost executor', () => {
  assert.doesNotMatch(background + content + popupJs, /hubstudio-cli/i);
  assert.doesNotMatch(background + content + popupJs, /app[_ -]?secret/i);
  assert.doesNotMatch(background + content + popupJs, /local-api-key/i);
  assert.match(background, /PURCHASE_ASSISTANT_API_PREFIX/);
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
});

test('does not submit, save, continue checkout or fill CURP', () => {
  assert.doesNotMatch(content, /requestSubmit\s*\(/);
  assert.doesNotMatch(content, /\.submit\s*\(/);
  assert.doesNotMatch(content, /GUARDAR[^]{0,160}\.click\s*\(/i);
  assert.doesNotMatch(content, /CONTINUAR[^]{0,160}\.click\s*\(/i);
  assert.doesNotMatch(content, /fieldLabels:\s*\[['"]CURP/);
  assert.match(content, /插件不会生成、填写或保存证件标识/);
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
  assert.match(content, /\['Nombre（SHEIN）', values\.firstName\]/);
  assert.match(content, /\['Apellido（SHEIN）', values\.lastName\]/);
  assert.match(content, /\['收货人电话', recipient\.recipientPhone\]/);
  assert.match(content, /\['地址1', recipient\.addressLine1\]/);
  assert.match(content, /\['地址2', recipient\.addressLine2\]/);
  assert.match(content, /鼠标点击任一字段即复制当前显示值/);
  assert.match(content, /function clearRecipientCard/);
  assert.match(content, /async function loadRecipientPreview/);
  assert.match(content, /void loadRecipientPreview\(task\)/);
  assert.match(content, /selectedTask\.taskKey !== task\.taskKey/);
  assert.match(content, /仅当前页面临时显示/);
  assert.ok(
    content.indexOf('type: \'GET_RECIPIENT\'') < content.indexOf('renderRecipientCard(response.recipient, validation.values)'),
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
  assert.match(popupHtml, /会话自动配对/);
  assert.match(popupHtml, /v0\.5\.2/);
  assert.match(popupHtml, /\.\.\/icons\/icon48\.png/);
  assert.match(content, /CONTENT_VERSION = '0\.5\.2'/);
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
  assert.match(content, /Nombre\/Apellido 组合替换后回读不一致/);
  assert.match(content, /async function executeStepsSequentially/);
  assert.match(content, /正在成组替换 Nombre \/ Apellido/);
  assert.match(content, /getAttribute\('aria-invalid'\) === 'true'/);
  assert.match(content, /!field\.checkValidity\(\)/);
  assert.match(content, /async function retryMismatchedTextFields/);
  assert.match(content, /检测到文本字段被页面重置/);
  assert.match(content, /Promise\.all\(/);
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
    content.indexOf('正在最终核对邮编') < content.indexOf('正在填写街道地址'),
    '街道地址必须在邮编与州市联动稳定后填写',
  );
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

test('degrades HubStudio automation without blocking current-page fill', () => {
  assert.match(background, /requestExecutor\('\/capabilities'\)/);
  assert.match(background, /hubAutomationSupport\(health\)/);
  assert.match(background, /reasonCode: support\.reasonCode/);
  assert.match(background, /executor_feature_inconsistent/);
  assert.doesNotMatch(background, /capabilities\.error \|\| '接口不存在'/);
  assert.match(background, /local_access_disabled/);
  assert.match(background, /Xynigo 主执行器未运行/);
  assert.match(background, /若终端已显示运行，请开启团队偏好的“本地访问”/);
  assert.match(background, /hubStudio: capabilities\.ok/);
  assert.match(content, /data-role="hub-capability"/);
  assert.match(content, /HubStudio 自动化暂不可用，不影响当前页面填写/);
  assert.match(content, /const health = await refreshExecutorStatus\(\)/);
  assert.ok(
    content.indexOf("const health = await refreshExecutorStatus()")
      < content.indexOf("type: 'LIST_TASKS'"),
    '健康状态刷新不能替代或阻断任务接口的实际结果',
  );
  assert.doesNotMatch(content, /if \(!health\.hubStudio/);
  assert.match(popupHtml, /id="hubStatus"/);
  assert.match(popupJs, /HubStudio Local API 已就绪/);
  assert.match(contentCss, /\.xpa-hub-capability\[data-tone="warning"\]/);
  assert.match(background, /case 'HUB_ENV_LOCATE'/);
  assert.match(background, /case 'HUB_ENV_CONTROL'/);
  assert.match(background, /case 'HUB_ENV_BATCH'/);
  assert.match(background, /\/hub\/environments\/locate\?identifier=/);
  assert.match(background, /\/hub\/environments\/batch/);
  assert.match(background, /只能在 SHEIN 页面操作 HubStudio 环境/);
  assert.match(content, /data-role="hub-controls"/);
  assert.match(content, /runHubEnvironmentAction/);
  assert.doesNotMatch(background + content + popupJs, /127\.0\.0\.1:6873/);
  assert.doesNotMatch(background + content + popupJs, /local-api-key/i);
});

test('keeps the in-page executor status consistent with the settings popup', () => {
  const connectedText = 'localhost 执行器已连接 · 自动配对完成';
  const disconnectedText = 'localhost 执行器未连接';
  assert.ok(content.includes(connectedText));
  assert.ok(popupJs.includes(connectedText));
  assert.ok(content.includes(disconnectedText));
  assert.ok(popupJs.includes(disconnectedText));
  assert.match(content, /let connectionRevision = 0/);
  assert.match(content, /if \(revision !== connectionRevision\) return false/);
  assert.match(content, /function openPanel\(\)[^]*void refreshExecutorStatus\(\)/);
  assert.match(content, /type: 'LIST_TASKS'[^]*confirmExecutorConnected\(\)/);
  assert.match(content, /type: 'GET_RECIPIENT'[^]*confirmExecutorConnected\(\)/);
  assert.match(content, /EXECUTOR_CONNECTION_ERROR_CODES\.has\(code\)/);
});

test('builds one extension-only package for Chrome, Comet and HubStudio', () => {
  assert.match(buildScript, /--dev\|--release\|--all/);
  assert.match(buildScript, /xynigo-shein-purchase-assistant-dev/);
  assert.match(buildScript, /copy_extension_files "\$DEV_DIR"/);
  assert.match(buildScript, /PACKAGE_NAME="xynigo-shein-purchase-assistant-v\$VERSION"/);
  assert.doesNotMatch(buildScript, /executor\/config\.json/);
});
