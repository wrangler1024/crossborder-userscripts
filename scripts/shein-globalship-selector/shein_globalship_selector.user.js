// ==UserScript==
// @name         Shein Global Selector
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      0.2.0
// @description  面向 SHEIN 美国站与墨西哥站搜索页、类目页的选品工作台，支持 GlobalShip 筛选、链接复制与 Excel 导出。
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/scripts/shein-globalship-selector
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @match        https://us.shein.com/*
// @match        https://shein.com.mx/*
// @match        https://*.shein.com.mx/*
// @icon         https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/assets/xynigo-mascot.png
// @resource     XYNIGO_MASCOT https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/assets/xynigo-mascot.png
// @require      https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_getResourceURL
// @connect      img.ltwebstatic.com
// @connect      *.ltwebstatic.com
// @connect      img.shein.com
// @connect      us.shein.com
// @connect      shein.com.mx
// @connect      www.shein.com.mx
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js
// @updateURL    https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-globalship-selector/shein_globalship_selector.user.js
// ==/UserScript==

(function expose(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.XynigoSheinGlobalShipSelector = api;
    if (typeof document !== 'undefined' && typeof window !== 'undefined') api.boot();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSelector() {
    'use strict';

    const APP_ID = 'xynigo-shein-selector';
    const HOST_ID = `${APP_ID}-host`;
    const LAUNCHER_HOST_ID = `${APP_ID}-launcher-host`;
    const LAUNCHER_ID = `${APP_ID}-launcher`;
    const SESSION_KEY = `${APP_ID}-session-v2`;
    const LAUNCHER_POSITION_KEY = `${APP_ID}-launcher-top-v1`;
    const COPY_SHORTCUT_KEY = `${APP_ID}-copy-shortcut-v1`;
    const COPY_SCOPE_KEY = `${APP_ID}-copy-scope-v1`;
    const PRODUCT_LINK_SELECTOR = 'a[href*="-p-"][href*=".html"],a[href*="goods-p-"]';
    const EXCLUDED_PATH = /\/(?:cart|user|account|orders?|checkout|login|wishlist)(?:\/|$)/i;
    const DETAIL_PATH = /(?:-p-|goods-p-)(\d+)\.html(?:\/)?$/i;
    const LIST_PATH = /(?:^\/pdsearch\/|-(?:c|sc)-\d+\.html(?:\/)?$)/i;
    const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
    const LAUNCHER_HEIGHT = 44;
    const DEFAULT_COPY_SHORTCUT = Object.freeze({ code: 'KeyL', key: 'l', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false });
    const FILTER_DEFAULTS = Object.freeze({
        globalShip: true,
        quickShip: false,
        trends: false,
        newArrivals: false,
        salesMin: 1000,
        priceMin: null,
        priceMax: null,
        couponOff: 0,
        ratingMin: 4.5,
    });

    function asText(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function normalizeText(value) {
        return asText(value).replace(/\s+/g, ' ').trim();
    }

    function lowerText(value) {
        return normalizeText(value).toLowerCase();
    }

    function mascotAssetUrl() {
        try {
            if (typeof GM_getResourceURL === 'function') return GM_getResourceURL('XYNIGO_MASCOT');
        } catch (_error) {
            // Chromium extension builds continue with the packaged mascot.
        }
        try {
            if (globalThis.chrome?.runtime?.getURL) return globalThis.chrome.runtime.getURL('xynigo-mascot.png');
        } catch (_error) {
            // Fall back to the public project asset for other userscript engines.
        }
        return 'https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/assets/xynigo-mascot.png';
    }

    function toUrl(value, base) {
        try {
            return new URL(value, base);
        } catch (_error) {
            return null;
        }
    }

    function getSiteProfile(url) {
        const parsed = toUrl(url);
        const hostname = parsed?.hostname.toLowerCase() || '';
        if (hostname === 'us.shein.com') {
            return { code: 'US', currency: 'USD', symbol: '$', hostname };
        }
        if (hostname === 'shein.com.mx' || hostname.endsWith('.shein.com.mx')) {
            return { code: 'MX', currency: 'MXN', symbol: '$', hostname };
        }
        return null;
    }

    function isSupportedListingUrl(url) {
        const parsed = toUrl(url);
        if (!parsed || !getSiteProfile(url) || EXCLUDED_PATH.test(parsed.pathname)) return false;
        if (DETAIL_PATH.test(parsed.pathname)) return false;
        return LIST_PATH.test(parsed.pathname);
    }

    function isSearchResultsUrl(url) {
        const parsed = toUrl(url);
        return Boolean(parsed && getSiteProfile(url) && /^\/pdsearch\//i.test(parsed.pathname));
    }

    function getPageType(url) {
        if (isSearchResultsUrl(url)) return 'Search';
        return isSupportedListingUrl(url) ? 'Category' : 'Unsupported';
    }

    function extractProductId(url, base = 'https://us.shein.com/') {
        const parsed = toUrl(url, base);
        if (!parsed) return '';
        const match = parsed.pathname.match(/(?:-p-|goods-p-)(\d+)\.html(?:\/)?$/i);
        return match ? match[1] : '';
    }

    function canonicalizeProductUrl(url, base = 'https://us.shein.com/') {
        const parsed = toUrl(url, base);
        const goodsId = extractProductId(url, base);
        if (!parsed || !goodsId || !getSiteProfile(parsed.href)) return '';
        parsed.search = '';
        parsed.hash = '';
        return `${parsed.origin}${parsed.pathname}`;
    }

    function parseNumber(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        let raw = normalizeText(value).replace(/[^\d.,+-]/g, '');
        if (!raw) return null;
        const lastComma = raw.lastIndexOf(',');
        const lastDot = raw.lastIndexOf('.');
        if (lastComma >= 0 && lastDot >= 0) {
            raw = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
        } else if (lastComma >= 0) {
            const decimals = raw.length - lastComma - 1;
            raw = decimals === 1 || decimals === 2 ? raw.replace(',', '.') : raw.replace(/,/g, '');
        } else if ((raw.match(/\./g) || []).length > 1) {
            const parts = raw.split('.');
            raw = `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
        }
        const number = Number(raw);
        return Number.isFinite(number) ? number : null;
    }

    function parseSales(value) {
        const raw = lowerText(value).replace(/\+/g, '');
        const match = raw.match(/([\d.,]+)\s*([km万千]?)/i);
        if (!match) return null;
        const amount = parseNumber(match[1]);
        if (amount === null) return null;
        const unit = match[2].toLowerCase();
        if (unit === 'k' || unit === '千') return Math.round(amount * 1000);
        if (unit === 'm') return Math.round(amount * 1000000);
        if (unit === '万') return Math.round(amount * 10000);
        return Math.round(amount);
    }

    function getPageNumber(url) {
        const parsed = toUrl(url);
        return Math.max(1, Number(parsed?.searchParams.get('page')) || 1);
    }

    function getKeyword(url, doc) {
        const parsed = toUrl(url);
        if (!parsed) return '';
        if (/^\/pdsearch\//i.test(parsed.pathname)) {
            return decodeURIComponent(parsed.pathname.replace(/^\/pdsearch\//i, '').replace(/\/$/, ''));
        }
        return normalizeText(doc?.querySelector?.('h1')?.textContent || doc?.title || '');
    }

    function hasExactSignal(text, names) {
        const normalized = lowerText(text);
        return names.some((name) => new RegExp(`(?:^|[^a-z])${name}(?:$|[^a-z])`, 'i').test(normalized));
    }

    function hasExactElementLabel(root, names) {
        const normalizedNames = names.map(lowerText);
        return [root, ...Array.from(root?.querySelectorAll?.('*') || [])].some((element) => {
            const label = lowerText(element?.getAttribute?.('aria-label') || element?.getAttribute?.('title') || element?.textContent);
            return normalizedNames.includes(label);
        });
    }

    function collectJsonProductMap(doc) {
        const productMap = new Map();
        let seenObjects = 0;
        const visit = (value) => {
            if (!value || typeof value !== 'object' || seenObjects > 60000) return;
            seenObjects += 1;
            if (Array.isArray(value)) {
                value.forEach(visit);
                return;
            }
            const goodsId = asText(value.goods_id ?? value.goodsId ?? value.product_id ?? value.productId);
            if (/^\d+$/.test(goodsId)) productMap.set(goodsId, { ...(productMap.get(goodsId) || {}), ...value });
            Object.values(value).forEach(visit);
        };
        Array.from(doc?.querySelectorAll?.('script[type="application/json"],script#__NEXT_DATA__') || [])
            .slice(0, 30)
            .forEach((script) => {
                const source = script.textContent?.trim();
                if (!source || source.length > 12_000_000) return;
                try { visit(JSON.parse(source)); } catch (_error) { /* Ignore unrelated JSON. */ }
            });
        return productMap;
    }

    function findProductCard(link) {
        const goodsId = extractProductId(link?.href || link?.getAttribute?.('href'));
        if (!goodsId) return null;
        let current = link;
        let best = null;
        for (let depth = 0; current?.parentElement && depth < 11; depth += 1) {
            current = current.parentElement;
            const ids = productIdsWithin(current);
            if (ids.size > 1) break;
            if (ids.size === 1 && ids.has(goodsId)) {
                const images = current.querySelectorAll?.('img')?.length || 0;
                if (images) best = current;
            }
        }
        return best;
    }

    function productIdsWithin(root) {
        const ids = new Set();
        const links = [];
        if (root?.matches?.(PRODUCT_LINK_SELECTOR)) links.push(root);
        root?.querySelectorAll?.(PRODUCT_LINK_SELECTOR).forEach((link) => links.push(link));
        links.forEach((link) => {
            const id = extractProductId(link.href || link.getAttribute?.('href'));
            if (id) ids.add(id);
        });
        return ids;
    }

    function collectProductCards(root) {
        const cards = new Set();
        root.querySelectorAll(PRODUCT_LINK_SELECTOR).forEach((link) => {
            const card = findProductCard(link);
            if (card) cards.add(card);
        });
        return Array.from(cards);
    }

    function firstText(root, selectors) {
        for (const selector of selectors) {
            const value = normalizeText(root.querySelector?.(selector)?.textContent);
            if (value) return value;
        }
        return '';
    }

    function firstImage(root) {
        const image = root.querySelector?.('img');
        const value = image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || image?.getAttribute?.('data-original');
        if (!value) return '';
        if (value.startsWith('//')) return `https:${value}`;
        return toUrl(value, root.ownerDocument?.location?.href)?.href || '';
    }

    function structuredValue(data, names) {
        for (const name of names) {
            if (data?.[name] !== undefined && data?.[name] !== null && data?.[name] !== '') return data[name];
        }
        return null;
    }

    function ratingFromStars(card) {
        const starList = Array.from(card.querySelectorAll?.('.star-icon-list') || [])
            .find((list) => list.querySelectorAll('i[class*="_star_"]').length === 5);
        const stars = Array.from(starList?.querySelectorAll?.('i[class*="_star_"]') || []);
        if (stars.length !== 5) return null;
        const levels = stars.map((star) => Number(asText(star.className).match(/_star_(\d+)_/)?.[1]));
        if (levels.some((level) => !Number.isFinite(level) || level < 0 || level > 5)) return null;
        return Math.round(levels.reduce((sum, level) => sum + level / 5, 0) * 10) / 10;
    }

    function styleCountFromCard(card) {
        const explicit = parseNumber(firstText(card, ['.product-card__color-count', '[class*="color-count"]']));
        if (explicit !== null) return explicit;
        const swatches = card.querySelectorAll?.('.product-card__color-item,[class*="color-item"]')?.length || 0;
        return swatches || 1;
    }

    function extractProduct(card, context) {
        const link = Array.from(card.querySelectorAll(PRODUCT_LINK_SELECTOR))
            .find((candidate) => extractProductId(candidate.href || candidate.getAttribute('href')));
        if (!link) return null;
        const url = canonicalizeProductUrl(link.href || link.getAttribute('href'), context.url);
        const goodsId = extractProductId(url);
        if (!url || !goodsId) return null;
        const data = context.productMap.get(goodsId) || {};
        const cardText = normalizeText(card.textContent);
        const title = normalizeText(
            link.getAttribute('title')
            || link.getAttribute('aria-label')
            || firstText(card, ['[class*="goods-title"]', '[class*="product-name"]', '[class*="item-name"]'])
            || structuredValue(data, ['goods_name', 'goodsName', 'productName']),
        );
        const currentPriceText = firstText(card, ['[class*="sale-price"]', '[class*="discount-price"]', '[class*="goods-price"]', '[class*="product-price"]', '[class*="price"]']);
        const originalPriceText = firstText(card, ['del', 's', '[class*="original-price"]', '[class*="retail-price"]']);
        const currentPrice = parseNumber(currentPriceText || structuredValue(data, ['salePrice', 'sale_price', 'retailPrice', 'retail_price', 'price']));
        const originalPrice = parseNumber(originalPriceText || structuredValue(data, ['originalPrice', 'original_price', 'marketPrice', 'market_price'])) || currentPrice;
        const salesRaw = firstText(card, ['[class*="sale-volume"]', '[class*="sold"]', '[class*="sales"]'])
            || cardText.match(/[\d.,]+\s*[km]?\+?\s*(?:sold|vendidos)/i)?.[0]
            || normalizeText(structuredValue(data, ['sales_volume_text', 'salesVolumeText', 'soldText']));
        const sales = parseSales(salesRaw);
        const ratingRaw = structuredValue(data, ['comment_rank_average', 'commentRankAverage', 'rating', 'star'])
            || card.getAttribute('data-rating')
            || firstText(card, ['[class*="rating"]', '[aria-label*="star"]']);
        const rating = parseNumber(ratingRaw) ?? ratingFromStars(card);
        const reviewsRaw = structuredValue(data, ['comment_num', 'commentNum', 'reviewCount'])
            || firstText(card, ['.start-text', '[class*="review-count"]', '[class*="comment"]']);
        const reviews = parseSales(reviewsRaw);
        const singleSku = structuredValue(data, ['is_single_sku', 'isSingleSku']) ?? card.getAttribute('data-is-single-sku');
        const relatedColors = structuredValue(data, ['relatedColorNew', 'related_color_new', 'colorList', 'colors']);
        const styles = Array.isArray(relatedColors) ? relatedColors.length : (parseNumber(card.getAttribute('data-style-count')) ?? styleCountFromCard(card));
        const knownMultiSku = singleSku === 0 || singleSku === '0' || singleSku === false
            ? 'Yes'
            : (singleSku === 1 || singleSku === '1' || singleSku === true ? 'No' : (styles > 1 ? 'Yes' : '—'));
        const seller = normalizeText(structuredValue(data, ['storeTitle', 'store_title', 'sellerName', 'seller_name'])
            || firstText(card, ['.delivery-words-title__text', '.delivery-words-title', '[class*="store-name"]', '[class*="seller-name"]', '[class*="brand-title"]'])) || '—';
        const isQuickShip = hasExactElementLabel(card, ['quickship', 'local']);
        const fulfillment = isQuickShip ? 'QuickShip' : 'GlobalShip';
        return {
            site: context.site.code,
            pageType: context.pageType,
            keyword: context.keyword,
            page: context.page,
            scannedAt: new Date().toISOString(),
            goodsId,
            productSku: normalizeText(structuredValue(data, ['goods_sn', 'goodsSn', 'productSku', 'product_sku'])) || '—',
            title: title || `SHEIN ${goodsId}`,
            url,
            imageUrl: firstImage(card) || normalizeText(structuredValue(data, ['goods_img', 'goodsImg', 'imageUrl', 'image_url'])),
            currency: context.site.currency,
            originalPrice,
            currentPrice,
            salesRaw: salesRaw || '—',
            sales,
            rating,
            reviews,
            multiSku: knownMultiSku,
            styles: styles ?? '—',
            specs: styles > 1 ? 'Color' : '—',
            skuQty: '—',
            fulfillment,
            seller,
            storeType: /official/i.test(cardText) ? 'Official store' : '—',
            trends: hasExactElementLabel(card, ['trends']),
            newArrivals: hasExactElementLabel(card, ['new arrivals', 'new arrival', 'novedades']),
            bestSeller: /(?:best seller|más vendidos)/i.test(cardText),
            almostSoldOut: /(?:almost sold out|casi agotado)/i.test(cardText),
            repeatCustomers: /repeat customers/i.test(cardText),
            otherSellers: /other sellers/i.test(cardText),
        };
    }

    function collectProducts(doc, url = doc?.location?.href || '') {
        if (!isSupportedListingUrl(url)) return [];
        const site = getSiteProfile(url);
        const context = {
            url,
            site,
            pageType: getPageType(url),
            keyword: getKeyword(url, doc),
            page: getPageNumber(url),
            productMap: collectJsonProductMap(doc),
        };
        const products = new Map();
        collectProductCards(doc).forEach((card) => {
            const product = extractProduct(card, context);
            if (product) products.set(product.goodsId, product);
        });
        return Array.from(products.values());
    }

    function normalizeFilters(filters = {}, siteCode = 'MX') {
        const defaults = {
            ...FILTER_DEFAULTS,
            priceMin: siteCode === 'MX' ? 100 : null,
            couponOff: siteCode === 'MX' ? 65 : 0,
        };
        const merged = { ...defaults, ...(filters && typeof filters === 'object' ? filters : {}) };
        const optionalNumber = (value, fallback) => {
            if (value === null || value === '') return null;
            const number = Number(value);
            return Number.isFinite(number) ? number : fallback;
        };
        return {
            globalShip: Boolean(merged.globalShip),
            quickShip: Boolean(merged.quickShip),
            trends: Boolean(merged.trends),
            newArrivals: Boolean(merged.newArrivals),
            salesMin: optionalNumber(merged.salesMin, defaults.salesMin),
            priceMin: optionalNumber(merged.priceMin, defaults.priceMin),
            priceMax: optionalNumber(merged.priceMax, defaults.priceMax),
            couponOff: Math.min(100, Math.max(0, optionalNumber(merged.couponOff, defaults.couponOff) ?? 0)),
            ratingMin: optionalNumber(merged.ratingMin, defaults.ratingMin),
        };
    }

    function clearedFilters(siteCode = 'MX') {
        return normalizeFilters({
            globalShip: false,
            quickShip: false,
            trends: false,
            newArrivals: false,
            salesMin: null,
            priceMin: null,
            priceMax: null,
            couponOff: 0,
            ratingMin: null,
        }, siteCode);
    }

    function normalizeShortcut(value) {
        if (!value || typeof value.code !== 'string' || !(value.altKey || value.ctrlKey || value.metaKey)) return { ...DEFAULT_COPY_SHORTCUT };
        return {
            code: value.code,
            key: asText(value.key),
            altKey: Boolean(value.altKey),
            ctrlKey: Boolean(value.ctrlKey),
            metaKey: Boolean(value.metaKey),
            shiftKey: Boolean(value.shiftKey),
        };
    }

    function shortcutLabel(rawShortcut, compact = false) {
        const shortcut = normalizeShortcut(rawShortcut);
        const parts = [];
        if (shortcut.ctrlKey) parts.push('Ctrl');
        if (shortcut.altKey) parts.push('Alt');
        if (shortcut.shiftKey) parts.push('Shift');
        if (shortcut.metaKey) parts.push('⌘');
        const key = shortcut.code.startsWith('Key')
            ? shortcut.code.slice(3)
            : (shortcut.code.startsWith('Digit') ? shortcut.code.slice(5) : shortcut.key);
        parts.push(asText(key).toUpperCase());
        return parts.join(compact ? '+' : ' + ');
    }

    function matchesShortcut(event, rawShortcut) {
        const shortcut = normalizeShortcut(rawShortcut);
        return event.code === shortcut.code
            && Boolean(event.altKey) === shortcut.altKey
            && Boolean(event.ctrlKey) === shortcut.ctrlKey
            && Boolean(event.metaKey) === shortcut.metaKey
            && Boolean(event.shiftKey) === shortcut.shiftKey;
    }

    function effectivePrice(product, couponOff) {
        if (product.currentPrice === null || product.currentPrice === undefined) return null;
        return Math.round(product.currentPrice * (100 - Number(couponOff || 0))) / 100;
    }

    function evaluateProduct(product, rawFilters = {}) {
        const filters = normalizeFilters(rawFilters, product.site);
        const reasons = [];
        if (filters.globalShip && product.fulfillment !== 'GlobalShip') reasons.push('非 GlobalShip');
        if (filters.quickShip && product.fulfillment !== 'QuickShip') reasons.push('非 QuickShip');
        if (Number.isFinite(filters.salesMin) && (product.sales === null || product.sales < filters.salesMin)) reasons.push('销量不足');
        const price = effectivePrice(product, filters.couponOff);
        if (filters.priceMin !== null && (price === null || price < filters.priceMin)) reasons.push('价格低于下限');
        if (filters.priceMax !== null && (price === null || price > filters.priceMax)) reasons.push('价格高于上限');
        if (filters.ratingMin !== null && (product.rating === null || product.rating < filters.ratingMin)) reasons.push('星级不足');
        if (filters.trends && !product.trends) reasons.push('非 Trends');
        if (filters.newArrivals && !product.newArrivals) reasons.push('非 New Arrivals');
        return { matched: reasons.length === 0, reasons, effectivePrice: price };
    }

    function formatProductLinks(products) {
        return Array.from(new Set((products || []).map((product) => canonicalizeProductUrl(product.url)).filter(Boolean))).join('\n');
    }

    function exportHeaders() {
        return [
            '站点', '页面类型', '关键词/类目', '页码', '扫描时间', 'Goods ID', 'Product SKU', '商品标题', '商品链接', '商品主图', '主图 URL',
            '币种', '原价', '页面价', '优惠券 OFF %', '支付比例 %', '折后价', '销量原文', '销量下限', '星级', '评论数',
            '多规格', '款式数', '规格', 'SKU Qty', 'Fulfillment', 'Sold by', '店铺类型', 'Trends', 'New Arrivals', 'Best Seller',
            'Almost sold out', 'Repeat customers', 'Other sellers', '筛选结果', '未命中原因', '筛选条件',
        ];
    }

    function productToExportRow(product, filters, imageCellValue = '') {
        const evaluation = evaluateProduct(product, filters);
        return [
            product.site, product.pageType, product.keyword, product.page, product.scannedAt, product.goodsId, product.productSku, product.title, product.url,
            imageCellValue, product.imageUrl, product.currency, product.originalPrice, product.currentPrice, filters.couponOff, 100 - filters.couponOff,
            evaluation.effectivePrice, product.salesRaw, product.sales, product.rating, product.reviews, product.multiSku, product.styles, product.specs, product.skuQty,
            product.fulfillment, product.seller, product.storeType, product.trends ? 'Yes' : 'No', product.newArrivals ? 'Yes' : 'No',
            product.bestSeller ? 'Yes' : 'No', product.almostSoldOut ? 'Yes' : 'No', product.repeatCustomers ? 'Yes' : 'No', product.otherSellers ? 'Yes' : 'No',
            evaluation.matched ? 'Matched' : 'Unmatched', evaluation.reasons.join('；'), filterSummary(filters),
        ];
    }

    function filterSummary(filters) {
        return [
            filters.globalShip ? 'GlobalShip' : '', filters.quickShip ? 'QuickShip' : '', filters.salesMin !== null ? `Sales>=${filters.salesMin}` : '',
            filters.priceMin !== null ? `Price>=${filters.priceMin}` : '', filters.priceMax !== null ? `Price<=${filters.priceMax}` : '',
            `Coupon=${filters.couponOff}%OFF`, filters.ratingMin !== null ? `Rating>=${filters.ratingMin}` : '', filters.trends ? 'Trends' : '', filters.newArrivals ? 'New Arrivals' : '',
        ].filter(Boolean).join(' | ');
    }

    async function createWorkbook(products, rawFilters, options = {}) {
        const Excel = options.ExcelJS || globalThis.ExcelJS;
        if (!Excel) throw new Error('ExcelJS 未加载');
        const filters = normalizeFilters(rawFilters, products[0]?.site || 'MX');
        const workbook = new Excel.Workbook();
        workbook.creator = 'Shein Global Selector';
        workbook.created = new Date();
        const sheet = workbook.addWorksheet('Selected Products', { views: [{ state: 'frozen', ySplit: 1 }] });
        sheet.addRow(exportHeaders());
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF137C58' } };
        sheet.getRow(1).height = 24;
        sheet.autoFilter = { from: 'A1', to: 'AK1' };
        sheet.columns.forEach((column, index) => { column.width = index === 7 ? 36 : (index === 8 || index === 10 ? 42 : 14); });
        sheet.getColumn(10).width = 12;
        for (let index = 0; index < products.length; index += 1) {
            const product = products[index];
            let imageData = null;
            let imageCell = '';
            if (options.includeImages) {
                try {
                    imageData = product.imageUrl ? await options.imageLoader(product.imageUrl) : null;
                    if (!imageData) imageCell = '图片获取失败';
                } catch (_error) {
                    imageCell = '图片获取失败';
                }
            }
            const row = sheet.addRow(productToExportRow(product, filters, imageCell));
            row.alignment = { vertical: 'middle', wrapText: true };
            if (imageData) {
                const imageId = workbook.addImage({ base64: imageData.dataUrl, extension: imageData.extension || 'jpeg' });
                sheet.addImage(imageId, { tl: { col: 9.08, row: row.number - 0.92 }, ext: { width: 60, height: 80 } });
                row.height = 62;
            }
        }
        return workbook;
    }

    function escapeFilePart(value) {
        return normalizeText(value).replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) || 'products';
    }

    function downloadBlob(blob, filename) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    }

    function fetchImageDataUrl(url) {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'XYNIGO_FETCH_IMAGE', url }, (response) => {
                    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                    if (!response?.ok) return reject(new Error(response?.error || '图片获取失败'));
                    resolve(`data:${response.mime};base64,${response.base64}`);
                });
            });
        }
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url, responseType: 'arraybuffer', timeout: 15000, anonymous: true,
                    onload(response) {
                        if (response.status < 200 || response.status >= 300 || response.response.byteLength > IMAGE_LIMIT_BYTES) return reject(new Error('图片响应无效'));
                        const bytes = new Uint8Array(response.response);
                        let binary = '';
                        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                        const mime = response.responseHeaders.match(/content-type:\s*([^;\r\n]+)/i)?.[1] || 'image/jpeg';
                        resolve(`data:${mime};base64,${btoa(binary)}`);
                    },
                    onerror: () => reject(new Error('图片获取失败')),
                    ontimeout: () => reject(new Error('图片获取超时')),
                });
            });
        }
        return Promise.reject(new Error('当前环境不支持图片导出'));
    }

    function compressImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 60;
                canvas.height = 80;
                const context = canvas.getContext('2d');
                context.fillStyle = '#fff';
                context.fillRect(0, 0, 60, 80);
                const scale = Math.min(60 / image.naturalWidth, 80 / image.naturalHeight);
                const width = Math.max(1, image.naturalWidth * scale);
                const height = Math.max(1, image.naturalHeight * scale);
                context.drawImage(image, (60 - width) / 2, (80 - height) / 2, width, height);
                resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.32), extension: 'jpeg' });
            };
            image.onerror = () => reject(new Error('图片解码失败'));
            image.src = dataUrl;
        });
    }

    async function loadCompressedImage(url) {
        return compressImage(await fetchImageDataUrl(url));
    }

    function boot() {
        if (window.__xynigoSheinSelectorBooted) return;
        window.__xynigoSheinSelectorBooted = true;
        if (!isSupportedListingUrl(location.href)) return;

        const site = getSiteProfile(location.href);

        function readCopyShortcut() {
            try { return normalizeShortcut(JSON.parse(window.localStorage.getItem(COPY_SHORTCUT_KEY) || 'null')); } catch (_error) { return { ...DEFAULT_COPY_SHORTCUT }; }
        }

        function readCopyScope() {
            try { return window.localStorage.getItem(COPY_SCOPE_KEY) === 'selected' ? 'selected' : 'filtered'; } catch (_error) { return 'filtered'; }
        }

        const state = {
            site,
            products: [],
            selected: new Map(),
            filters: normalizeFilters(readSession()?.filters, site.code),
            copyShortcut: readCopyShortcut(),
            pendingCopyShortcut: readCopyShortcut(),
            copyScope: readCopyScope(),
            recordingShortcut: false,
            open: readSession()?.open ?? true,
            maximized: false,
            scanTimer: 0,
            host: null,
            shadow: null,
            launcherHost: null,
            launcher: null,
            launcherTop: Math.round(window.innerHeight * 0.38),
        };

        function readSession() {
            try { return JSON.parse(sessionStorage.getItem(`${SESSION_KEY}-${site.code}`) || 'null'); } catch (_error) { return null; }
        }

        function saveSession() {
            try {
                sessionStorage.setItem(`${SESSION_KEY}-${site.code}`, JSON.stringify({ filters: state.filters, open: state.open }));
            } catch (_error) { /* Session persistence is optional. */ }
        }

        function clampLauncherTop(value) {
            const minTop = 72;
            const maxTop = Math.max(minTop, window.innerHeight - LAUNCHER_HEIGHT - 24);
            return Math.round(Math.min(maxTop, Math.max(minTop, Number(value) || minTop)));
        }

        function setLauncherTop(value, persist = false) {
            state.launcherTop = clampLauncherTop(value);
            if (state.launcherHost) state.launcherHost.style.setProperty('top', `${state.launcherTop}px`, 'important');
            if (persist) {
                try { window.localStorage.setItem(LAUNCHER_POSITION_KEY, String(state.launcherTop)); } catch (_error) { /* Position memory is optional. */ }
            }
        }

        function restoreLauncherTop() {
            let stored = null;
            try { stored = Number(window.localStorage.getItem(LAUNCHER_POSITION_KEY)); } catch (_error) { /* Use the viewport default. */ }
            setLauncherTop(Number.isFinite(stored) && stored > 0 ? stored : state.launcherTop);
        }

        function icon(name) {
            const icons = {
                plane: '✈', truck: '▰', trends: '↗', new: '✦', sales: '▥', price: '$', star: '★', copy: '⧉', export: '⇩', refresh: '↻', maximize: '⛶',
            };
            return icons[name] || '•';
        }

        function filterIcon(name) {
            if (name === 'truck') return '<span class="ico official"><img src="https://img.ltwebstatic.com/images3_ccc/2024/11/20/c3/17320925911e06348e027fb3f6e71a78280043da85.png" alt="" referrerpolicy="no-referrer"></span>';
            if (name === 'trends') return '<span class="ico official trends-icon"><img src="https://img.ltwebstatic.com/images3_ccc/2024/07/25/0c/17218992763c90c1e58652d3c3ae23be19490aecc4.png" alt="" referrerpolicy="no-referrer"></span>';
            if (name === 'new') return '<span class="ico designed"><i class="pictogram pictogram-new"></i></span>';
            if (name === 'sales') return '<span class="ico designed"><i class="pictogram pictogram-sales"></i></span>';
            if (name === 'price') return '<span class="ico designed"><i class="pictogram pictogram-price">$</i></span>';
            return `<span class="ico">${icon(name)}</span>`;
        }

        function mountLauncher() {
            if (document.getElementById(LAUNCHER_HOST_ID)) return;
            const host = document.createElement('div');
            host.id = LAUNCHER_HOST_ID;
            Object.assign(host.style, {
                position: 'fixed',
                zIndex: '2147483001',
                right: '0',
                width: '50px',
                height: `${LAUNCHER_HEIGHT}px`,
                overflow: 'visible',
            });
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `
                <style>
                  :host{all:initial}*{box-sizing:border-box}
                  button{all:initial;box-sizing:border-box;position:absolute;right:0;top:0;width:50px;height:44px;display:flex;align-items:center;justify-content:flex-start;gap:7px;padding:0 2px;overflow:visible;border:1px solid rgba(22,130,87,.48);border-radius:999px 0 0 999px;background:linear-gradient(135deg,#fbfffd 0%,#eaf7f1 100%);color:#126b4a;box-shadow:-5px 8px 22px rgba(18,94,64,.18),inset 0 0 0 1px rgba(255,255,255,.7);cursor:grab;touch-action:none;user-select:none;font:700 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:width .2s cubic-bezier(.2,.8,.2,1),padding .2s ease,box-shadow .18s ease,background .18s ease}
                  button:hover,button:focus-visible,button.is-dragging{width:154px;padding-right:13px;background:linear-gradient(135deg,#fff 0%,#e4f5ed 100%);box-shadow:-7px 10px 27px rgba(18,94,64,.23)}
                  button:active{cursor:grabbing}
                  button:focus-visible{outline:3px solid rgba(22,130,87,.22);outline-offset:3px}
                  .mascot{width:42px;height:42px;flex:0 0 42px;display:grid;place-items:center;margin-left:-4px;overflow:visible;pointer-events:none}
                  .mascot img{width:46px;height:46px;display:block;object-fit:contain;filter:drop-shadow(0 4px 6px rgba(15,82,57,.2))}
                  .label{min-width:0;width:0;display:block;overflow:hidden;opacity:0;text-align:left;white-space:nowrap;transition:opacity .12s ease}
                  button:hover .label,button:focus-visible .label,button.is-dragging .label{width:auto;opacity:1}
                </style>
                <button id="${LAUNCHER_ID}" type="button" aria-controls="${HOST_ID}" aria-expanded="${state.open}" aria-label="SHEIN选品助手，鼠标悬停展开，点击${state.open ? '收起' : '打开'}工作台，上下拖动调整位置" title="悬停展开 · 点击${state.open ? '收起' : '打开'}工作台 · 上下拖动位置">
                  <span class="mascot"><img src="${mascotAssetUrl()}" alt="" draggable="false"></span>
                  <span class="label">SHEIN选品助手</span>
                </button>`;
            document.documentElement.appendChild(host);
            const launcher = shadow.getElementById(LAUNCHER_ID);
            state.launcherHost = host;
            state.launcher = launcher;
            restoreLauncherTop();

            let drag = null;
            let ignoreClick = false;
            launcher.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                drag = { pointerId: event.pointerId, startY: event.clientY, startTop: state.launcherTop, moved: false };
                launcher.setPointerCapture?.(event.pointerId);
            });
            launcher.addEventListener('pointermove', (event) => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                const deltaY = event.clientY - drag.startY;
                if (Math.abs(deltaY) > 3) drag.moved = true;
                if (!drag.moved) return;
                event.preventDefault();
                launcher.classList.add('is-dragging');
                setLauncherTop(drag.startTop + deltaY);
            });
            const finishDrag = (event) => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                if (drag.moved) {
                    setLauncherTop(state.launcherTop, true);
                    ignoreClick = true;
                    window.setTimeout(() => { ignoreClick = false; }, 0);
                }
                launcher.classList.remove('is-dragging');
                if (launcher.hasPointerCapture?.(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
                drag = null;
            };
            launcher.addEventListener('pointerup', finishDrag);
            launcher.addEventListener('pointercancel', finishDrag);
            launcher.addEventListener('click', (event) => {
                if (ignoreClick) {
                    event.preventDefault();
                    return;
                }
                state.open = !state.open;
                saveSession();
                renderVisibility();
            });
            launcher.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                setLauncherTop(state.launcherTop + (event.key === 'ArrowUp' ? -24 : 24), true);
            });
            window.addEventListener('resize', () => setLauncherTop(state.launcherTop));
        }

        function mountWorkbench() {
            if (document.getElementById(HOST_ID)) return;
            const host = document.createElement('div');
            host.id = HOST_ID;
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = `
                <style>${workbenchCss()}</style>
                <section class="panel">
                  <div class="resize" title="拖动调整窗口高度"></div>
                  <header>
                    <div class="brand"><span class="mascot"><img src="${mascotAssetUrl()}" alt=""></span><span><b>Shein Global Selector</b><small><span class="brand-sub">Xynigo · ${state.site.code} sourcing workspace</span><span class="status">等待扫描</span></small></span></div>
                    <nav><button data-action="prev">‹ 上一页</button><strong class="page"></strong><button data-action="next">下一页 ›</button><button data-action="scan">${icon('refresh')} 重新扫描</button><button data-action="clear" title="关闭全部筛选条件，不清除已选商品">⊘ 清空筛选</button><button data-action="copy" title="默认复制当前页全部筛选命中商品的链接">${icon('copy')} 复制商品链接</button><button class="shortcut-button" data-action="shortcut" title="设置复制商品链接快捷键">⌨ ${shortcutLabel(state.copyShortcut, true)}</button><button class="primary" data-action="export">${icon('export')} 导出已选 <span class="selected-count">0</span></button><button data-action="max">${icon('maximize')} 最大化</button><button data-action="close">—</button></nav>
                  </header>
                  <div class="filters"></div>
                  <div class="body"><div class="table-wrap"><table><thead><tr><th class="check"><input type="checkbox" data-action="all"></th><th>PRODUCT</th><th>PAGE PRICE</th><th>EFFECTIVE PRICE</th><th>SALES</th><th>RATING</th><th>MULTI-SKU</th><th>STYLES</th><th>SPECS</th><th>FULFILLMENT</th><th>SOLD BY</th><th>OFFICIAL SIGNALS</th><th>DECISION</th></tr></thead><tbody></tbody></table></div><aside><h3><span></span>选品概览</h3><dl class="summary"></dl><p class="note">规格与精确 SKU Qty 通常需要进入详情页采集；列表页没有数据时显示“—”。</p></aside></div>
                  <div class="toast" role="status"></div>
                  <dialog class="export-dialog"><form method="dialog"><h2>导出已选商品</h2><p>每个商品一行，导出为 Excel 工作簿。</p><label class="image-option"><input type="checkbox" name="images"> 将商品主图插入 Excel（压缩至约 60×80 px，导出更慢）</label><div><button value="cancel">取消</button><button value="confirm" class="primary">开始导出</button></div></form></dialog>
                  <dialog class="shortcut-dialog"><form method="dialog"><h2>复制商品链接快捷键</h2><p>快捷键只在 SHEIN 商品列表页生效，与工具栏“复制商品链接”使用相同范围。</p><label class="shortcut-scope"><span>复制范围</span><select name="copyScope"><option value="filtered">当前页全部筛选结果</option><option value="selected">已选商品</option></select></label><button class="shortcut-recorder" type="button" data-action="record-shortcut">${shortcutLabel(state.copyShortcut)}</button><div class="shortcut-help">点击上方按键框，然后按下新的组合键。</div><div class="shortcut-actions"><button type="button" data-action="reset-shortcut">恢复默认</button><span><button value="cancel">取消</button><button class="primary" type="button" data-action="save-shortcut">保存快捷键</button></span></div></form></dialog>
                </section>`;
            document.body.appendChild(host);
            state.host = host;
            state.shadow = shadow;
            bindEvents();
            bindResize();
        }

        function workbenchCss() {
            return `:host{all:initial}*{box-sizing:border-box}.panel{--green:#16835a;--dark:#17221e;--line:#dce8e2;position:fixed;z-index:2147483000;left:0;right:0;bottom:0;height:42vh;min-height:290px;max-height:92vh;background:#fff;color:var(--dark);box-shadow:0 -10px 28px rgba(21,55,42,.16);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.panel.max{height:92vh}.resize{position:absolute;z-index:3;top:-5px;left:0;right:0;height:10px;cursor:ns-resize}.resize:after{content:"";display:block;width:44px;height:3px;margin:3px auto;border-radius:3px;background:#9fb9ae}header{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:#fbfefc}.brand{display:flex;align-items:center;gap:9px}.mascot{display:grid;place-items:center;width:32px;height:32px;border:1px solid #b9ddcd;border-radius:9px;background:#eaf8f1;overflow:hidden}.mascot img{width:30px;height:30px;display:block;object-fit:contain}.brand b{display:block;font-size:13px}.brand small{display:flex;align-items:center;gap:5px;color:#718079;margin-top:2px}.brand-sub:after{content:"·";margin-left:5px}nav{display:flex;align-items:center;gap:5px}button{height:30px;padding:0 9px;border:1px solid #d7dfdb;border-radius:6px;background:#fff;color:#24302b;font:600 11px inherit;cursor:pointer}button:hover{border-color:#78b99d;background:#f1faf6}.primary{border-color:var(--green);background:var(--green);color:#fff}.primary:hover{background:#126f4c}.shortcut-button{padding:0 8px;color:#176d4d}.page{min-width:34px;text-align:center}.filters{display:grid;grid-template-columns:repeat(4,minmax(112px,1fr)) minmax(145px,1.1fr) minmax(238px,1.7fr) minmax(86px,.62fr) minmax(82px,.55fr);gap:6px;padding:7px 10px;border-bottom:1px solid var(--line);background:#f7fbf9}.filter{min-width:0;height:48px;display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid #b9daca;border-radius:7px;background:#fff}.filter .ico{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:7px;background:#e8f7f0;color:var(--green);font-size:16px;font-weight:800}.filter .ico.official{overflow:hidden;border:1px solid rgba(36,50,44,.08);background:#fff}.filter .ico.official img{width:22px;height:22px;object-fit:contain}.filter .ico.trends-icon{background:#eef8f3}.filter .ico.trends-icon img{filter:brightness(0) saturate(100%) invert(38%) sepia(47%) saturate(1004%) hue-rotate(105deg) brightness(91%) contrast(91%)}.filter .ico.designed{border:1px solid rgba(22,130,87,.18);background:#eef8f3}.pictogram{position:relative;display:block;width:18px;height:18px;color:var(--green);font-style:normal}.pictogram-new:before{content:"";position:absolute;left:1px;top:3px;width:13px;height:13px;background:currentColor;clip-path:polygon(50% 0,63% 36%,100% 50%,63% 64%,50% 100%,37% 64%,0 50%,37% 36%)}.pictogram-new:after{content:"";position:absolute;right:0;top:1px;width:3px;height:3px;border-radius:50%;background:currentColor;box-shadow:0 13px 0 rgba(22,130,87,.48)}.pictogram-sales:before{content:"";position:absolute;bottom:2px;left:2px;width:3px;height:6px;border-radius:1px 1px 0 0;background:currentColor;box-shadow:5px -3px 0 currentColor,10px -7px 0 currentColor}.pictogram-sales:after{content:"";position:absolute;bottom:1px;left:1px;width:16px;height:1px;background:rgba(22,130,87,.32)}.pictogram-price{display:grid;place-items:center;border:1.5px solid currentColor;border-radius:50%;background:#fff;font-size:10px;font-weight:800}.coupon-mark{position:relative;width:15px;height:11px;margin-right:1px;border-radius:3px;background:var(--green);color:#fff;font-size:7px;font-weight:800;text-align:center;line-height:11px;clip-path:polygon(0 0,72% 0,100% 50%,72% 100%,0 100%)}.filter label{min-width:0;display:block;flex:1}.filter small{display:block;color:#75827c;font-size:9px;white-space:nowrap}.filter b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.switch{position:relative;width:28px;height:16px;flex:0 0 28px}.switch input{opacity:0}.switch span{position:absolute;inset:0;border-radius:12px;background:#ccd5d1}.switch span:after{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #777}.switch input:checked+span{background:var(--green)}.switch input:checked+span:after{transform:translateX(12px)}.inline-field{display:flex;align-items:center;gap:4px}.inline-field input,.inline-field select{width:66px;height:25px;padding:0 7px;border:1px solid #d5e2dc;border-radius:7px;background:#fff;font-size:10px;outline:none}.inline-field input:focus,.inline-field select:focus{border-color:var(--green)}.rating-filter{gap:4px;padding:5px}.rating-filter .inline-field select{width:50px;height:25px;padding:0 2px;border-radius:6px}.price-filter{gap:5px}.price-copy{display:grid;grid-template-rows:16px 25px;gap:2px;min-width:0;flex:1}.coupon-row{display:flex;align-items:center;gap:3px}.coupon-row b{margin-right:auto}.coupon-row button{height:17px;padding:0 5px;border-radius:5px;font-size:9px}.coupon-row button.active{border-color:var(--green);background:#e9f8f1;color:var(--green)}.price-inputs{display:grid;grid-template-columns:1fr 8px 1fr 1.15fr;align-items:center;gap:3px}.price-inputs input{min-width:0;width:100%;height:25px;padding:0 6px;border:1px solid #d5e2dc;border-radius:7px;font-size:9px}.body{display:grid;grid-template-columns:minmax(0,1fr) 190px;height:calc(100% - 113px)}.table-wrap{overflow:auto}.table-wrap table{width:100%;border-collapse:collapse;table-layout:fixed}.table-wrap th{position:sticky;top:0;z-index:1;height:30px;padding:0 7px;border-bottom:1px solid var(--line);background:#f8faf9;color:#64716b;font-size:9px;letter-spacing:.04em;text-align:left}.table-wrap td{height:48px;padding:5px 7px;border-bottom:1px solid #e8efeb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.table-wrap tr.matched{background:#f0fbf6}.table-wrap tr:hover{background:#f7fbf9}.check{width:32px}.product{width:210px}.product-cell{display:grid;grid-template-columns:34px 1fr;gap:7px;align-items:center}.product-cell img{width:34px;height:40px;object-fit:cover;background:#eee}.product-cell b,.product-cell small{display:block;overflow:hidden;text-overflow:ellipsis}.product-cell small,.sub{color:#7b8781;font-size:9px}.money{color:#11764f;font-weight:700}.pill{display:inline-block;padding:3px 6px;border-radius:10px;background:#e8f6ef;color:#16734f;font-size:9px}.signal{display:inline-block;margin:1px 2px;padding:2px 5px;border:1px solid #b9decf;border-radius:9px;color:#16734f;font-size:8px}aside{overflow:auto;border-left:1px solid var(--line);padding:10px;background:#fbfdfc}aside h3{margin:0 0 7px;font-size:12px}aside h3 span{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:var(--green)}dl{margin:0}dl div{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e8efeb}dt{color:#66736d}dd{margin:0;font-weight:700}.note{margin:10px 0 0;padding:8px;border:1px solid #efd9a6;border-radius:7px;background:#fff9e9;color:#725b22;font-size:9px}.toast{position:absolute;right:14px;top:53px;display:none;padding:8px 12px;border-radius:6px;background:#17221e;color:#fff}.toast.show{display:block}dialog{width:430px;border:0;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.28)}dialog::backdrop{background:rgba(13,30,23,.35)}dialog form{padding:8px}dialog h2{margin:0 0 8px;font-size:18px}dialog p{color:#637169}.image-option{display:flex;gap:8px;align-items:flex-start;margin:18px 0;padding:12px;border-radius:8px;background:#eff8f4}dialog form>div{display:flex;justify-content:flex-end;gap:8px}.shortcut-scope{display:grid;gap:6px;margin:16px 0}.shortcut-scope span{font-weight:700}.shortcut-scope select{height:34px;padding:0 9px;border:1px solid #cadbd3;border-radius:7px;background:#fff}.shortcut-recorder{width:100%;height:48px;border:1px dashed #75b89b;background:#f1faf6;color:#126f4c;font-size:16px}.shortcut-recorder.is-recording{border-style:solid;background:#e2f5ec}.shortcut-help{margin:8px 0 16px;color:#718079}.shortcut-actions{display:flex;align-items:center;justify-content:space-between}.shortcut-actions span{display:flex;gap:8px}`;
        }

        function bindResize() {
            const handle = state.shadow.querySelector('.resize');
            handle.addEventListener('pointerdown', (event) => {
                const startY = event.clientY;
                const startHeight = state.shadow.querySelector('.panel').getBoundingClientRect().height;
                handle.setPointerCapture(event.pointerId);
                const move = (moveEvent) => {
                    const next = Math.min(innerHeight * 0.92, Math.max(290, startHeight + startY - moveEvent.clientY));
                    state.shadow.querySelector('.panel').style.height = `${next}px`;
                };
                const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
                handle.addEventListener('pointermove', move);
                handle.addEventListener('pointerup', up);
            });
        }

        function bindEvents() {
            state.shadow.addEventListener('click', async (event) => {
                const action = event.target.closest('[data-action]')?.dataset.action;
                if (!action) return;
                if (action === 'scan') scan();
                if (action === 'close') { state.open = false; saveSession(); renderVisibility(); }
                if (action === 'max') { state.maximized = !state.maximized; state.shadow.querySelector('.panel').classList.toggle('max', state.maximized); }
                if (action === 'prev') navigatePage(-1);
                if (action === 'next') navigatePage(1);
                if (action === 'clear') clearFilters();
                if (action === 'copy') await copyProductLinks();
                if (action === 'shortcut') openShortcutDialog();
                if (action === 'record-shortcut') startShortcutRecording();
                if (action === 'reset-shortcut') resetShortcutDialog();
                if (action === 'save-shortcut') saveShortcutDialog();
                if (action === 'export') openExportDialog();
                if (action === 'coupon') { state.filters.couponOff = Number(event.target.dataset.value); saveSession(); render(); }
            });
            state.shadow.addEventListener('change', (event) => {
                const filter = event.target.dataset.filter;
                if (filter) {
                    let value = event.target.type === 'checkbox' ? event.target.checked : (event.target.value === '' ? null : Number(event.target.value));
                    state.filters[filter] = value;
                    if (filter === 'globalShip' && value) state.filters.quickShip = false;
                    if (filter === 'quickShip' && value) state.filters.globalShip = false;
                    saveSession();
                    render();
                }
                if (event.target.dataset.selectId) {
                    const product = state.products.find((item) => item.goodsId === event.target.dataset.selectId);
                    if (event.target.checked && product) state.selected.set(product.goodsId, product);
                    else state.selected.delete(event.target.dataset.selectId);
                    render();
                }
                if (event.target.dataset.action === 'all') {
                    visibleProducts().forEach(({ product }) => event.target.checked ? state.selected.set(product.goodsId, product) : state.selected.delete(product.goodsId));
                    render();
                }
            });
            const exportDialog = state.shadow.querySelector('.export-dialog');
            exportDialog.addEventListener('close', async () => {
                if (exportDialog.returnValue !== 'confirm') return;
                await exportSelected(exportDialog.querySelector('[name="images"]').checked);
            });
            state.shadow.querySelector('.shortcut-dialog').addEventListener('close', () => { state.recordingShortcut = false; });
            window.addEventListener('keydown', handleShortcutKeydown);
        }

        function isEditableTarget(target) {
            return Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"]'));
        }

        function showDialog(dialog) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        }

        function closeDialog(dialog) {
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
        }

        function clearFilters() {
            state.filters = clearedFilters(state.site.code);
            saveSession();
            render();
            toast('筛选条件已清空，已选商品保持不变');
        }

        function openShortcutDialog() {
            const dialog = state.shadow.querySelector('.shortcut-dialog');
            state.pendingCopyShortcut = { ...state.copyShortcut };
            state.recordingShortcut = false;
            dialog.querySelector('[name="copyScope"]').value = state.copyScope;
            const recorder = dialog.querySelector('.shortcut-recorder');
            recorder.textContent = shortcutLabel(state.pendingCopyShortcut);
            recorder.classList.remove('is-recording');
            dialog.querySelector('.shortcut-help').textContent = '点击上方按键框，然后按下新的组合键。';
            showDialog(dialog);
        }

        function startShortcutRecording() {
            const dialog = state.shadow.querySelector('.shortcut-dialog');
            state.recordingShortcut = true;
            const recorder = dialog.querySelector('.shortcut-recorder');
            recorder.classList.add('is-recording');
            recorder.textContent = '请按下组合键…';
            dialog.querySelector('.shortcut-help').textContent = '组合键需包含 Alt、Ctrl 或 Command。';
        }

        function resetShortcutDialog() {
            const dialog = state.shadow.querySelector('.shortcut-dialog');
            state.pendingCopyShortcut = { ...DEFAULT_COPY_SHORTCUT };
            state.recordingShortcut = false;
            dialog.querySelector('[name="copyScope"]').value = 'filtered';
            const recorder = dialog.querySelector('.shortcut-recorder');
            recorder.textContent = shortcutLabel(state.pendingCopyShortcut);
            recorder.classList.remove('is-recording');
            dialog.querySelector('.shortcut-help').textContent = '已恢复默认，点击“保存快捷键”后生效。';
        }

        function saveShortcutDialog() {
            const dialog = state.shadow.querySelector('.shortcut-dialog');
            state.copyShortcut = normalizeShortcut(state.pendingCopyShortcut);
            state.copyScope = dialog.querySelector('[name="copyScope"]').value === 'selected' ? 'selected' : 'filtered';
            state.recordingShortcut = false;
            try {
                window.localStorage.setItem(COPY_SHORTCUT_KEY, JSON.stringify(state.copyShortcut));
                window.localStorage.setItem(COPY_SCOPE_KEY, state.copyScope);
            } catch (_error) { /* Shortcut persistence is optional. */ }
            renderShortcutButton();
            closeDialog(dialog);
            toast(`复制快捷键已保存：${shortcutLabel(state.copyShortcut)}`);
        }

        async function handleShortcutKeydown(event) {
            const dialog = state.shadow?.querySelector('.shortcut-dialog');
            if (state.recordingShortcut) {
                if (event.key === 'Escape') {
                    state.recordingShortcut = false;
                    const recorder = dialog.querySelector('.shortcut-recorder');
                    recorder.classList.remove('is-recording');
                    recorder.textContent = shortcutLabel(state.pendingCopyShortcut);
                    dialog.querySelector('.shortcut-help').textContent = '已取消录入。';
                    return;
                }
                if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return;
                event.preventDefault();
                if (!event.altKey && !event.ctrlKey && !event.metaKey) {
                    dialog.querySelector('.shortcut-help').textContent = '请至少按住 Alt、Ctrl 或 Command 中的一个。';
                    return;
                }
                state.pendingCopyShortcut = normalizeShortcut(event);
                state.recordingShortcut = false;
                const recorder = dialog.querySelector('.shortcut-recorder');
                recorder.classList.remove('is-recording');
                recorder.textContent = shortcutLabel(state.pendingCopyShortcut);
                dialog.querySelector('.shortcut-help').textContent = '新组合键已录入，点击“保存快捷键”后生效。';
                return;
            }
            if (isEditableTarget(event.target) || !matchesShortcut(event, state.copyShortcut)) return;
            event.preventDefault();
            await copyProductLinks();
        }

        function navigatePage(delta) {
            const url = new URL(location.href);
            url.searchParams.set('page', String(Math.max(1, getPageNumber(url.href) + delta)));
            location.href = url.href;
        }

        function visibleProducts() {
            return state.products.map((product) => ({ product, evaluation: evaluateProduct(product, state.filters) })).filter((entry) => entry.evaluation.matched);
        }

        function renderFilters() {
            const counts = {
                globalShip: state.products.filter((p) => p.fulfillment === 'GlobalShip').length,
                quickShip: state.products.filter((p) => p.fulfillment === 'QuickShip').length,
                trends: state.products.filter((p) => p.trends).length,
                newArrivals: state.products.filter((p) => p.newArrivals).length,
            };
            const filters = state.shadow.querySelector('.filters');
            const toggle = (key, label, kind, count, sub) => `<div class="filter">${filterIcon(kind)}<label><small>${sub}</small><b>${label} · ${count}</b></label><label class="switch"><input type="checkbox" data-filter="${key}" ${state.filters[key] ? 'checked' : ''}><span></span></label></div>`;
            filters.innerHTML = toggle('globalShip', 'GlobalShip', 'plane', counts.globalShip, 'Fulfillment')
                + toggle('quickShip', 'QuickShip', 'truck', counts.quickShip, 'Fulfillment')
                + toggle('trends', 'Trends', 'trends', counts.trends, 'Official signal')
                + toggle('newArrivals', 'New Arrivals', 'new', counts.newArrivals, 'Official signal')
                + `<div class="filter">${filterIcon('sales')}<label><small>Sales · minimum</small><span class="inline-field"><input type="number" min="0" step="100" data-filter="salesMin" value="${state.filters.salesMin ?? ''}"></span></label></div>`
                + `<div class="filter price-filter">${filterIcon('price')}<div class="price-copy"><div class="coupon-row"><b>Price · ${state.site.currency}</b><span class="coupon-mark" title="Coupon">%</span>${[65, 30, 0].map((value) => `<button type="button" data-action="coupon" data-value="${value}" class="${state.filters.couponOff === value ? 'active' : ''}">${value}%</button>`).join('')}</div><div class="price-inputs"><input aria-label="Minimum price" type="number" min="0" placeholder="${state.site.symbol} 0" data-filter="priceMin" value="${state.filters.priceMin ?? ''}"><span>—</span><input aria-label="Maximum price" type="number" min="0" placeholder="${state.site.symbol} ∞" data-filter="priceMax" value="${state.filters.priceMax ?? ''}"><input aria-label="Coupon percent off" type="number" min="0" max="100" placeholder="% OFF" data-filter="couponOff" value="${state.filters.couponOff}"></div></div></div>`
                + `<div class="filter rating-filter">${filterIcon('star')}<label><small>Rating</small><span class="inline-field"><select data-filter="ratingMin" aria-label="星级门槛，支持4.0、4.2、4.5三档">${state.filters.ratingMin === null ? '<option value="" selected disabled hidden>—</option>' : ''}<option value="4" ${state.filters.ratingMin === 4 ? 'selected' : ''}>4.0+</option><option value="4.2" ${state.filters.ratingMin === 4.2 ? 'selected' : ''}>4.2+</option><option value="4.5" ${state.filters.ratingMin === 4.5 ? 'selected' : ''}>4.5+</option></select></span></label></div>`
                + `<div class="filter metrics"><span class="ico">✓</span><label><small>最终命中</small><b>${visibleProducts().length} · ${state.products.length ? Math.round(visibleProducts().length / state.products.length * 1000) / 10 : 0}%</b></label></div>`;
        }

        function renderTable() {
            const body = state.shadow.querySelector('tbody');
            body.replaceChildren();
            visibleProducts().forEach(({ product, evaluation }) => {
                const row = document.createElement('tr');
                row.className = evaluation.matched ? 'matched' : '';
                const signals = [product.trends ? 'Trends' : '', product.newArrivals ? 'New Arrivals' : '', product.bestSeller ? 'Best Seller' : '', product.almostSoldOut ? 'Almost sold out' : ''].filter(Boolean);
                const cells = [
                    { html: `<input type="checkbox" data-select-id="${product.goodsId}" ${state.selected.has(product.goodsId) ? 'checked' : ''}>` },
                    { node: productCell(product), className: 'product' },
                    { text: money(product.currentPrice, product.currency) },
                    { text: money(evaluation.effectivePrice, product.currency), className: 'money' },
                    { html: `<b>${safeHtml(product.salesRaw)}</b><small class="sub">${product.sales ?? '—'} lower bound</small>` },
                    { html: `<b>★ ${product.rating ?? '—'}</b><small class="sub">${product.reviews ?? '—'} reviews</small>` },
                    { html: `<span class="pill">${product.multiSku}</span>` },
                    { text: product.styles }, { text: product.specs },
                    { html: `<span class="pill">${product.fulfillment}</span>` },
                    { html: `<b>${safeHtml(product.seller)}</b><small class="sub">${safeHtml(product.storeType)}</small>` },
                    { html: signals.length ? signals.map((signal) => `<span class="signal">${safeHtml(signal)}</span>`).join('') : '—' },
                    { html: '<span class="money">● 符合</span>' },
                ];
                cells.forEach((cell) => {
                    const td = document.createElement('td');
                    if (cell.className) td.className = cell.className;
                    if (cell.node) td.appendChild(cell.node);
                    else if (cell.html !== undefined) td.innerHTML = cell.html;
                    else td.textContent = cell.text ?? '—';
                    row.appendChild(td);
                });
                body.appendChild(row);
            });
        }

        function safeHtml(value) {
            return asText(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
        }

        function productCell(product) {
            const wrap = document.createElement('div');
            wrap.className = 'product-cell';
            const image = document.createElement('img');
            image.loading = 'lazy';
            image.alt = '';
            if (product.imageUrl) image.src = product.imageUrl;
            const copy = document.createElement('span');
            const title = document.createElement('b');
            title.textContent = product.title;
            const meta = document.createElement('small');
            meta.textContent = `ID ${product.goodsId} · ${product.site}`;
            copy.append(title, meta);
            wrap.append(image, copy);
            return wrap;
        }

        function money(value, currency) {
            return value === null || value === undefined ? '—' : `${currency} ${Number(value).toFixed(2)}`;
        }

        function renderSummary() {
            const matched = visibleProducts().length;
            const entries = [
                ['当前站点', state.site.code], ['页面类型', getPageType(location.href)], ['当前结果页', `${getPageNumber(location.href)}`], ['已加载商品', state.products.length],
                ['GlobalShip', state.products.filter((p) => p.fulfillment === 'GlobalShip').length], ['QuickShip · Local', state.products.filter((p) => p.fulfillment === 'QuickShip').length],
                ['最终命中', matched], ['命中率', state.products.length ? `${Math.round(matched / state.products.length * 1000) / 10}%` : '0%'], ['已选商品', state.selected.size],
            ];
            const summary = state.shadow.querySelector('.summary');
            summary.replaceChildren(...entries.map(([key, value]) => {
                const div = document.createElement('div');
                const dt = document.createElement('dt'); dt.textContent = key;
                const dd = document.createElement('dd'); dd.textContent = value;
                div.append(dt, dd); return div;
            }));
        }

        function renderVisibility() {
            if (state.host) state.host.style.display = state.open ? '' : 'none';
            if (!state.launcher) return;
            state.launcher.setAttribute('aria-expanded', String(state.open));
            state.launcher.setAttribute('aria-label', `SHEIN选品助手，鼠标悬停展开，点击${state.open ? '收起' : '打开'}工作台，上下拖动调整位置`);
            state.launcher.title = `悬停展开 · 点击${state.open ? '收起' : '打开'}工作台 · 上下拖动位置`;
        }

        function renderShortcutButton() {
            const button = state.shadow?.querySelector('[data-action="shortcut"]');
            if (!button) return;
            button.textContent = `⌨ ${shortcutLabel(state.copyShortcut, true)}`;
            button.title = `设置复制商品链接快捷键（当前 ${shortcutLabel(state.copyShortcut)}）`;
        }

        function render() {
            if (!state.shadow) return;
            renderFilters();
            renderTable();
            renderSummary();
            state.shadow.querySelector('.status').textContent = `第 ${getPageNumber(location.href)} 页 · ${state.products.length} loaded · ${visibleProducts().length} matched`;
            state.shadow.querySelector('.page').textContent = String(getPageNumber(location.href));
            state.shadow.querySelector('.selected-count').textContent = String(state.selected.size);
            renderShortcutButton();
            renderVisibility();
        }

        function scan() {
            if (!isSupportedListingUrl(location.href)) return;
            state.products = collectProducts(document, location.href);
            state.products.forEach((product) => { if (state.selected.has(product.goodsId)) state.selected.set(product.goodsId, product); });
            render();
            toast(`已扫描 ${state.products.length} 个商品`);
        }

        function scheduleScan(delay = 350) {
            clearTimeout(state.scanTimer);
            state.scanTimer = setTimeout(scan, delay);
        }

        function toast(message) {
            const element = state.shadow.querySelector('.toast');
            element.textContent = message;
            element.classList.add('show');
            clearTimeout(element._timer);
            element._timer = setTimeout(() => element.classList.remove('show'), 2200);
        }

        async function copyProductLinks() {
            const products = state.copyScope === 'selected'
                ? Array.from(state.selected.values())
                : visibleProducts().map(({ product }) => product);
            const links = formatProductLinks(products);
            if (!links) return toast(state.copyScope === 'selected' ? '请先选择商品' : '当前页没有筛选命中商品');
            if (typeof GM_setClipboard === 'function') GM_setClipboard(links, 'text');
            else await navigator.clipboard.writeText(links);
            toast(`已复制 ${products.length} 条链接（${state.copyScope === 'selected' ? '已选商品' : '当前页全部筛选结果'}，每行一条）`);
        }

        function openExportDialog() {
            if (!state.selected.size) return toast('请先选择商品');
            const dialog = state.shadow.querySelector('.export-dialog');
            dialog.returnValue = '';
            dialog.showModal();
        }

        async function exportSelected(includeImages) {
            const products = Array.from(state.selected.values());
            if (!products.length) return;
            toast(includeImages ? '正在压缩主图并生成 Excel…' : '正在生成 Excel…');
            try {
                const workbook = await createWorkbook(products, state.filters, { includeImages, imageLoader: loadCompressedImage });
                const buffer = await workbook.xlsx.writeBuffer();
                const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Shein-Global-Selector-${state.site.code}-${escapeFilePart(getKeyword(location.href, document))}-${date}.xlsx`);
                toast(`已导出 ${products.length} 个商品`);
            } catch (error) {
                toast(`导出失败：${error.message}`);
            }
        }

        mountLauncher();
        mountWorkbench();
        scan();
        const observer = new MutationObserver(() => scheduleScan());
        observer.observe(document.documentElement, { childList: true, subtree: true });
        let lastUrl = location.href;
        window.setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            const supported = isSupportedListingUrl(lastUrl);
            if (state.host) state.host.style.display = supported && state.open ? '' : 'none';
            if (state.launcherHost) state.launcherHost.style.display = supported ? '' : 'none';
            if (supported) scheduleScan(0);
        }, 800);
    }

    return {
        boot,
        getSiteProfile,
        isSupportedListingUrl,
        isSearchResultsUrl,
        getPageType,
        extractProductId,
        canonicalizeProductUrl,
        parseNumber,
        parseSales,
        getPageNumber,
        getKeyword,
        productIdsWithin,
        findProductCard,
        collectProductCards,
        collectJsonProductMap,
        hasExactElementLabel,
        ratingFromStars,
        styleCountFromCard,
        collectProducts,
        normalizeFilters,
        clearedFilters,
        normalizeShortcut,
        shortcutLabel,
        matchesShortcut,
        effectivePrice,
        evaluateProduct,
        formatProductLinks,
        exportHeaders,
        productToExportRow,
        filterSummary,
        createWorkbook,
    };
});
