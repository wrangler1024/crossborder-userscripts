'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const availability = require('../availability');
const core = require('../core');

test('classifies explicit Spanish, English and Chinese unavailability statements', () => {
    for (const [text, state] of [
        ['Lo sentimos, este artículo está agotado.', 'sold_out'],
        ['Sorry, this item is out of stock.', 'sold_out'],
        ['This product is currently unavailable.', 'unavailable'],
        ['Este producto no está disponible.', 'unavailable'],
        ['Este producto ha sido retirado.', 'delisted'],
        ['该商品已下架', 'delisted'],
        ['当前商品无法购买', 'unavailable'],
    ]) assert.equal(availability.classifyText(text)?.state, state, text);
});

test('generic loading, verification and isolated stock words are not product-level evidence', () => {
    for (const text of ['Loading', 'Verify you are human', 'Sign in', 'Sold out', 'Agotado', 'Page not found']) {
        assert.equal(availability.classifyText(text), null, text);
    }
    assert.equal(availability.classifyText('Sold out', true).state, 'sold_out');
});

test('explicit unsellable status takes priority even when product JSON and price baseline are missing', () => {
    assert.equal(core.compare({ ok: false }, { ok: false }, availability.classifyText('This product is no longer available.')).code, 'unavailable');
});
