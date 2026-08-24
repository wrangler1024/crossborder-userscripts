'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = __dirname;
const repoRoot = path.resolve(extensionDir, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'shein-batch-shelf', 'shein_removed_shelves.user.js'),
    'utf8',
);
const buildScript = fs.readFileSync(path.join(extensionDir, 'build.sh'), 'utf8');
const installGuide = fs.readFileSync(path.join(extensionDir, 'INSTALL.md'), 'utf8');

test('builds a least-privilege Manifest V3 package for Chrome and HubStudio', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.permissions, undefined);
    assert.equal(manifest.host_permissions, undefined);
    assert.deepEqual(manifest.content_scripts[0].matches, [
        'https://sellerhub.shein.com/*',
        'https://sso.geiwohuo.com/*',
    ]);
    assert.deepEqual(manifest.content_scripts[0].js, ['content.js']);
    assert.equal(manifest.content_scripts[0].run_at, 'document_idle');
    assert.equal(manifest.icons['128'], 'xynigo-mascot.png');
});

test('keeps extension, userscript and install-guide versions synchronized', () => {
    const userscriptVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
    const installVersion = installGuide.match(/版本：`([^`]+)`/)?.[1];
    assert.equal(manifest.version, userscriptVersion);
    assert.equal(manifest.version, installVersion);
});

test('retains the write-safety controls in the packaged content script', () => {
    assert.match(userscript, /目标站点（默认不选）/);
    assert.match(userscript, /confirmationText: '确认上架'/);
    assert.match(userscript, /confirmationText: '确认下架'/);
    assert.match(userscript, /API 已受理/);
    assert.match(userscript, /停止后续批次/);
    assert.doesNotMatch(userscript, /@grant\s+unsafeWindow/);
});

test('uses only current-origin SHEIN API paths at runtime', () => {
    assert.match(userscript, /['`]\/spmp-api-prefix\/spmp\/product\/list\?/);
    assert.match(userscript, /['`]\/spmp-api-prefix\/spmp\/product\/batch_operate_Shelf_status['`]/);
    const runtimeUrls = [...userscript.matchAll(/fetchJsonWithRetry\(\s*([`'"])(.*?)\1/g)].map((match) => match[2]);
    assert.equal(runtimeUrls.length, 2);
    assert.equal(runtimeUrls.every((url) => url.startsWith('/spmp-api-prefix/')), true);
});

test('builds release ZIP and a stable unpacked directory', () => {
    assert.match(buildScript, /--dev\|--release\|--all/);
    assert.match(buildScript, /xynigo-shein-batch-shelf-dev/);
    assert.match(buildScript, /xynigo-shein-batch-shelf-v\$MANIFEST_VERSION/);
    assert.match(buildScript, /copy_extension_files "\$DEV_DIR"/);
});
