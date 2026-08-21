'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const selector = require('../shein_globalship_selector.user.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'shein_globalship_selector.user.js'), 'utf8');

test('recognizes only SHEIN US search-result routes', () => {
    assert.equal(selector.isSearchResultsUrl('https://us.shein.com/pdsearch/t%20shirts/'), true);
    assert.equal(selector.isSearchResultsUrl('https://us.shein.com/pdsearch/t%20shirts/?page=2'), true);
    assert.equal(selector.isSearchResultsUrl('https://us.shein.com/Example-p-518192161.html'), false);
    assert.equal(selector.isSearchResultsUrl('https://www.shein.com.mx/pdsearch/playeras/'), false);
});
test('extracts product ids without relying on SHEIN CSS class names', () => {
    assert.equal(
        selector.extractProductId('https://us.shein.com/Example-p-518192161.html?mallCode=1'),
        '518192161',
    );
    assert.equal(selector.extractProductId('/Another-p-433721545.html'), '433721545');
    assert.equal(selector.extractProductId('/pdsearch/example/'), '');
});

test('classifies only exact Local and QuickShip fulfillment labels', () => {
    assert.equal(selector.isLocalFulfillmentLabel(' Local '), true);
    assert.equal(selector.isLocalFulfillmentLabel('QuickShip'), true);
    assert.equal(selector.isLocalFulfillmentLabel('local style'), false);
    assert.equal(selector.isLocalFulfillmentLabel('Quick Shipping'), false);
    assert.equal(selector.hasLocalFulfillmentLabel(['New', 'QuickShip']), true);
    assert.equal(selector.hasLocalFulfillmentLabel(['New', 'Trending']), false);
});

test('recognizes the native QuickShip URL state', () => {
    assert.equal(selector.isQuickShipTaggedUrl(
        'https://us.shein.com/pdsearch/t-shirts/?tag_ids=quickship&tag_type=12',
    ), true);
    assert.equal(selector.isQuickShipTaggedUrl(
        'https://us.shein.com/pdsearch/t-shirts/?tag_ids=new,quickship',
    ), true);
    assert.equal(selector.isQuickShipTaggedUrl(
        'https://us.shein.com/pdsearch/t-shirts/?tag_ids=new',
    ), false);
});

test('declares an independent English selector with no privileged userscript grants', () => {
    assert.match(source, /^\/\/ @name\s+Xynigo SHEIN GlobalShip Selector$/m);
    assert.match(source, /^\/\/ @version\s+0\.1\.0$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/us\.shein\.com\/pdsearch\/\*$/m);
    assert.match(source, /^\/\/ @grant\s+none$/m);
    assert.match(source, /label\.textContent = 'GlobalShip'/);
    assert.match(source, /nativeTagName === 'li' \? 'li' : 'button'/);
    assert.match(source, /cardHasLocalFulfillmentBadge/);
    assert.match(source, /turnOffNativeQuickShip/);
    assert.doesNotMatch(source, /textContent\.includes\(['"]local/);
    assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|GM_xmlhttpRequest/);
});
