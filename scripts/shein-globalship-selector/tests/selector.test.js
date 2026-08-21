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
      <script type="application/json">${JSON.stringify({ goods: [{ goods_id: id, goods_sn: `SKU-${id}`, is_single_sku: singleSku, relatedColorNew, comment_num: reviews, onSaleTime: '2024-01-01T00:00:00Z', ...(options.productData || {}) }] })}</script>
      ${options.pagination ? '<nav class="sui-pagination"><button type="button" aria-label="Previous page">Previous page</button><button type="button" aria-label="Page 1">1</button><button type="button" aria-label="Page 2">2</button><button type="button" aria-label="Next page">Next page</button></nav>' : ''}
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
    assert.equal([...host.shadowRoot.querySelectorAll('tbody tr')].every((row) => row.children.length === 15), true);
    assert.doesNotMatch(host.shadowRoot.querySelector('tbody tr').children[5].textContent, /reviews/i);
    assert.equal(host.shadowRoot.querySelector('tbody tr').children[6].textContent.trim(), '1,268');
    assert.equal(host.shadowRoot.querySelector('tbody tr').children[9].querySelector('b').textContent, 'Color');
    assert.equal(host.shadowRoot.querySelector('tbody tr').children[9].querySelector('.sub').textContent, '4');
    const responsiveCss = host.shadowRoot.querySelector('style').textContent;
    assert.match(responsiveCss, /grid-template-rows:auto auto minmax\(0,1fr\)/);
    assert.match(responsiveCss, /calc\(930px \+ var\(--product-column-width\) \+ var\(--sold-by-column-width\)\)/);
    assert.match(responsiveCss, /@media\(max-width:1279px\)/);
    assert.match(responsiveCss, /@media\(max-width:1023px\)/);
    assert.match(responsiveCss, /\.panel\.summary-open aside/);
    assert.match(responsiveCss, /\.filter label\.switch\{width:22px;height:13px;flex:0 0 22px/);
    assert.match(responsiveCss, /\.pictogram-single-spec:before/);
    assert.match(responsiveCss, /repeat\(4,minmax\(112px,1fr\)\) minmax\(132px,1\.05fr\)/);
    assert.match(responsiveCss, /\.coupon-row\{display:grid;grid-template-columns:113px minmax\(0,1fr\);gap:0/);
    assert.match(responsiveCss, /\.coupon-tools\{[^}]*border-left:1px solid #cad4cf/);
    assert.match(responsiveCss, /\.price-inputs\{grid-template-columns:48px 8px 48px 64px;justify-content:start/);
    assert.match(responsiveCss, /\.inline-field input,\.inline-field select\{[^}]*max-width:66px/);
    assert.equal(host.shadowRoot.querySelectorAll('[data-sort-key]').length, 5);
    assert.ok(host.shadowRoot.querySelector('[data-action="spec-scan"]'));
    assert.equal(host.shadowRoot.querySelector('[data-filter="singleSpec"]').closest('.filter').querySelector('small').textContent, 'Specification');
    assert.ok(host.shadowRoot.querySelector('.coupon-custom'));
    assert.equal(host.shadowRoot.querySelector('.coupon-suffix').textContent, '%');
    const summaryToggle = host.shadowRoot.querySelector('[data-action="summary"]');
    assert.equal(summaryToggle.getAttribute('aria-expanded'), 'false');
    summaryToggle.click();
    assert.equal(summaryToggle.getAttribute('aria-expanded'), 'true');
    assert.equal(host.shadowRoot.querySelector('.panel').classList.contains('summary-open'), true);
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
    assert.match(migratedShadow.querySelector('.status').textContent, /1 matched/);
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
    assert.match(emptyShadow.querySelector('.status').textContent, /1 loaded · 0 matched/);
    assert.match(emptyShadow.querySelector('tbody .empty-state').textContent, /已扫描 1 个商品/);
    assert.match(emptyShadow.querySelector('tbody .empty-state').textContent, /清空筛选/);
    emptyDom.window.close();
});

test('retries a transient Jijiyun failure and then fills missing table fields', async () => {
    const dom = productFixture('https://www.shein.com.mx/Women-Clothing-c-2030.html', {
        sales: '',
        storeCode: '1294342101',
        productData: { comment_num: null, comment_rank_average: null, onSaleTime: null },
    });
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
    await new Promise((resolve) => dom.window.setTimeout(resolve, 750));
    const shadow = dom.window.document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const cells = shadow.querySelector('tbody tr').children;
    assert.equal(requests, 2);
    assert.equal(cells[4].textContent.trim(), '0');
    assert.equal(cells[5].textContent.trim(), '★ 4.4');
    assert.equal(cells[6].textContent.trim(), '5');
    assert.equal(cells[7].textContent.trim(), '2020-06-26');
    assert.match(cells[12].textContent, /Balvessa/);
    assert.match(cells[4].querySelector('b').title, /极鲸云/);
    assert.match(cells[12].querySelector('b').title, /极鲸云/);
    dom.window.close();
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
    assert.match(shadow.querySelector('tbody tr').children[12].textContent, /Twelve Optimal Selection/);
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
        document.body.insertBefore(card, document.querySelector('script'));
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
        document.body.insertBefore(card, document.querySelector('script'));
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
        document.body.insertBefore(card, document.querySelector('script'));
    });

    dom.window.eval(source);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));
    const shadow = document.getElementById('xynigo-shein-selector-host').shadowRoot;
    const columnValues = (index) => [...shadow.querySelectorAll('tbody tr')].map((row) => row.children[index].textContent.trim());

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
    assert.match(source, /^\/\/ @version\s+0\.3\.21$/m);
    assert.match(source, /DETAIL_SPEC_CONCURRENCY = 5/);
    assert.match(source, /DETAIL_SPEC_REQUEST_START_GAP_MS = 300/);
    assert.match(source, /^\/\/ @match\s+https:\/\/us\.shein\.com\/\*$/m);
    assert.match(source, /^\/\/ @match\s+https:\/\/\*\.shein\.com\.mx\/\*$/m);
    assert.match(source, /^\/\/ @require\s+https:\/\/cdn\.jsdelivr\.net\/npm\/exceljs@4\.4\.0\/dist\/exceljs\.min\.js$/m);
    assert.match(source, /GM_xmlhttpRequest/);
    assert.match(source, /^\/\/ @connect\s+api\.sheinshuju\.com$/m);
    assert.match(source, /当前页全部筛选结果/);
    assert.match(source, /data-action="clear"/);
});
