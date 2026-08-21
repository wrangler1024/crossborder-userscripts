'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ExcelJS = require('exceljs');
const { JSDOM } = require('jsdom');

const selector = require('../shein_globalship_selector.user.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'shein_globalship_selector.user.js'), 'utf8');

function productFixture(url, options = {}) {
    const id = options.id || '518192161';
    const title = options.title || 'INAWLY casual letter print shirt';
    const local = options.local ? '<span class="badge">Local</span>' : '';
    const trends = options.trends ? '<span>Trends</span>' : '';
    const newArrivals = options.newArrivals ? '<span>New Arrivals</span>' : '';
    return new JSDOM(`<!doctype html><html><head><title>SHEIN listing</title></head><body>
      <h1>${options.heading || 'Women Tops'}</h1>
      <article class="product-card" data-is-single-sku="0">
        <a class="S-product-card__img-container" href="/${title.replace(/\s+/g, '-')}-p-${id}.html?mallCode=1" title="${title}"><img src="https://img.ltwebstatic.com/images3_pi/fixture.webp"></a>
        <a href="/${title.replace(/\s+/g, '-')}-p-${id}.html?src_identifier=test">${title}</a>
        ${local}${trends}${newArrivals}
        <span class="sale-price">${options.price || '$MXN320.00'}</span>
        <span class="sales">${options.sales || '3.6k+ vendidos'}</span>
        <span class="rating">${options.rating || '4.84'}</span>
        <span class="delivery-words-title__text">INAWLY</span>
      </article>
      <script type="application/json">${JSON.stringify({ goods: [{ goods_id: id, goods_sn: `SKU-${id}`, is_single_sku: 0, relatedColorNew: [{}, {}, {}], comment_num: 1268 }] })}</script>
    </body></html>`, { url, runScripts: 'outside-only' });
}

test('supports US and MX search, category, and collection listings only', () => {
    const supported = [
        'https://us.shein.com/pdsearch/t-shirts/?page=2',
        'https://www.shein.com.mx/pdsearch/playeras/',
        'https://us.shein.com/Women-Clothing-c-2030.html',
        'https://www.shein.com.mx/Women-Clothing-c-2030.html',
        'https://us.shein.com/new/Women-Clothing-sc-002209010.html',
        'https://www.shein.com.mx/trends/SHEIN-Trends-sc-00679470.html',
    ];
    supported.forEach((url) => assert.equal(selector.isSupportedListingUrl(url), true, url));
    const rejected = [
        'https://us.shein.com/Example-p-518192161.html',
        'https://www.shein.com.mx/Example-p-518192161.html',
        'https://us.shein.com/cart',
        'https://us.shein.com/user/orders',
        'https://example.com/Women-Clothing-c-2030.html',
    ];
    rejected.forEach((url) => assert.equal(selector.isSupportedListingUrl(url), false, url));
    assert.equal(selector.getPageType(supported[0]), 'Search');
    assert.equal(selector.getPageType(supported[2]), 'Category');
});

test('detects site currency and canonicalizes US/MX product links', () => {
    assert.deepEqual(selector.getSiteProfile('https://us.shein.com/pdsearch/tops/').code, 'US');
    assert.deepEqual(selector.getSiteProfile('https://www.shein.com.mx/pdsearch/tops/').currency, 'MXN');
    assert.equal(selector.extractProductId('/Another-p-433721545.html'), '433721545');
    assert.equal(
        selector.canonicalizeProductUrl('https://us.shein.com/Example-p-518192161.html?mallCode=1#detail'),
        'https://us.shein.com/Example-p-518192161.html',
    );
});

test('parses localized prices and sales lower bounds', () => {
    assert.equal(selector.parseNumber('$MXN1,234.50'), 1234.5);
    assert.equal(selector.parseNumber('US$ 12.99'), 12.99);
    assert.equal(selector.parseNumber('1.234,50'), 1234.5);
    assert.equal(selector.parseSales('3.6k+ sold'), 3600);
    assert.equal(selector.parseSales('2.1k+ vendidos'), 2100);
    assert.equal(selector.parseSales('800+ vendidos'), 800);
});

test('extracts listing fields from US search and MX category DOM fixtures', () => {
    const usDom = productFixture('https://us.shein.com/pdsearch/tops/?page=2', { price: '$12.50', sales: '1.8k+ sold', trends: true });
    const mxDom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', { local: true, newArrivals: true });
    const usProduct = selector.collectProducts(usDom.window.document, usDom.window.location.href)[0];
    const mxProduct = selector.collectProducts(mxDom.window.document, mxDom.window.location.href)[0];
    assert.equal(usProduct.site, 'US');
    assert.equal(usProduct.pageType, 'Search');
    assert.equal(usProduct.page, 2);
    assert.equal(usProduct.currency, 'USD');
    assert.equal(usProduct.sales, 1800);
    assert.equal(usProduct.trends, true);
    assert.equal(usProduct.multiSku, 'Yes');
    assert.equal(usProduct.styles, 3);
    assert.equal(usProduct.skuQty, '—');
    assert.equal(mxProduct.site, 'MX');
    assert.equal(mxProduct.pageType, 'Category');
    assert.equal(mxProduct.fulfillment, 'QuickShip');
    assert.equal(mxProduct.newArrivals, true);
});

test('reads SHEIN current star-icon and colorway DOM when JSON product data is absent', () => {
    const dom = new JSDOM(`<article class="product-card">
      <div class="product-card__color-set"><div class="product-card__color-item"></div><div class="product-card__color-item"></div><div class="product-card__color-count">6</div></div>
      <div class="star-icon-list">
        <i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_4_16px_1_honor"></i>
      </div>
      <div class="star-icon-list">
        <i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_5_16px_1_honor"></i><i class="sh_pc_sui_icon_star_4_16px_1_honor"></i>
      </div>
    </article>`);
    const card = dom.window.document.querySelector('.product-card');
    assert.equal(selector.ratingFromStars(card), 4.8);
    assert.equal(selector.styleCountFromCard(card), 6);
});

test('applies site-aware coupon price, fulfillment, sales, and rating filters', () => {
    const product = selector.collectProducts(
        productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html').window.document,
        'https://www.shein.com.mx/Women-Clothing-c-2030.html',
    )[0];
    const matched = selector.evaluateProduct(product, { globalShip: true, quickShip: false, salesMin: 1000, priceMin: 100, priceMax: null, couponOff: 65, ratingMin: 4.5 });
    assert.equal(matched.matched, true);
    assert.equal(matched.effectivePrice, 112);
    assert.equal(selector.evaluateProduct(product, { globalShip: true, salesMin: 4000, couponOff: 65, ratingMin: 4.5 }).matched, false);
});

test('clears every filter without restoring site defaults and validates configurable shortcuts', () => {
    assert.deepEqual(selector.clearedFilters('MX'), {
        globalShip: false,
        quickShip: false,
        trends: false,
        newArrivals: false,
        salesMin: null,
        priceMin: null,
        priceMax: null,
        couponOff: 0,
        ratingMin: null,
    });
    const shortcut = selector.normalizeShortcut({ code: 'KeyK', key: 'k', altKey: false, ctrlKey: true, metaKey: false, shiftKey: true });
    assert.equal(selector.shortcutLabel(shortcut), 'Ctrl + Shift + K');
    assert.equal(selector.matchesShortcut({ ...shortcut }, shortcut), true);
    assert.equal(selector.shortcutLabel(selector.normalizeShortcut({ code: 'KeyQ' }), true), 'Alt+L');
});

test('copies only clean canonical links, one per line and deduplicated', () => {
    const products = [
        { url: 'https://us.shein.com/One-p-1.html?mallCode=1' },
        { url: 'https://us.shein.com/One-p-1.html?src=test' },
        { url: 'https://us.shein.com/Two-p-2.html#detail' },
    ];
    assert.equal(selector.formatProductLinks(products), 'https://us.shein.com/One-p-1.html\nhttps://us.shein.com/Two-p-2.html');
});

test('builds Excel with the full field contract and optional embedded image', async () => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html');
    const product = selector.collectProducts(dom.window.document, dom.window.location.href)[0];
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+JmCbWQAAAABJRU5ErkJggg==';
    const workbook = await selector.createWorkbook([product], selector.normalizeFilters({}, 'MX'), {
        ExcelJS,
        includeImages: true,
        imageLoader: async () => ({ dataUrl: tinyPng, extension: 'png' }),
    });
    const sheet = workbook.getWorksheet('Selected Products');
    assert.equal(sheet.getRow(1).values.includes('Sold by'), true);
    assert.equal(sheet.getRow(1).values.includes('SKU Qty'), true);
    assert.equal(sheet.getRow(2).getCell(1).value, 'MX');
    assert.equal(workbook.model.media.length, 1);
    const buffer = await workbook.xlsx.writeBuffer();
    assert.ok(buffer.byteLength > 1000);
});

test('mounts the launcher and bottom workbench on a supported category page', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { price: '$12.50', sales: '2k+ sold' });
    let clipboard = '';
    dom.window.GM_setClipboard = (value) => { clipboard = value; };
    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const launcherHost = dom.window.document.getElementById('xynigo-shein-selector-launcher-host');
    const launcher = launcherHost?.shadowRoot?.getElementById('xynigo-shein-selector-launcher');
    const host = dom.window.document.getElementById('xynigo-shein-selector-host');
    assert.ok(launcher);
    assert.ok(host?.shadowRoot);
    assert.match(launcher.shadowRoot?.textContent || launcher.textContent, /SHEIN选品助手/);
    assert.match(host.shadowRoot.textContent, /Shein Global Selector/);
    assert.match(host.shadowRoot.textContent, /Price · USD/);
    assert.match(host.shadowRoot.textContent, /INAWLY casual letter print shirt/);
    assert.equal(host.shadowRoot.querySelector('[data-filter="ratingMin"]').getBoundingClientRect().width <= 50, true);
    host.shadowRoot.querySelector('[data-action="copy"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    assert.equal(clipboard, 'https://us.shein.com/INAWLY-casual-letter-print-shirt-p-518192161.html');
    host.shadowRoot.querySelector('[data-action="clear"]').click();
    assert.equal(host.shadowRoot.querySelector('[data-filter="globalShip"]').checked, false);
    assert.equal(host.shadowRoot.querySelector('[data-filter="salesMin"]').value, '');
    assert.equal(host.shadowRoot.querySelector('[data-filter="ratingMin"]').value, '');
    dom.window.close();
});

test('declares dual-site userscript access and pinned ExcelJS', () => {
    assert.match(source, /^\/\/ @name\s+Shein Global Selector$/m);
    assert.match(source, /^\/\/ @version\s+0\.2\.0$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/us\.shein\.com\/\*$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/\*\.shein\.com\.mx\/\*$/m);
    assert.match(source, /^\/\/ @require\s+https:\/\/cdn\.jsdelivr\.net\/npm\/exceljs@4\.4\.0\/dist\/exceljs\.min\.js$/m);
    assert.match(source, /GM_xmlhttpRequest/);
    assert.match(source, /当前页全部筛选结果/);
    assert.match(source, /data-action="clear"/);
});
