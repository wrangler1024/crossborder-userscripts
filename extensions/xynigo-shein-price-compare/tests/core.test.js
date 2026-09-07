'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core');
const url = 'https://shein.com.mx/x-p-123.html?goods_id=123&skucode=SKU1&mallCode=1#xv=1&op=100.00&c=MXN&p=Black&s=M';
const baseline = core.parseLink(url);
const snapshot = () => ({ ok: true, safeToUse: true, site: 'MX', product: { goodsId: '123', mallCode: '1' },
    selectedSkuCode: 'SKU1', variants: [{ skuCode: 'SKU1', isSelected: true, price: '110.00', currency: 'MXN', priceSource: 'rendered', stockText: '2' }] });

test('old links remain valid and new timestamp is retained', () => {
    assert.equal(baseline.ok, true);
    assert.equal(baseline.capturedAt, null);
    assert.equal(core.parseLink(url + '&pt=1788739200').capturedAt, 1788739200000);
    assert.equal(core.parseLink(url + '&pt=9999999999').capturedAt, null);
});

test('rejects ambiguous, missing, foreign, nonpositive and contradictory baselines', () => {
    for (const bad of [url.replace('op=100.00', 'op='), url.replace('op=100.00', 'op=-1'),
        url.replace('op=100.00', 'op=0'), url.replace('op=100.00', 'op=Infinity'),
        url.replace('op=100.00', 'op=1e2'), url + '&op=5', url.replace('xv=1', 'xv=2'),
        url.replace('c=MXN', 'c=USD'), url.replace('goods_id=123', 'goods_id=456'),
        url.replace('skucode=SKU1', 'skucode='), url.replace('shein.com.mx', 'shein.com.mx.evil.test'),
        url.replace('https:', 'http:'), url.replace('skucode=SKU1', 'skucode=SKU1&skucode=SKU2')]) {
        assert.equal(core.parseLink(bad).ok, false, bad);
    }
});

test('compares monetary values in integer cents without float equality mistakes', () => {
    const data = snapshot();
    assert.deepEqual([core.compare(baseline, data).code, core.compare(baseline, data).deltaCents, core.compare(baseline, data).percent], ['up', 1000, 10]);
    data.variants[0].price = '90';
    assert.equal(core.compare(baseline, data).code, 'down');
    data.variants[0].price = '100.00';
    assert.equal(core.compare(baseline, data).code, 'same');
    assert.equal(core.cents('0.29'), 29);
});

test('never compares a different SKU, product, mall, currency, stale SSR or schema price', () => {
    const changes = [
        (s) => { s.selectedSkuCode = 'SKU2'; },
        (s) => { s.product.goodsId = '999'; },
        (s) => { s.product.mallCode = '2'; },
        (s) => { s.site = 'US'; },
        (s) => { s.safeToUse = false; },
        (s) => { s.variants[0].currency = 'USD'; },
        (s) => { s.variants[0].priceSource = 'schema'; },
        (s) => { s.variants[0].price = ''; },
        (s) => { s.variants[0].stockText = '0'; },
        (s) => { s.variants = []; },
    ];
    for (const change of changes) {
        const data = snapshot(); change(data);
        assert.equal(core.compare(baseline, data).comparable, false);
    }
});

test('price changes and unavailable reads restart the entire stability window', () => {
    let state = core.settle(null, 'SKU1:100', 0);
    state = core.settle(state, 'SKU1:100', 2100);
    assert.equal(state.ready, false);
    state = core.settle(state, 'SKU1:110', 2200);
    assert.equal(state.ready, false);
    assert.equal(core.settle(state, 'SKU1:110', 4400).ready, true);
    state = core.settle(state, '', 4500);
    assert.equal(core.settle(state, 'SKU1:110', 9000).ready, false);
});
