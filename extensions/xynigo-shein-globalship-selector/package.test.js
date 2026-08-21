'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = __dirname;
const repoRoot = path.resolve(extensionDir, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(path.join(repoRoot, 'scripts', 'shein-globalship-selector', 'shein_globalship_selector.user.js'), 'utf8');
const background = fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8');
const excelJsLicense = fs.readFileSync(path.join(extensionDir, 'EXCELJS-LICENSE.txt'), 'utf8');
const buildScript = fs.readFileSync(path.join(extensionDir, 'build.sh'), 'utf8');

test('declares Manifest V3 support for US/MX list pages and clipboard-only browser permission', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'Shein Global Selector');
    assert.deepEqual(manifest.permissions, ['clipboardWrite']);
    assert.deepEqual(manifest.content_scripts[0].matches, [
        'https://us.shein.com/*',
        'https://shein.com.mx/*',
        'https://*.shein.com.mx/*',
    ]);
    assert.deepEqual(manifest.content_scripts[0].js, ['exceljs.min.js', 'content.js']);
    assert.equal(manifest.background.service_worker, 'background.js');
    assert.equal(manifest.icons['128'], 'xynigo-mascot.png');
    assert.deepEqual(manifest.web_accessible_resources, [{
        resources: ['xynigo-mascot.png'],
        matches: [
            'https://us.shein.com/*',
            'https://shein.com.mx/*',
            'https://*.shein.com.mx/*',
        ],
    }]);
});

test('keeps extension and userscript versions synchronized', () => {
    const userscriptVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
    assert.equal(manifest.version, userscriptVersion);
});

test('ships the ExcelJS MIT notice used by the bundled exporter', () => {
    assert.match(excelJsLicense, /ExcelJS is distributed under the MIT License/);
    assert.match(excelJsLicense, /Copyright \(c\) 2014-2019 Guyon Roche/);
});

test('limits extension image and anonymous fallback requests to explicit hosts and routes', () => {
    assert.match(background, /message\?\.type === 'XYNIGO_FETCH_IMAGE'/);
    assert.match(background, /message\?\.type === 'XYNIGO_FETCH_JSON'/);
    assert.match(background, /host\.endsWith\('\.ltwebstatic\.com'\)/);
    assert.match(background, /host === 'img\.shein\.com'/);
    assert.match(background, /host\.endsWith\('\.shein\.com\.mx'\)/);
    assert.match(background, /credentials: 'omit'/);
    assert.match(background, /MAX_IMAGE_BYTES/);
    assert.match(background, /url\.hostname === 'api\.sheinshuju\.com'/);
    assert.match(background, /url\.pathname === '\/api\/v1\/goods\/card'/);
    assert.match(background, /MAX_JSON_BYTES/);
    assert.ok(manifest.host_permissions.includes('https://api.sheinshuju.com/*'));
    assert.doesNotMatch(JSON.stringify(manifest.host_permissions), /<all_urls>/);
});

test('keeps the selector separate from the product variant helper', () => {
    assert.match(userscript, /XynigoSheinGlobalShipSelector/);
    assert.doesNotMatch(userscript, /XynigoSheinVariantHelper/);
});

test('supports a stable unpacked development directory for browser reloads', () => {
    assert.match(buildScript, /--dev\|--release\|--all/);
    assert.match(buildScript, /xynigo-shein-globalship-selector-dev/);
    assert.match(buildScript, /copy_extension_files "\$DEV_DIR"/);
});
