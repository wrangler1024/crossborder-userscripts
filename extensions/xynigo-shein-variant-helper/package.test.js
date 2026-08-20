'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = __dirname;
const repoRoot = path.resolve(extensionDir, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'shein-product-variant-helper', 'shein_product_variant_helper.user.js'),
    'utf8',
);

test('builds one Manifest V3 package for Chrome and HubStudio', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ['clipboardWrite']);
    assert.deepEqual(manifest.content_scripts[0].matches, [
        'https://us.shein.com/*',
        'https://shein.com.mx/*',
        'https://*.shein.com.mx/*',
    ]);
    assert.deepEqual(manifest.content_scripts[0].js, ['content.js']);
});

test('keeps extension and userscript versions synchronized', () => {
    const userscriptVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
    assert.equal(manifest.version, userscriptVersion);
});

test('provides browser-native fallbacks when Tampermonkey APIs are absent', () => {
    assert.match(userscript, /window\.localStorage\.getItem\(key\)/);
    assert.match(userscript, /window\.localStorage\.setItem\(key, JSON\.stringify\(value\)\)/);
    assert.match(userscript, /navigator\.clipboard\.writeText\(value\)/);
    assert.match(userscript, /document\.execCommand\('copy'\)/);
});
