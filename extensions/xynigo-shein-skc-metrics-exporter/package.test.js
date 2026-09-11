'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = __dirname;
const repoRoot = path.resolve(extensionDir, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'shein-skc-metrics-exporter', 'shein_skc_metrics_exporter.user.js'),
    'utf8',
);
const buildScript = fs.readFileSync(path.join(extensionDir, 'build.sh'), 'utf8');
const installGuide = fs.readFileSync(path.join(extensionDir, 'INSTALL.md'), 'utf8');

test('builds a least-privilege read-only Manifest V3 package for Chrome and HubStudio', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.permissions, undefined);
    assert.equal(manifest.host_permissions, undefined);
    assert.deepEqual(manifest.content_scripts[0].matches, [
        'https://sellerhub.shein.com/*',
    ]);
    assert.deepEqual(manifest.content_scripts[0].js, ['vendor/jszip.min.js', 'content.js']);
    assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
    assert.equal(manifest.icons['128'], 'xynigo-mascot.png');
    assert.equal(manifest.background, undefined);
});

test('reuses the exact JSZip vendor copy shipped by the logistics assistant', () => {
    const vendor = fs.readFileSync(path.join(extensionDir, 'vendor', 'jszip.min.js'));
    const reference = fs.readFileSync(
        path.join(repoRoot, 'extensions', 'xynigo-dxm-logistics-assistant', 'vendor', 'jszip.min.js'),
    );
    assert.equal(vendor.equals(reference), true);
    assert.match(buildScript, /vendor\/jszip\.min\.js/);
});

test('keeps extension, userscript and install-guide versions synchronized', () => {
    const userscriptVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
    const installVersion = installGuide.match(/版本：`([^`]+)`/)?.[1];
    assert.equal(manifest.version, userscriptVersion);
    assert.equal(manifest.version, installVersion);
});

test('keeps the collector strictly read-only', () => {
    assert.match(userscript, /只读采集/);
    assert.match(userscript, /停止采集/);
    assert.match(userscript, /不发送任何写请求|不修改任何后台数据/);
    assert.doesNotMatch(userscript, /fetch\s*\(/);
    assert.doesNotMatch(userscript, /XMLHttpRequest/);
    assert.doesNotMatch(userscript, /GM_xmlhttpRequest/);
    assert.doesNotMatch(userscript, /@connect\b/);
    assert.doesNotMatch(userscript, /@grant\s+unsafeWindow/);
    assert.match(userscript, /@match\s+https:\/\/sellerhub\.shein\.com\/\*/);
    assert.doesNotMatch(userscript, /@match\s+https:\/\/sso\./);
});

test('sends the only simulated interaction to the next-page control', () => {
    const clickReceivers = [...new Set(
        [...userscript.matchAll(/([\w.]+)\.click\(\)/g)].map((match) => match[1]),
    )].sort();
    assert.deepEqual(clickReceivers, ['anchor', 'decision.control', 'state.elements.closeButton']);
    assert.match(userscript, /decision\.control\.click\(\)/, '自动翻页只允许点击“下一页”控件');
    assert.match(userscript, /anchor\.click\(\)/);
});

test('exports UTF-8 CSV and Excel with images for spreadsheet review', () => {
    assert.match(userscript, /\\uFEFF/);
    assert.match(userscript, /text\/csv;charset=utf-8/);
    assert.match(userscript, /shein-skc-metrics-/);
    assert.match(userscript, /buildXlsxBytes/);
    assert.match(userscript, /loadProductImages/);
    assert.match(userscript, /splitPriceCell/);
    assert.match(userscript, /导出 Excel（含商品图）/);
    assert.match(userscript, /spreadsheetml\.sheet/);
});

test('builds release ZIP and a stable unpacked directory', () => {
    assert.match(buildScript, /--dev\|--release\|--all/);
    assert.match(buildScript, /xynigo-shein-skc-metrics-exporter-dev/);
    assert.match(buildScript, /xynigo-shein-skc-metrics-exporter-v\$MANIFEST_VERSION/);
    assert.match(buildScript, /copy_extension_files "\$DEV_DIR"/);
    assert.match(installGuide, /npm run build:xynigo-skc-export:dev/);
});
