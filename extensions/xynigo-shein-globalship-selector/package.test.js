'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionDir = __dirname;
const repoRoot = path.resolve(extensionDir, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const userscript = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'shein-globalship-selector', 'shein_globalship_selector.user.js'),
    'utf8',
);

test('builds an independent least-privilege Manifest V3 selector', () => {
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'Xynigo SHEIN GlobalShip Selector');
    assert.deepEqual(manifest.permissions, []);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://us.shein.com/pdsearch/*']);
    assert.deepEqual(manifest.content_scripts[0].js, ['content.js']);
    assert.equal(manifest.icons['128'], 'xynigo-mascot.png');
});
test('keeps extension and userscript versions synchronized', () => {
    const userscriptVersion = userscript.match(/^\/\/ @version\s+(\S+)$/m)?.[1];
    assert.equal(manifest.version, userscriptVersion);
});

test('keeps GlobalShip Selector separate from the product variant helper', () => {
    assert.match(userscript, /XynigoSheinGlobalShipSelector/);
    assert.doesNotMatch(userscript, /XynigoSheinVariantHelper/);
    assert.doesNotMatch(userscript, /clipboard|GM_setClipboard/);
});
