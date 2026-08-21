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
    const reviews = options.reviews ?? 1268;
    const singleSku = options.singleSku ?? 0;
    const relatedColorNew = Array.from({ length: options.relatedColorCount ?? 0 }, (_, index) => ({ goods_id: `${id}-${index + 1}`, attr_name: 'Color' }));
    const local = options.local ? '<span class="badge">Local</span>' : '';
    const trends = options.trends ? '<span data-trend-label="trend_shop_code_4409279408_Easowa Curve"></span>' : '';
    const newArrivals = options.newArrivals ? '<span>New Arrivals</span>' : '';
    const imageHtml = options.imageHtml || '<img src="https://img.ltwebstatic.com/images3_pi/fixture.webp">';
    const sellerHtml = options.seller === '' ? '' : `<span class="delivery-words-title__text">${options.seller || 'INAWLY'}</span>`;
    const storeCodeAttribute = options.storeCode ? ` data-store_code="${options.storeCode}"` : '';
    return new JSDOM(`<!doctype html><html><head><title>SHEIN listing</title></head><body>
      <h1>${options.heading || 'Women Tops'}</h1>
      <section aria-label="LISTA DE PRODUCTOS">
        <div class="product-list-v2__container">
          <article class="product-card" data-is-single-sku="${singleSku}">
            <a class="S-product-card__img-container" href="/${title.replace(/\s+/g, '-')}-p-${id}.html?mallCode=1" title="${title}"${storeCodeAttribute}>${imageHtml}</a>
            <a href="/${title.replace(/\s+/g, '-')}-p-${id}.html?src_identifier=test">${title}</a>
            ${local}${trends}${newArrivals}
            <span class="sale-price">${options.price || '$MXN320.00'}</span>
            <span class="sales">${options.sales || '3.6k+ vendidos'}</span>
            <span class="rating">${options.rating || '4.84'}</span>
            <span class="comment-count">${reviews}</span>
            ${sellerHtml}
          </article>
        </div>
      </section>
      <script type="application/json">${JSON.stringify({ goods: [{ goods_id: id, goods_sn: `SKU-${id}`, is_single_sku: singleSku, relatedColorNew, comment_num: reviews, onSaleTime: '2024-01-01T00:00:00Z', ...(options.productData || {}) }] })}</script>
      ${options.pagination ? '<nav class="sui-pagination"><button type="button" aria-label="Previous page">Previous page</button><button type="button" aria-label="Page 1">1</button><button type="button" aria-label="Page 2">2</button><button type="button" aria-label="Next page">Next page</button></nav>' : ''}
    </body></html>`, { url, runScripts: 'outside-only' });
}

function simpleProductCard(id, title = `Formal product ${id}`) {
    return `<article class="product-card">
      <a class="S-product-card__img-container" href="/${title.replace(/\s+/g, '-')}-p-${id}.html" title="${title}"><img data-src="https://img.ltwebstatic.com/images3_pi/${id}.webp"></a>
      <a href="/${title.replace(/\s+/g, '-')}-p-${id}.html">${title}</a>
      <span class="sale-price">$20.00</span><span class="sales">100 sold</span><span class="rating">4.5</span>
    </article>`;
}

function listingBoundaryFixture(url, options = {}) {
    const officialCount = Number(options.officialCount || 0);
    const recommendCount = Number(options.recommendCount || 0);
    const official = Array.from({ length: officialCount }, (_, index) => simpleProductCard(String(800000000 + index), `Formal ${index + 1}`)).join('');
    const recommended = Array.from({ length: recommendCount }, (_, index) => simpleProductCard(String(900000000 + index), `Recommended ${index + 1}`)).join('');
    const formalGrid = options.includeFormalGrid === false ? '' : `<section aria-label="LISTA DE PRODUCTOS"><div class="product-list-v2__container">${official}</div></section>`;
    const empty = options.empty ? '<div class="SelectClassEmpty">No hay coincidencias</div>' : '';
    const risk = options.risk ? '<div class="crawler-block">Security verification · verify you are human</div>' : '';
    const recommend = recommendCount ? `<section class="SelectClassEmptyRecommend" data-component="PRODUCT_RECOMMEND_COMPONENT"><h2>También podría gustarte</h2><div class="product-list-v2__container">${recommended}</div></section>` : '';
    return new JSDOM(`<!doctype html><html><head><title>SHEIN listing</title></head><body><h1>Women</h1>${risk}${empty}${formalGrid}${recommend}</body></html>`, {
        url,
        runScripts: 'outside-only',
    });
}

function accumulatedProduct(id, extra = {}) {
    return {
        goodsId: String(id),
        site: 'MX',
        title: `Product ${id}`,
        url: `https://www.shein.com.mx/Product-${id}-p-${id}.html`,
        currentPrice: 200,
        originalPrice: 200,
        sales: 100,
        rating: 4.5,
        fulfillment: 'GlobalShip',
        trends: false,
        newArrivals: false,
        specConfirmed: true,
        specType: 'Single',
        ...extra,
    };
}

function installExtensionStorage(dom, store = new Map()) {
    const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    dom.window.chrome = {
        runtime: {
            getURL(resource) { return `chrome-extension://xynigo-test/${resource}`; },
        },
        storage: {
            local: {
                get(key, callback) {
                    const result = { [key]: clone(store.get(key)) };
                    dom.window.queueMicrotask(() => callback?.(result));
                },
                set(values, callback) {
                    Object.entries(values).forEach(([key, value]) => store.set(key, clone(value)));
                    dom.window.queueMicrotask(() => callback?.());
                },
            },
        },
    };
    return store;
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

test('keeps the complete cumulative toolbar status visible on wide screens', () => {
    assert.match(source, /\.brand\{min-width:0;max-width:none\}/);
    assert.match(source, /\.brand small\{min-width:max-content;overflow:visible;white-space:nowrap\}/);
    assert.match(source, /\.brand-sub,\.status\{flex:0 0 auto\}/);
    assert.doesNotMatch(source, /\.brand\{min-width:0;max-width:330px\}/);
});

test('collects 120 formal products and excludes 9 delayed recommendation products', () => {
    const dom = listingBoundaryFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html?page=4', { officialCount: 120, recommendCount: 9 });
    const snapshot = selector.collectListingSnapshot(dom.window.document, dom.window.location.href);
    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.products.length, 120);
    assert.equal(snapshot.products.some((product) => product.title.startsWith('Recommended')), false);
    assert.match(snapshot.grid.className, /product-list-v2__container/);
});

test('returns empty with zero formal products even when empty-result recommendations contain 9 products', () => {
    const dom = listingBoundaryFixture('https://www.shein.com.mx/pdsearch/no-match/', { includeFormalGrid: false, officialCount: 0, recommendCount: 9, empty: true });
    const snapshot = selector.collectListingSnapshot(dom.window.document, dom.window.location.href);
    assert.equal(snapshot.status, 'empty');
    assert.equal(snapshot.products.length, 0);
    assert.equal(snapshot.grid, null);
});

test('returns risk with zero products when a crawler block is shown beside recommendations', () => {
    const dom = listingBoundaryFixture('https://us.shein.com/Women-Clothing-c-2030.html?page=2', { includeFormalGrid: false, recommendCount: 9, risk: true });
    const snapshot = selector.collectListingSnapshot(dom.window.document, dom.window.location.href);
    assert.equal(snapshot.status, 'risk');
    assert.equal(snapshot.products.length, 0);
    assert.match(snapshot.message, /风险验证/);
});

test('applies filters to the current formal grid without touching recommendation cards', () => {
    const dom = listingBoundaryFixture('https://www.shein.com.mx/pdsearch/playeras/', { officialCount: 2, recommendCount: 1 });
    const products = selector.collectProducts(dom.window.document, dom.window.location.href);
    products[0].sales = 5000;
    products[1].sales = 100;
    const result = selector.applyPageProductFilter(dom.window.document, dom.window.location.href, {
        globalShip: false,
        salesMin: 1000,
    }, products);
    const formalCards = selector.collectProductCards(selector.findOfficialProductGrid(dom.window.document));
    const recommendationCard = dom.window.document.querySelector('.SelectClassEmptyRecommend .product-card');
    assert.deepEqual({ total: result.total, matched: result.matched, hidden: result.hidden }, { total: 2, matched: 1, hidden: 1 });
    assert.equal(formalCards.filter((card) => card.hasAttribute('data-xynigo-shein-selector-filtered-out')).length, 1);
    assert.equal(recommendationCard.hasAttribute('data-xynigo-shein-selector-filtered-out'), false);
    assert.match(dom.window.document.getElementById('xynigo-shein-selector-page-filter-style').textContent, /display:none!important/);
    selector.clearPageProductFilter(dom.window.document);
    assert.equal(formalCards.some((card) => card.hasAttribute('data-xynigo-shein-selector-filtered-out')), false);
    dom.window.close();
});

test('recognizes formal grids on MX and US search and category pages', () => {
    [
        'https://www.shein.com.mx/pdsearch/vestidos/',
        'https://www.shein.com.mx/Women-Clothing-c-2030.html',
        'https://us.shein.com/pdsearch/dresses/',
        'https://us.shein.com/Women-Clothing-c-2030.html',
    ].forEach((url) => {
        const dom = listingBoundaryFixture(url, { officialCount: 2, recommendCount: 2 });
        const snapshot = selector.collectListingSnapshot(dom.window.document, dom.window.location.href);
        assert.equal(snapshot.status, 'ready', url);
        assert.equal(snapshot.products.length, 2, url);
    });
});

test('keeps page-only navigation in one context but resets for search, category, site, or official filters', () => {
    const base = listingBoundaryFixture('https://www.shein.com.mx/pdsearch/vestidos/?page=1', { officialCount: 1 });
    const pageTwo = selector.listingContextKey('https://www.shein.com.mx/pdsearch/vestidos/?page=2', base.window.document);
    const pageOne = selector.listingContextKey(base.window.location.href, base.window.document);
    assert.equal(pageOne, pageTwo);
    assert.notEqual(pageOne, selector.listingContextKey('https://www.shein.com.mx/pdsearch/playeras/?page=1', base.window.document));
    assert.notEqual(pageOne, selector.listingContextKey('https://www.shein.com.mx/pdsearch/vestidos/?color=black', base.window.document));
    assert.notEqual(pageOne, selector.listingContextKey('https://www.shein.com.mx/Women-Clothing-c-2030.html', base.window.document));
    assert.notEqual(pageOne, selector.listingContextKey('https://us.shein.com/pdsearch/vestidos/', base.window.document));
});

test('accumulates normal pages with the latest page group first', () => {
    let groups = new Map();
    let order = [];
    ({ groups, order } = selector.updatePageAccumulator(groups, order, { page: 1, status: 'ready', products: [accumulatedProduct('101')], message: '' }));
    const result = selector.updatePageAccumulator(groups, order, { page: 2, status: 'ready', products: [accumulatedProduct('201')], message: '' });
    assert.deepEqual(result.order, [2, 1]);
    assert.deepEqual(result.products.map((product) => product.goodsId), ['201', '101']);
});

test('returning to an earlier page replaces it and prunes later page groups', () => {
    let result = selector.updatePageAccumulator(new Map(), [], { page: 1, status: 'ready', products: [accumulatedProduct('101')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 2, status: 'ready', products: [accumulatedProduct('201')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 1, status: 'ready', products: [accumulatedProduct('102')], message: '' });
    assert.deepEqual(result.order, [1]);
    assert.deepEqual(result.products.map((product) => product.goodsId), ['102']);
    assert.equal(result.groups.size, 1);
});

test('deduplicates the same goodsId across accumulated page groups in newest-page order', () => {
    let result = selector.updatePageAccumulator(new Map(), [], { page: 1, status: 'ready', products: [accumulatedProduct('same'), accumulatedProduct('101')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 2, status: 'ready', products: [accumulatedProduct('same', { title: 'newest copy' }), accumulatedProduct('201')], message: '' });
    assert.deepEqual(result.products.map((product) => product.goodsId), ['same', '201', '101']);
    assert.equal(result.products[0].title, 'newest copy');
    assert.equal(result.products[0].sourcePage, 2);
});

test('rescanning the current page replaces only that page and preserves other accumulated pages', () => {
    let result = selector.updatePageAccumulator(new Map(), [], { page: 1, status: 'ready', products: [accumulatedProduct('101')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 2, status: 'ready', products: [accumulatedProduct('201')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 2, status: 'ready', products: [accumulatedProduct('202')], message: '' });
    assert.deepEqual(result.products.map((product) => product.goodsId), ['202', '101']);
    assert.equal(result.groups.get(1).products[0].goodsId, '101');
});

test('risk and timeout page states preserve a previously successful page snapshot', () => {
    let result = selector.updatePageAccumulator(new Map(), [], { page: 4, status: 'ready', products: [accumulatedProduct('401')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 4, status: 'risk', products: [], message: '页面需要风险验证' });
    assert.equal(result.group.status, 'risk');
    assert.equal(result.group.products.length, 1);
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 5, status: 'timeout', products: [], message: '页面加载超时' });
    assert.deepEqual(result.products.map((product) => product.goodsId), ['401']);
    assert.equal(result.groups.get(5).products.length, 0);
});

test('risk on an earlier page does not prune later successful page groups', () => {
    let result = selector.updatePageAccumulator(new Map(), [], { page: 1, status: 'ready', products: [accumulatedProduct('101')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 2, status: 'ready', products: [accumulatedProduct('201')], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 1, status: 'risk', products: [], message: '页面需要风险验证' });
    assert.deepEqual(result.order, [1, 2]);
    assert.deepEqual(result.products.map((product) => product.goodsId), ['101', '201']);
    assert.equal(result.groups.get(2).status, 'ready');
});

test('filters and link/export inputs operate on the deduplicated accumulated pool in page-group order', () => {
    let result = selector.updatePageAccumulator(new Map(), [], { page: 1, status: 'ready', products: [accumulatedProduct('101', { sales: 50 })], message: '' });
    result = selector.updatePageAccumulator(result.groups, result.order, { page: 2, status: 'ready', products: [accumulatedProduct('201', { sales: 500 }), accumulatedProduct('202', { sales: 700 })], message: '' });
    const filters = { ...selector.clearedFilters('MX'), salesMin: 100 };
    const matched = result.products.filter((product) => selector.evaluateProduct(product, filters).matched);
    assert.deepEqual(matched.map((product) => product.goodsId), ['201', '202']);
    assert.equal(selector.formatProductLinks(matched), `${matched[0].url}\n${matched[1].url}`);
    const selected = new Map([['101', result.products.find((product) => product.goodsId === '101')], ['202', matched[1]]]);
    assert.deepEqual(Array.from(selected.values()).map((product) => selector.productToExportRow(product, filters)[5]), ['101', '202']);
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

test('prefers the SHEIN official current page over a stale URL page parameter', () => {
    const dom = new JSDOM(`
      <nav class="sui-pagination" aria-label="Pagination Navigation">
        <button aria-label="Previous page" disabled></button>
        <button aria-label="Page 1" aria-current="page">1</button>
        <button aria-label="Page 2">2</button>
        <button aria-label="Next page"></button>
      </nav>
    `);
    const url = 'https://www.shein.com.mx/pdsearch/vestidos/?page=3';
    assert.equal(selector.getPageNumber(url, dom.window.document), 1);
    dom.window.document.querySelector('[aria-label="Previous page"]').disabled = false;
    dom.window.document.querySelector('[aria-label="Page 1"]').removeAttribute('aria-current');
    dom.window.document.querySelector('[aria-label="Page 2"]').setAttribute('aria-current', 'page');
    assert.equal(selector.getPageNumber(url, dom.window.document), 2);
    assert.equal(selector.getPageNumber(url, null), 3);
});

test('booting on official page 1 prunes stale higher-page session groups and their selections', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html?page=5', { pagination: true, singleSku: 1 });
    const previous = dom.window.document.querySelector('[aria-label="Previous page"]');
    const pageOne = dom.window.document.querySelector('[aria-label="Page 1"]');
    previous.disabled = true;
    pageOne.setAttribute('aria-current', 'page');
    const contextKey = selector.listingContextKey(dom.window.location.href, dom.window.document);
    const currentProduct = selector.collectProducts(dom.window.document, dom.window.location.href)[0];
    const savedGroup = (page, product) => ({
        page,
        status: 'ready',
        message: '',
        products: [product],
        formalCount: 1,
        hasSuccessfulSnapshot: true,
        updatedAt: '2026-08-21T00:00:00.000Z',
    });
    dom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-US', JSON.stringify({
        schemaVersion: 5,
        filters: selector.clearedFilters('US'),
        open: true,
        contextKey,
        pageOrder: [1, 5, 3, 2],
        pageGroups: [
            savedGroup(1, currentProduct),
            savedGroup(5, accumulatedProduct('501', { site: 'US', url: 'https://us.shein.com/Product-501-p-501.html' })),
            savedGroup(3, accumulatedProduct('301', { site: 'US', url: 'https://us.shein.com/Product-301-p-301.html' })),
            savedGroup(2, accumulatedProduct('201', { site: 'US', url: 'https://us.shein.com/Product-201-p-201.html' })),
        ],
        selectedIds: ['501'],
    }));

    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 40));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    assert.match(shadow.querySelector('.status').textContent, /第 1 页 · 当前 1 · 累计 1 页 \/ 1 · 当前命中 1 · 累计命中 1/);
    assert.deepEqual([...shadow.querySelectorAll('.page-divider')].map((row) => row.dataset.status), ['ready']);
    assert.match(shadow.querySelector('.page-divider').textContent, /第 1 页/);
    assert.doesNotMatch(shadow.querySelector('tbody').textContent, /第 [235] 页/);
    assert.equal(shadow.querySelector('.selected-count').textContent, '0');
    const saved = JSON.parse(dom.window.sessionStorage.getItem('xynigo-shein-selector-session-v2-US'));
    assert.equal(saved.schemaVersion, 6);
    assert.equal(saved.compact, false);
    assert.deepEqual(saved.pageOrder, [1]);
    assert.deepEqual(saved.selectedIds, []);
    dom.window.close();
});

test('parses localized prices and sales lower bounds', () => {
    assert.equal(selector.parseNumber('$MXN1,234.50'), 1234.5);
    assert.equal(selector.parseNumber('US$ 12.99'), 12.99);
    assert.equal(selector.parseNumber('1.234,50'), 1234.5);
    assert.equal(selector.parseSales('3.6k+ sold'), 3600);
    assert.equal(selector.parseSales('2.1k+ vendidos'), 2100);
    assert.equal(selector.parseSales('800+ vendidos'), 800);
    assert.equal(selector.parseSales('0 sold'), 0);
    assert.equal(selector.formatCount(null), '—');
    assert.equal(selector.formatCount(0), '0');
});

test('reads nested SHEIN starComment data and keeps store_code for fallback lookup', () => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', {
        productData: {
            store_code: '8215335601',
            comment_num: null,
            comment_rank_average: null,
            rankInfo: {
                pcStandardView: {
                    sellingPointUniversalLabels: [{
                        starComment: { comment_num: 892, comment_rank_average: 4.61 },
                    }],
                },
            },
        },
    });
    const product = selector.collectProducts(dom.window.document, dom.window.location.href)[0];
    assert.equal(product.storeCode, '8215335601');
    assert.equal(product.rating, 4.61);
    assert.equal(product.reviews, 892);
    assert.equal(product.ratingSource, 'SHEIN');
    assert.equal(product.reviewsSource, 'SHEIN');
});

test('builds and parses anonymous Jijiyun fallback while only upgrading a zero page sale with a positive fallback', async () => {
    const product = {
        site: 'MX', goodsId: '544083340', storeCode: '1294342101', seller: '—', sales: null, rating: null, reviews: null, onSaleDate: null,
    };
    const url = new URL(selector.jijiyunCardUrl(product));
    assert.equal(url.origin, 'https://api.sheinshuju.com');
    assert.equal(url.pathname, '/api/v1/goods/card');
    assert.equal(url.searchParams.get('goodsId'), '544083340');
    assert.equal(url.searchParams.get('mallId'), '1294342101');
    assert.equal(url.searchParams.get('siteUID'), 'mx');

    const payload = {
        code: 0,
        data: {
            goods: { mallId: '1294342101', sold: 0, totalSold: 999, goodsScore: 4.4, reviewNum: 5, onSaleTime: '2020-06-26T08:00:00.000+08:00', createTime: '2020-08-07T12:15:10.893+08:00' },
            mall: { mallName: 'Balvessa' },
        },
    };
    const parsed = selector.parseJijiyunCardPayload(payload);
    assert.deepEqual(parsed, { seller: 'Balvessa', mallId: '1294342101', rating: 4.4, reviews: 5, sales: 0, onSaleDate: '2020-06-26' });
    assert.equal(selector.applyJijiyunData(product, parsed), true);
    assert.deepEqual(
        [product.seller, product.sales, product.rating, product.reviews, product.onSaleDate],
        ['Balvessa', 0, 4.4, 5, '2020-06-26'],
    );

    const missingProduct = { seller: '—', sales: null, rating: null, reviews: null, onSaleDate: null };
    assert.equal(selector.applyJijiyunData(missingProduct, { seller: '', sales: null, rating: null, reviews: null, onSaleDate: null }), false);
    assert.deepEqual([missingProduct.sales, missingProduct.rating, missingProduct.reviews], [null, null, null]);

    const zeroSalesProduct = {
        seller: 'SHEIN Clasi', sellerSource: 'SHEIN', sales: 0, salesRaw: '0 sold', salesSource: 'SHEIN', rating: 4.8, ratingSource: 'SHEIN', reviews: 0, reviewsSource: 'SHEIN', onSaleDate: '2020-01-02', onSaleDateSource: 'SHEIN',
    };
    assert.equal(selector.needsJijiyunEnrichment({ ...product, seller: 'SHEIN Clasi', sales: 0, rating: 4.8, reviews: 1, onSaleDate: '2020-01-02' }), true);
    assert.equal(selector.applyJijiyunData(zeroSalesProduct, { seller: 'Other', sales: 100, rating: 5, reviews: 50, onSaleDate: '2021-01-01' }), true);
    assert.deepEqual(
        [zeroSalesProduct.seller, zeroSalesProduct.sales, zeroSalesProduct.salesSource, zeroSalesProduct.rating, zeroSalesProduct.reviews, zeroSalesProduct.onSaleDate],
        ['SHEIN Clasi', 100, '极鲸云', 4.8, 0, '2020-01-02'],
    );

    const nonzeroSalesProduct = { seller: 'SHEIN Clasi', sales: 700, salesRaw: '700 sold', salesSource: 'SHEIN', rating: 4.8, reviews: 1, onSaleDate: '2020-01-02' };
    assert.equal(selector.applyJijiyunData(nonzeroSalesProduct, { seller: 'Other', sales: 800, rating: 5, reviews: 50, onSaleDate: '2021-01-01' }), false);
    assert.equal(nonzeroSalesProduct.sales, 700);
    assert.equal(nonzeroSalesProduct.salesSource, 'SHEIN');
    assert.equal(selector.jijiyunFailureRetryDelay(1), 5000);
    assert.equal(selector.jijiyunFailureRetryDelay(2), 10000);
    assert.equal(selector.jijiyunFailureRetryDelay(9), 60000);
    assert.equal(selector.jijiyunFailureReady({ failed: true, nextRetryAt: 99 }, 100), true);
    assert.equal(selector.jijiyunFailureReady({ failed: true, nextRetryAt: 101 }, 100), false);

    let requestOptions;
    const fetched = await selector.fetchJijiyunProductCard(product, {
        fetchImpl: async (_requestUrl, options) => {
            requestOptions = options;
            return { ok: true, status: 200, json: async () => payload };
        },
    });
    assert.equal(requestOptions.credentials, 'omit');
    assert.deepEqual(fetched, parsed);

    const discoveredProduct = {
        site: 'MX', goodsId: '520806944', storeCode: '', seller: '—', sales: null, rating: null, reviews: null, onSaleDate: null,
    };
    const requestedMallIds = [];
    const discovered = await selector.fetchJijiyunProductCard(discoveredProduct, {
        fetchImpl: async (requestUrl, options) => {
            assert.equal(options.credentials, 'omit');
            const mallId = new URL(requestUrl).searchParams.get('mallId');
            requestedMallIds.push(mallId);
            return {
                ok: true,
                status: 200,
                json: async () => mallId === '1'
                    ? { code: 0, data: { goods: { mallId: '4409279408', sold: 50, goodsScore: 4.7, reviewNum: 16, onSaleTime: '2025-09-02T00:00:00Z' }, mall: {} } }
                    : { code: 0, data: { goods: { mallId: '4409279408' }, mall: { mallName: 'Easowa Curve' } } },
            };
        },
    });
    assert.deepEqual(requestedMallIds, ['1', '4409279408']);
    assert.deepEqual(discovered, { seller: 'Easowa Curve', mallId: '4409279408', rating: 4.7, reviews: 16, sales: 50, onSaleDate: '2025-09-02' });
    assert.equal(selector.applyJijiyunData(discoveredProduct, discovered), true);
    assert.equal(discoveredProduct.storeCode, '4409279408');
    assert.equal(discoveredProduct.seller, 'Easowa Curve');
});

test('reads SHEIN data-trend-label without matching product-title wording', () => {
    const tagged = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', { trends: true });
    const titleOnly = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', { id: '518192162', title: 'Everyday trends graphic tee' });
    const taggedProduct = selector.collectProducts(tagged.window.document, tagged.window.location.href)[0];
    assert.equal(taggedProduct.trends, true);
    assert.equal(taggedProduct.storeCode, '4409279408');
    assert.equal(taggedProduct.seller, 'Easowa Curve');
    assert.equal(taggedProduct.sellerSource, 'SHEIN');
    assert.equal(selector.collectProducts(titleOnly.window.document, titleOnly.window.location.href)[0].trends, false);
});

test('reads SHEIN data-store_code directly from the product link', () => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', { storeCode: '8985397265' });
    const product = selector.collectProducts(dom.window.document, dom.window.location.href)[0];
    assert.equal(product.storeCode, '8985397265');
});

test('extracts listing fields from US search and MX category DOM fixtures', () => {
    const usDom = productFixture('https://us.shein.com/pdsearch/tops/?page=2', {
        price: '$12.50',
        sales: '1.8k+ sold',
        trends: true,
        relatedColorCount: 3,
        productData: { skc_sale_attr: [{ attr_name: 'Size', attr_value_list: [{ attr_value_id: 'S' }, { attr_value_id: 'M' }, { attr_value_id: 'L' }] }] },
    });
    const mxDom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', { local: true, newArrivals: true });
    const usProduct = selector.collectProducts(usDom.window.document, usDom.window.location.href)[0];
    const mxProduct = selector.collectProducts(mxDom.window.document, mxDom.window.location.href)[0];
    assert.equal(usProduct.site, 'US');
    assert.equal(usProduct.pageType, 'Search');
    assert.equal(usProduct.page, 2);
    assert.equal(usProduct.currency, 'USD');
    assert.equal(usProduct.sales, 1800);
    assert.equal(usProduct.trends, true);
    assert.equal(usProduct.specType, 'Dual');
    assert.equal(usProduct.primarySpec, 'Color');
    assert.equal(usProduct.primarySpecCount, 3);
    assert.equal(usProduct.secondarySpec, 'Size');
    assert.equal(usProduct.secondarySpecCount, 3);
    assert.equal(usProduct.skuQty, '—');
    assert.equal(mxProduct.site, 'MX');
    assert.equal(mxProduct.pageType, 'Category');
    assert.equal(mxProduct.fulfillment, 'QuickShip');
    assert.equal(mxProduct.newArrivals, true);
});

test('extracts real SHEIN lazy image URLs instead of placeholders', () => {
    const lazyDom = productFixture('https://us.shein.com/pdsearch/tops/', {
        imageHtml: '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-src="//img.ltwebstatic.com/images3_pi/lazy-real.webp">',
    });
    const lazyProduct = selector.collectProducts(lazyDom.window.document, lazyDom.window.location.href)[0];
    assert.equal(lazyProduct.imageUrl, 'https://img.ltwebstatic.com/images3_pi/lazy-real.webp');

    const responsiveDom = new JSDOM('<article><a href="/Example-p-1.html"><img src="https://img.ltwebstatic.com/loading.gif" srcset="//img.ltwebstatic.com/small.webp 320w, //img.ltwebstatic.com/large.webp 960w"></a></article>', {
        url: 'https://us.shein.com/pdsearch/tops/',
    });
    assert.equal(selector.firstImage(responsiveDom.window.document.querySelector('article')), 'https://img.ltwebstatic.com/large.webp');
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
    assert.equal(selector.colorwayCountFromCard(card), 6);
});

test('classifies specification dimensions without confusing them with SKU quantity', () => {
    const sizeSpec = { skc_sale_attr: [{ attr_name: 'Size', attr_value_list: [{ attr_value_id: 'S' }, { attr_value_id: 'M' }, { attr_value_id: 'L' }] }] };
    const sizeOnlyDom = productFixture('https://us.shein.com/pdsearch/tops/', { singleSku: 0, relatedColorCount: 0, productData: sizeSpec });
    const colorOnlyDom = productFixture('https://us.shein.com/pdsearch/tops/', { singleSku: 1, relatedColorCount: 4 });
    const colorObservedMultiSkuDom = productFixture('https://us.shein.com/pdsearch/tops/', { singleSku: 0, relatedColorCount: 4 });
    const colorAndSizeDom = productFixture('https://us.shein.com/pdsearch/tops/', { singleSku: 0, relatedColorCount: 4, productData: sizeSpec });
    const noSpecDom = productFixture('https://us.shein.com/pdsearch/tops/', { singleSku: 1, relatedColorCount: 0 });
    const sizeOnly = selector.collectProducts(sizeOnlyDom.window.document, sizeOnlyDom.window.location.href)[0];
    const colorOnly = selector.collectProducts(colorOnlyDom.window.document, colorOnlyDom.window.location.href)[0];
    const colorObservedMultiSku = selector.collectProducts(colorObservedMultiSkuDom.window.document, colorObservedMultiSkuDom.window.location.href)[0];
    const colorAndSize = selector.collectProducts(colorAndSizeDom.window.document, colorAndSizeDom.window.location.href)[0];
    const noSpec = selector.collectProducts(noSpecDom.window.document, noSpecDom.window.location.href)[0];

    assert.deepEqual([sizeOnly.specType, sizeOnly.primarySpec, sizeOnly.primarySpecCount, sizeOnly.secondarySpec], ['Single', 'Size', 3, '—']);
    assert.deepEqual([colorOnly.specType, colorOnly.primarySpec, colorOnly.primarySpecCount, colorOnly.secondarySpec], ['Single', 'Color', 4, '—']);
    assert.deepEqual([colorObservedMultiSku.specType, colorObservedMultiSku.primarySpec, colorObservedMultiSku.secondarySpec], ['—', 'Color', '—']);
    assert.equal(colorObservedMultiSku.specConfirmed, false);
    assert.deepEqual([colorAndSize.specType, colorAndSize.primarySpec, colorAndSize.primarySpecCount, colorAndSize.secondarySpec, colorAndSize.secondarySpecCount], ['Dual', 'Color', 4, 'Size', 3]);
    assert.deepEqual([noSpec.specType, noSpec.primarySpec, noSpec.secondarySpec], ['Single', '—', '—']);
    assert.equal(selector.evaluateProduct(sizeOnly, { singleSpec: true, salesMin: null, priceMin: null, ratingMin: null }).matched, true);
    assert.deepEqual(selector.evaluateProduct(colorObservedMultiSku, { singleSpec: true, salesMin: null, priceMin: null, ratingMin: null }).reasons, ['规格结构待确认']);
    assert.equal(selector.evaluateProduct(colorAndSize, { singleSpec: true, salesMin: null, priceMin: null, ratingMin: null }).matched, false);
});

test('confirms Single or Dual from fetched detail gbRawData instead of guessing from one listing dimension', async () => {
    const dualGoodsId = '465161453';
    const dualRawData = {
        canonicalInfo: { goods_id: dualGoodsId },
        modules: {
            productInfo: { goods_id: dualGoodsId },
            saleAttr: {
                mainSaleAttribute: {
                    attr_id: '27',
                    attr_name: 'Color',
                    info: Array.from({ length: 13 }, (_, index) => ({ goods_id: `${dualGoodsId}${index}`, attr_id: '27', attr_name: 'Color', attr_value_id: `color-${index}` })),
                },
                multiLevelSaleAttribute: {
                    goods_id: dualGoodsId,
                    skc_sale_attr: [{ attr_id: '87', attr_name: 'Talla', attr_value_list: ['XS', 'S', 'M', 'L'].map((value) => ({ attr_value_id: value })) }],
                    sku_list: ['XS', 'S', 'M', 'L'].map((value) => ({ sku_code: `SKU-${value}`, sku_sale_attr: [{ attr_id: '87', attr_name: 'Talla', attr_value_id: value }] })),
                },
            },
        },
    };
    const dualHtml = `<script>window.gbRawData = ${JSON.stringify(dualRawData)};</script>`;
    const dual = selector.specStructureFromDetailHtml(dualHtml, dualGoodsId);
    assert.deepEqual(
        [dual.specType, dual.primarySpec, dual.primarySpecCount, dual.secondarySpec, dual.secondarySpecCount, dual.skuQty, dual.specConfirmed],
        ['Dual', 'Color', 13, 'Size', 4, 4, true],
    );

    const singleGoodsId = '524601815';
    const singleRawData = {
        canonicalInfo: { goods_id: singleGoodsId },
        modules: {
            productInfo: { goods_id: singleGoodsId },
            saleAttr: {
                mainSaleAttribute: { attr_id: '27', attr_name: 'Color', info: [{ goods_id: singleGoodsId, attr_value_id: 'black' }] },
                multiLevelSaleAttribute: {
                    goods_id: singleGoodsId,
                    skc_sale_attr: [{ attr_id: '87', attr_name: 'Talla', attr_value_list: ['XS', 'S', 'M', 'L', 'XL'].map((value) => ({ attr_value_id: value })) }],
                    sku_list: ['XS', 'S', 'M', 'L', 'XL'].map((value) => ({ sku_code: `SKU-${value}`, sku_sale_attr: [{ attr_id: '87', attr_name: 'Talla', attr_value_id: value }] })),
                },
            },
        },
    };
    let requestedDetailUrl = '';
    const single = await selector.fetchDetailSpecStructure(`https://www.shein.com.mx/Example-p-${singleGoodsId}.html`, {
        fetchImpl: async (url) => {
            requestedDetailUrl = url;
            return {
                ok: true,
                status: 200,
                url,
                text: async () => JSON.stringify({
                    code: '0',
                    msg: 'ok',
                    info: singleRawData.modules,
                }),
            };
        },
    });
    assert.deepEqual(
        [single.specType, single.primarySpec, single.primarySpecCount, single.secondarySpec, single.skuQty, single.specConfirmed],
        ['Single', 'Size', 5, '—', 5, true],
    );
    const requested = new URL(requestedDetailUrl);
    assert.equal(requested.pathname, '/bff-api/product/get_goods_detail_realtime_data');
    assert.equal(requested.searchParams.get('_lang'), 'es');
    assert.equal(requested.searchParams.get('goods_id'), singleGoodsId);
    assert.equal(requested.searchParams.has('mallCode'), false);

    const stale = selector.specStructureFromDetailHtml(dualHtml, '999999999');
    assert.equal(stale.specType, '—');
    assert.equal(stale.specConfirmed, false);
    assert.match(stale.specError, /ID/);
});

test('uses the SHEIN detail API contract and distinguishes soft limits from CAPTCHA', async () => {
    const mx = new URL(selector.detailApiUrl('https://www.shein.com.mx/Example-p-123456.html'));
    assert.equal(mx.pathname, '/bff-api/product/get_goods_detail_realtime_data');
    assert.equal(mx.searchParams.get('_ver'), '1.1.8');
    assert.equal(mx.searchParams.get('_lang'), 'es');
    assert.equal(mx.searchParams.get('goods_id'), '123456');
    assert.equal(mx.searchParams.has('mallCode'), false);

    const us = new URL(selector.detailApiUrl('https://us.shein.com/Example-p-654321.html', { mallCode: '2' }));
    assert.equal(us.searchParams.get('_lang'), 'en');
    assert.equal(us.searchParams.get('mallCode'), '2');
    assert.equal(us.searchParams.get('priorityMallType'), '2');

    const rateLimit = await selector.fetchDetailSpecStructure('https://us.shein.com/Example-p-654321.html', {
        mallCode: '1',
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            url: 'https://us.shein.com/risk/action/limit',
            text: async () => '<!DOCTYPE html><title>captcha</title>',
        }),
    });
    assert.equal(rateLimit.specConfirmed, false);
    assert.equal(rateLimit.specFailureKind, 'rate-limit');
    assert.match(rateLimit.specError, /接口限流/);
    assert.match(rateLimit.specError, /无需验证/);

    const captcha = await selector.fetchDetailSpecStructure('https://us.shein.com/Example-p-654321.html', {
        mallCode: '1',
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            url: 'https://us.shein.com/risk/challenge',
            text: async () => '<!DOCTYPE html><script>window.captcha_type=909</script>',
        }),
    });
    assert.equal(captcha.specFailureKind, 'risk');
    assert.match(captcha.specError, /完成验证/);
});

test('finds late gbRawData and falls back to JSON-LD or detail DOM specification groups', () => {
    const goodsId = '465161453';
    const rawData = {
        canonicalInfo: { goods_id: goodsId },
        modules: {
            productInfo: { goods_id: goodsId },
            saleAttr: {
                mainSaleAttribute: {
                    attr_id: '27', attr_name: 'Color',
                    info: ['red', 'blue'].map((value) => ({ goods_id: `${goodsId}-${value}`, attr_id: '27', attr_name: 'Color', attr_value_id: value })),
                },
                multiLevelSaleAttribute: {
                    goods_id: goodsId,
                    skc_sale_attr: [{ attr_id: '87', attr_name: 'Size', attr_value_list: ['S', 'M'].map((value) => ({ attr_value_id: value })) }],
                    sku_list: ['S', 'M'].map((value) => ({ sku_code: value, sku_sale_attr: [{ attr_id: '87', attr_name: 'Size', attr_value_id: value }] })),
                },
            },
        },
    };
    const lateHtml = `${Array.from({ length: 100 }, (_, index) => `<script>window.fixture${index}={"ok":true};</script>`).join('')}<script>window.gbRawData = ${JSON.stringify(rawData)};</script>`;
    assert.equal(selector.specStructureFromDetailHtml(lateHtml, goodsId).specType, 'Dual');

    const schema = {
        '@type': 'ProductGroup',
        url: `https://www.shein.com.mx/Example-p-${goodsId}.html`,
        hasVariant: ['S', 'M', 'L'].map((size) => ({
            sku: `SKU-${size}`,
            size,
            offers: { url: `https://www.shein.com.mx/Example-p-${goodsId}.html?skucode=${size}` },
        })),
    };
    const schemaHtml = `<script id="goodsDetailSchema" type="application/ld+json">${JSON.stringify(schema)}</script>`;
    const schemaSpec = selector.specStructureFromDetailHtml(schemaHtml, goodsId);
    assert.deepEqual([schemaSpec.specType, schemaSpec.primarySpec, schemaSpec.primarySpecCount, schemaSpec.specSource], ['Single', 'Size', 3, 'detail-schema']);
    const merged = selector.mergeSpecStructures(
        { primarySpec: 'Color', primarySpecCount: 13, secondarySpec: '—', secondarySpecCount: null },
        schemaSpec,
    );
    assert.deepEqual([merged.specType, merged.primarySpec, merged.primarySpecCount, merged.secondarySpec, merged.secondarySpecCount], ['Dual', 'Color', 13, 'Size', 3]);

    const dom = new JSDOM(`
      <div class="product-intro__color-radio"><button role="radio" aria-label="Red"></button><button role="radio" aria-label="Blue"></button></div>
      <div class="product-intro__size-radio"><button role="radio" aria-label="S"></button><button role="radio" aria-label="M"></button><button role="radio" aria-label="L"></button></div>
    `);
    const domSpec = selector.specStructureFromDetailDom(dom.window.document);
    assert.deepEqual([domSpec.specType, domSpec.primarySpec, domSpec.primarySpecCount, domSpec.secondarySpec, domSpec.secondarySpecCount], ['Dual', 'Color', 2, 'Size', 3]);
});

test('applies site-aware coupon price, fulfillment, sales, and rating filters', () => {
    const product = selector.collectProducts(
        productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html').window.document,
        'https://www.shein.com.mx/Women-Clothing-c-2030.html',
    )[0];
    const matched = selector.evaluateProduct(product, { globalShip: true, quickShip: false, singleSpec: false, salesMin: 1000, priceMin: 100, priceMax: null, couponOff: 65, ratingMin: 4.5 });
    assert.equal(matched.matched, true);
    assert.equal(matched.effectivePrice, 112);
    assert.equal(selector.evaluateProduct(product, { globalShip: true, singleSpec: false, salesMin: 4000, couponOff: 65, ratingMin: 4.5 }).matched, false);
});

test('clears every filter without restoring site defaults and validates configurable shortcuts', () => {
    assert.equal(selector.normalizeFilters({}, 'MX').singleSpec, false);
    assert.deepEqual(selector.normalizeFilters({}, 'MX'), {
        globalShip: true,
        quickShip: false,
        trends: false,
        newArrivals: false,
        singleSpec: false,
        salesMin: null,
        priceMin: null,
        priceMax: null,
        couponOff: 0,
        ratingMin: null,
    });
    assert.deepEqual(selector.clearedFilters('MX'), {
        globalShip: false,
        quickShip: false,
        trends: false,
        newArrivals: false,
        singleSpec: false,
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

test('builds normalized MX and US common filter templates with site-aware summaries', () => {
    const mxTemplates = selector.defaultFilterTemplates('MX');
    const usTemplates = selector.defaultFilterTemplates('US');
    assert.deepEqual(mxTemplates.map(({ name }) => name), ['GlobalShip 基础', 'MX代采 · 65%券', '单规格轻量选品']);
    assert.equal(mxTemplates[1].filters.priceMin, 100);
    assert.equal(usTemplates[1].filters.priceMin, 25);
    assert.deepEqual(selector.filterTemplateSummary(mxTemplates[1].filters, 'MX'), ['GlobalShip', '销量 ≥1,000', 'MXN 100–∞', '65%券', '4.2★+']);
    assert.deepEqual(selector.filterTemplateSummary(usTemplates[1].filters, 'US'), ['GlobalShip', '销量 ≥1,000', 'USD 25–∞', '65%券', '4.2★+']);
    assert.equal(selector.filterTemplateMatches(mxTemplates[0].filters, { globalShip: true }, 'MX'), true);
    assert.equal(selector.filterTemplateMatches(mxTemplates[0].filters, { globalShip: true, trends: true }, 'MX'), false);
    assert.equal(selector.normalizeFilterTemplate({ name: '', filters: {} }, 'MX'), null);
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
    assert.equal(sheet.getRow(1).values.includes('上架日期'), true);
    assert.equal(sheet.getRow(1).values.includes('SKU Qty'), true);
    assert.equal(sheet.getRow(1).values.includes('规格类型'), true);
    assert.equal(sheet.getRow(1).values.includes('款式数'), false);
    assert.equal(sheet.getRow(2).getCell(1).value, 'MX');
    assert.equal(workbook.model.media.length, 1);
    const buffer = await workbook.xlsx.writeBuffer();
    assert.ok(buffer.byteLength > 1000);
});

test('reports image export progress and counts failed images without stopping the workbook', async () => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html');
    const sourceProduct = selector.collectProducts(dom.window.document, dom.window.location.href)[0];
    const products = [1, 2, 3].map((index) => ({ ...sourceProduct, goodsId: `${sourceProduct.goodsId}-${index}`, title: `Export ${index}` }));
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+JmCbWQAAAABJRU5ErkJggg==';
    const progress = [];
    let calls = 0;
    const workbook = await selector.createWorkbook(products, selector.normalizeFilters({}, 'MX'), {
        ExcelJS,
        includeImages: true,
        imageLoader: async () => {
            calls += 1;
            if (calls === 2) throw new Error('fixture failure');
            return { dataUrl: tinyPng, extension: 'png' };
        },
        onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(progress.map(({ completed, total, failed }) => ({ completed, total, failed })), [
        { completed: 1, total: 3, failed: 0 },
        { completed: 2, total: 3, failed: 1 },
        { completed: 3, total: 3, failed: 1 },
    ]);
    assert.equal(workbook.getWorksheet('Selected Products').rowCount, 4);
    assert.equal(workbook.model.media.length, 2);
});

test('mounts the launcher and bottom workbench on a supported category page', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { price: '$12.50', sales: '2k+ sold', pagination: true, singleSku: 1, relatedColorCount: 4 });
    let clipboard = '';
    let officialPaginationClicks = 0;
    ['Page 2', 'Next page'].forEach((label) => {
        dom.window.document.querySelector(`[aria-label="${label}"]`).addEventListener('click', () => { officialPaginationClicks += 1; });
    });
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
    assert.ok(host.shadowRoot.querySelector('.export-progress'));
    assert.equal(host.shadowRoot.querySelector('.export-progress').hidden, true);
    assert.equal(host.shadowRoot.querySelector('[data-action="export"]').getAttribute('aria-busy'), 'false');
    assert.match(host.shadowRoot.textContent, /Price · USD/);
    assert.match(host.shadowRoot.textContent, /Single-Spec/);
    assert.match(host.shadowRoot.textContent, /补全规格/);
    assert.match(host.shadowRoot.textContent, /INAWLY casual letter print shirt/);
    assert.match(host.shadowRoot.querySelector('thead').textContent, /SPEC TYPE/);
    assert.match(host.shadowRoot.querySelector('thead').textContent, /PRI SPEC/);
    assert.match(host.shadowRoot.querySelector('thead').textContent, /SEC SPEC/);
    assert.match(host.shadowRoot.querySelector('thead').textContent, /REVIEWS/);
    assert.doesNotMatch(host.shadowRoot.querySelector('thead').textContent, /STYLES|MULTI-SKU/);
    assert.equal(host.shadowRoot.querySelectorAll('thead th').length, 15);
    const firstProductRow = host.shadowRoot.querySelector('tbody tr:not(.page-divider):not(.empty-state)');
    assert.equal(firstProductRow.children.length, 15);
    assert.doesNotMatch(firstProductRow.children[5].textContent, /reviews/i);
    assert.equal(firstProductRow.children[6].textContent.trim(), '1,268');
    assert.equal(firstProductRow.children[9].querySelector('b').textContent, 'Color');
    assert.equal(firstProductRow.children[9].querySelector('.sub').textContent, '4');
    const responsiveCss = host.shadowRoot.querySelector('style').textContent;
    assert.match(responsiveCss, /grid-template-rows:auto auto minmax\(0,1fr\)/);
    assert.match(responsiveCss, /\.panel\.compact\{height:113px!important;min-height:113px;max-height:113px;grid-template-rows:auto auto/);
    assert.match(responsiveCss, /\.panel\.compact \.resize\{cursor:default;pointer-events:none\}/);
    assert.match(responsiveCss, /\.panel\.compact \.body\{display:none\}/);
    assert.match(responsiveCss, /calc\(930px \+ var\(--product-column-width\) \+ var\(--sold-by-column-width\)\)/);
    assert.match(responsiveCss, /@media\(max-width:1279px\)/);
    assert.match(responsiveCss, /@media\(max-width:1023px\)/);
    assert.match(responsiveCss, /\.panel\.summary-open aside/);
    assert.match(responsiveCss, /\.filter label\.switch\{width:22px;height:13px;flex:0 0 22px/);
    assert.match(responsiveCss, /\.pictogram-single-spec:before/);
    assert.match(responsiveCss, /repeat\(4,minmax\(112px,1fr\)\) minmax\(132px,1\.05fr\)/);
    assert.match(responsiveCss, /minmax\(145px,1\.1fr\) 346px minmax\(86px,\.62fr\)/);
    assert.match(responsiveCss, /\.coupon-row\{display:grid;grid-template-columns:182px 80px;gap:0/);
    assert.match(responsiveCss, /\.coupon-tools\{[^}]*border-left:1px solid #cad4cf/);
    assert.match(responsiveCss, /\.price-inputs\{grid-template-columns:83px 7px 83px 80px;justify-content:start;gap:3px/);
    assert.match(responsiveCss, /\.coupon-custom\{[^}]*padding-left:5px;border-left:1px solid #cad4cf/);
    assert.match(responsiveCss, /\.inline-field input,\.inline-field select\{[^}]*max-width:66px/);
    assert.match(responsiveCss, /\.filter-apply\.is-dirty\{border-color:var\(--green\)/);
    assert.match(responsiveCss, /\.status-match\{[^}]*background:#e8f7f0[^}]*font-weight:750/);
    assert.deepEqual(Array.from(host.shadowRoot.querySelectorAll('.status-match')).map((badge) => badge.textContent.trim()), ['当前命中 1', '累计命中 1']);
    assert.deepEqual(Array.from(host.shadowRoot.querySelectorAll('.status-match strong')).map((number) => number.textContent), ['1', '1']);
    assert.equal(host.shadowRoot.querySelectorAll('[data-sort-key]').length, 5);
    assert.ok(host.shadowRoot.querySelector('[data-action="spec-scan"]'));
    assert.equal(host.shadowRoot.querySelector('[data-filter="singleSpec"]').closest('.filter').querySelector('small').textContent, 'Specification');
    assert.ok(host.shadowRoot.querySelector('.coupon-custom'));
    assert.equal(host.shadowRoot.querySelector('.coupon-suffix').textContent, '%');
    assert.deepEqual(Array.from(host.shadowRoot.querySelectorAll('[data-action="apply-numeric"]')).map((button) => button.textContent), ['应用', '应用']);
    const summaryToggle = host.shadowRoot.querySelector('[data-action="summary"]');
    assert.equal(summaryToggle.getAttribute('aria-expanded'), 'false');
    summaryToggle.click();
    assert.equal(summaryToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(host.shadowRoot.querySelector('.panel').classList.contains('summary-open'), true);
    const compactButton = host.shadowRoot.querySelector('[data-action="close"]');
    compactButton.click();
    assert.equal(host.shadowRoot.querySelector('.panel').classList.contains('compact'), true);
    assert.equal(host.shadowRoot.querySelector('.filters').children.length, 9);
    assert.equal(compactButton.textContent, '▲');
    assert.match(compactButton.getAttribute('aria-label'), /展开完整工作台/);
    assert.equal(launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(JSON.parse(dom.window.sessionStorage.getItem('xynigo-shein-selector-session-v2-US')).compact, true);
    const compactTableRow = host.shadowRoot.querySelector('tbody tr:not(.page-divider):not(.empty-state)');
    const compactRating = host.shadowRoot.querySelector('[data-filter="ratingMin"]');
    compactRating.value = '4.5';
    compactRating.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.strictEqual(host.shadowRoot.querySelector('tbody tr:not(.page-divider):not(.empty-state)'), compactTableRow);
    compactButton.click();
    assert.equal(host.shadowRoot.querySelector('.panel').classList.contains('compact'), false);
    assert.equal(compactButton.textContent, '—');
    assert.equal(launcher.getAttribute('aria-expanded'), 'true');
    assert.notStrictEqual(host.shadowRoot.querySelector('tbody tr:not(.page-divider):not(.empty-state)'), compactTableRow);
    const firstImage = host.shadowRoot.querySelector('.product-cell img');
    assert.equal(firstImage.getAttribute('src'), 'https://img.ltwebstatic.com/images3_pi/fixture.webp');
    const imageLink = host.shadowRoot.querySelector('.product-image-link');
    const titleLink = host.shadowRoot.querySelector('.product-title-link');
    assert.equal(imageLink.href, 'https://us.shein.com/INAWLY-casual-letter-print-shirt-p-518192161.html');
    assert.equal(titleLink.href, imageLink.href);
    assert.equal(imageLink.target, '_blank');
    assert.equal(titleLink.target, '_blank');
    const productColumnResizer = host.shadowRoot.querySelector('.product-column-resizer');
    productColumnResizer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(host.shadowRoot.querySelector('.panel').style.getPropertyValue('--product-column-width'), '234px');
    assert.equal(productColumnResizer.getAttribute('aria-valuenow'), '234');
    const soldByColumnResizer = host.shadowRoot.querySelector('.sold-by-column-resizer');
    soldByColumnResizer.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(host.shadowRoot.querySelector('.panel').style.getPropertyValue('--sold-by-column-width'), '124px');
    assert.equal(soldByColumnResizer.getAttribute('aria-valuenow'), '124');
    assert.equal(host.shadowRoot.querySelector('.toast').classList.contains('show'), false);
    dom.window.document.querySelector('.product-card').appendChild(dom.window.document.createElement('span'));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 420));
    assert.strictEqual(host.shadowRoot.querySelector('.product-cell img'), firstImage);
    assert.equal(host.shadowRoot.querySelector('.toast').classList.contains('show'), false);
    host.shadowRoot.querySelector('[data-action="scan"]').click();
    assert.notStrictEqual(host.shadowRoot.querySelector('.product-cell img'), firstImage);
    assert.equal(host.shadowRoot.querySelector('.toast').classList.contains('show'), true);
    assert.match(host.shadowRoot.querySelector('.toast').textContent, /已扫描 1 个商品/);
    assert.equal(host.shadowRoot.querySelector('[data-filter="ratingMin"]').getBoundingClientRect().width <= 50, true);
    let ratingSelect = host.shadowRoot.querySelector('[data-filter="ratingMin"]');
    assert.equal(ratingSelect.querySelector('option[value=""]').textContent, 'All');
    assert.equal(ratingSelect.querySelector('option[value=""]').disabled, false);
    ratingSelect.value = '4.5';
    ratingSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(host.shadowRoot.querySelector('[data-filter="ratingMin"]').value, '4.5');
    ratingSelect = host.shadowRoot.querySelector('[data-filter="ratingMin"]');
    ratingSelect.value = '';
    ratingSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(host.shadowRoot.querySelector('[data-filter="ratingMin"]').value, '');
    host.shadowRoot.querySelector('[data-action="copy"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    assert.equal(clipboard, 'https://us.shein.com/INAWLY-casual-letter-print-shirt-p-518192161.html');
    host.shadowRoot.querySelector('[data-action="clear"]').click();
    assert.equal(host.shadowRoot.querySelector('[data-filter="globalShip"]').checked, false);
    assert.equal(host.shadowRoot.querySelector('[data-filter="singleSpec"]').checked, false);
    assert.equal(host.shadowRoot.querySelector('[data-filter="salesMin"]').value, '');
    assert.equal(host.shadowRoot.querySelector('[data-filter="ratingMin"]').value, '');
    host.shadowRoot.querySelector('[data-action="next"]').click();
    assert.equal(officialPaginationClicks, 1);
    assert.equal(dom.window.location.href, 'https://us.shein.com/Women-Clothing-c-2030.html');
    dom.window.document.querySelector('.product-card').remove();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 420));
    assert.match(host.shadowRoot.querySelector('.status').textContent, /正在加载第 2 页/);
    assert.match(host.shadowRoot.querySelector('tbody').textContent, /INAWLY casual letter print shirt/);
    dom.window.close();
});

test('applies, edits, copies, and persists common filter templates per site', async (t) => {
    const dom = productFixture('https://www.shein.com.mx/pdsearch/playeras/', { pagination: true });
    t.after(() => dom.window.close());
    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    const host = dom.window.document.getElementById('xynigo-shein-selector-host');
    const shadow = host.shadowRoot;
    const templateMenu = shadow.querySelector('[data-action="template-menu"]');
    const popover = shadow.querySelector('.template-popover');
    const compactButton = shadow.querySelector('[data-action="close"]');
    assert.ok(templateMenu);
    assert.ok(shadow.querySelector('[data-action="template-create"]'));

    compactButton.click();
    templateMenu.click();
    assert.equal(shadow.querySelector('.panel').classList.contains('compact'), true);
    assert.equal(popover.hidden, false);
    assert.equal(popover.querySelectorAll('.template-item').length, 3);
    assert.match(popover.textContent, /MX\s*站独立保存/);
    compactButton.click();

    templateMenu.click();
    const procurement = popover.querySelector('[data-template-id="mx-procurement-65"]');
    procurement.querySelector('[data-action="template-apply"]').click();
    assert.equal(shadow.querySelector('[data-filter="globalShip"]').checked, true);
    assert.equal(shadow.querySelector('[data-filter="salesMin"]').value, '1000');
    assert.equal(shadow.querySelector('[data-filter="priceMin"]').value, '100');
    assert.equal(shadow.querySelector('[data-filter="couponOff"]').value, '65');
    assert.equal(shadow.querySelector('[data-filter="ratingMin"]').value, '4.2');
    assert.match(templateMenu.textContent, /MX代采/);

    templateMenu.click();
    const globalBase = popover.querySelector('[data-template-id="mx-global-base"]');
    globalBase.querySelector('[data-action="template-more"]').click();
    assert.equal(globalBase.classList.contains('menu-open'), true);
    assert.match(globalBase.querySelector('.template-row-actions').textContent, /覆盖为当前筛选/);
    assert.match(globalBase.querySelector('.template-row-actions').textContent, /复制/);
    assert.match(globalBase.querySelector('.template-row-actions').textContent, /删除/);
    globalBase.querySelector('[data-action="template-edit"]').click();

    const dialog = shadow.querySelector('.template-dialog');
    assert.equal(dialog.hasAttribute('open'), true);
    assert.equal(dialog.querySelector('.template-filter-editor').hidden, false);
    assert.match(dialog.textContent, /一键筛选条件/);
    const nameInput = dialog.querySelector('[name="templateName"]');
    nameInput.value = 'GlobalShip 高评分';
    const trends = dialog.querySelector('[data-template-field="trends"]');
    trends.checked = true;
    trends.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const rating = dialog.querySelector('[data-template-field="ratingMin"]');
    rating.value = '4.5';
    rating.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    dialog.querySelector('[data-action="template-save"]').click();
    assert.equal(dialog.hasAttribute('open'), false);

    const storageKey = 'xynigo-shein-selector-filter-templates-v1-MX';
    let saved = JSON.parse(dom.window.localStorage.getItem(storageKey));
    assert.equal(saved.length, 3);
    const edited = saved.find((template) => template.id === 'mx-global-base');
    assert.equal(edited.name, 'GlobalShip 高评分');
    assert.equal(edited.filters.trends, true);
    assert.equal(edited.filters.ratingMin, 4.5);

    templateMenu.click();
    popover.querySelector('[data-template-id="mx-global-base"] [data-action="template-apply"]').click();
    assert.equal(shadow.querySelector('[data-filter="trends"]').checked, true);
    assert.equal(shadow.querySelector('[data-filter="ratingMin"]').value, '4.5');
    assert.match(templateMenu.textContent, /GlobalShip 高评分/);

    shadow.querySelector('[data-action="template-create"]').click();
    assert.equal(dialog.querySelector('.template-filter-editor').hidden, true);
    dialog.querySelector('[name="templateName"]').value = '高评分备份';
    dialog.querySelector('[data-action="template-save"]').click();
    saved = JSON.parse(dom.window.localStorage.getItem(storageKey));
    assert.equal(saved.length, 4);
    assert.equal(saved.some((template) => template.name === '高评分备份'), true);
    assert.equal(dom.window.localStorage.getItem('xynigo-shein-selector-filter-templates-v1-US'), null);
});

test('restores the selected template and filters from extension storage after closing the tab', async (t) => {
    const extensionStore = new Map();
    const first = productFixture('https://www.shein.com.mx/pdsearch/playeras/', { pagination: true });
    t.after(() => first.window.close());
    installExtensionStorage(first, extensionStore);
    first.window.eval(source);
    await new Promise((resolve) => first.window.setTimeout(resolve, 40));

    const firstShadow = first.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const firstMenu = firstShadow.querySelector('[data-action="template-menu"]');
    firstMenu.click();
    const procurement = firstShadow.querySelector('[data-template-id="mx-procurement-65"]');
    procurement.querySelector('[data-action="template-edit"]').click();
    const dialog = firstShadow.querySelector('.template-dialog');
    dialog.querySelector('[name="templateName"]').value = '持久代采';
    dialog.querySelector('[data-action="template-save"]').click();
    firstMenu.click();
    firstShadow.querySelector('[data-template-id="mx-procurement-65"] [data-action="template-apply"]').click();
    const trends = firstShadow.querySelector('[data-filter="trends"]');
    trends.checked = true;
    trends.dispatchEvent(new first.window.Event('change', { bubbles: true }));
    await new Promise((resolve) => first.window.setTimeout(resolve, 50));

    const templateKey = 'xynigo-shein-selector-filter-templates-v1-MX';
    const stateKey = 'xynigo-shein-selector-filter-state-v1-MX';
    assert.equal(extensionStore.get(templateKey).find((template) => template.id === 'mx-procurement-65').name, '持久代采');
    assert.equal(extensionStore.get(stateKey).activeTemplateId, 'mx-procurement-65');
    assert.equal(extensionStore.get(stateKey).filters.trends, true);
    first.window.close();

    const second = productFixture('https://www.shein.com.mx/pdsearch/playeras/', { pagination: true });
    t.after(() => second.window.close());
    installExtensionStorage(second, extensionStore);
    second.window.eval(source);
    await new Promise((resolve) => second.window.setTimeout(resolve, 40));
    const secondShadow = second.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const secondMenu = secondShadow.querySelector('[data-action="template-menu"]');
    const clear = secondShadow.querySelector('[data-action="clear"]');
    const specScan = secondShadow.querySelector('[data-action="spec-scan"]');

    assert.match(secondMenu.textContent, /持久代采/);
    assert.equal(secondShadow.querySelector('[data-filter="globalShip"]').checked, true);
    assert.equal(secondShadow.querySelector('[data-filter="salesMin"]').value, '1000');
    assert.equal(secondShadow.querySelector('[data-filter="priceMin"]').value, '100');
    assert.equal(secondShadow.querySelector('[data-filter="couponOff"]').value, '65');
    assert.equal(secondShadow.querySelector('[data-filter="ratingMin"]').value, '4.2');
    assert.equal(secondShadow.querySelector('[data-filter="trends"]').checked, true);
    assert.equal(secondShadow.querySelector('.template-dirty-dot').hidden, false);
    assert.ok(secondMenu.compareDocumentPosition(clear) & second.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.ok(clear.compareDocumentPosition(specScan) & second.window.Node.DOCUMENT_POSITION_FOLLOWING);
});

test('workbench filters the current SHEIN page and clear restores its formal cards', async () => {
    const dom = productFixture('https://www.shein.com.mx/pdsearch/playeras/', { local: true, sales: '800 vendidos' });
    try {
        dom.window.eval(source);
        await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
        const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
        const card = dom.window.document.querySelector('.product-card');
        assert.equal(card.getAttribute('data-xynigo-shein-selector-filtered-out'), 'true');
        shadow.querySelector('[data-action="clear"]').click();
        assert.equal(card.hasAttribute('data-xynigo-shein-selector-filtered-out'), false);
        const quickShip = shadow.querySelector('[data-filter="quickShip"]');
        quickShip.checked = true;
        quickShip.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(card.hasAttribute('data-xynigo-shein-selector-filtered-out'), false);
        const salesMin = shadow.querySelector('[data-filter="salesMin"]');
        salesMin.value = '1000';
        salesMin.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.strictEqual(shadow.querySelector('[data-filter="salesMin"]'), salesMin);
        assert.equal(card.hasAttribute('data-xynigo-shein-selector-filtered-out'), false);
        assert.equal(shadow.querySelector('[data-draft-scope="sales"]').disabled, false);
        salesMin.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        assert.equal(card.hasAttribute('data-xynigo-shein-selector-filtered-out'), false);
        shadow.querySelector('[data-draft-scope="sales"]').click();
        assert.equal(card.getAttribute('data-xynigo-shein-selector-filtered-out'), 'true');
        const relaxedSales = shadow.querySelector('[data-filter="salesMin"]');
        relaxedSales.value = '500';
        relaxedSales.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        relaxedSales.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        assert.equal(card.hasAttribute('data-xynigo-shein-selector-filtered-out'), false);
    } finally {
        dom.window.close();
    }
});

test('pauses product rescans and blocks page-level key handlers while a numeric filter is edited', async () => {
    const dom = productFixture('https://www.shein.com.mx/pdsearch/playeras/', { singleSku: 1 });
    try {
        dom.window.eval(source);
        await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
        const host = dom.window.document.getElementById('xynigo-shein-selector-host');
        const shadow = host.shadowRoot;
        const salesMin = shadow.querySelector('[data-filter="salesMin"]');
        const initialImage = shadow.querySelector('.product-cell img').getAttribute('src');
        let pageInputEvents = 0;
        let pageKeyEvents = 0;
        dom.window.document.addEventListener('input', () => { pageInputEvents += 1; });
        dom.window.document.addEventListener('keydown', () => { pageKeyEvents += 1; });

        salesMin.focus();
        salesMin.value = '1000';
        salesMin.dispatchEvent(new dom.window.Event('input', { bubbles: true, composed: true }));
        salesMin.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, composed: true }));
        dom.window.document.querySelector('.product-card img').setAttribute('data-src', '//img.ltwebstatic.com/images3_pi/edit-lock.webp');
        await new Promise((resolve) => dom.window.setTimeout(resolve, 420));

        assert.equal(pageInputEvents, 0);
        assert.equal(pageKeyEvents, 0);
        assert.equal(shadow.querySelector('.product-cell img').getAttribute('src'), initialImage);
        shadow.querySelector('[data-draft-scope="sales"]').click();
        assert.equal(shadow.querySelector('.product-cell img').getAttribute('src'), initialImage);
        await new Promise((resolve) => dom.window.setTimeout(resolve, 180));
        assert.equal(shadow.querySelector('.product-cell img').getAttribute('src'), 'https://img.ltwebstatic.com/images3_pi/edit-lock.webp');
        assert.equal(shadow.querySelector('.toast').classList.contains('show'), false);
    } finally {
        dom.window.close();
    }
});

test('recommendation load/unload and formal-grid lazy images do not change formal count or repeat scan toasts', async () => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', { singleSku: 1 });
    let clipboard = '';
    dom.window.GM_setClipboard = (value) => { clipboard = value; };
    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const productCheckbox = shadow.querySelector('[data-select-id="518192161"]');
    productCheckbox.checked = true;
    productCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    const recommendation = dom.window.document.createElement('section');
    recommendation.className = 'SelectClassEmptyRecommend';
    recommendation.setAttribute('data-component', 'PRODUCT_RECOMMEND_COMPONENT');
    recommendation.innerHTML = `<h2>También podría gustarte</h2><div class="product-list-v2__container">${simpleProductCard('999999999', 'Recommended delayed')}</div>`;
    dom.window.document.body.appendChild(recommendation);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 450));
    assert.match(shadow.querySelector('.status').textContent, /累计 1 页 \/ 1/);
    assert.doesNotMatch(shadow.querySelector('tbody').textContent, /Recommended delayed/);
    assert.equal(shadow.querySelector('.toast').classList.contains('show'), false);

    recommendation.remove();
    dom.window.document.querySelector('.product-card img').setAttribute('data-src', 'https://img.ltwebstatic.com/images3_pi/formal-lazy.webp');
    await new Promise((resolve) => dom.window.setTimeout(resolve, 450));
    assert.match(shadow.querySelector('.status').textContent, /累计 1 页 \/ 1/);
    assert.equal(shadow.querySelector('[data-select-id="518192161"]').checked, true);
    assert.equal(shadow.querySelector('.toast').classList.contains('show'), false);

    shadow.querySelector('[data-action="copy"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    assert.equal(clipboard, 'https://www.shein.com.mx/INAWLY-casual-letter-print-shirt-p-518192161.html');
    dom.window.close();
});

test('observes an initially empty formal grid and scans when official cards arrive later', async () => {
    const dom = listingBoundaryFixture('https://us.shein.com/pdsearch/tops/', { officialCount: 0 });
    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    assert.match(shadow.querySelector('.status').textContent, /等待正式商品列表/);
    dom.window.document.querySelector('.product-list-v2__container').insertAdjacentHTML('beforeend', simpleProductCard('812345678', 'Official delayed'));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 450));
    assert.match(shadow.querySelector('.status').textContent, /累计 1 页 \/ 1/);
    assert.match(shadow.querySelector('tbody').textContent, /Official delayed/);
    assert.equal(shadow.querySelector('.toast').classList.contains('show'), false);
    dom.window.close();
});

test('waits for the target formal grid before accumulating page 2 and keeps page 2 above page 1', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { pagination: true, singleSku: 1 });
    const pageOne = dom.window.document.querySelector('[aria-label="Page 1"]');
    const pageTwo = dom.window.document.querySelector('[aria-label="Page 2"]');
    dom.window.document.querySelector('[aria-label="Previous page"]').disabled = true;
    pageOne.setAttribute('aria-current', 'page');
    const markPageTwo = () => {
        pageOne.removeAttribute('aria-current');
        pageTwo.setAttribute('aria-current', 'page');
        dom.window.document.querySelector('[aria-label="Previous page"]').disabled = false;
    };
    pageTwo.addEventListener('click', markPageTwo);
    dom.window.document.querySelector('[aria-label="Next page"]').addEventListener('click', markPageTwo);
    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const firstCheckbox = shadow.querySelector('[data-select-id="518192161"]');
    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    shadow.querySelector('[data-action="next"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 300));
    assert.match(shadow.querySelector('.status').textContent, /正在加载第 2 页/);
    assert.equal(shadow.querySelectorAll('.page-divider').length, 1);

    dom.window.document.querySelector('.product-list-v2__container').innerHTML = simpleProductCard('812345679', 'Page two formal');
    await new Promise((resolve) => dom.window.setTimeout(resolve, 550));
    const dividers = [...shadow.querySelectorAll('.page-divider')].map((row) => row.textContent.trim());
    assert.match(dividers[0], /第 2 页/);
    assert.match(dividers[1], /第 1 页/);
    assert.match(source, /\.page-divider td\{position:sticky;top:30px;z-index:2/);
    assert.match(shadow.querySelector('.status').textContent, /累计 2 页 \/ 2/);
    assert.deepEqual(Array.from(shadow.querySelectorAll('.status-match')).map((badge) => badge.textContent.trim()), ['当前命中 1', '累计命中 2']);
    assert.equal(shadow.querySelector('[data-select-id="518192161"]').checked, true);
    const pageSelectors = [...shadow.querySelectorAll('[data-action="select-page"]')];
    assert.equal(pageSelectors[0].dataset.page, '2');
    assert.equal(pageSelectors[0].checked, false);
    assert.equal(pageSelectors[1].dataset.page, '1');
    assert.equal(pageSelectors[1].checked, true);
    pageSelectors[0].checked = true;
    pageSelectors[0].dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(shadow.querySelector('.selected-count').textContent, '2');
    assert.equal(shadow.querySelector('[data-action="select-page"][data-page="2"]').checked, true);
    const pageTwoSelector = shadow.querySelector('[data-action="select-page"][data-page="2"]');
    pageTwoSelector.checked = false;
    pageTwoSelector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(shadow.querySelector('.selected-count').textContent, '1');
    assert.equal(shadow.querySelector('[data-select-id="518192161"]').checked, true);
    shadow.querySelector('[data-action="clear"]').click();
    assert.equal(shadow.querySelector('.selected-count').textContent, '1');
    dom.window.close();
});

test('keeps cross-page duplicate rows in each page group while cumulative actions dedupe goodsId', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { pagination: true, singleSku: 1 });
    let clipboard = '';
    dom.window.GM_setClipboard = (value) => { clipboard = value; };
    const pageOne = dom.window.document.querySelector('[aria-label="Page 1"]');
    const pageTwo = dom.window.document.querySelector('[aria-label="Page 2"]');
    dom.window.document.querySelector('[aria-label="Previous page"]').disabled = true;
    pageOne.setAttribute('aria-current', 'page');
    const markPageTwo = () => {
        pageOne.removeAttribute('aria-current');
        pageTwo.setAttribute('aria-current', 'page');
        dom.window.document.querySelector('[aria-label="Previous page"]').disabled = false;
    };
    pageTwo.addEventListener('click', markPageTwo);
    dom.window.document.querySelector('[aria-label="Next page"]').addEventListener('click', markPageTwo);
    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 30));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    shadow.querySelector('[data-action="next"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 300));
    dom.window.document.querySelector('.product-list-v2__container').innerHTML = [
        simpleProductCard('518192161', 'Page two duplicate'),
        simpleProductCard('812345679', 'Page two unique'),
    ].join('');
    await new Promise((resolve) => dom.window.setTimeout(resolve, 550));

    assert.match(shadow.querySelector('.status').textContent, /累计 2 页 \/ 2/);
    const dividers = [...shadow.querySelectorAll('.page-divider')];
    assert.match(dividers[0].textContent, /第 2 页 · 2 个正式商品/);
    assert.match(dividers[0].textContent, /筛选命中 2 · 跨页重复 1/);
    assert.match(dividers[1].textContent, /第 1 页 · 1 个正式商品/);
    assert.match(dividers[1].textContent, /筛选命中 1 · 跨页重复 1/);
    const productRows = [...shadow.querySelectorAll('tbody tr:not(.page-divider):not(.empty-state)')];
    assert.equal(productRows.length, 3);
    const duplicateRows = productRows.filter((row) => row.dataset.goodsId === '518192161');
    assert.deepEqual(duplicateRows.map((row) => row.dataset.sourcePage), ['2', '1']);
    duplicateRows.forEach((row) => {
        assert.equal(row.dataset.crossPageDuplicate, 'true');
        assert.match(row.querySelector('.duplicate-signal').getAttribute('title'), /第 2、1 页/);
    });

    const pageTwoSelector = shadow.querySelector('[data-action="select-page"][data-page="2"]');
    pageTwoSelector.checked = true;
    pageTwoSelector.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(shadow.querySelector('.selected-count').textContent, '2');
    assert.equal(shadow.querySelector('[data-action="select-page"][data-page="2"]').checked, true);
    shadow.querySelector('[data-action="copy"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    const copiedLinks = clipboard.split('\n');
    assert.equal(copiedLinks.length, 2);
    assert.equal(new Set(copiedLinks.map((link) => selector.extractProductId(link))).size, 2);
    dom.window.close();
});

test('migrates legacy restrictive filters to safe defaults and explains a zero-match table', async () => {
    const migratedDom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { singleSku: 0, relatedColorCount: 0 });
    migratedDom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-US', JSON.stringify({
        filters: { ...selector.clearedFilters('US'), singleSpec: true, salesMin: 1000, priceMin: 100, couponOff: 65, ratingMin: 4.5 },
        open: true,
    }));
    migratedDom.window.eval(source);
    await new Promise((resolve) => migratedDom.window.setTimeout(resolve, 20));
    const migratedShadow = migratedDom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    assert.equal(migratedShadow.querySelector('[data-filter="globalShip"]').checked, true);
    assert.equal(migratedShadow.querySelector('[data-filter="singleSpec"]').checked, false);
    assert.equal(migratedShadow.querySelector('[data-filter="salesMin"]').value, '');
    assert.equal(migratedShadow.querySelector('[data-filter="priceMin"]').value, '');
    assert.equal(migratedShadow.querySelector('[data-filter="couponOff"]').value, '0');
    assert.equal(migratedShadow.querySelector('[data-filter="ratingMin"]').value, '');
    assert.match(migratedShadow.querySelector('.status').textContent, /当前命中 1 · 累计命中 1/);
    migratedDom.window.close();

    const emptyDom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { sales: '50 sold', singleSku: 1 });
    emptyDom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-US', JSON.stringify({
        schemaVersion: 4,
        filters: { ...selector.clearedFilters('US'), globalShip: true, salesMin: 1000 },
        open: true,
    }));
    emptyDom.window.eval(source);
    await new Promise((resolve) => emptyDom.window.setTimeout(resolve, 20));
    const emptyShadow = emptyDom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    assert.match(emptyShadow.querySelector('.status').textContent, /累计 1 页 \/ 1 · 当前命中 0 · 累计命中 0/);
    assert.match(emptyShadow.querySelector('tbody .empty-state').textContent, /累计 1 个正式商品/);
    assert.match(emptyShadow.querySelector('tbody .empty-state').textContent, /清空筛选/);
    emptyDom.window.close();
});

test('retries a transient Jijiyun failure and then fills missing table fields', async (t) => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', {
        sales: '',
        storeCode: '1294342101',
        productData: { comment_num: null, comment_rank_average: null, onSaleTime: null },
    });
    t.after(() => dom.window.close());
    const card = dom.window.document.querySelector('.product-card');
    card.querySelector('.sales').remove();
    card.querySelector('.rating').remove();
    card.querySelector('.comment-count').remove();
    card.querySelector('.delivery-words-title__text').remove();
    dom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-MX', JSON.stringify({ filters: selector.clearedFilters('MX'), open: true }));
    let requests = 0;
    dom.window.GM_xmlhttpRequest = (options) => {
        requests += 1;
        assert.match(options.url, /goodsId=518192161/);
        assert.match(options.url, /mallId=1294342101/);
        assert.equal(options.anonymous, true);
        if (requests === 1) {
            dom.window.setTimeout(() => options.onerror(), 0);
            return;
        }
        dom.window.setTimeout(() => options.onload({
            status: 200,
            response: {
                code: 0,
                data: {
                    goods: { sold: 0, goodsScore: 4.4, reviewNum: 5, onSaleTime: '2020-06-26T08:00:00.000+08:00' },
                    mall: { mallName: 'Balvessa' },
                },
            },
            responseText: '',
        }), 0);
    };
    dom.window.eval(source
        .replace('JIJIYUN_REQUEST_START_GAP_MS = 180', 'JIJIYUN_REQUEST_START_GAP_MS = 5')
        .replace('JIJIYUN_FAILURE_RETRY_BASE_MS = 5 * 1000', 'JIJIYUN_FAILURE_RETRY_BASE_MS = 15')
        .replace('JIJIYUN_FAILURE_RETRY_MAX_MS = 60 * 1000', 'JIJIYUN_FAILURE_RETRY_MAX_MS = 30'));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 1100));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const cells = shadow.querySelector('tbody tr:not(.page-divider):not(.empty-state)').children;
    assert.equal(requests, 2);
    assert.equal(cells[4].textContent.trim(), '0');
    assert.equal(cells[5].textContent.trim(), '★ 4.4');
    assert.equal(cells[6].textContent.trim(), '5');
    assert.equal(cells[7].textContent.trim(), '2020-06-26');
    assert.match(cells[12].textContent, /Balvessa/);
    assert.match(cells[4].querySelector('b').title, /极鲸云/);
    assert.match(cells[12].querySelector('b').title, /极鲸云/);
});

test('rescans when SHEIN hydrates data-store_code after the first render', async () => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', {
        seller: '',
        productData: { comment_num: 1, comment_rank_average: 4.5, onSaleTime: '2026-01-01T00:00:00Z' },
    });
    dom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-MX', JSON.stringify({ filters: selector.clearedFilters('MX'), open: true }));
    const requestedMallIds = [];
    dom.window.GM_xmlhttpRequest = (options) => {
        const mallId = new URL(options.url).searchParams.get('mallId');
        requestedMallIds.push(mallId);
        dom.window.setTimeout(() => options.onload({
            status: 200,
            response: mallId === '8985397265'
                ? { code: 0, data: { goods: {}, mall: { mallName: 'Twelve Optimal Selection' } } }
                : { code: 0, data: { goods: {}, mall: {} } },
            responseText: '',
        }), 0);
    };
    dom.window.eval(source.replace('JIJIYUN_REQUEST_START_GAP_MS = 180', 'JIJIYUN_REQUEST_START_GAP_MS = 5'));
    dom.window.setTimeout(() => {
        dom.window.document.querySelector('.S-product-card__img-container').setAttribute('data-store_code', '8985397265');
    }, 40);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 1100));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    assert.ok(requestedMallIds.includes('8985397265'));
    assert.match(shadow.querySelector('tbody tr:not(.page-divider):not(.empty-state)').children[12].textContent, /Twelve Optimal Selection/);
    dom.window.close();
});

test('waits through a soft-limit cooldown and resumes pending specs at one worker', async () => {
    const goodsId = '465161453';
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { id: goodsId, singleSku: 0, relatedColorCount: 2 });
    dom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-US', JSON.stringify({ filters: selector.clearedFilters('US'), open: true }));
    const detailRawData = {
        canonicalInfo: { goods_id: goodsId },
        modules: {
            productInfo: { goods_id: goodsId },
            saleAttr: {
                mainSaleAttribute: {
                    attr_id: '27', attr_name: 'Color',
                    info: ['red', 'blue'].map((value) => ({ goods_id: `${goodsId}-${value}`, attr_id: '27', attr_name: 'Color', attr_value_id: value })),
                },
                multiLevelSaleAttribute: {
                    goods_id: goodsId,
                    skc_sale_attr: [{ attr_id: '87', attr_name: 'Size', attr_value_list: ['S', 'M'].map((value) => ({ attr_value_id: value })) }],
                    sku_list: ['S', 'M'].map((value) => ({ sku_code: value, sku_sale_attr: [{ attr_id: '87', attr_name: 'Size', attr_value_id: value }] })),
                },
            },
        },
    };
    let requests = 0;
    dom.window.fetch = async (url) => {
        requests += 1;
        if (requests === 1) {
            return {
                ok: true,
                status: 200,
                url: 'https://us.shein.com/risk/action/limit',
                text: async () => '<!DOCTYPE html><title>captcha</title>',
            };
        }
        return {
            ok: true,
            status: 200,
            url,
            text: async () => JSON.stringify({ code: '0', msg: 'ok', info: detailRawData.modules }),
        };
    };
    const acceleratedSource = source.replace('DETAIL_SPEC_RATE_LIMIT_COOLDOWN_MS = 15 * 1000', 'DETAIL_SPEC_RATE_LIMIT_COOLDOWN_MS = 120');
    dom.window.eval(acceleratedSource);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    assert.equal(shadow.querySelector('tbody .pill').textContent, '—');

    shadow.querySelector('[data-action="spec-scan"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 50));
    assert.equal(requests, 1);
    const failed = shadow.querySelector('tbody .pill.failed');
    assert.equal(failed.textContent, '！');
    assert.match(failed.dataset.specError, /接口限流/);
    failed.dispatchEvent(new dom.window.Event('pointerover', { bubbles: true }));
    assert.equal(shadow.querySelector('.spec-error-tooltip').hidden, false);
    assert.match(shadow.querySelector('.spec-error-tooltip').textContent, /接口限流/);
    failed.click();
    assert.match(shadow.querySelector('.toast').textContent, /无需验证/);

    shadow.querySelector('[data-action="spec-scan"]').click();
    assert.match(shadow.querySelector('.status').textContent, /自动续跑/);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 50));
    assert.equal(requests, 1);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 400));
    assert.equal(requests, 2);
    assert.equal(shadow.querySelector('tbody .pill').textContent, 'Dual');
    assert.match(shadow.querySelector('.summary').textContent, /规格已确认1/);
    assert.match(shadow.querySelector('.summary').textContent, /规格失败0/);
    dom.window.close();
});

test('staggers the five-worker detail queue and cancels waiting siblings after a soft limit', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { id: '7001', singleSku: 0, relatedColorCount: 0 });
    const document = dom.window.document;
    const baseCard = document.querySelector('.product-card');
    Array.from({ length: 5 }, (_, index) => String(7002 + index)).forEach((id) => {
        const card = baseCard.cloneNode(true);
        card.querySelectorAll('a').forEach((link) => { link.href = `/Parallel-item-p-${id}.html?mallCode=1`; });
        document.querySelector('.product-list-v2__container').appendChild(card);
    });
    dom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-US', JSON.stringify({ filters: selector.clearedFilters('US'), open: true }));
    dom.window.GM_xmlhttpRequest = (options) => dom.window.setTimeout(() => options.onload({ status: 200, response: { code: 1 }, responseText: '' }), 0);

    let requests = 0;
    let active = 0;
    let maxActive = 0;
    let aborted = 0;
    dom.window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
        requests += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        const requestNumber = requests;
        let settled = false;
        const finish = (callback) => {
            if (settled) return;
            settled = true;
            active -= 1;
            callback();
        };
        const timer = dom.window.setTimeout(() => finish(() => {
            if (requestNumber === 1) {
                resolve({
                    ok: true,
                    status: 200,
                    url: 'https://us.shein.com/risk/action/limit',
                    text: async () => '<!DOCTYPE html><title>captcha</title>',
                });
                return;
            }
            const goodsId = new URL(url).searchParams.get('goods_id');
            resolve({
                ok: true,
                status: 200,
                url,
                text: async () => JSON.stringify({ code: '0', info: { productInfo: { goods_id: goodsId }, saleAttr: {} } }),
            });
        }), requestNumber === 1 ? 30 : 260);
        options.signal?.addEventListener('abort', () => finish(() => {
            dom.window.clearTimeout(timer);
            aborted += 1;
            reject(new dom.window.DOMException('Aborted', 'AbortError'));
        }), { once: true });
    });

    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const shadow = document.getElementById('xynigo-shein-selector-host').shadowRoot;
    shadow.querySelector('[data-action="spec-scan"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 430));

    assert.equal(requests, 1);
    assert.equal(maxActive, 1);
    assert.equal(aborted, 0);
    assert.equal(shadow.querySelectorAll('tbody .pill.failed').length, 1);
    assert.match(shadow.querySelector('.status').textContent, /接口限流/);
    assert.match(shadow.querySelector('.status').textContent, /1并发/);
    dom.window.close();
});

test('caps successful detail completion at five concurrent in-flight requests', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { id: '7101', singleSku: 0, relatedColorCount: 0 });
    const document = dom.window.document;
    const baseCard = document.querySelector('.product-card');
    Array.from({ length: 5 }, (_, index) => String(7102 + index)).forEach((id) => {
        const card = baseCard.cloneNode(true);
        card.querySelectorAll('a').forEach((link) => { link.href = `/Parallel-success-p-${id}.html?mallCode=1`; });
        document.querySelector('.product-list-v2__container').appendChild(card);
    });
    dom.window.sessionStorage.setItem('xynigo-shein-selector-session-v2-US', JSON.stringify({ filters: selector.clearedFilters('US'), open: true }));
    dom.window.GM_xmlhttpRequest = (options) => dom.window.setTimeout(() => options.onload({ status: 200, response: { code: 1 }, responseText: '' }), 0);

    let requests = 0;
    let active = 0;
    let maxActive = 0;
    dom.window.fetch = (url) => new Promise((resolve) => {
        requests += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        const goodsId = new URL(url).searchParams.get('goods_id');
        dom.window.setTimeout(() => {
            active -= 1;
            resolve({
                ok: true,
                status: 200,
                url,
                text: async () => JSON.stringify({
                    code: '0',
                    info: {
                        productInfo: { goods_id: goodsId },
                        saleAttr: {
                            mainSaleAttribute: {
                                attr_name: 'Color',
                                info: [{ goods_id: `${goodsId}-black`, attr_name: 'Color', attr_value_id: 'black' }, { goods_id: `${goodsId}-white`, attr_name: 'Color', attr_value_id: 'white' }],
                            },
                            multiLevelSaleAttribute: {
                                goods_id: goodsId,
                                skc_sale_attr: [{ attr_name: 'Size', attr_value_list: [{ attr_value_id: 'S' }, { attr_value_id: 'M' }] }],
                                sku_list: [
                                    { sku_code: `${goodsId}-S`, sku_sale_attr: [{ attr_name: 'Size', attr_value_id: 'S' }] },
                                    { sku_code: `${goodsId}-M`, sku_sale_attr: [{ attr_name: 'Size', attr_value_id: 'M' }] },
                                ],
                            },
                        },
                    },
                }),
            });
        }, 140);
    });

    const acceleratedSource = source.replace('DETAIL_SPEC_REQUEST_START_GAP_MS = 300', 'DETAIL_SPEC_REQUEST_START_GAP_MS = 20');
    dom.window.eval(acceleratedSource);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const shadow = document.getElementById('xynigo-shein-selector-host').shadowRoot;
    shadow.querySelector('[data-action="spec-scan"]').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 900));

    try {
        assert.equal(requests, 6);
        assert.equal(maxActive, 5);
        assert.match(shadow.querySelector('.summary').textContent, /规格已确认6/);
    } finally {
        dom.window.close();
    }
});

test('renders numeric sales and sorts sales, reviews, and both price columns numerically', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', { price: '$320.00', sales: '3.6k+ sold', singleSku: 1 });
    const document = dom.window.document;
    const baseCard = document.querySelector('.product-card');
    [
        { id: '2002', title: 'Lower sales item', price: '$198.00', sales: '1.2k+ sold', reviews: 386 },
        { id: '2003', title: 'Higher sales item', price: '$463.34', sales: '4.9k+ sold', reviews: 2412 },
    ].forEach((fixture) => {
        const card = baseCard.cloneNode(true);
        const links = card.querySelectorAll('a');
        links[0].href = `/${fixture.title.replace(/\s+/g, '-')}-p-${fixture.id}.html`;
        links[0].title = fixture.title;
        links[1].href = `/${fixture.title.replace(/\s+/g, '-')}-p-${fixture.id}.html`;
        links[1].textContent = fixture.title;
        card.querySelector('.sale-price').textContent = fixture.price;
        card.querySelector('.sales').textContent = fixture.sales;
        card.querySelector('.comment-count').textContent = String(fixture.reviews);
        document.querySelector('.product-list-v2__container').appendChild(card);
    });

    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const shadow = document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const columnValues = (index) => [...shadow.querySelectorAll('tbody tr:not(.page-divider):not(.empty-state)')].map((row) => row.children[index].textContent.trim());

    shadow.querySelector('[data-sort-key="sales"]').click();
    assert.deepEqual(columnValues(4), ['1,200', '3,600', '4,900']);
    assert.equal(shadow.querySelector('[data-sort-key="sales"]').closest('th').getAttribute('aria-sort'), 'ascending');
    shadow.querySelector('[data-sort-key="sales"]').click();
    assert.deepEqual(columnValues(4), ['4,900', '3,600', '1,200']);

    shadow.querySelector('[data-sort-key="pagePrice"]').click();
    assert.deepEqual(columnValues(2), ['USD 198.00', 'USD 320.00', 'USD 463.34']);
    shadow.querySelector('[data-sort-key="effectivePrice"]').click();
    assert.deepEqual(columnValues(3), ['USD 198.00', 'USD 320.00', 'USD 463.34']);
    shadow.querySelector('[data-sort-key="reviews"]').click();
    assert.deepEqual(columnValues(6), ['386', '1,268', '2,412']);
    shadow.querySelector('[data-sort-key="reviews"]').click();
    assert.deepEqual(columnValues(6), ['2,412', '1,268', '386']);
    assert.doesNotMatch(shadow.querySelector('tbody').textContent, /lower bound|k\+ sold/i);
    dom.window.close();
});

test('refreshes the workbench image when a lower card finishes lazy loading', async () => {
    const dom = productFixture('https://us.shein.com/Women-Clothing-c-2030.html', {
        imageHtml: '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">',
        singleSku: 1,
    });
    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const host = dom.window.document.getElementById('xynigo-shein-selector-host');
    const tableWrap = host.shadowRoot.querySelector('.table-wrap');
    const initialImage = host.shadowRoot.querySelector('.product-cell img');
    assert.equal(initialImage.hasAttribute('src'), false);
    tableWrap.scrollTop = 37;

    dom.window.document.querySelector('.product-card img').setAttribute('data-src', '//img.ltwebstatic.com/images3_pi/lower-card.webp');
    await new Promise((resolve) => dom.window.setTimeout(resolve, 420));

    const refreshedImage = host.shadowRoot.querySelector('.product-cell img');
    assert.equal(refreshedImage.getAttribute('src'), 'https://img.ltwebstatic.com/images3_pi/lower-card.webp');
    assert.equal(tableWrap.scrollTop, 37);
    assert.equal(host.shadowRoot.querySelector('.toast').classList.contains('show'), false);
    dom.window.close();
});

test('declares dual-site userscript access and pinned ExcelJS', () => {
    assert.match(source, /^\/\/ @name\s+Shein Global Selector$/m);
    assert.match(source, /^\/\/ @version\s+0\.5\.1$/m);
    assert.match(source, /DETAIL_SPEC_CONCURRENCY = 5/);
    assert.match(source, /DETAIL_SPEC_REQUEST_START_GAP_MS = 300/);
    assert.match(source, /^\/\/ @match\s+https:\/\/us\.shein\.com\/\*$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/\*\.shein\.com\.mx\/\*$/m);
    assert.match(source, /^\/\/ @require\s+https:\/\/cdn\.jsdelivr\.net\/npm\/exceljs@4\.4\.0\/dist\/exceljs\.min\.js$/m);
    assert.match(source, /GM_xmlhttpRequest/);
    assert.match(source, /^\/\/ @connect\s+api\.sheinshuju\.com$/m);
    assert.match(source, /全部累计页面筛选结果/);
    assert.match(source, /data-action="clear"/);
});
