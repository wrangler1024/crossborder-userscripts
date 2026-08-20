'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const helper = require('../shein_product_variant_helper.user.js');

const fixturePath = path.join(__dirname, 'fixtures', 'us-product-312187195.html');
const fixture = fs.readFileSync(fixturePath, 'utf8');
const userscriptPath = path.join(__dirname, '..', 'shein_product_variant_helper.user.js');
const userscript = fs.readFileSync(userscriptPath, 'utf8');

function fixtureScripts() {
    return [...fixture.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => {
        const attrs = match[1];
        return {
            id: attrs.match(/\bid="([^"]+)"/i)?.[1] || '',
            type: attrs.match(/\btype="([^"]+)"/i)?.[1] || '',
            content: match[2],
        };
    });
}

const productUrl = 'https://us.shein.com/Sanitized-Black-Jumpsuit-p-312187195.html?mallCode=1&main_attr=27_112';

test('extracts product, color and exact size SKU mapping from gbRawData', () => {
    const result = helper.parseProductPage({
        url: productUrl,
        hostname: 'us.shein.com',
        scripts: fixtureScripts(),
        selectedAttributes: [{ attrId: '87', attrValueId: '1009391', label: '11Y' }],
    });

    assert.equal(result.ok, true);
    assert.equal(result.safeToUse, true);
    assert.equal(result.code, 'OK');
    assert.equal(result.product.goodsId, '312187195');
    assert.equal(result.product.goodsSn, 'sk25092965620246395');
    assert.equal(result.product.productRelationId, 'k250520314858');
    assert.equal(result.product.color.value, 'Black');
    assert.equal(result.variants.length, 5);
    assert.deepEqual(result.variants.map((item) => item.size.value), ['8Y', '9Y', '10Y', '11Y', '12Y']);

    const selected = result.variants.find((item) => item.isSelected);
    assert.equal(selected.skuCode, 'I3c0auhysow1');
    assert.equal(selected.uniqueKey, 'US:312187195:I3c0auhysow1');
    assert.match(selected.exactUrl, /skucode=I3c0auhysow1/);
});

test('blocks copy safety when URL and SSR goods ids disagree', () => {
    const scripts = fixtureScripts();
    scripts[0] = {
        ...scripts[0],
        content: scripts[0].content.replaceAll('312187195', '97573275'),
    };

    const result = helper.parseProductPage({
        url: productUrl,
        hostname: 'us.shein.com',
        scripts,
        selectedAttributes: [{ attrId: '87', attrValueId: '1009391' }],
    });

    assert.equal(result.safeToUse, false);
    assert.equal(result.code, 'STALE_PRODUCT_DATA');
    assert.match(result.warnings.join('\n'), /商品 ID 不一致/);
});

test('recognizes US and Mexico sites and rejects non-product paths', () => {
    assert.equal(helper.detectSite('us.shein.com'), 'US');
    assert.equal(helper.detectSite('www.shein.com.mx'), 'MX');
    assert.equal(helper.extractUrlGoodsId(productUrl), '312187195');
    assert.equal(helper.isProductUrl('https://us.shein.com/super-deals'), false);
});

test('declares the metadata required for Tampermonkey online updates', () => {
    assert.match(userscript, /^\/\/ @version\s+0\.1\.0$/m);
    assert.match(userscript, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/.+\.user\.js$/m);
    assert.match(userscript, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/.+\.user\.js$/m);
});
