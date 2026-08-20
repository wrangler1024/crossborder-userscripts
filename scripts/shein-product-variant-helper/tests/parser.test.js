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
    assert.equal(result.product.primarySpec.value, 'Black');
    assert.equal(result.product.secondarySpec.name, 'Size');
    assert.equal(result.product.hasSecondarySpec, true);
    assert.equal(result.variants.length, 5);
    assert.deepEqual(result.variants.map((item) => item.size.value), ['8Y', '9Y', '10Y', '11Y', '12Y']);
    assert.deepEqual(result.variants.map((item) => item.secondarySpec.value), ['8Y', '9Y', '10Y', '11Y', '12Y']);

    const selected = result.variants.find((item) => item.isSelected);
    assert.equal(selected.skuCode, 'I3c0auhysow1');
    assert.equal(selected.uniqueKey, 'US:312187195:I3c0auhysow1');
    assert.match(selected.exactUrl, /skucode=I3c0auhysow1/);
    assert.match(selected.exactUrl, /^https:\/\/us\.shein\.com\/x-p-312187195\.html\?/);
    assert.equal(new URL(selected.exactUrl).searchParams.get('main_attr'), '27_112');
    assert.equal(new URL(selected.exactUrl).searchParams.has('src_identifier'), false);
    assert.ok(selected.exactUrl.length < 150);
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
    assert.equal(helper.shouldAutoRefreshAfterColorSwitch(result), true);
    assert.equal(helper.productPageKey(productUrl), 'https://us.shein.com:312187195');
});

test('does not auto-refresh for a valid product or unrelated partial data', () => {
    const valid = helper.parseProductPage({
        url: productUrl,
        hostname: 'us.shein.com',
        scripts: fixtureScripts(),
        selectedAttributes: [],
    });

    assert.equal(helper.shouldAutoRefreshAfterColorSwitch(valid), false);
    assert.equal(helper.shouldAutoRefreshAfterColorSwitch({
        code: 'STALE_PRODUCT_DATA',
        consistency: { ids: { url: '312187195' } },
        product: { goodsId: '312187195' },
    }), false);
});

test('repairs stale precise-link identity while preserving SHEIN primary-route hint', () => {
    const staleUrl = 'https://shein.com.mx/Product-p-416148165.html?mallCode=1&goods_id=354424310&skucode=I5mqbu10xxh3my&main_attr=27_112';
    const result = {
        url: staleUrl,
        code: 'STALE_PRODUCT_DATA',
        consistency: {
            ids: { url: '416148165' },
            actualGoodsIds: ['416148165', '354424310'],
        },
        product: { goodsId: '416148165' },
    };

    assert.equal(helper.shouldAutoRefreshAfterPrimarySwitch(result), true);
    const repaired = new URL(helper.reconcilePreciseProductUrl(result));
    assert.equal(repaired.pathname, '/Product-p-416148165.html');
    assert.equal(repaired.searchParams.get('goods_id'), '416148165');
    assert.equal(repaired.searchParams.has('skucode'), false);
    assert.equal(repaired.searchParams.get('main_attr'), '27_112');
    assert.equal(repaired.searchParams.get('mallCode'), '1');
});

test('blocks copying sold-out or unknown-stock variants', () => {
    const safeResult = { safeToUse: true };
    const available = { price: '10.39', stockText: '2', availability: 'InStock' };
    const soldOut = { price: '10.39', stockText: '0', availability: 'InStock' };
    const schemaSoldOut = { price: '10.39', stockText: '', availability: 'OutOfStock' };
    const unknown = { price: '10.39', stockText: '', availability: '' };

    assert.equal(helper.getVariantStockState(available), 'in_stock');
    assert.equal(helper.getVariantStockState(soldOut), 'out_of_stock');
    assert.equal(helper.getVariantStockState(schemaSoldOut), 'out_of_stock');
    assert.equal(helper.getVariantStockState(unknown), 'unknown');
    assert.equal(helper.canCopyVariant(safeResult, available), true);
    assert.equal(helper.canCopyVariant(safeResult, soldOut), false);
    assert.equal(helper.canCopyVariant(safeResult, unknown), false);
});

test('normalizes generic spec labels for restoring selection after reload', () => {
    assert.equal(helper.normalizeSpecLabel('Pink (one size)'), 'pink');
    assert.equal(helper.normalizeSizeLabel('9Y (128-134 cm)'), '9y');
    assert.equal(helper.normalizeSizeLabel(' 12Y '), '12y');
    assert.match(userscript, /secondaryValueId:/);
    assert.match(userscript, /restoreSecondarySpecAfterRefresh/);
});

test('auto-selects the sole SKU and matches arbitrary secondary attributes', () => {
    const sole = [{ skuCode: 'SOLE-1', attributes: [] }];
    assert.equal(helper.selectedSkuFromPage('https://us.shein.com/Test-p-1.html', [], sole), 'SOLE-1');

    const variants = [
        { skuCode: 'PINK-1', attributes: [{ id: '901', valueId: 'pink', value: 'Pink' }] },
        { skuCode: 'BLUE-1', attributes: [{ id: '901', valueId: 'blue', value: 'Blue' }] },
    ];
    assert.equal(helper.selectedSkuFromPage(
        'https://us.shein.com/Test-p-1.html',
        [{ attrId: '901', attrValueId: 'blue', label: 'Blue' }],
        variants,
    ), 'BLUE-1');
    assert.equal(helper.selectedSkuFromPage(
        'https://us.shein.com/Test-p-1.html?skucode=BLUE-1',
        [],
        variants,
    ), '');
});

test('parses a Style Type single-SKU product without inventing a size', () => {
    const goodsId = '538465952';
    const url = `https://us.shein.com/Single-p-${goodsId}.html?mallCode=1`;
    const rawData = {
        canonicalInfo: { goods_id: goodsId },
        modules: {
            productInfo: {
                goods_id: goodsId,
                goods_sn: 'single-goods-sn',
                productRelationID: 'single-relation',
                selectedMallCode: '1',
            },
            saleAttr: {
                mainSaleAttribute: {
                    info: [{
                        goods_id: goodsId,
                        attr_id: '101',
                        attr_name: 'Style Type',
                        attr_value_id: '202',
                        attr_value: 'Black',
                    }],
                },
                multiLevelSaleAttribute: {
                    goods_id: goodsId,
                    goods_sn: 'single-goods-sn',
                    skc_sale_attr: [],
                    sku_list: [{
                        sku_code: 'SOLE-1',
                        sku_sale_attr: [],
                        mall_stock: [{ mall_code: '1', stock: 20 }],
                    }],
                },
            },
        },
    };
    const schema = {
        '@type': 'ProductGroup',
        url,
        productGroupID: 'single-relation',
        hasVariant: [{
            sku: 'SOLE-1',
            offers: {
                price: '15.96',
                priceCurrency: 'USD',
                availability: 'https://schema.org/InStock',
                url: `${url}&skucode=SOLE-1`,
            },
        }],
    };
    const result = helper.parseProductPage({
        url,
        hostname: 'us.shein.com',
        scripts: [
            { content: `window.gbRawData = ${JSON.stringify(rawData)};` },
            { id: 'goodsDetailSchema', type: 'application/ld+json', content: JSON.stringify(schema) },
        ],
        selectedAttributes: [],
    });

    assert.equal(result.safeToUse, true);
    assert.equal(result.product.primarySpec.name, 'Style Type');
    assert.equal(result.product.primarySpec.value, 'Black');
    assert.equal(result.product.hasSecondarySpec, false);
    assert.equal(result.selectedSkuCode, 'SOLE-1');
    assert.equal(result.variants[0].secondarySpec, null);
    assert.equal(result.variants[0].isSelected, true);
    assert.equal(helper.variantModelLabel(result, result.variants[0]), 'Black');
    assert.equal(helper.variantFullModelLabel(result, result.variants[0]), 'Black');
});

test('builds a compact direct SHEIN link while preserving precision parameters', () => {
    const compact = helper.makeExactUrl(
        'https://us.shein.com/a-very-long-product-title-p-428645064.html?mallCode=1&src_identifier=tracking',
        '428645064',
        'I9mn4kthaev5ws',
        { id: '101', valueId: '202' },
    );
    const parsed = new URL(compact);

    assert.equal(parsed.pathname, '/x-p-428645064.html');
    assert.equal(parsed.searchParams.get('goods_id'), '428645064');
    assert.equal(parsed.searchParams.get('skucode'), 'I9mn4kthaev5ws');
    assert.equal(parsed.searchParams.get('main_attr'), '101_202');
    assert.equal(parsed.searchParams.has('channelId'), false);
    assert.equal(parsed.searchParams.has('detailBusinessFrom'), false);
    assert.equal(parsed.searchParams.has('pageType'), false);
    assert.equal(parsed.searchParams.has('contentIds'), false);
    assert.equal(parsed.searchParams.has('src_identifier'), false);
    assert.ok(compact.length < 150);
});

test('calculates coupon prices and builds three-line Dianxiaomi order remarks', () => {
    assert.equal(helper.calculatePurchasePrice('10.39', 0), '10.39');
    assert.equal(helper.calculatePurchasePrice('10.39', 0.3), '7.27');
    assert.equal(helper.calculatePurchasePrice('10.39', 0.5), '5.20');
    assert.equal(helper.calculatePurchasePrice('10.39', 0.6), '4.16');
    assert.equal(helper.calculatePurchasePrice('10.39', 0.65), '3.64');

    const result = helper.parseProductPage({
        url: productUrl,
        hostname: 'us.shein.com',
        scripts: fixtureScripts(),
        selectedAttributes: [{ attrId: '87', attrValueId: '1009391', label: '11Y' }],
    });
    const selected = result.variants.find((item) => item.isSelected);

    assert.equal(helper.variantFullModelLabel(result, selected), 'Black/11Y');
    assert.equal(helper.buildOrderRemark(result, selected, 0.65), [
        selected.exactUrl,
        'Black / 11Y',
        '3.64',
    ].join('\n'));

    const singleResult = {
        url: 'https://us.shein.com/Single-p-538465952.html',
        product: { primarySpec: { name: 'Style Type', value: 'Black' } },
    };
    const singleVariant = {
        exactUrl: 'https://us.shein.com/Single-p-538465952.html?skucode=SOLE-1',
        primarySpec: { name: 'Style Type', value: 'Black' },
        secondarySpec: null,
        price: '15.96',
    };
    assert.equal(helper.variantModelLabel(singleResult, singleVariant), 'Black');
    assert.equal(helper.variantFullModelLabel(singleResult, singleVariant), 'Black');
    assert.equal(helper.buildOrderRemark(singleResult, singleVariant, 0.6), [
        'https://us.shein.com/Single-p-538465952.html?skucode=SOLE-1',
        'Black',
        '6.38',
    ].join('\n'));
});

test('uses the rendered MX price only for the currently selected variant', () => {
    assert.deepEqual(helper.parseRenderedPriceText('$MXN44.08'), { price: '44.08', currency: 'MXN' });
    assert.deepEqual(helper.parseRenderedPriceText('US$10.39'), { price: '10.39', currency: 'USD' });
    assert.deepEqual(helper.parseRenderedPriceText('$10.39', 'USD'), { price: '10.39', currency: 'USD' });
    assert.equal(helper.parseRenderedPriceText('Precio original $MXN164.00'), null);

    const result = helper.parseProductPage({
        url: productUrl,
        hostname: 'us.shein.com',
        scripts: fixtureScripts(),
        selectedAttributes: [{ attrId: '87', attrValueId: '1009391', label: '11Y' }],
        renderedPrice: { price: '44.08', currency: 'MXN' },
    });

    const selected = result.variants.find((item) => item.isSelected);
    const other = result.variants.find((item) => !item.isSelected);
    assert.equal(selected.price, '44.08');
    assert.equal(selected.currency, 'MXN');
    assert.equal(selected.priceSource, 'rendered');
    assert.equal(other.price, '');
    assert.equal(other.priceSource, 'unverified');
    assert.equal(helper.canCopyVariant(result, selected), true);
    assert.equal(helper.canCopyVariant(result, other), false);
    assert.equal(helper.buildOrderRemark(result, selected, 0.6).split('\n').at(-1), '17.63');
});

test('finishes adaptive price settling only after a stable sample window', () => {
    assert.equal(helper.renderedPriceKey({ price: '81.05', currency: 'MXN' }), 'MXN:81.05');
    assert.equal(helper.renderedPriceKey(null), '');
    assert.equal(helper.shouldFinishPriceSettlement({
        elapsedMs: 1000,
        stableForMs: 1000,
        hasSample: true,
    }), false);
    assert.equal(helper.shouldFinishPriceSettlement({
        elapsedMs: 1400,
        stableForMs: 900,
        hasSample: true,
    }), true);
    assert.equal(helper.shouldFinishPriceSettlement({
        elapsedMs: 2600,
        stableForMs: 300,
        hasSample: true,
    }), false);
    assert.equal(helper.shouldFinishPriceSettlement({ force: true }), true);
});

test('copies the operations sample as link, specification and price only', () => {
    const exactUrl = 'https://us.shein.com/x-p-455579396.html?mallCode=1&goods_id=455579396&skucode=I6mogk9rvox29x';
    assert.equal(helper.buildOrderRemark(
        { url: 'https://us.shein.com/x-p-455579396.html' },
        {
            exactUrl,
            primarySpec: { name: 'Style Type', value: '6 Items' },
            secondarySpec: null,
            price: '2.64',
        },
        0,
    ), `${exactUrl}\n6 Items\n2.64`);
});

test('recognizes US and Mexico sites and rejects non-product paths', () => {
    assert.equal(helper.detectSite('us.shein.com'), 'US');
    assert.equal(helper.detectSite('www.shein.com.mx'), 'MX');
    assert.equal(helper.extractUrlGoodsId(productUrl), '312187195');
    assert.equal(helper.isProductUrl('https://us.shein.com/super-deals'), false);

    const mexicoLink = helper.makeExactUrl(
        'https://www.shein.com.mx/Producto-p-354424310.html?mallCode=1&src_identifier=tracking',
        '354424310',
        'I5mqbu10xxh3my',
        { id: '27', valueId: '447' },
    );
    assert.equal(new URL(mexicoLink).origin, 'https://www.shein.com.mx');
    assert.equal(new URL(mexicoLink).pathname, '/x-p-354424310.html');
    assert.equal(new URL(mexicoLink).searchParams.get('skucode'), 'I5mqbu10xxh3my');
});

test('renders folded identification details by default', () => {
    assert.match(userscript, /createElement\('details'/);
    assert.match(userscript, /商品识别信息/);
    assert.doesNotMatch(userscript, /identification\.open\s*=\s*true/);
});

test('auto-selects the requested SKU instead of trusting the URL alone', () => {
    assert.match(userscript, /ensureRequestedSkuSelection/);
    assert.match(userscript, /已按精简链接定位型号/);
});

test('blocks copying while a switched variant price is still settling', () => {
    assert.match(userscript, /PRICE_SETTLE_DELAYS/);
    assert.match(userscript, /120, 250, 450, 700, 1000, 1400, 1900, 2600, 3400, 4200/);
    assert.match(userscript, /priceSettlingUntil/);
    assert.match(userscript, /shouldFinishPriceSettlement/);
    assert.match(userscript, /页面售价更新中，稳定后将自动重新读取/);
    assert.match(userscript, /copy\.disabled = priceSettling \|\| !canCopyVariant/);
});

test('checks switched product identity even when the panel is closed', () => {
    assert.match(userscript, /if \(state\.open\) \{\s+render\(\);\s+return;\s+\}/);
    assert.match(userscript, /const result = parseCurrentPage\(\);\s+rememberSelectedSecondarySpec\(result\);\s+automaticRefreshState\(result\);/);
});

test('renders compact stock-only variant cards without secondary copy actions', () => {
    assert.match(userscript, /grid-template-columns:repeat\(auto-fit,minmax\(96px,1fr\)\)/);
    assert.match(userscript, /采购备注仅支持页面当前选中型号/);
    assert.doesNotMatch(userscript, /className: 'xv-copy'/);
    assert.doesNotMatch(userscript, /text: '复制备注'/);
});

test('supports a configurable guarded shortcut for copying the current variant', () => {
    const defaultShortcut = helper.normalizeShortcut(null);
    assert.deepEqual(defaultShortcut, {
        code: 'KeyC',
        ctrlKey: false,
        altKey: true,
        shiftKey: true,
        metaKey: false,
    });
    assert.equal(helper.formatShortcut(defaultShortcut), 'Alt + Shift + C');
    assert.equal(helper.shortcutMatches({
        code: 'KeyC',
        ctrlKey: false,
        altKey: true,
        shiftKey: true,
        metaKey: false,
    }, defaultShortcut), true);
    assert.equal(helper.shortcutMatches({
        code: 'KeyC',
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
        metaKey: false,
    }, defaultShortcut), false);
    assert.deepEqual(helper.shortcutFromKeyboardEvent({ code: 'F8' }), {
        code: 'F8',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
    });
    assert.equal(helper.shortcutFromKeyboardEvent({ code: 'KeyX' }), null);
    assert.match(userscript, /快捷键设置/);
    assert.match(userscript, /copyCurrentVariant/);
});

test('uses the approved Xynigo mascot in the floating button', () => {
    assert.match(userscript, /^\/\/ @resource\s+XYNIGO_MASCOT https:\/\/raw\.githubusercontent\.com\/.+xynigo-mascot\.png$/m);
    assert.match(userscript, /^\/\/ @grant\s+GM_getResourceURL$/m);
    assert.match(userscript, /className: 'xv-mascot'/);
    assert.match(userscript, /width:46px; height:46px/);
});

test('declares the metadata required for Tampermonkey online updates', () => {
    assert.match(userscript, /^\/\/ @version\s+0\.1\.15$/m);
    assert.match(userscript, /^\/\/ @updateURL\s+https:\/\/raw\.githubusercontent\.com\/.+\.user\.js$/m);
    assert.match(userscript, /^\/\/ @downloadURL\s+https:\/\/raw\.githubusercontent\.com\/.+\.user\.js$/m);
});
