// ==UserScript==
// @name         Shein Global Selector
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      0.3.21
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
// @connect      api.sheinshuju.com
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
    const SESSION_SCHEMA_VERSION = 4;
    const LAUNCHER_POSITION_KEY = `${APP_ID}-launcher-top-v1`;
    const COPY_SHORTCUT_KEY = `${APP_ID}-copy-shortcut-v1`;
    const COPY_SCOPE_KEY = `${APP_ID}-copy-scope-v1`;
    const PRODUCT_COLUMN_WIDTH_KEY = `${APP_ID}-product-column-width-v1`;
    const SOLD_BY_COLUMN_WIDTH_KEY = `${APP_ID}-sold-by-column-width-v1`;
    const PRODUCT_LINK_SELECTOR = 'a[href*="-p-"][href*=".html"],a[href*="goods-p-"]';
    const EXCLUDED_PATH = /\/(?:cart|user|account|orders?|checkout|login|wishlist)(?:\/|$)/i;
    const DETAIL_PATH = /(?:-p-|goods-p-)(\d+)\.html(?:\/)?$/i;
    const LIST_PATH = /(?:^\/pdsearch\/|-(?:c|sc)-\d+\.html(?:\/)?$)/i;
    const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
    const LAUNCHER_HEIGHT = 44;
    const PRODUCT_COLUMN_MIN_WIDTH = 210;
    const PRODUCT_COLUMN_MAX_WIDTH = 560;
    const SOLD_BY_COLUMN_MIN_WIDTH = 100;
    const SOLD_BY_COLUMN_MAX_WIDTH = 360;
    const DETAIL_SPEC_CONCURRENCY = 5;
    const DETAIL_SPEC_REQUEST_START_GAP_MS = 300;
    const DETAIL_SPEC_REQUEST_GAP_MS = 240;
    const DETAIL_SPEC_RATE_LIMIT_COOLDOWN_MS = 15 * 1000;
    const DETAIL_SPEC_RATE_LIMIT_MAX_COOLDOWN_MS = 60 * 1000;
    const DETAIL_SPEC_FAILURE_TTL_MS = 60 * 1000;
    const DETAIL_HTML_LIMIT_BYTES = 20 * 1024 * 1024;
    const DETAIL_API_VERSION = '1.1.8';
    const DETAIL_API_PATH = '/bff-api/product/get_goods_detail_realtime_data';
    const JIJIYUN_API_ORIGIN = 'https://api.sheinshuju.com';
    const JIJIYUN_CARD_PATH = '/api/v1/goods/card';
    const JIJIYUN_ENRICHMENT_CONCURRENCY = 4;
    const JIJIYUN_REQUEST_START_GAP_MS = 180;
    const JIJIYUN_FAILURE_RETRY_BASE_MS = 5 * 1000;
    const JIJIYUN_FAILURE_RETRY_MAX_MS = 60 * 1000;
    const STORE_CODE_ATTRIBUTE_NAMES = Object.freeze(['data-store_code', 'data-store-code', 'data-store-id', 'data-mall-id', 'data-shop-code']);
    const DEFAULT_COPY_SHORTCUT = Object.freeze({ code: 'KeyL', key: 'l', altKey: true, ctrlKey: false, metaKey: false, shiftKey: false });
    const FILTER_DEFAULTS = Object.freeze({
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

    function asText(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function normalizeText(value) {
        return asText(value).replace(/\s+/g, ' ').trim();
    }

    function lowerText(value) {
        return normalizeText(value).toLowerCase();
    }

    function firstPresent(...values) {
        return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
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

    function paginationLabels(element) {
        return [element?.getAttribute?.('aria-label'), element?.getAttribute?.('title'), element?.textContent]
            .map(lowerText)
            .filter(Boolean);
    }

    function hasPaginationContext(element) {
        let current = element;
        for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
            const identity = lowerText([
                current.id,
                current.className,
                current.getAttribute?.('role'),
                current.getAttribute?.('aria-label'),
            ].filter(Boolean).join(' '));
            if (/pagin|page-number|page-list/.test(identity)) return true;
        }
        return false;
    }

    function findOfficialPaginationControl(documentRef, delta, currentPage) {
        const targetPage = Math.max(1, Number(currentPage || 1) + delta);
        const targetLabels = new Set([`page ${targetPage}`, `página ${targetPage}`, String(targetPage)]);
        const directionPatterns = delta > 0
            ? [/^next page$/i, /^siguiente página$/i, /^página siguiente$/i]
            : [/^previous page$/i, /^anterior$/i, /^página anterior$/i];
        const candidates = Array.from(documentRef?.querySelectorAll?.('button, a, [role="button"]') || [])
            .filter((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true')
            .filter((element) => !element.closest('article, [class*="product-card"]'))
            .map((element) => {
                const labels = paginationLabels(element);
                const numbered = labels.some((label) => targetLabels.has(label));
                const directional = labels.some((label) => directionPatterns.some((pattern) => pattern.test(label)));
                if (!numbered && !directional) return null;
                const score = (numbered ? 100 : 50) + (hasPaginationContext(element) ? 30 : 0);
                return { element, score };
            })
            .filter(Boolean)
            .sort((left, right) => right.score - left.score);
        return candidates[0]?.element || null;
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

    function detailApiUrl(url, options = {}) {
        const parsed = toUrl(url);
        const site = getSiteProfile(parsed?.href || '');
        const goodsId = asText(options.goodsId || extractProductId(parsed?.href || ''));
        if (!parsed || !site || !/^\d+$/.test(goodsId)) return '';
        const params = new URLSearchParams({
            _ver: DETAIL_API_VERSION,
            _lang: site.code === 'MX' ? 'es' : 'en',
            goods_id: goodsId,
            isUserSelectedMallCode: '0',
            isQueryIsPaidMember: '1',
            isQueryCanTrail: '1',
            isHideEstimatePriceInfo: '0',
            specialSceneType: '0',
            sceneFlag: '',
            priorityMallType: '',
            skcPriceType: '',
            sourceFrom: 'goods_detail',
        });
        if (site.code === 'US') {
            const mallCode = asText(options.mallCode || parsed.searchParams.get('mallCode') || '1');
            params.set('mallCode', mallCode);
            params.set('priorityMallType', mallCode);
        }
        return `${parsed.origin}${DETAIL_API_PATH}?${params}`;
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

    function formatCount(value) {
        if (value === null || value === undefined || value === '') return '—';
        const number = Number(value);
        return Number.isFinite(number) ? Math.round(number).toLocaleString('en-US') : '—';
    }

    function officialPageNumber(documentRef) {
        const controls = Array.from(documentRef?.querySelectorAll?.('button, a, [role="button"]') || [])
            .filter((element) => hasPaginationContext(element));
        const current = controls.find((element) => lowerText(element.getAttribute?.('aria-current')) === 'page');
        if (current) {
            const labels = paginationLabels(current);
            for (const label of labels) {
                const match = label.match(/(?:page|página|pagina)\s*(\d+)|^(\d+)$/i);
                const page = Number(match?.[1] || match?.[2]);
                if (Number.isInteger(page) && page > 0) return page;
            }
        }
        const previous = controls.find((element) => paginationLabels(element).some((label) => /^(?:previous page|anterior|página anterior)$/i.test(label)));
        if (previous && (previous.disabled || previous.getAttribute?.('aria-disabled') === 'true')) return 1;
        return null;
    }

    function getPageNumber(url, documentRef = typeof document !== 'undefined' ? document : null) {
        const official = officialPageNumber(documentRef);
        if (official !== null) return official;
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

    function hasTrendLabel(root) {
        return [root, ...Array.from(root?.querySelectorAll?.('[data-trend-label]') || [])].some((element) => {
            const label = lowerText(element?.getAttribute?.('data-trend-label'));
            return /(?:^|[_\s-])trends?(?:[_\s-]|$)/i.test(label);
        }) || hasExactElementLabel(root, ['trends']);
    }

    function trendStoreMetadata(root) {
        const elements = [root, ...Array.from(root?.querySelectorAll?.('[data-trend-label]') || [])];
        for (const element of elements) {
            const label = normalizeText(element?.getAttribute?.('data-trend-label'));
            const match = label.match(/(?:^|[_\s-])trend_shop_code_(\d+)(?:_(.+))?$/i);
            if (!match) continue;
            return {
                storeCode: match[1],
                seller: normalizeText(match[2]?.replace(/_/g, ' ')),
            };
        }
        return { storeCode: '', seller: '' };
    }

    function storeCodeFromDom(card, link) {
        const elements = [link, card, ...Array.from(card?.querySelectorAll?.('[data-store_code],[data-store-code],[data-store-id],[data-mall-id],[data-shop-code]') || [])];
        for (const element of elements) {
            for (const attribute of STORE_CODE_ATTRIBUTE_NAMES) {
                const value = normalizeText(element?.getAttribute?.(attribute));
                if (/^\d+$/.test(value)) return value;
            }
        }
        return '';
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

    function normalizeImageUrl(value, base) {
        const raw = normalizeText(value);
        if (!raw || /^(?:data|blob|javascript):/i.test(raw)) return '';
        const parsed = toUrl(raw.startsWith('//') ? `https:${raw}` : raw, base);
        if (!parsed || !/^https?:$/.test(parsed.protocol)) return '';
        if (/(?:^|[\/_\-.])(placeholder|transparent|loading|lazyload|spacer|blank)(?:[\/_\-.?]|$)/i.test(parsed.href)) return '';
        return parsed.href;
    }

    function srcsetImageUrls(value) {
        return asText(value).split(',').map((entry) => {
            const [url, descriptor = ''] = entry.trim().split(/\s+/, 2);
            const amount = Number(descriptor.replace(/[^\d.]/g, '')) || 0;
            const unitWeight = descriptor.endsWith('w') ? 2 : (descriptor.endsWith('x') ? 1 : 0);
            return { url, score: unitWeight * 1_000_000 + amount };
        }).filter(({ url }) => url).sort((left, right) => right.score - left.score).map(({ url }) => url);
    }

    function imageUrlFromElement(image, base) {
        const directCandidates = [
            image?.getAttribute?.('data-src'),
            image?.getAttribute?.('data-original'),
            image?.getAttribute?.('data-lazy-src'),
            image?.getAttribute?.('data-original-src'),
            image?.getAttribute?.('data-image'),
            image?.getAttribute?.('data-url'),
        ];
        const responsiveCandidates = [
            ...srcsetImageUrls(image?.getAttribute?.('data-srcset')),
            ...srcsetImageUrls(image?.getAttribute?.('srcset')),
        ];
        const loadedCandidates = [image?.currentSrc, image?.getAttribute?.('src'), image?.src];
        return [...directCandidates, ...responsiveCandidates, ...loadedCandidates]
            .map((candidate) => normalizeImageUrl(candidate, base))
            .find(Boolean) || '';
    }

    function firstImage(root) {
        const base = root?.ownerDocument?.location?.href;
        const images = Array.from(root?.querySelectorAll?.('img') || []);
        images.sort((left, right) => Number(Boolean(right.closest?.(PRODUCT_LINK_SELECTOR))) - Number(Boolean(left.closest?.(PRODUCT_LINK_SELECTOR))));
        return images.map((image) => imageUrlFromElement(image, base)).find(Boolean) || '';
    }

    function structuredImageUrl(data, names, base) {
        const queue = names.map((name) => data?.[name]).filter((value) => value !== undefined && value !== null);
        const visited = new Set();
        for (let index = 0; index < queue.length && index < 80; index += 1) {
            const value = queue[index];
            if (typeof value === 'string') {
                const normalized = normalizeImageUrl(value, base);
                if (normalized) return normalized;
                continue;
            }
            if (!value || typeof value !== 'object' || visited.has(value)) continue;
            visited.add(value);
            const preferredKeys = ['origin_image', 'original_image', 'image_url', 'imageUrl', 'url', 'src', 'thumbnail'];
            preferredKeys.forEach((key) => { if (value[key] !== undefined) queue.push(value[key]); });
            Object.entries(value).forEach(([key, nested]) => { if (!preferredKeys.includes(key)) queue.push(nested); });
        }
        return '';
    }

    function structuredValue(data, names) {
        for (const name of names) {
            if (data?.[name] !== undefined && data?.[name] !== null && data?.[name] !== '') return data[name];
        }
        return null;
    }

    function listingStarComment(data = {}) {
        const rankInfo = structuredValue(data, ['rankInfo', 'rank_info']) || {};
        const standardView = structuredValue(rankInfo, ['pcStandardView', 'pc_standard_view']) || {};
        const labels = structuredValue(standardView, ['sellingPointUniversalLabels', 'selling_point_universal_labels']);
        if (!Array.isArray(labels)) return {};
        return labels.map((label) => structuredValue(label, ['starComment', 'star_comment']))
            .find((value) => value && typeof value === 'object') || {};
    }

    function listingReviewSignals(data = {}) {
        const starComment = listingStarComment(data);
        return {
            ratingRaw: firstPresent(
                structuredValue(data, ['comment_rank_average', 'commentRankAverage', 'rating', 'star']),
                structuredValue(starComment, ['comment_rank_average', 'commentRankAverage', 'goods_score', 'goodsScore', 'rating', 'star']),
            ),
            reviewsRaw: firstPresent(
                structuredValue(data, ['comment_num', 'commentNum', 'reviewCount']),
                structuredValue(starComment, ['comment_num', 'commentNum', 'comment_num_show', 'commentNumShow', 'reviewCount']),
            ),
        };
    }

    function siteUidForSite(siteCode) {
        const normalized = upperSiteCode(siteCode);
        return normalized === 'US' ? 'us' : (normalized === 'MX' ? 'mx' : '');
    }

    function upperSiteCode(value) {
        return normalizeText(value).toUpperCase();
    }

    function jijiyunCardUrl(product = {}, mallIdOverride = '') {
        const goodsId = normalizeText(product.goodsId);
        const requestedMallId = normalizeText(mallIdOverride || product.storeCode);
        const mallId = /^\d+$/.test(requestedMallId) ? requestedMallId : '1';
        const siteUID = siteUidForSite(product.site);
        if (!/^\d+$/.test(goodsId) || !/^\d+$/.test(mallId) || !siteUID) return '';
        const url = new URL(JIJIYUN_CARD_PATH, JIJIYUN_API_ORIGIN);
        url.searchParams.set('goodsId', goodsId);
        url.searchParams.set('mallId', mallId);
        url.searchParams.set('siteUID', siteUID);
        return url.href;
    }

    function normalizeOnSaleDate(value) {
        if (value === undefined || value === null || value === '') return null;
        let raw = value;
        if (typeof raw === 'number' || /^\d{10,13}$/.test(normalizeText(raw))) {
            const amount = Number(raw);
            raw = amount < 10_000_000_000 ? amount * 1000 : amount;
        }
        const time = new Date(raw).getTime();
        const minimum = Date.UTC(2018, 0, 1);
        const maximum = Date.now() + 24 * 60 * 60 * 1000;
        if (!Number.isFinite(time) || time < minimum || time > maximum) return null;
        const explicitDate = typeof value === 'string' ? value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] : '';
        return explicitDate || new Date(time).toISOString().slice(0, 10);
    }

    function parseJijiyunCardPayload(payload) {
        if (!payload || asText(payload.code) !== '0') return { seller: '', mallId: '', rating: null, reviews: null, sales: null, onSaleDate: null };
        const goods = payload.data?.goods || {};
        const mall = payload.data?.mall || {};
        return {
            seller: normalizeText(mall.mallName),
            mallId: normalizeText(goods.mallId),
            rating: parseNumber(goods.goodsScore),
            reviews: parseSales(goods.reviewNum),
            sales: parseSales(firstPresent(goods.sold, goods.last90DaysSoldNum)),
            onSaleDate: normalizeOnSaleDate(goods.onSaleTime),
        };
    }

    function hasSeller(product) {
        const seller = normalizeText(product?.seller);
        return Boolean(seller && seller !== '—');
    }

    function needsJijiyunEnrichment(product) {
        return Boolean(jijiyunCardUrl(product) && (
            !hasSeller(product)
            || product.sales === null || product.sales === undefined || Number(product.sales) === 0
            || product.rating === null || product.rating === undefined
            || product.reviews === null || product.reviews === undefined
            || !product.onSaleDate
        ));
    }

    function jijiyunFailureRetryDelay(failureCount) {
        const attempts = Math.max(1, Number(failureCount) || 1);
        return Math.min(JIJIYUN_FAILURE_RETRY_MAX_MS, JIJIYUN_FAILURE_RETRY_BASE_MS * (2 ** (attempts - 1)));
    }

    function jijiyunFailureReady(cached, now = Date.now()) {
        return Boolean(cached?.failed && Number(cached.nextRetryAt || 0) <= now);
    }

    function applyJijiyunData(product, data = {}) {
        if (!product) return false;
        let changed = false;
        const optionalNumber = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        };
        const sales = optionalNumber(data.sales);
        const rating = optionalNumber(data.rating);
        const reviews = optionalNumber(data.reviews);
        const mallId = normalizeText(data.mallId);
        if (!/^\d+$/.test(normalizeText(product.storeCode)) && /^\d+$/.test(mallId)) {
            product.storeCode = mallId;
            changed = true;
        }
        if (!hasSeller(product) && normalizeText(data.seller)) {
            product.seller = normalizeText(data.seller);
            product.sellerSource = '极鲸云';
            changed = true;
        }
        const salesMissing = product.sales === null || product.sales === undefined;
        const positiveFallbackForZero = Number(product.sales) === 0 && sales !== null && sales > 0;
        if ((salesMissing && sales !== null) || positiveFallbackForZero) {
            product.sales = Math.max(0, Math.round(sales));
            product.salesRaw = `${product.sales} (极鲸云${positiveFallbackForZero ? '兜底；页面 0' : ''})`;
            product.salesSource = '极鲸云';
            changed = true;
        }
        if ((product.rating === null || product.rating === undefined) && rating !== null) {
            product.rating = rating;
            product.ratingSource = '极鲸云';
            changed = true;
        }
        if ((product.reviews === null || product.reviews === undefined) && reviews !== null) {
            product.reviews = Math.max(0, Math.round(reviews));
            product.reviewsSource = '极鲸云';
            changed = true;
        }
        if (!product.onSaleDate && normalizeOnSaleDate(data.onSaleDate)) {
            product.onSaleDate = normalizeOnSaleDate(data.onSaleDate);
            product.onSaleDateSource = '极鲸云';
            changed = true;
        }
        return changed;
    }

    function runtimeJsonRequest(url) {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ type: 'XYNIGO_FETCH_JSON', url }, (response) => {
                    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                    if (!response?.ok) return reject(new Error(response?.error || '数据请求失败'));
                    resolve(response.payload);
                });
            });
        }
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET', url, responseType: 'json', timeout: 12000, anonymous: true,
                    onload(response) {
                        if (response.status < 200 || response.status >= 300) return reject(new Error(`HTTP ${response.status}`));
                        try {
                            resolve(response.response || JSON.parse(response.responseText));
                        } catch (_error) {
                            reject(new Error('数据接口返回非 JSON 内容'));
                        }
                    },
                    onerror: () => reject(new Error('数据请求失败')),
                    ontimeout: () => reject(new Error('数据请求超时')),
                });
            });
        }
        if (typeof globalThis.fetch === 'function') {
            return globalThis.fetch(url, { credentials: 'omit', cache: 'no-store' }).then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            });
        }
        return Promise.reject(new Error('当前环境不支持数据补全'));
    }

    async function fetchJijiyunProductCard(product, options = {}) {
        const empty = { seller: '', mallId: '', rating: null, reviews: null, sales: null, onSaleDate: null };
        const requestedMallId = /^\d+$/.test(normalizeText(product.storeCode)) ? normalizeText(product.storeCode) : '1';
        const requestCard = async (mallId) => {
            const url = jijiyunCardUrl(product, mallId);
            if (!url) return empty;
            let payload;
            if (typeof options.fetchImpl === 'function') {
                const response = await options.fetchImpl(url, { credentials: 'omit', cache: 'no-store', signal: options.signal });
                if (!response?.ok) throw new Error(`HTTP ${response?.status || '未知'}`);
                payload = await response.json();
            } else {
                payload = await runtimeJsonRequest(url);
            }
            return parseJijiyunCardPayload(payload);
        };
        const first = await requestCard(requestedMallId);
        if (first.seller || !/^\d+$/.test(first.mallId) || first.mallId === requestedMallId) return first;
        try {
            const second = await requestCard(first.mallId);
            return {
                seller: second.seller || first.seller,
                mallId: first.mallId || second.mallId,
                rating: first.rating ?? second.rating,
                reviews: first.reviews ?? second.reviews,
                sales: first.sales ?? second.sales,
                onSaleDate: first.onSaleDate || second.onSaleDate,
            };
        } catch (_error) {
            return first;
        }
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

    function colorwayCountFromCard(card) {
        const explicit = parseNumber(firstText(card, ['.product-card__color-count', '[class*="color-count"]']));
        if (explicit !== null) return explicit;
        const swatches = card.querySelectorAll?.('.product-card__color-item,[class*="color-item"]')?.length || 0;
        return swatches || 1;
    }

    function distinctOptionCount(items, preferredKeys = []) {
        const values = new Set();
        Array.from(items || []).forEach((item, index) => {
            if (item === null || item === undefined) return;
            if (typeof item !== 'object') {
                const value = normalizeText(item);
                if (value) values.add(value);
                return;
            }
            const value = preferredKeys.map((key) => item[key]).find((candidate) => candidate !== undefined && candidate !== null && candidate !== '')
                ?? item.attr_value_id ?? item.attrValueId ?? item.attr_value_name ?? item.attrValueName ?? item.attr_value ?? item.value ?? item.goods_id ?? item.goodsId;
            values.add(normalizeText(value) || `option-${index}`);
        });
        return values.size;
    }

    function normalizeSpecName(value) {
        const name = normalizeText(value);
        if (!name) return '';
        if (/^(?:color|colour|颜色|colourway|colorway)$/i.test(name)) return 'Color';
        if (/^(?:size|talla|尺码|尺寸)$/i.test(name)) return 'Size';
        return name;
    }

    function emptySpecStructure(source = 'listing', error = '') {
        return {
            specType: '—',
            primarySpec: '—',
            primarySpecCount: null,
            secondarySpec: '—',
            secondarySpecCount: null,
            skuQty: '—',
            specSource: source,
            specConfirmed: false,
            specError: error,
        };
    }

    function extractBalancedJson(source, markerEnd) {
        let start = Number(markerEnd);
        while (/\s/.test(source[start] || '')) start += 1;
        const opener = source[start];
        const closer = opener === '{' ? '}' : (opener === '[' ? ']' : '');
        if (!closer) return '';
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < source.length; index += 1) {
            const character = source[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === '"') inString = false;
                continue;
            }
            if (character === '"') inString = true;
            else if (character === opener) depth += 1;
            else if (character === closer) {
                depth -= 1;
                if (depth === 0) return source.slice(start, index + 1);
            }
        }
        return '';
    }

    function detailScripts(input) {
        if (typeof input !== 'string') {
            return Array.from(input?.querySelectorAll?.('script') || []).map((script) => ({
                id: asText(script.id),
                type: asText(script.type),
                content: script.textContent || '',
            }));
        }
        const scripts = [];
        const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
        let match;
        while ((match = pattern.exec(asText(input)))) {
            const attributes = match[1] || '';
            const attributeValue = (name) => attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || '';
            scripts.push({ id: attributeValue('id'), type: attributeValue('type'), content: match[2] || '' });
        }
        return scripts;
    }

    function parseDetailRawData(input) {
        const sources = typeof input === 'string' ? [input] : detailScripts(input).map((script) => script.content);
        for (const source of sources) {
            const assignment = /(?:window\.)?gbRawData\s*=\s*/.exec(source);
            if (!assignment) continue;
            const json = extractBalancedJson(source, assignment.index + assignment[0].length);
            if (!json) continue;
            try { return JSON.parse(json); } catch (_error) { /* Try another matching script. */ }
        }
        return null;
    }

    function flattenDetailSchema(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.flatMap(flattenDetailSchema);
        if (Array.isArray(value['@graph'])) return value['@graph'].flatMap(flattenDetailSchema);
        return [value];
    }

    function parseDetailSchemas(input) {
        const schemas = [];
        detailScripts(input).forEach((script) => {
            if (script.id !== 'goodsDetailSchema' && lowerText(script.type) !== 'application/ld+json') return;
            try {
                flattenDetailSchema(JSON.parse(script.content)).forEach((schema) => {
                    if (schema?.['@type'] === 'ProductGroup' || Array.isArray(schema?.hasVariant)) schemas.push(schema);
                });
            } catch (_error) { /* Ignore unrelated or malformed JSON-LD. */ }
        });
        return schemas;
    }

    function detailGoodsIds(rawData) {
        const modules = rawData?.modules || {};
        const multiLevel = modules.saleAttr?.multiLevelSaleAttribute || {};
        return [
            rawData?.canonicalInfo?.goods_id,
            modules.productInfo?.goods_id,
            multiLevel.goods_id,
        ].map(asText).filter((value) => /^\d+$/.test(value));
    }

    function specStructureFromDetailData(rawData, expectedGoodsId = '') {
        if (!rawData || typeof rawData !== 'object') return emptySpecStructure('detail', '详情页未找到 gbRawData');
        const expected = asText(expectedGoodsId);
        const ids = detailGoodsIds(rawData);
        if (expected && (!ids.length || ids.some((goodsId) => goodsId !== expected))) return emptySpecStructure('detail', '详情页商品 ID 不一致');

        const modules = rawData.modules || {};
        const saleAttr = modules.saleAttr || {};
        const mainAttribute = saleAttr.mainSaleAttribute || {};
        const multiLevel = saleAttr.multiLevelSaleAttribute || {};
        const skuList = Array.isArray(multiLevel.sku_list) ? multiLevel.sku_list : [];
        if (!Object.keys(saleAttr).length && !skuList.length) return emptySpecStructure('detail', '详情页缺少规格数据');

        const attributes = new Map();
        const addAttribute = (rawName, rawCount = null, rawKey = '') => {
            const name = normalizeSpecName(rawName);
            const number = Number(rawCount);
            const count = Number.isFinite(number) && number > 1 ? number : null;
            if (!name || count === null) return;
            const key = asText(rawKey) || lowerText(name);
            const current = attributes.get(key);
            if (!current || count > current.count) attributes.set(key, { name, count });
        };

        const mainInfo = Array.isArray(mainAttribute.info) ? mainAttribute.info : [];
        const mainName = structuredValue(mainAttribute, ['attr_name', 'attrName', 'name'])
            || structuredValue(mainInfo[0], ['attr_name', 'attrName', 'name']);
        const mainKey = structuredValue(mainAttribute, ['attr_id', 'attrId'])
            || structuredValue(mainInfo[0], ['attr_id', 'attrId'])
            || lowerText(normalizeSpecName(mainName));
        addAttribute(mainName, distinctOptionCount(mainInfo, ['attr_value_id', 'attrValueId', 'goods_id', 'goodsId']), mainKey);

        const definitions = [multiLevel.skc_sale_attr, multiLevel.skcSaleAttr, multiLevel.sale_attrs, multiLevel.saleAttrs].find(Array.isArray) || [];
        definitions.forEach((definition) => {
            const values = structuredValue(definition, ['attr_value_list', 'attrValueList', 'values', 'options']);
            const name = structuredValue(definition, ['attr_name', 'attrName', 'name', 'attr_name_en']);
            const key = structuredValue(definition, ['attr_id', 'attrId']) || lowerText(normalizeSpecName(name));
            addAttribute(name, Array.isArray(values) ? distinctOptionCount(values) : null, key);
        });

        const skuAttributes = new Map();
        skuList.forEach((sku) => {
            const saleAttributes = structuredValue(sku, ['sku_sale_attr', 'skuSaleAttr', 'sale_attrs', 'saleAttrs']);
            if (!Array.isArray(saleAttributes)) return;
            saleAttributes.forEach((attribute) => {
                const name = structuredValue(attribute, ['attr_name', 'attrName', 'name', 'attr_name_en']);
                const key = asText(structuredValue(attribute, ['attr_id', 'attrId'])) || lowerText(normalizeSpecName(name));
                if (!key || !name) return;
                if (!skuAttributes.has(key)) skuAttributes.set(key, { name, values: [] });
                skuAttributes.get(key).values.push(attribute);
            });
        });
        skuAttributes.forEach(({ name, values }, key) => addAttribute(name, distinctOptionCount(values), key));

        const ordered = Array.from(attributes.values()).slice(0, 2);
        const specType = ordered.length > 1 ? 'Dual' : (ordered.length === 1 || skuList.length === 1 ? 'Single' : '—');
        return {
            specType,
            primarySpec: ordered[0]?.name || '—',
            primarySpecCount: ordered[0]?.count ?? null,
            secondarySpec: ordered[1]?.name || '—',
            secondarySpecCount: ordered[1]?.count ?? null,
            skuQty: skuList.length || '—',
            specSource: 'detail',
            specConfirmed: specType !== '—',
            specError: specType === '—' ? '详情页规格结构不完整' : '',
        };
    }

    function specStructureFromDetailSchema(schemas, expectedGoodsId = '') {
        const expected = asText(expectedGoodsId);
        const schemaGoodsIds = (schema) => [
            schema?.url,
            ...(schema?.hasVariant || []).map((variant) => variant?.offers?.url),
        ].map((url) => extractProductId(asText(url))).filter(Boolean);
        const schema = expected
            ? Array.from(schemas || []).find((candidate) => schemaGoodsIds(candidate).includes(expected))
            : Array.from(schemas || [])[0];
        if (!schema) return emptySpecStructure('detail-schema', expected ? '详情页 JSON-LD 商品 ID 不一致' : '详情页缺少商品 JSON-LD');

        const variants = Array.isArray(schema.hasVariant) ? schema.hasVariant : [];
        const nodes = [schema, ...variants];
        const values = { Color: [], Size: [] };
        nodes.forEach((node) => {
            if (node?.color) values.Color.push(node.color);
            if (node?.size) values.Size.push(node.size);
            Array.from(node?.additionalProperty || []).forEach((property) => {
                const name = normalizeSpecName(property?.name || property?.propertyID);
                if (values[name] && property?.value !== undefined) values[name].push(property.value);
            });
        });
        const dimensions = Object.entries(values).map(([name, rawValues]) => ({
            name,
            count: new Set(rawValues.map(normalizeText).filter(Boolean)).size,
        })).filter(({ count }) => count > 1);
        const specType = dimensions.length > 1 ? 'Dual' : (dimensions.length === 1 || variants.length === 1 ? 'Single' : '—');
        return {
            specType,
            primarySpec: dimensions[0]?.name || '—',
            primarySpecCount: dimensions[0]?.count ?? null,
            secondarySpec: dimensions[1]?.name || '—',
            secondarySpecCount: dimensions[1]?.count ?? null,
            skuQty: variants.length || '—',
            specSource: 'detail-schema',
            specConfirmed: specType !== '—',
            specError: specType === '—' ? 'JSON-LD 规格结构不完整' : '',
        };
    }

    function specStructureFromDetailDom(documentRef) {
        if (!documentRef?.querySelectorAll) return emptySpecStructure('detail-dom', '详情页 DOM 不可用');
        const groups = Array.from(documentRef.querySelectorAll([
            '[class*="product-intro"][class*="color"]',
            '[class*="product-intro"][class*="size"]',
            '[class*="goods-color"]',
            '[class*="goods-size"]',
            '[data-attr-name]',
            '[data-attr_name]',
        ].join(',')));
        const dimensions = new Map();
        groups.forEach((group) => {
            const identity = [group.className, group.getAttribute('data-attr-name'), group.getAttribute('data-attr_name'), group.getAttribute('aria-label')].map(asText).join(' ');
            const name = /(?:color|colour|颜色)/i.test(identity) ? 'Color' : (/(?:size|talla|尺码|尺寸)/i.test(identity) ? 'Size' : '');
            if (!name) return;
            const options = Array.from(group.querySelectorAll('[data-attr-value-id],[data-attr_value_id],[role="radio"],input[type="radio"]'));
            const values = new Set(options.map((option, index) => normalizeText(
                option.getAttribute('data-attr-value-id')
                || option.getAttribute('data-attr_value_id')
                || option.value
                || option.getAttribute('aria-label')
                || option.getAttribute('title')
                || option.textContent,
            ) || `option-${index}`));
            if (values.size > 1 && values.size > (dimensions.get(name)?.count || 0)) dimensions.set(name, { name, count: values.size });
        });
        const ordered = ['Color', 'Size'].map((name) => dimensions.get(name)).filter(Boolean);
        const specType = ordered.length > 1 ? 'Dual' : (ordered.length === 1 ? 'Single' : '—');
        return {
            specType,
            primarySpec: ordered[0]?.name || '—',
            primarySpecCount: ordered[0]?.count ?? null,
            secondarySpec: ordered[1]?.name || '—',
            secondarySpecCount: ordered[1]?.count ?? null,
            skuQty: '—',
            specSource: 'detail-dom',
            specConfirmed: specType !== '—',
            specError: specType === '—' ? '详情页 DOM 未找到可确认的规格组' : '',
        };
    }

    function mergeSpecStructures(base, supplement) {
        if (!supplement?.specConfirmed) return supplement || emptySpecStructure('detail', '详情规格未确认');
        const dimensions = new Map();
        const add = (name, count) => {
            const normalizedName = normalizeSpecName(name);
            const number = Number(count);
            if (!normalizedName || normalizedName === '—' || !Number.isFinite(number) || number <= 1) return;
            const current = dimensions.get(lowerText(normalizedName));
            if (!current || number > current.count) dimensions.set(lowerText(normalizedName), { name: normalizedName, count: number });
        };
        add(base?.primarySpec, base?.primarySpecCount);
        add(base?.secondarySpec, base?.secondarySpecCount);
        add(supplement.primarySpec, supplement.primarySpecCount);
        add(supplement.secondarySpec, supplement.secondarySpecCount);
        const ordered = Array.from(dimensions.values()).slice(0, 2);
        const specType = ordered.length > 1 ? 'Dual' : (ordered.length === 1 ? 'Single' : supplement.specType);
        return {
            ...supplement,
            specType,
            primarySpec: ordered[0]?.name || supplement.primarySpec || '—',
            primarySpecCount: ordered[0]?.count ?? supplement.primarySpecCount ?? null,
            secondarySpec: ordered[1]?.name || '—',
            secondarySpecCount: ordered[1]?.count ?? null,
            specConfirmed: specType !== '—',
        };
    }

    function specStructureFromDetailHtml(html, expectedGoodsId = '') {
        const rawResult = specStructureFromDetailData(parseDetailRawData(html), expectedGoodsId);
        if (rawResult.specConfirmed) return rawResult;
        const schemaResult = specStructureFromDetailSchema(parseDetailSchemas(html), expectedGoodsId);
        if (schemaResult.specConfirmed) return schemaResult;
        if (typeof DOMParser === 'function') {
            const domResult = specStructureFromDetailDom(new DOMParser().parseFromString(html, 'text/html'));
            if (domResult.specConfirmed) return domResult;
        }
        return { ...rawResult, specError: [rawResult.specError, schemaResult.specError].filter(Boolean).join('；') };
    }

    function specStructureFromDetailApi(payload, expectedGoodsId = '') {
        const expected = asText(expectedGoodsId);
        const info = payload?.info;
        if (!info || typeof info !== 'object') return emptySpecStructure('detail-api', '详情接口缺少商品数据');
        const rawData = {
            canonicalInfo: { goods_id: expected },
            modules: {
                productInfo: info.productInfo || {},
                saleAttr: info.saleAttr || {},
            },
        };
        const result = specStructureFromDetailData(rawData, expected);
        return { ...result, specSource: 'detail-api' };
    }

    function detailBlockKind(response, body = '') {
        const responseUrl = lowerText(response?.url);
        const content = lowerText(body.slice(0, 12000));
        if (/\/risk\/action\/limit/.test(responseUrl) || /risk\/action\/limit/.test(content)) return 'rate-limit';
        if (/\/risk\/challenge/.test(responseUrl) || /captcha_type|risk\/challenge/.test(content)) return 'captcha';
        return '';
    }

    function isRiskDetailResponse(response, body = '') {
        return Boolean(detailBlockKind(response, body));
    }

    async function fetchDetailSpecStructure(url, options = {}) {
        const parsed = toUrl(url);
        const expectedGoodsId = extractProductId(parsed?.href || '');
        const fetchImpl = options.fetchImpl || globalThis.fetch;
        const apiUrl = detailApiUrl(parsed?.href || '', { goodsId: expectedGoodsId, mallCode: options.mallCode });
        if (!parsed || !expectedGoodsId || !apiUrl || typeof fetchImpl !== 'function') return emptySpecStructure('detail-api', '无法请求商品详情接口');
        try {
            const response = await fetchImpl(apiUrl, {
                credentials: 'include',
                redirect: 'follow',
                cache: 'no-store',
                signal: options.signal,
            });
            if (!response?.ok) return emptySpecStructure('detail-api', `详情接口请求失败：${response?.status || '未知'}`);
            const body = await response.text();
            const blockKind = detailBlockKind(response, body);
            if (blockKind === 'rate-limit') {
                return { ...emptySpecStructure('detail-api', 'SHEIN 规格接口限流：商品页可正常打开，无需验证'), specFailureKind: 'rate-limit' };
            }
            if (blockKind === 'captcha') {
                return { ...emptySpecStructure('detail-api', 'SHEIN 风控拦截：请完成验证后重试'), specFailureKind: 'risk' };
            }
            if (!body || body.length > DETAIL_HTML_LIMIT_BYTES) return emptySpecStructure('detail-api', '详情接口内容无效');
            let payload;
            try {
                payload = JSON.parse(body);
            } catch (_error) {
                return emptySpecStructure('detail-api', '详情接口返回了非 JSON 内容');
            }
            if (asText(payload?.code) !== '0') return emptySpecStructure('detail-api', `详情接口返回错误：${asText(payload?.code) || '未知'}`);
            return specStructureFromDetailApi(payload, expectedGoodsId);
        } catch (error) {
            if (error?.name === 'AbortError') {
                return { ...emptySpecStructure('detail-api', '规格补全已取消'), specFailureKind: 'aborted' };
            }
            return emptySpecStructure('detail-api', `详情接口请求失败：${error.message}`);
        }
    }

    function specStructureFromListing(data = {}, card) {
        const saleAttr = structuredValue(data, ['saleAttr', 'sale_attr']) || {};
        const mainAttribute = structuredValue(data, ['mainSaleAttribute', 'main_sale_attribute'])
            || structuredValue(saleAttr, ['mainSaleAttribute', 'main_sale_attribute']) || {};
        const multiLevel = structuredValue(data, ['multiLevelSaleAttribute', 'multi_level_sale_attribute'])
            || structuredValue(saleAttr, ['multiLevelSaleAttribute', 'multi_level_sale_attribute']) || {};
        const attributes = new Map();
        let hasExplicitSkuSpec = false;
        const addAttribute = (rawName, rawCount = null) => {
            const name = normalizeSpecName(rawName);
            const number = Number(rawCount);
            const count = Number.isFinite(number) && number > 0 ? number : null;
            if (!name || count === 1) return;
            const key = lowerText(name);
            const current = attributes.get(key);
            if (!current || (count !== null && (current.count === null || count > current.count))) attributes.set(key, { name, count });
        };

        const relatedColors = structuredValue(data, ['relatedColorNew', 'related_color_new', 'colorList', 'colors']);
        const mainInfo = structuredValue(mainAttribute, ['info', 'list', 'values']);
        const cardColorways = parseNumber(card?.getAttribute?.('data-style-count')) ?? colorwayCountFromCard(card);
        const colorwayCount = Math.max(
            Array.isArray(relatedColors) ? relatedColors.length : 0,
            Array.isArray(mainInfo) ? distinctOptionCount(mainInfo, ['goods_id', 'goodsId']) : 0,
            Number(cardColorways) || 0,
        );
        const mainName = structuredValue(mainAttribute, ['attr_name', 'attrName', 'name'])
            || structuredValue(Array.isArray(mainInfo) ? mainInfo[0] : null, ['attr_name', 'attrName', 'name'])
            || 'Color';
        if (colorwayCount > 1) addAttribute(mainName, colorwayCount);

        const definitionLists = [
            structuredValue(data, ['skc_sale_attr', 'skcSaleAttr', 'sale_attrs', 'saleAttrs']),
            structuredValue(multiLevel, ['skc_sale_attr', 'skcSaleAttr', 'sale_attrs', 'saleAttrs']),
        ].filter(Array.isArray);
        definitionLists.flat().forEach((definition) => {
            const values = structuredValue(definition, ['attr_value_list', 'attrValueList', 'values', 'options']);
            const count = Array.isArray(values) ? distinctOptionCount(values) : null;
            const name = structuredValue(definition, ['attr_name', 'attrName', 'name']);
            const before = attributes.size;
            addAttribute(name, count);
            if (attributes.size > before || attributes.has(lowerText(normalizeSpecName(name)))) hasExplicitSkuSpec = true;
        });

        const skuLists = [
            structuredValue(data, ['sku_list', 'skuList', 'skus']),
            structuredValue(multiLevel, ['sku_list', 'skuList', 'skus']),
        ].filter(Array.isArray);
        const skuAttributes = new Map();
        skuLists.flat().forEach((sku) => {
            const saleAttributes = structuredValue(sku, ['sku_sale_attr', 'skuSaleAttr', 'sale_attrs', 'saleAttrs']);
            if (!Array.isArray(saleAttributes)) return;
            saleAttributes.forEach((attribute) => {
                const name = normalizeSpecName(structuredValue(attribute, ['attr_name', 'attrName', 'name']));
                if (!name) return;
                const key = lowerText(name);
                if (!skuAttributes.has(key)) skuAttributes.set(key, { name, values: [] });
                skuAttributes.get(key).values.push(attribute);
            });
        });
        skuAttributes.forEach(({ name, values }) => {
            const before = attributes.size;
            addAttribute(name, distinctOptionCount(values));
            if (attributes.size > before || attributes.has(lowerText(name))) hasExplicitSkuSpec = true;
        });

        const singleSku = structuredValue(data, ['is_single_sku', 'isSingleSku']) ?? card?.getAttribute?.('data-is-single-sku');
        const hasOneSku = singleSku === 1 || singleSku === '1' || singleSku === true;

        const ordered = Array.from(attributes.values()).slice(0, 2);
        const hasConfirmedSingleDimension = ordered.length === 1 && (hasOneSku || (hasExplicitSkuSpec && colorwayCount <= 1));
        const specType = ordered.length > 1 ? 'Dual' : ((hasConfirmedSingleDimension || (ordered.length === 0 && hasOneSku)) ? 'Single' : '—');
        return {
            specType,
            primarySpec: ordered[0]?.name || '—',
            primarySpecCount: ordered[0]?.count ?? null,
            secondarySpec: ordered[1]?.name || '—',
            secondarySpecCount: ordered[1]?.count ?? null,
            skuQty: skuLists.length ? Math.max(...skuLists.map((list) => list.length)) || '—' : '—',
            specSource: 'listing',
            specConfirmed: specType !== '—',
            specError: specType === '—' ? '列表页规格数据不完整' : '',
        };
    }

    function extractProduct(card, context) {
        const link = Array.from(card.querySelectorAll(PRODUCT_LINK_SELECTOR))
            .find((candidate) => extractProductId(candidate.href || candidate.getAttribute('href')));
        if (!link) return null;
        const rawProductUrl = toUrl(link.href || link.getAttribute('href'), context.url);
        const url = canonicalizeProductUrl(rawProductUrl?.href || '', context.url);
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
        const reviewSignals = listingReviewSignals(data);
        const ratingRaw = firstPresent(
            reviewSignals.ratingRaw,
            card.getAttribute('data-rating'),
            firstText(card, ['[class*="rating"]', '[aria-label*="star"]']),
        );
        const rating = parseNumber(ratingRaw) ?? ratingFromStars(card);
        const reviewsRaw = firstPresent(
            reviewSignals.reviewsRaw,
            firstText(card, ['.start-text', '[class*="review-count"]', '[class*="comment"]']),
        );
        const reviews = parseSales(reviewsRaw);
        const specStructure = specStructureFromListing(data, card);
        const trendStore = trendStoreMetadata(card);
        const domStoreCode = storeCodeFromDom(card, link);
        const seller = normalizeText(structuredValue(data, [
            'storeTitle', 'store_title', 'storeName', 'store_name', 'sellerName', 'seller_name', 'mallName', 'mall_name', 'shopName', 'shop_name',
        ]) || firstText(card, [
            '[data-store-name]', '[data-seller-name]', '[data-mall-name]', '[data-shop-name]',
            '[class*="store-name"]', '[class*="seller-name"]', '[class*="mall-name"]', '[class*="shop-name"]',
        ]) || trendStore.seller || firstText(card, [
            '.delivery-words-title__text', '.delivery-words-title', '[class*="brand-title"]',
        ])) || '—';
        const onSaleDate = normalizeOnSaleDate(structuredValue(data, ['onSaleTime', 'on_sale_time']));
        const isQuickShip = hasExactElementLabel(card, ['quickship', 'local']);
        const fulfillment = isQuickShip ? 'QuickShip' : 'GlobalShip';
        return {
            site: context.site.code,
            pageType: context.pageType,
            keyword: context.keyword,
            page: context.page,
            scannedAt: new Date().toISOString(),
            goodsId,
            mallCode: normalizeText(rawProductUrl?.searchParams.get('mallCode') || structuredValue(data, ['mallCode', 'mall_code'])) || (context.site.code === 'US' ? '1' : ''),
            storeCode: normalizeText(structuredValue(data, ['store_code', 'storeCode', 'storeId', 'store_id', 'mallId', 'mall_id', 'shopCode', 'shop_code']) || domStoreCode || trendStore.storeCode),
            productSku: normalizeText(structuredValue(data, ['goods_sn', 'goodsSn', 'productSku', 'product_sku'])) || '—',
            title: title || `SHEIN ${goodsId}`,
            url,
            imageUrl: firstImage(card) || structuredImageUrl(data, ['goods_img', 'goodsImg', 'imageUrl', 'image_url'], context.url),
            currency: context.site.currency,
            originalPrice,
            currentPrice,
            salesRaw: salesRaw || '—',
            sales,
            salesSource: sales !== null ? 'SHEIN' : '',
            rating,
            ratingSource: rating !== null ? 'SHEIN' : '',
            reviews,
            reviewsSource: reviews !== null ? 'SHEIN' : '',
            onSaleDate,
            onSaleDateSource: onSaleDate ? 'SHEIN' : '',
            specType: specStructure.specType,
            primarySpec: specStructure.primarySpec,
            primarySpecCount: specStructure.primarySpecCount,
            secondarySpec: specStructure.secondarySpec,
            secondarySpecCount: specStructure.secondarySpecCount,
            skuQty: specStructure.skuQty,
            specSource: specStructure.specSource,
            specConfirmed: specStructure.specConfirmed,
            specError: specStructure.specError,
            specLookupStatus: specStructure.specConfirmed ? 'confirmed' : 'pending',
            fulfillment,
            seller,
            sellerSource: seller !== '—' ? 'SHEIN' : '',
            storeType: /official/i.test(cardText) ? 'Official store' : '—',
            trends: hasTrendLabel(card),
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
            page: getPageNumber(url, doc),
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
        const defaults = { ...FILTER_DEFAULTS };
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
            singleSpec: Boolean(merged.singleSpec),
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
            singleSpec: false,
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
        if (filters.singleSpec && product.specType !== 'Single') reasons.push(product.specType === '—' ? '规格结构待确认' : '非单规格');
        return { matched: reasons.length === 0, reasons, effectivePrice: price };
    }

    function formatProductLinks(products) {
        return Array.from(new Set((products || []).map((product) => canonicalizeProductUrl(product.url)).filter(Boolean))).join('\n');
    }

    function exportHeaders() {
        return [
            '站点', '页面类型', '关键词/类目', '页码', '扫描时间', 'Goods ID', 'Product SKU', '商品标题', '商品链接', '商品主图', '主图 URL',
            '币种', '原价', '页面价', '优惠券 OFF %', '支付比例 %', '折后价', '销量原文', '销量下限', '星级', '评论数', '上架日期',
            '规格类型', '主规格', '次规格', 'SKU Qty', 'Fulfillment', 'Sold by', '店铺类型', 'Trends', 'New Arrivals', 'Best Seller',
            'Almost sold out', 'Repeat customers', 'Other sellers', '筛选结果', '未命中原因', '筛选条件',
        ];
    }

    function specExportValue(name, count) {
        if (!name || name === '—') return '—';
        const hasCount = count !== null && count !== undefined && count !== '' && Number.isFinite(Number(count));
        return hasCount ? `${name} · ${Number(count)}` : name;
    }

    function productToExportRow(product, filters, imageCellValue = '') {
        const evaluation = evaluateProduct(product, filters);
        return [
            product.site, product.pageType, product.keyword, product.page, product.scannedAt, product.goodsId, product.productSku, product.title, product.url,
            imageCellValue, product.imageUrl, product.currency, product.originalPrice, product.currentPrice, filters.couponOff, 100 - filters.couponOff,
            evaluation.effectivePrice, product.salesRaw, product.sales, product.rating, product.reviews, product.onSaleDate, product.specType,
            specExportValue(product.primarySpec, product.primarySpecCount), specExportValue(product.secondarySpec, product.secondarySpecCount), product.skuQty,
            product.fulfillment, product.seller, product.storeType, product.trends ? 'Yes' : 'No', product.newArrivals ? 'Yes' : 'No',
            product.bestSeller ? 'Yes' : 'No', product.almostSoldOut ? 'Yes' : 'No', product.repeatCustomers ? 'Yes' : 'No', product.otherSellers ? 'Yes' : 'No',
            evaluation.matched ? 'Matched' : 'Unmatched', evaluation.reasons.join('；'), filterSummary(filters),
        ];
    }

    function filterSummary(filters) {
        return [
            filters.globalShip ? 'GlobalShip' : '', filters.quickShip ? 'QuickShip' : '', filters.salesMin !== null ? `Sales>=${filters.salesMin}` : '',
            filters.priceMin !== null ? `Price>=${filters.priceMin}` : '', filters.priceMax !== null ? `Price<=${filters.priceMax}` : '',
            `Coupon=${filters.couponOff}%OFF`, filters.ratingMin !== null ? `Rating>=${filters.ratingMin}` : '', filters.trends ? 'Trends' : '', filters.newArrivals ? 'New Arrivals' : '', filters.singleSpec ? 'Single-Spec' : '',
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
        sheet.autoFilter = { from: 'A1', to: 'AL1' };
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

        function readProductColumnWidth() {
            try {
                const value = Number(window.localStorage.getItem(PRODUCT_COLUMN_WIDTH_KEY));
                return Number.isFinite(value) && value >= PRODUCT_COLUMN_MIN_WIDTH ? value : PRODUCT_COLUMN_MIN_WIDTH;
            } catch (_error) {
                return PRODUCT_COLUMN_MIN_WIDTH;
            }
        }

        function readSoldByColumnWidth() {
            try {
                const value = Number(window.localStorage.getItem(SOLD_BY_COLUMN_WIDTH_KEY));
                return Number.isFinite(value) && value >= SOLD_BY_COLUMN_MIN_WIDTH ? value : SOLD_BY_COLUMN_MIN_WIDTH;
            } catch (_error) {
                return SOLD_BY_COLUMN_MIN_WIDTH;
            }
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
            sort: { key: null, direction: 'ascending' },
            scanTimer: 0,
            scanSignature: '',
            pendingScanOptions: null,
            pageNavigation: null,
            detailSpecCache: new Map(),
            detailSpecTimer: 0,
            detailSpecActive: false,
            detailSpecProgress: { completed: 0, total: 0, failed: 0 },
            detailSpecPendingOptions: null,
            detailSpecMode: 'filter',
            detailSpecConcurrency: DETAIL_SPEC_CONCURRENCY,
            detailSpecCooldownUntil: 0,
            detailSpecRateLimitCount: 0,
            jijiyunCache: new Map(),
            jijiyunMallCache: new Map(),
            jijiyunTimer: 0,
            jijiyunActive: false,
            jijiyunPending: false,
            jijiyunNextRequestAt: 0,
            host: null,
            shadow: null,
            launcherHost: null,
            launcher: null,
            launcherTop: Math.round(window.innerHeight * 0.38),
            productColumnWidth: readProductColumnWidth(),
            soldByColumnWidth: readSoldByColumnWidth(),
        };

        function readSession() {
            try {
                const session = JSON.parse(sessionStorage.getItem(`${SESSION_KEY}-${site.code}`) || 'null');
                if (!session) return null;
                if (session.schemaVersion === SESSION_SCHEMA_VERSION) return session;
                return {
                    ...session,
                    schemaVersion: SESSION_SCHEMA_VERSION,
                    filters: normalizeFilters({}, site.code),
                };
            } catch (_error) {
                return null;
            }
        }

        function saveSession() {
            try {
                sessionStorage.setItem(`${SESSION_KEY}-${site.code}`, JSON.stringify({ schemaVersion: SESSION_SCHEMA_VERSION, filters: state.filters, open: state.open }));
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
            if (name === 'singleSpec') return '<span class="ico designed"><i class="pictogram pictogram-single-spec"><i></i></i></span>';
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
                <style>${workbenchCss()}${responsiveWorkbenchCss()}</style>
                <section class="panel">
                  <div class="resize" title="拖动调整窗口高度"></div>
                  <header>
                    <div class="brand"><span class="mascot"><img src="${mascotAssetUrl()}" alt=""></span><span><b>Shein Global Selector</b><small><span class="brand-sub">Xynigo · ${state.site.code} sourcing workspace</span><span class="status">等待扫描</span></small></span></div>
                    <nav aria-label="选品工具栏"><button data-action="prev" aria-label="上一页"><span aria-hidden="true">‹</span><span class="button-label">上一页</span></button><strong class="page"></strong><button data-action="next" aria-label="下一页"><span class="button-label">下一页</span><span aria-hidden="true">›</span></button><button data-action="scan" aria-label="重新扫描"><span aria-hidden="true">${icon('refresh')}</span><span class="button-label">重新扫描</span></button><button data-action="spec-scan" aria-label="补全当前页商品规格" title="补全当前页全部待确认商品的 Spec Type"><span aria-hidden="true">◇</span><span class="button-label">补全规格</span></button><button data-action="clear" aria-label="清空筛选" title="关闭全部筛选条件，不清除已选商品"><span aria-hidden="true">⊘</span><span class="button-label">清空筛选</span></button><button data-action="copy" aria-label="复制商品链接" title="默认复制当前页全部筛选命中商品的链接"><span aria-hidden="true">${icon('copy')}</span><span class="button-label">复制商品链接</span></button><button class="shortcut-button" data-action="shortcut" title="设置复制商品链接快捷键">⌨ ${shortcutLabel(state.copyShortcut, true)}</button><button class="primary" data-action="export">${icon('export')} 导出已选 <span class="selected-count">0</span></button><button class="summary-toggle" data-action="summary" aria-controls="xynigo-selector-summary" aria-expanded="false" aria-label="显示或收起选品概览" title="显示或收起选品概览"><span aria-hidden="true">●</span><span class="button-label">概览</span></button><button data-action="max" aria-label="最大化或还原"><span aria-hidden="true">${icon('maximize')}</span><span class="button-label">最大化</span></button><button data-action="close" aria-label="收起工作台">—</button></nav>
                  </header>
                  <div class="filters"></div>
                  <div class="body"><div class="table-wrap"><table><thead><tr><th class="check"><input type="checkbox" data-action="all"></th><th class="product product-heading">PRODUCT <span class="product-column-resizer" role="separator" aria-label="调整 Product 列宽" aria-orientation="vertical" aria-valuemin="${PRODUCT_COLUMN_MIN_WIDTH}" aria-valuemax="${PRODUCT_COLUMN_MAX_WIDTH}" tabindex="0"></span></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="pagePrice">PAGE PRICE <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="effectivePrice">EFFECTIVE PRICE <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="sales">SALES <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th>RATING</th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="reviews">REVIEWS <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="onSaleDate">LISTED ON <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th title="Specification type">SPEC TYPE</th><th title="Primary specification">PRI SPEC</th><th title="Secondary specification">SEC SPEC</th><th>FULFILLMENT</th><th class="sold-by sold-by-heading">SOLD BY <span class="sold-by-column-resizer" role="separator" aria-label="调整 Sold by 列宽" aria-orientation="vertical" aria-valuemin="${SOLD_BY_COLUMN_MIN_WIDTH}" aria-valuemax="${SOLD_BY_COLUMN_MAX_WIDTH}" tabindex="0"></span></th><th>OFFICIAL SIGNALS</th><th>DECISION</th></tr></thead><tbody></tbody></table></div><aside id="xynigo-selector-summary"><h3><span></span>选品概览</h3><dl class="summary"></dl><p class="note">规格结构优先读取列表结构化数据；数据不足时显示“—”，不会推测为单规格。极鲸云一期仅补全缺失的店铺、销量、评分、评论数和上架日期，不覆盖 SHEIN 原值。</p></aside></div>
                  <div class="spec-error-tooltip" role="tooltip"></div>
                  <div class="toast" role="status"></div>
                  <dialog class="export-dialog"><form method="dialog"><h2>导出已选商品</h2><p>每个商品一行，导出为 Excel 工作簿。</p><label class="image-option"><input type="checkbox" name="images"> 将商品主图插入 Excel（压缩至约 60×80 px，导出更慢）</label><div><button value="cancel">取消</button><button value="confirm" class="primary">开始导出</button></div></form></dialog>
                  <dialog class="shortcut-dialog"><form method="dialog"><h2>复制商品链接快捷键</h2><p>快捷键只在 SHEIN 商品列表页生效，与工具栏“复制商品链接”使用相同范围。</p><label class="shortcut-scope"><span>复制范围</span><select name="copyScope"><option value="filtered">当前页全部筛选结果</option><option value="selected">已选商品</option></select></label><button class="shortcut-recorder" type="button" data-action="record-shortcut">${shortcutLabel(state.copyShortcut)}</button><div class="shortcut-help">点击上方按键框，然后按下新的组合键。</div><div class="shortcut-actions"><button type="button" data-action="reset-shortcut">恢复默认</button><span><button value="cancel">取消</button><button class="primary" type="button" data-action="save-shortcut">保存快捷键</button></span></div></form></dialog>
                </section>`;
            document.body.appendChild(host);
            state.host = host;
            state.shadow = shadow;
            bindEvents();
            bindResize();
            bindProductColumnResize();
            bindSoldByColumnResize();
        }

        function workbenchCss() {
            return `:host{all:initial}*{box-sizing:border-box}.panel{--green:#16835a;--dark:#17221e;--line:#dce8e2;position:fixed;z-index:2147483000;left:0;right:0;bottom:0;height:42vh;min-height:290px;max-height:92vh;background:#fff;color:var(--dark);box-shadow:0 -10px 28px rgba(21,55,42,.16);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.panel.max{height:92vh}.resize{position:absolute;z-index:3;top:-5px;left:0;right:0;height:10px;cursor:ns-resize}.resize:after{content:"";display:block;width:44px;height:3px;margin:3px auto;border-radius:3px;background:#9fb9ae}header{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:#fbfefc}.brand{display:flex;align-items:center;gap:9px}.mascot{display:grid;place-items:center;width:32px;height:32px;border:1px solid #b9ddcd;border-radius:9px;background:#eaf8f1;overflow:hidden}.mascot img{width:30px;height:30px;display:block;object-fit:contain}.brand b{display:block;font-size:13px}.brand small{display:flex;align-items:center;gap:5px;color:#718079;margin-top:2px}.brand-sub:after{content:"·";margin-left:5px}nav{display:flex;align-items:center;gap:5px}button{height:30px;padding:0 9px;border:1px solid #d7dfdb;border-radius:6px;background:#fff;color:#24302b;font:600 11px inherit;cursor:pointer}button:hover{border-color:#78b99d;background:#f1faf6}.primary{border-color:var(--green);background:var(--green);color:#fff}.primary:hover{background:#126f4c}.shortcut-button{padding:0 8px;color:#176d4d}.page{min-width:34px;text-align:center}.filters{display:grid;grid-template-columns:repeat(4,minmax(112px,1fr)) minmax(145px,1.1fr) minmax(238px,1.7fr) minmax(86px,.62fr) minmax(82px,.55fr);gap:6px;padding:7px 10px;border-bottom:1px solid var(--line);background:#f7fbf9}.filter{min-width:0;height:48px;display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid #b9daca;border-radius:7px;background:#fff}.filter .ico{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:7px;background:#e8f7f0;color:var(--green);font-size:16px;font-weight:800}.filter .ico.official{overflow:hidden;border:1px solid rgba(36,50,44,.08);background:#fff}.filter .ico.official img{width:22px;height:22px;object-fit:contain}.filter .ico.trends-icon{background:#eef8f3}.filter .ico.trends-icon img{filter:brightness(0) saturate(100%) invert(38%) sepia(47%) saturate(1004%) hue-rotate(105deg) brightness(91%) contrast(91%)}.filter .ico.designed{border:1px solid rgba(22,130,87,.18);background:#eef8f3}.pictogram{position:relative;display:block;width:18px;height:18px;color:var(--green);font-style:normal}.pictogram-new:before{content:"";position:absolute;left:1px;top:3px;width:13px;height:13px;background:currentColor;clip-path:polygon(50% 0,63% 36%,100% 50%,63% 64%,50% 100%,37% 64%,0 50%,37% 36%)}.pictogram-new:after{content:"";position:absolute;right:0;top:1px;width:3px;height:3px;border-radius:50%;background:currentColor;box-shadow:0 13px 0 rgba(22,130,87,.48)}.pictogram-sales:before{content:"";position:absolute;bottom:2px;left:2px;width:3px;height:6px;border-radius:1px 1px 0 0;background:currentColor;box-shadow:5px -3px 0 currentColor,10px -7px 0 currentColor}.pictogram-sales:after{content:"";position:absolute;bottom:1px;left:1px;width:16px;height:1px;background:rgba(22,130,87,.32)}.pictogram-price{display:grid;place-items:center;border:1.5px solid currentColor;border-radius:50%;background:#fff;font-size:10px;font-weight:800}.coupon-mark{position:relative;width:15px;height:11px;margin-right:1px;border-radius:3px;background:var(--green);color:#fff;font-size:7px;font-weight:800;text-align:center;line-height:11px;clip-path:polygon(0 0,72% 0,100% 50%,72% 100%,0 100%)}.filter label{min-width:0;display:block;flex:1}.filter small{display:block;color:#75827c;font-size:9px;white-space:nowrap}.filter b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.switch{position:relative;width:28px;height:16px;flex:0 0 28px}.switch input{opacity:0}.switch span{position:absolute;inset:0;border-radius:12px;background:#ccd5d1}.switch span:after{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #777}.switch input:checked+span{background:var(--green)}.switch input:checked+span:after{transform:translateX(12px)}.inline-field{display:flex;align-items:center;gap:4px}.inline-field input,.inline-field select{width:66px;height:25px;padding:0 7px;border:1px solid #d5e2dc;border-radius:7px;background:#fff;font-size:10px;outline:none}.inline-field input:focus,.inline-field select:focus{border-color:var(--green)}.rating-filter{gap:4px;padding:5px}.rating-filter .inline-field select{width:50px;height:25px;padding:0 2px;border-radius:6px}.price-filter{gap:5px}.price-copy{display:grid;grid-template-rows:16px 25px;gap:2px;min-width:0;flex:1}.coupon-row{display:flex;align-items:center;gap:3px}.coupon-row b{margin-right:auto}.coupon-row button{height:17px;padding:0 5px;border-radius:5px;font-size:9px}.coupon-row button.active{border-color:var(--green);background:#e9f8f1;color:var(--green)}.price-inputs{display:grid;grid-template-columns:1fr 8px 1fr 1.15fr;align-items:center;gap:3px}.price-inputs input{min-width:0;width:100%;height:25px;padding:0 6px;border:1px solid #d5e2dc;border-radius:7px;font-size:9px}.body{display:grid;grid-template-columns:minmax(0,1fr) 190px;height:calc(100% - 113px)}.table-wrap{overflow:auto}.table-wrap table{width:100%;border-collapse:collapse;table-layout:fixed}.table-wrap th{position:sticky;top:0;z-index:1;height:30px;padding:0 7px;border-bottom:1px solid var(--line);background:#f8faf9;color:#64716b;font-size:9px;letter-spacing:.04em;text-align:left}.table-wrap td{height:48px;padding:5px 7px;border-bottom:1px solid #e8efeb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.table-wrap tr.matched{background:#f0fbf6}.table-wrap tr:hover{background:#f7fbf9}.check{width:32px}.product{width:210px}.product-cell{display:grid;grid-template-columns:34px 1fr;gap:7px;align-items:center}.product-cell img{width:34px;height:40px;object-fit:cover;background:#eee}.product-cell b,.product-cell small{display:block;overflow:hidden;text-overflow:ellipsis}.product-cell small,.sub{color:#7b8781;font-size:9px}.money{color:#11764f;font-weight:700}.pill{display:inline-block;padding:3px 6px;border-radius:10px;background:#e8f6ef;color:#16734f;font-size:9px}.pill.loading{background:#eef2f0;color:#607068}.pill.failed{background:#fff1dc;color:#986400;cursor:help}.spec-error-tooltip{position:fixed;z-index:2147483646;display:none;max-width:340px;padding:7px 9px;border:1px solid #e5c98e;border-radius:7px;background:#fff9e9;color:#604b1d;box-shadow:0 8px 24px rgba(36,48,42,.2);font-size:10px;line-height:1.45;white-space:normal;pointer-events:none}.spec-error-tooltip.show{display:block}.signal{display:inline-block;margin:1px 2px;padding:2px 5px;border:1px solid #b9decf;border-radius:9px;color:#16734f;font-size:8px}aside{overflow:auto;border-left:1px solid var(--line);padding:10px;background:#fbfdfc}aside h3{margin:0 0 7px;font-size:12px}aside h3 span{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:var(--green)}dl{margin:0}dl div{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e8efeb}dt{color:#66736d}dd{margin:0;font-weight:700}.note{margin:10px 0 0;padding:8px;border:1px solid #efd9a6;border-radius:7px;background:#fff9e9;color:#725b22;font-size:9px}.toast{position:absolute;right:14px;top:53px;display:none;padding:8px 12px;border-radius:6px;background:#17221e;color:#fff}.toast.show{display:block}dialog{width:430px;border:0;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.28)}dialog::backdrop{background:rgba(13,30,23,.35)}dialog form{padding:8px}dialog h2{margin:0 0 8px;font-size:18px}dialog p{color:#637169}.image-option{display:flex;gap:8px;align-items:flex-start;margin:18px 0;padding:12px;border-radius:8px;background:#eff8f4}dialog form>div{display:flex;justify-content:flex-end;gap:8px}.shortcut-scope{display:grid;gap:6px;margin:16px 0}.shortcut-scope span{font-weight:700}.shortcut-scope select{height:34px;padding:0 9px;border:1px solid #cadbd3;border-radius:7px;background:#fff}.shortcut-recorder{width:100%;height:48px;border:1px dashed #75b89b;background:#f1faf6;color:#126f4c;font-size:16px}.shortcut-recorder.is-recording{border-style:solid;background:#e2f5ec}.shortcut-help{margin:8px 0 16px;color:#718079}.shortcut-actions{display:flex;align-items:center;justify-content:space-between}.shortcut-actions span{display:flex;gap:8px}`;
        }

        function responsiveWorkbenchCss() {
            return `
              .table-wrap tr.empty-state:hover{background:#fff}
              .empty-state td{height:96px!important;text-align:center!important;white-space:normal!important;color:#53635b}
              .empty-state b{display:block;margin-bottom:6px;font-size:13px;color:#24352d}
              .empty-state small{display:block;font-size:10px;color:#718079}
              .filters{grid-template-columns:repeat(4,minmax(112px,1fr)) minmax(132px,1.05fr) minmax(145px,1.1fr) minmax(238px,1.7fr) minmax(86px,.62fr) minmax(82px,.55fr)}
              .pictogram-single-spec:before{content:"";position:absolute;top:3px;left:1px;width:15px;height:11px;border:1.5px solid currentColor;border-radius:3px;background:rgba(255,255,255,.82)}
              .pictogram-single-spec:after{content:"";position:absolute;top:7px;left:4px;width:3px;height:3px;border-radius:50%;background:currentColor}
              .pictogram-single-spec>i{position:absolute;top:8px;left:9px;width:6px;height:1.5px;border-radius:2px;background:currentColor;opacity:.62}
              .filter label.switch{width:22px;height:13px;flex:0 0 22px}
              .switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0}
              .switch span:after{width:9px;height:9px}
              .switch input:checked+span:after{transform:translateX(9px)}
              .coupon-row{display:grid;grid-template-columns:113px minmax(0,1fr);gap:0}
              .coupon-row b{margin-right:0}
              .coupon-tools{min-height:17px;display:inline-flex;align-items:center;justify-self:start;gap:3px;padding-left:7px;border-left:1px solid #cad4cf}
              .inline-field input,.inline-field select{flex:0 0 auto;max-width:66px}
              .price-inputs{grid-template-columns:48px 8px 48px 64px;justify-content:start}
              .coupon-custom{min-width:0;height:25px;display:grid;grid-template-columns:minmax(0,1fr) 10px;align-items:center;gap:2px;padding-left:7px;border-left:1px solid #cad4cf}
              .coupon-custom input{width:100%}
              .coupon-suffix{color:#506159;font-size:9px;font-weight:700;text-align:left}
              .table-wrap th .sort-button{height:26px;display:inline-flex;align-items:center;gap:3px;padding:0;border:0;background:transparent;color:inherit;font-size:inherit;letter-spacing:inherit}
              .table-wrap th .sort-button:hover{border:0;background:transparent;color:#126f4c}
              .sort-indicator{width:9px;color:#9aa39f;text-align:center}
              .table-wrap th[aria-sort="ascending"] .sort-button,.table-wrap th[aria-sort="descending"] .sort-button{color:#126f4c}
              .numeric-value{font-variant-numeric:tabular-nums}
              .panel{--product-column-width:210px;--sold-by-column-width:100px;display:grid;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden}
              header{height:auto;min-height:50px;display:grid;grid-template-columns:minmax(190px,max-content) minmax(0,1fr);gap:10px}
              .brand{min-width:0;max-width:330px}
              .brand>span:last-child{min-width:0}
              .brand b,.brand small,.brand small span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              nav{min-width:0;justify-content:flex-end;overflow-x:auto;overflow-y:hidden;overscroll-behavior-inline:contain;scrollbar-width:thin}
              nav::-webkit-scrollbar{height:4px}
              nav::-webkit-scrollbar-thumb{border-radius:4px;background:#bfd4ca}
              nav button{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;gap:4px;white-space:nowrap}
              .summary-toggle{display:none}
              .filters{min-width:0;overflow-x:auto;overflow-y:hidden;overscroll-behavior-inline:contain;scrollbar-width:thin}
              .filters::-webkit-scrollbar{height:5px}
              .filters::-webkit-scrollbar-track{background:#edf5f1}
              .filters::-webkit-scrollbar-thumb{border-radius:5px;background:#a9c9bb}
              .body{position:relative;min-width:0;min-height:0;height:auto;overflow:hidden}
              .table-wrap{min-width:0;min-height:0;overscroll-behavior:contain}
              .table-wrap table{width:max(100%,calc(930px + var(--product-column-width) + var(--sold-by-column-width)));min-width:calc(930px + var(--product-column-width) + var(--sold-by-column-width))}
              .table-wrap .product{width:var(--product-column-width)}
              .table-wrap .sold-by{width:var(--sold-by-column-width)}
              .product-heading,.sold-by-heading{padding-right:12px}
              .product-column-resizer,.sold-by-column-resizer{position:absolute;z-index:2;top:0;right:-4px;width:9px;height:100%;cursor:col-resize;touch-action:none}
              .product-column-resizer:after,.sold-by-column-resizer:after{content:"";position:absolute;top:6px;bottom:6px;left:4px;width:1px;background:#c7d6cf}
              .product-column-resizer:hover:after,.product-column-resizer:focus-visible:after,.product-column-resizer.is-dragging:after,.sold-by-column-resizer:hover:after,.sold-by-column-resizer:focus-visible:after,.sold-by-column-resizer.is-dragging:after{width:2px;background:var(--green)}
              .product-column-resizer:focus-visible,.sold-by-column-resizer:focus-visible{outline:2px solid rgba(22,130,87,.2);outline-offset:-2px}
              .product-cell a{min-width:0;color:inherit;text-decoration:none}
              .product-image-link{display:block;width:34px;height:40px;border-radius:3px}
              .product-image-link:focus-visible,.product-title-link:focus-visible{outline:2px solid rgba(22,130,87,.28);outline-offset:2px}
              .product-title-link:hover b{text-decoration:underline;text-decoration-color:#78b99d;text-underline-offset:2px}
              dialog{max-width:calc(100vw - 24px)}
              @media(max-width:1279px){
                header{grid-template-columns:minmax(178px,max-content) minmax(0,1fr);padding-inline:10px}
                .brand{max-width:220px}
                .brand-sub{display:none}
                .brand-sub:after{content:none}
                nav{gap:4px}
                nav button{padding-inline:7px}
                .filters{grid-template-columns:repeat(4,106px) 128px 140px 225px 82px 80px}
              }
              @media(max-width:1119px){
                header{grid-template-columns:178px minmax(0,1fr)}
                .brand{max-width:178px}
                .brand small{display:none}
                nav button[data-action="prev"],nav button[data-action="next"],nav button[data-action="scan"],nav button[data-action="spec-scan"],nav button[data-action="clear"],nav button[data-action="copy"],nav button[data-action="max"]{width:30px;padding-inline:0}
                nav button[data-action="prev"] .button-label,nav button[data-action="next"] .button-label,nav button[data-action="scan"] .button-label,nav button[data-action="spec-scan"] .button-label,nav button[data-action="clear"] .button-label,nav button[data-action="copy"] .button-label,nav button[data-action="max"] .button-label{display:none}
              }
              @media(max-width:1023px){
                header{grid-template-columns:168px minmax(0,1fr)}
                .brand{max-width:168px}
                .mascot{width:28px;height:28px}
                .mascot img{width:26px;height:26px}
                .summary-toggle{display:inline-flex}
                .body{grid-template-columns:minmax(0,1fr)}
                aside{position:absolute;z-index:3;top:0;right:0;bottom:0;width:min(260px,85vw);border-left:1px solid var(--line);box-shadow:-10px 0 24px rgba(21,55,42,.16);visibility:hidden;opacity:0;pointer-events:none;transform:translateX(100%);transition:transform .18s ease,opacity .18s ease}
                .panel.summary-open aside{visibility:visible;opacity:1;pointer-events:auto;transform:translateX(0)}
              }
              @media(max-width:719px){
                header{grid-template-columns:44px minmax(0,1fr);padding-inline:6px;gap:6px}
                .brand{width:36px}
                .brand>span:last-child{display:none}
                nav button.primary{padding-inline:6px}
                .filters{padding-inline:6px}
              }
            `;
        }

        function setProductColumnWidth(value, persist = false) {
            const width = Math.round(Math.min(PRODUCT_COLUMN_MAX_WIDTH, Math.max(PRODUCT_COLUMN_MIN_WIDTH, Number(value) || PRODUCT_COLUMN_MIN_WIDTH)));
            state.productColumnWidth = width;
            state.shadow?.querySelector('.panel')?.style.setProperty('--product-column-width', `${width}px`);
            const resizer = state.shadow?.querySelector('.product-column-resizer');
            resizer?.setAttribute('aria-valuenow', String(width));
            resizer?.setAttribute('title', `Product 列宽 ${width}px；向右拖动或使用方向键调整`);
            if (persist) {
                try { window.localStorage.setItem(PRODUCT_COLUMN_WIDTH_KEY, String(width)); } catch (_error) { /* Column width persistence is optional. */ }
            }
        }

        function bindProductColumnResize() {
            const resizer = state.shadow.querySelector('.product-column-resizer');
            setProductColumnWidth(state.productColumnWidth);
            let drag = null;
            resizer.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: state.productColumnWidth };
                resizer.classList.add('is-dragging');
                resizer.setPointerCapture?.(event.pointerId);
            });
            resizer.addEventListener('pointermove', (event) => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                setProductColumnWidth(drag.startWidth + event.clientX - drag.startX);
            });
            const finish = (event) => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                setProductColumnWidth(state.productColumnWidth, true);
                resizer.classList.remove('is-dragging');
                if (resizer.hasPointerCapture?.(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
                drag = null;
            };
            resizer.addEventListener('pointerup', finish);
            resizer.addEventListener('pointercancel', finish);
            resizer.addEventListener('keydown', (event) => {
                const delta = event.key === 'ArrowRight' ? 24 : (event.key === 'ArrowLeft' ? -24 : 0);
                if (!delta && event.key !== 'Home' && event.key !== 'End') return;
                event.preventDefault();
                const next = event.key === 'Home' ? PRODUCT_COLUMN_MIN_WIDTH : (event.key === 'End' ? PRODUCT_COLUMN_MAX_WIDTH : state.productColumnWidth + delta);
                setProductColumnWidth(next, true);
            });
        }

        function setSoldByColumnWidth(value, persist = false) {
            const width = Math.round(Math.min(SOLD_BY_COLUMN_MAX_WIDTH, Math.max(SOLD_BY_COLUMN_MIN_WIDTH, Number(value) || SOLD_BY_COLUMN_MIN_WIDTH)));
            state.soldByColumnWidth = width;
            state.shadow?.querySelector('.panel')?.style.setProperty('--sold-by-column-width', `${width}px`);
            const resizer = state.shadow?.querySelector('.sold-by-column-resizer');
            resizer?.setAttribute('aria-valuenow', String(width));
            resizer?.setAttribute('title', `Sold by 列宽 ${width}px；向右拖动或使用方向键调整`);
            if (persist) {
                try { window.localStorage.setItem(SOLD_BY_COLUMN_WIDTH_KEY, String(width)); } catch (_error) { /* Column width persistence is optional. */ }
            }
        }

        function bindSoldByColumnResize() {
            const resizer = state.shadow.querySelector('.sold-by-column-resizer');
            setSoldByColumnWidth(state.soldByColumnWidth);
            let drag = null;
            resizer.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: state.soldByColumnWidth };
                resizer.classList.add('is-dragging');
                resizer.setPointerCapture?.(event.pointerId);
            });
            resizer.addEventListener('pointermove', (event) => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                setSoldByColumnWidth(drag.startWidth + event.clientX - drag.startX);
            });
            const finish = (event) => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                setSoldByColumnWidth(state.soldByColumnWidth, true);
                resizer.classList.remove('is-dragging');
                if (resizer.hasPointerCapture?.(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
                drag = null;
            };
            resizer.addEventListener('pointerup', finish);
            resizer.addEventListener('pointercancel', finish);
            resizer.addEventListener('keydown', (event) => {
                const delta = event.key === 'ArrowRight' ? 24 : (event.key === 'ArrowLeft' ? -24 : 0);
                if (!delta && event.key !== 'Home' && event.key !== 'End') return;
                event.preventDefault();
                const next = event.key === 'Home' ? SOLD_BY_COLUMN_MIN_WIDTH : (event.key === 'End' ? SOLD_BY_COLUMN_MAX_WIDTH : state.soldByColumnWidth + delta);
                setSoldByColumnWidth(next, true);
            });
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
                if (action === 'scan') scan({ force: true, announce: true });
                if (action === 'close') { state.open = false; saveSession(); renderVisibility(); }
                if (action === 'max') { state.maximized = !state.maximized; state.shadow.querySelector('.panel').classList.toggle('max', state.maximized); }
                if (action === 'summary') {
                    const panel = state.shadow.querySelector('.panel');
                    const isOpen = panel.classList.toggle('summary-open');
                    event.target.closest('[data-action="summary"]')?.setAttribute('aria-expanded', String(isOpen));
                }
                if (action === 'prev') navigatePage(-1);
                if (action === 'next') navigatePage(1);
                if (action === 'sort') { toggleSort(event.target.closest('[data-sort-key]').dataset.sortKey); return; }
                if (action === 'spec-scan') requestFullDetailSpecScan();
                if (action === 'spec-error') toast(event.target.closest('[data-spec-error]')?.dataset.specError || '规格补全失败', 5200);
                if (action === 'clear') clearFilters();
                if (action === 'copy') await copyProductLinks();
                if (action === 'shortcut') openShortcutDialog();
                if (action === 'record-shortcut') startShortcutRecording();
                if (action === 'reset-shortcut') resetShortcutDialog();
                if (action === 'save-shortcut') saveShortcutDialog();
                if (action === 'export') openExportDialog();
                if (action === 'coupon') {
                    state.filters.couponOff = Number(event.target.dataset.value);
                    saveSession();
                    render();
                    scheduleDetailSpecEnrichment();
                }
            });
            const showSpecError = (target) => {
                const trigger = target?.closest?.('.pill.failed[data-spec-error]');
                const tooltip = state.shadow.querySelector('.spec-error-tooltip');
                if (!trigger || !tooltip) return;
                tooltip.textContent = trigger.dataset.specError || '规格补全失败';
                tooltip.classList.add('show');
                const rect = trigger.getBoundingClientRect();
                const left = Math.max(8, Math.min(window.innerWidth - 348, rect.left + rect.width / 2 - 24));
                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${Math.max(8, rect.top - 8)}px`;
                tooltip.style.transform = 'translateY(-100%)';
            };
            const hideSpecError = () => state.shadow.querySelector('.spec-error-tooltip')?.classList.remove('show');
            state.shadow.addEventListener('pointerover', (event) => showSpecError(event.target));
            state.shadow.addEventListener('pointerout', (event) => {
                if (!event.relatedTarget || !event.target.closest?.('.pill.failed[data-spec-error]')?.contains(event.relatedTarget)) hideSpecError();
            });
            state.shadow.addEventListener('focusin', (event) => showSpecError(event.target));
            state.shadow.addEventListener('focusout', hideSpecError);
            state.shadow.querySelector('.table-wrap')?.addEventListener('scroll', hideSpecError, { passive: true });
            state.shadow.addEventListener('change', (event) => {
                const filter = event.target.dataset.filter;
                if (filter) {
                    let value = event.target.type === 'checkbox' ? event.target.checked : (event.target.value === '' ? null : Number(event.target.value));
                    state.filters[filter] = value;
                    if (filter === 'globalShip' && value) state.filters.quickShip = false;
                    if (filter === 'quickShip' && value) state.filters.globalShip = false;
                    saveSession();
                    render();
                    scheduleDetailSpecEnrichment();
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
            const currentPage = getPageNumber(location.href);
            const targetPage = Math.max(1, currentPage + delta);
            const officialControl = findOfficialPaginationControl(document, delta, currentPage);
            if (officialControl) {
                state.pageNavigation = {
                    startedAt: Date.now(),
                    originalProductIds: state.products.map((product) => product.goodsId).sort().join('|'),
                };
                state.shadow.querySelector('.status').textContent = `正在加载第 ${targetPage} 页…`;
                state.shadow.querySelector('.page').textContent = String(targetPage);
                officialControl.click();
                return;
            }
            const url = new URL(location.href);
            url.searchParams.set('page', String(targetPage));
            location.href = url.href;
        }

        function detailSpecKey(product) {
            return `${product.site}:${product.goodsId}:${product.mallCode || ''}`;
        }

        function applyDetailSpec(product, detailSpec) {
            if (!product || !detailSpec) return;
            product.specSource = detailSpec.specSource || 'detail';
            product.specError = detailSpec.specError || '';
            product.specFailureKind = detailSpec.specFailureKind || '';
            product.specLookupDone = true;
            if (!detailSpec.specConfirmed) {
                product.specConfirmed = false;
                product.specLookupStatus = 'failed';
                return;
            }
            const merged = mergeSpecStructures(product, detailSpec);
            product.specType = merged.specType;
            product.primarySpec = merged.primarySpec;
            product.primarySpecCount = merged.primarySpecCount;
            product.secondarySpec = merged.secondarySpec;
            product.secondarySpecCount = merged.secondarySpecCount;
            product.skuQty = merged.skuQty;
            product.specConfirmed = true;
            product.specLookupStatus = 'confirmed';
            product.specFailureKind = '';
            const selected = state.selected.get(product.goodsId);
            if (selected) Object.assign(selected, product);
        }

        function applyCachedDetailSpecs(products) {
            products.forEach((product) => {
                const key = detailSpecKey(product);
                const cached = state.detailSpecCache.get(key);
                if (!cached || typeof cached.then === 'function') return;
                const expiredFailure = !cached.specConfirmed && Date.now() - Number(cached.cachedAt || 0) >= DETAIL_SPEC_FAILURE_TTL_MS;
                if (expiredFailure) {
                    state.detailSpecCache.delete(key);
                    product.specLookupStatus = 'pending';
                    return;
                }
                applyDetailSpec(product, cached);
            });
        }

        function detailSpecCandidates(options = {}) {
            const includeAll = Boolean(options.all);
            const retryFailures = Boolean(options.retryFailures);
            const filtersWithoutSpec = { ...state.filters, singleSpec: false };
            return state.products.map((product, index) => ({
                product,
                index,
                selected: state.selected.has(product.goodsId),
                filterMatched: evaluateProduct(product, filtersWithoutSpec).matched,
            })).filter((entry) => {
                const { product, filterMatched } = entry;
                if (product.specConfirmed || (!includeAll && !filterMatched)) return false;
                const key = detailSpecKey(product);
                const cached = state.detailSpecCache.get(key);
                if (!cached || typeof cached.then === 'function') return true;
                if (cached.specConfirmed) {
                    applyDetailSpec(product, cached);
                    return false;
                }
                const failureExpired = Date.now() - Number(cached.cachedAt || 0) >= DETAIL_SPEC_FAILURE_TTL_MS;
                if (retryFailures || failureExpired) {
                    state.detailSpecCache.delete(key);
                    product.specLookupStatus = 'pending';
                    return true;
                }
                applyDetailSpec(product, cached);
                return false;
            }).sort((left, right) => (
                Number(right.selected) - Number(left.selected)
                || Number(right.filterMatched) - Number(left.filterMatched)
                || left.index - right.index
            )).map(({ product }) => product);
        }

        function updateDetailSpecStatus() {
            if (!state.shadow || !state.detailSpecActive) return;
            const { completed, total, failed } = state.detailSpecProgress;
            const verb = state.detailSpecMode === 'all' ? '补全' : '核对';
            state.shadow.querySelector('.status').textContent = `正在${verb}规格 ${completed}/${total}${failed ? ` · ${failed} 失败` : ''}…`;
        }

        async function waitForDetailSpecRequestSlot(signal) {
            const now = Date.now();
            const startAt = Math.max(now, Number(state.detailSpecNextRequestAt || 0));
            state.detailSpecNextRequestAt = startAt + DETAIL_SPEC_REQUEST_START_GAP_MS;
            const delay = startAt - now;
            if (delay <= 0) return !signal?.aborted;
            return new Promise((resolve) => {
                let settled = false;
                const finish = (available) => {
                    if (settled) return;
                    settled = true;
                    signal?.removeEventListener?.('abort', onAbort);
                    resolve(available);
                };
                const onAbort = () => {
                    window.clearTimeout(timer);
                    finish(false);
                };
                const timer = window.setTimeout(() => finish(!signal?.aborted), delay);
                signal?.addEventListener?.('abort', onAbort, { once: true });
            });
        }

        async function loadDetailSpec(product, options = {}) {
            const key = detailSpecKey(product);
            const cached = state.detailSpecCache.get(key);
            if (cached) return typeof cached.then === 'function' ? cached : Promise.resolve(cached);
            const request = fetchDetailSpecStructure(product.url, {
                fetchImpl: window.fetch?.bind(window),
                mallCode: product.mallCode,
                signal: options.signal,
            });
            state.detailSpecCache.set(key, request);
            const result = { ...(await request), cachedAt: Date.now() };
            state.detailSpecCache.set(key, result);
            return result;
        }

        async function enrichDetailSpecs(options = {}) {
            const includeAll = Boolean(options.all);
            if (state.detailSpecActive || (!includeAll && !state.filters.singleSpec) || typeof window.fetch !== 'function') return;
            applyCachedDetailSpecs(state.products);
            const candidates = detailSpecCandidates(options);
            if (!candidates.length) {
                render();
                if (options.announce) toast('当前页没有待补全的规格');
                return;
            }
            state.detailSpecActive = true;
            state.detailSpecMode = includeAll ? 'all' : 'filter';
            state.detailSpecProgress = { completed: 0, total: candidates.length, failed: 0 };
            candidates.forEach((product) => { product.specLookupStatus = 'loading'; });
            render();
            let cursor = 0;
            let abortReason = '';
            let abortKind = '';
            state.detailSpecNextRequestAt = Date.now();
            const abortController = typeof AbortController === 'function' ? new AbortController() : null;
            const workers = Array.from({ length: Math.min(state.detailSpecConcurrency, candidates.length) }, async () => {
                while ((includeAll || state.filters.singleSpec) && !abortReason) {
                    const index = cursor;
                    cursor += 1;
                    const product = candidates[index];
                    if (!product) break;
                    const slotAvailable = await waitForDetailSpecRequestSlot(abortController?.signal);
                    if (!slotAvailable || abortReason) break;
                    const detailSpec = await loadDetailSpec(product, { signal: abortController?.signal });
                    const currentProduct = state.products.find((item) => item.goodsId === product.goodsId);
                    if (detailSpec.specFailureKind === 'aborted') {
                        state.detailSpecCache.delete(detailSpecKey(product));
                        if (currentProduct) currentProduct.specLookupStatus = 'pending';
                        break;
                    }
                    if (currentProduct) applyDetailSpec(currentProduct, detailSpec);
                    state.detailSpecProgress.completed += 1;
                    if (!detailSpec.specConfirmed) state.detailSpecProgress.failed += 1;
                    if (detailSpec.specFailureKind === 'risk' || detailSpec.specFailureKind === 'rate-limit') {
                        abortReason = detailSpec.specError;
                        abortKind = detailSpec.specFailureKind;
                        if (abortKind === 'rate-limit') {
                            state.detailSpecRateLimitCount += 1;
                            const cooldown = Math.min(
                                DETAIL_SPEC_RATE_LIMIT_COOLDOWN_MS * (2 ** Math.max(0, state.detailSpecRateLimitCount - 1)),
                                DETAIL_SPEC_RATE_LIMIT_MAX_COOLDOWN_MS,
                            );
                            state.detailSpecCooldownUntil = Date.now() + cooldown;
                            state.detailSpecConcurrency = 1;
                        }
                        abortController?.abort();
                    }
                    updateDetailSpecStatus();
                    if (abortReason) break;
                    await new Promise((resolve) => window.setTimeout(resolve, DETAIL_SPEC_REQUEST_GAP_MS));
                }
            });
            await Promise.all(workers);
            candidates.forEach((product) => {
                if (product.specLookupStatus === 'loading') product.specLookupStatus = 'pending';
            });
            state.detailSpecActive = false;
            render();
            if (abortReason) {
                if (abortKind === 'rate-limit') {
                    const seconds = Math.max(1, Math.ceil((state.detailSpecCooldownUntil - Date.now()) / 1000));
                    state.shadow.querySelector('.status').textContent = `规格接口限流 · ${seconds}秒后可续跑 · 已降为1并发`;
                    toast('商品页可正常打开，无需验证；点击“补全规格”后将在冷却结束时自动续跑', 6200);
                } else {
                    state.shadow.querySelector('.status').textContent = `规格补全已暂停 · ${state.detailSpecProgress.completed}/${candidates.length}`;
                    toast(abortReason, 5200);
                }
            } else if (options.announce) {
                state.detailSpecCooldownUntil = 0;
                state.detailSpecRateLimitCount = 0;
                const confirmed = state.detailSpecProgress.completed - state.detailSpecProgress.failed;
                toast(`规格补全完成：${confirmed} 成功，${state.detailSpecProgress.failed} 失败`);
            }
            const pendingOptions = abortReason ? null : state.detailSpecPendingOptions;
            state.detailSpecPendingOptions = null;
            if (pendingOptions) scheduleDetailSpecEnrichment(0, pendingOptions);
        }

        function scheduleDetailSpecEnrichment(delay = 0, options = {}) {
            clearTimeout(state.detailSpecTimer);
            const normalized = {
                all: Boolean(options.all),
                retryFailures: Boolean(options.retryFailures),
                announce: Boolean(options.announce),
            };
            if ((!normalized.all && !state.filters.singleSpec) || typeof window.fetch !== 'function') return;
            state.detailSpecPendingOptions = {
                all: Boolean(state.detailSpecPendingOptions?.all || normalized.all),
                retryFailures: Boolean(state.detailSpecPendingOptions?.retryFailures || normalized.retryFailures),
                announce: Boolean(state.detailSpecPendingOptions?.announce || normalized.announce),
            };
            if (state.detailSpecActive) return;
            state.detailSpecTimer = window.setTimeout(() => {
                const pending = state.detailSpecPendingOptions || normalized;
                state.detailSpecPendingOptions = null;
                enrichDetailSpecs(pending);
            }, delay);
        }

        function requestFullDetailSpecScan() {
            if (!state.products.length) return toast('当前页没有可补全的商品');
            const remaining = Math.max(0, state.detailSpecCooldownUntil - Date.now());
            const options = { all: true, retryFailures: true, announce: true };
            if (remaining > 0) {
                const seconds = Math.max(1, Math.ceil(remaining / 1000));
                scheduleDetailSpecEnrichment(remaining, options);
                state.shadow.querySelector('.status').textContent = `规格接口冷却中 · ${seconds}秒后自动续跑 · 1并发`;
                toast(`已排队：${seconds}秒后自动继续补全规格`, 5200);
                return;
            }
            scheduleDetailSpecEnrichment(0, options);
        }

        function jijiyunCacheKey(product) {
            return `${product.site}:${product.goodsId}:${product.storeCode}`;
        }

        function jijiyunMallKey(product) {
            return `${product.site}:${product.storeCode}`;
        }

        function applyCachedJijiyunData(products) {
            products.forEach((product) => {
                const mallSeller = state.jijiyunMallCache.get(jijiyunMallKey(product));
                if (mallSeller) applyJijiyunData(product, { seller: mallSeller });
                const cached = state.jijiyunCache.get(jijiyunCacheKey(product));
                if (cached && typeof cached.then !== 'function') applyJijiyunData(product, cached);
            });
        }

        async function waitForJijiyunRequestSlot() {
            const now = Date.now();
            const startAt = Math.max(now, Number(state.jijiyunNextRequestAt || 0));
            state.jijiyunNextRequestAt = startAt + JIJIYUN_REQUEST_START_GAP_MS;
            const delay = startAt - now;
            if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
        }

        async function loadJijiyunData(product) {
            const key = jijiyunCacheKey(product);
            const cached = state.jijiyunCache.get(key);
            if (cached && typeof cached.then === 'function') return cached;
            if (cached && !cached.failed) return Promise.resolve(cached);
            if (cached?.failed && !jijiyunFailureReady(cached)) return Promise.resolve(cached);
            const previousFailureCount = Number(cached?.failureCount || 0);
            const request = fetchJijiyunProductCard(product).catch((error) => {
                const failedAt = Date.now();
                const failureCount = previousFailureCount + 1;
                return {
                    seller: '', mallId: '', rating: null, reviews: null, sales: null, onSaleDate: null,
                    failed: true,
                    error: normalizeText(error?.message) || '数据补全请求失败',
                    failureCount,
                    failedAt,
                    nextRetryAt: failedAt + jijiyunFailureRetryDelay(failureCount),
                };
            });
            state.jijiyunCache.set(key, request);
            const result = await request;
            state.jijiyunCache.set(key, result);
            if (/^\d+$/.test(result.mallId)) {
                const resolvedProduct = { ...product, storeCode: result.mallId };
                state.jijiyunCache.set(jijiyunCacheKey(resolvedProduct), result);
                if (result.seller) state.jijiyunMallCache.set(jijiyunMallKey(resolvedProduct), result.seller);
            } else if (result.seller) {
                state.jijiyunMallCache.set(jijiyunMallKey(product), result.seller);
            }
            return result;
        }

        async function enrichJijiyunData() {
            if (state.jijiyunActive) {
                state.jijiyunPending = true;
                return;
            }
            applyCachedJijiyunData(state.products);
            const candidates = state.products.filter(needsJijiyunEnrichment)
                .filter((product) => {
                    const cached = state.jijiyunCache.get(jijiyunCacheKey(product));
                    return !cached || jijiyunFailureReady(cached);
                });
            if (!candidates.length) {
                scheduleNextJijiyunFailureRetry();
                return;
            }

            state.jijiyunActive = true;
            state.jijiyunNextRequestAt = Date.now();
            let cursor = 0;
            let completed = 0;
            const workers = Array.from({ length: Math.min(JIJIYUN_ENRICHMENT_CONCURRENCY, candidates.length) }, async () => {
                while (true) {
                    const product = candidates[cursor];
                    cursor += 1;
                    if (!product) break;
                    await waitForJijiyunRequestSlot();
                    const data = await loadJijiyunData(product);
                    const currentProduct = state.products.find((item) => item.goodsId === product.goodsId);
                    if (currentProduct) applyJijiyunData(currentProduct, data);
                    completed += 1;
                    if (completed % 6 === 0) render();
                }
            });
            await Promise.all(workers);
            state.jijiyunActive = false;
            render();
            if (state.jijiyunPending) {
                state.jijiyunPending = false;
                scheduleJijiyunEnrichment(150);
            } else {
                scheduleNextJijiyunFailureRetry();
            }
        }

        function scheduleNextJijiyunFailureRetry() {
            const nextRetryAt = state.products.map((product) => state.jijiyunCache.get(jijiyunCacheKey(product)))
                .filter((cached) => cached?.failed && Number.isFinite(Number(cached.nextRetryAt)))
                .reduce((earliest, cached) => Math.min(earliest, Number(cached.nextRetryAt)), Number.POSITIVE_INFINITY);
            if (!Number.isFinite(nextRetryAt)) return;
            scheduleJijiyunEnrichment(Math.max(250, nextRetryAt - Date.now()));
        }

        function scheduleJijiyunEnrichment(delay = 450) {
            state.jijiyunPending = true;
            if (state.jijiyunActive) return;
            window.clearTimeout(state.jijiyunTimer);
            state.jijiyunTimer = window.setTimeout(() => {
                state.jijiyunPending = false;
                enrichJijiyunData();
            }, delay);
        }

        function visibleProducts() {
            const entries = state.products.map((product) => ({ product, evaluation: evaluateProduct(product, state.filters) })).filter((entry) => entry.evaluation.matched);
            if (!state.sort.key) return entries;
            const direction = state.sort.direction === 'ascending' ? 1 : -1;
            const valueFor = ({ product, evaluation }) => ({
                pagePrice: product.currentPrice,
                effectivePrice: evaluation.effectivePrice,
                sales: product.sales,
                reviews: product.reviews,
                onSaleDate: product.onSaleDate ? Date.parse(product.onSaleDate) : null,
            })[state.sort.key];
            return entries.sort((left, right) => {
                const leftRaw = valueFor(left);
                const rightRaw = valueFor(right);
                const leftValue = Number(leftRaw);
                const rightValue = Number(rightRaw);
                const leftMissing = leftRaw === null || leftRaw === undefined || !Number.isFinite(leftValue);
                const rightMissing = rightRaw === null || rightRaw === undefined || !Number.isFinite(rightValue);
                if (leftMissing || rightMissing) return leftMissing === rightMissing ? 0 : (leftMissing ? 1 : -1);
                return (leftValue - rightValue) * direction;
            });
        }

        function toggleSort(key) {
            state.sort = {
                key,
                direction: state.sort.key === key && state.sort.direction === 'ascending' ? 'descending' : 'ascending',
            };
            renderTable();
            renderSortHeaders();
        }

        function renderSortHeaders() {
            state.shadow.querySelectorAll('[data-sort-key]').forEach((button) => {
                const active = button.dataset.sortKey === state.sort.key;
                const direction = active ? state.sort.direction : 'none';
                button.closest('th').setAttribute('aria-sort', direction);
                button.querySelector('.sort-indicator').textContent = active
                    ? (state.sort.direction === 'ascending' ? '↑' : '↓')
                    : '↕';
            });
        }

        function renderFilters() {
            const counts = {
                globalShip: state.products.filter((p) => p.fulfillment === 'GlobalShip').length,
                quickShip: state.products.filter((p) => p.fulfillment === 'QuickShip').length,
                trends: state.products.filter((p) => p.trends).length,
                newArrivals: state.products.filter((p) => p.newArrivals).length,
                singleSpec: state.products.filter((p) => p.specType === 'Single').length,
            };
            const filters = state.shadow.querySelector('.filters');
            const toggle = (key, label, kind, count, sub) => `<div class="filter">${filterIcon(kind)}<label><small>${sub}</small><b>${label} · ${count}</b></label><label class="switch"><input type="checkbox" data-filter="${key}" ${state.filters[key] ? 'checked' : ''}><span></span></label></div>`;
            filters.innerHTML = toggle('globalShip', 'GlobalShip', 'plane', counts.globalShip, 'Fulfillment')
                + toggle('quickShip', 'QuickShip', 'truck', counts.quickShip, 'Fulfillment')
                + toggle('trends', 'Trends', 'trends', counts.trends, 'Official signal')
                + toggle('newArrivals', 'New Arrivals', 'new', counts.newArrivals, 'Official signal')
                + toggle('singleSpec', 'Single-Spec', 'singleSpec', counts.singleSpec, 'Specification')
                + `<div class="filter">${filterIcon('sales')}<label><small>Sales · minimum</small><span class="inline-field"><input type="number" min="0" step="100" data-filter="salesMin" value="${state.filters.salesMin ?? ''}"></span></label></div>`
                + `<div class="filter price-filter">${filterIcon('price')}<div class="price-copy"><div class="coupon-row"><b>Price · ${state.site.currency}</b><span class="coupon-tools"><span class="coupon-mark" title="Coupon">%</span>${[65, 30, 0].map((value) => `<button type="button" data-action="coupon" data-value="${value}" class="${state.filters.couponOff === value ? 'active' : ''}">${value}%</button>`).join('')}</span></div><div class="price-inputs"><input aria-label="Minimum price" type="number" min="0" placeholder="${state.site.symbol} 0" data-filter="priceMin" value="${state.filters.priceMin ?? ''}"><span>—</span><input aria-label="Maximum price" type="number" min="0" placeholder="${state.site.symbol} ∞" data-filter="priceMax" value="${state.filters.priceMax ?? ''}"><span class="coupon-custom"><input aria-label="Coupon percent off" type="number" min="0" max="100" placeholder="0" data-filter="couponOff" value="${state.filters.couponOff}"><span class="coupon-suffix" aria-hidden="true">%</span></span></div></div></div>`
                + `<div class="filter rating-filter">${filterIcon('star')}<label><small>Rating</small><span class="inline-field"><select data-filter="ratingMin" aria-label="星级门槛；All 表示不筛选，另支持4.0、4.2、4.5三档"><option value="" ${state.filters.ratingMin === null ? 'selected' : ''}>All</option><option value="4" ${state.filters.ratingMin === 4 ? 'selected' : ''}>4.0+</option><option value="4.2" ${state.filters.ratingMin === 4.2 ? 'selected' : ''}>4.2+</option><option value="4.5" ${state.filters.ratingMin === 4.5 ? 'selected' : ''}>4.5+</option></select></span></label></div>`
                + `<div class="filter metrics"><span class="ico">✓</span><label><small>最终命中</small><b>${visibleProducts().length} · ${state.products.length ? Math.round(visibleProducts().length / state.products.length * 1000) / 10 : 0}%</b></label></div>`;
        }

        function renderTable() {
            const tableWrap = state.shadow.querySelector('.table-wrap');
            const scrollTop = tableWrap.scrollTop;
            const scrollLeft = tableWrap.scrollLeft;
            const body = state.shadow.querySelector('tbody');
            body.replaceChildren();
            const entries = visibleProducts();
            if (!entries.length) {
                const row = document.createElement('tr');
                row.className = 'empty-state';
                const cell = document.createElement('td');
                cell.colSpan = 15;
                cell.innerHTML = state.products.length
                    ? `<b>已扫描 ${state.products.length} 个商品，当前筛选条件无命中</b><small>请调整条件，或点击工具栏“清空筛选”查看全部扫描数据。</small>`
                    : '<b>当前页面未识别到商品</b><small>请等待 SHEIN 列表加载完成后重新扫描。</small>';
                row.appendChild(cell);
                body.appendChild(row);
            }
            entries.forEach(({ product, evaluation }) => {
                const row = document.createElement('tr');
                row.className = evaluation.matched ? 'matched' : '';
                const signals = [product.trends ? 'Trends' : '', product.newArrivals ? 'New Arrivals' : '', product.bestSeller ? 'Best Seller' : '', product.almostSoldOut ? 'Almost sold out' : ''].filter(Boolean);
                const cells = [
                    { html: `<input type="checkbox" data-select-id="${product.goodsId}" ${state.selected.has(product.goodsId) ? 'checked' : ''}>` },
                    { node: productCell(product), className: 'product' },
                    { text: money(product.currentPrice, product.currency) },
                    { text: money(evaluation.effectivePrice, product.currency), className: 'money' },
                    { html: `<b class="numeric-value" title="来源：${safeHtml(product.salesSource || 'SHEIN')}">${formatCount(product.sales)}</b>` },
                    { html: `<b title="来源：${safeHtml(product.ratingSource || 'SHEIN')}">★ ${product.rating ?? '—'}</b>` },
                    { html: `<b class="numeric-value" title="来源：${safeHtml(product.reviewsSource || 'SHEIN')}">${formatCount(product.reviews)}</b>` },
                    { html: `<b title="${product.onSaleDate ? `来源：${safeHtml(product.onSaleDateSource || 'SHEIN')}` : '暂无上架日期'}">${safeHtml(product.onSaleDate || '—')}</b>` },
                    { html: specTypeCellHtml(product) },
                    { html: specCellHtml(product.primarySpec, product.primarySpecCount) },
                    { html: specCellHtml(product.secondarySpec, product.secondarySpecCount) },
                    { html: `<span class="pill">${product.fulfillment}</span>` },
                    { html: `<b title="来源：${safeHtml(product.sellerSource || 'SHEIN')}">${safeHtml(product.seller)}</b><small class="sub">${safeHtml(product.storeType)}</small>` },
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
            tableWrap.scrollTop = scrollTop;
            tableWrap.scrollLeft = scrollLeft;
        }

        function safeHtml(value) {
            return asText(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
        }

        function specCellHtml(name, count) {
            const label = name || '—';
            const number = Number(count);
            const hasCount = count !== null && count !== undefined && count !== '' && Number.isFinite(number);
            const countHtml = label !== '—' && hasCount
                ? `<small class="sub" title="${number} options">${number}</small>`
                : '';
            return `<b>${safeHtml(label)}</b>${countHtml}`;
        }

        function specTypeCellHtml(product) {
            if (product.specLookupStatus === 'loading') return '<span class="pill loading" title="正在读取商品详情规格">…</span>';
            if (product.specLookupStatus === 'failed') {
                const error = safeHtml(product.specError || '规格补全失败');
                return `<span class="pill failed" data-action="spec-error" data-spec-error="${error}" title="${error}" aria-label="规格补全失败：${error}" role="button" tabindex="0">！</span>`;
            }
            const label = product.specConfirmed ? product.specType : '—';
            const title = product.specConfirmed ? `规格已确认：${label}` : '规格待补采';
            return `<span class="pill" title="${safeHtml(title)}">${safeHtml(label)}</span>`;
        }

        function productCell(product) {
            const wrap = document.createElement('div');
            wrap.className = 'product-cell';
            const imageLink = document.createElement('a');
            imageLink.className = 'product-image-link';
            imageLink.href = product.url;
            imageLink.target = '_blank';
            imageLink.rel = 'noopener noreferrer';
            imageLink.setAttribute('aria-label', `打开商品：${product.title}`);
            const image = document.createElement('img');
            image.loading = 'lazy';
            image.decoding = 'async';
            image.alt = product.title;
            if (product.imageUrl) image.src = product.imageUrl;
            imageLink.appendChild(image);
            const copy = document.createElement('span');
            const titleLink = document.createElement('a');
            titleLink.className = 'product-title-link';
            titleLink.href = product.url;
            titleLink.target = '_blank';
            titleLink.rel = 'noopener noreferrer';
            titleLink.title = product.title;
            const title = document.createElement('b');
            title.textContent = product.title;
            titleLink.appendChild(title);
            const meta = document.createElement('small');
            meta.textContent = `ID ${product.goodsId} · ${product.site}`;
            copy.append(titleLink, meta);
            wrap.append(imageLink, copy);
            return wrap;
        }

        function money(value, currency) {
            return value === null || value === undefined ? '—' : `${currency} ${Number(value).toFixed(2)}`;
        }

        function renderSummary() {
            const matched = visibleProducts().length;
            const confirmedSpecs = state.products.filter((product) => product.specConfirmed).length;
            const failedSpecs = state.products.filter((product) => product.specLookupStatus === 'failed').length;
            const pendingSpecs = Math.max(0, state.products.length - confirmedSpecs - failedSpecs);
            const entries = [
                ['当前站点', state.site.code], ['页面类型', getPageType(location.href)], ['当前结果页', `${getPageNumber(location.href)}`], ['已加载商品', state.products.length],
                ['GlobalShip', state.products.filter((p) => p.fulfillment === 'GlobalShip').length], ['QuickShip · Local', state.products.filter((p) => p.fulfillment === 'QuickShip').length],
                ['Single-Spec', state.products.filter((p) => p.specConfirmed && p.specType === 'Single').length],
                ['规格已确认', confirmedSpecs], ['规格待补采', pendingSpecs], ['规格失败', failedSpecs],
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
            renderSortHeaders();
            renderSummary();
            if (state.detailSpecActive) updateDetailSpecStatus();
            else state.shadow.querySelector('.status').textContent = `第 ${getPageNumber(location.href)} 页 · ${state.products.length} loaded · ${visibleProducts().length} matched`;
            state.shadow.querySelector('.page').textContent = String(getPageNumber(location.href));
            state.shadow.querySelector('.selected-count').textContent = String(state.selected.size);
            renderShortcutButton();
            renderVisibility();
        }

        function productSignature(products) {
            return JSON.stringify(products.map((product) => [
                product.goodsId, product.mallCode, product.storeCode, product.title, product.url, product.imageUrl,
                product.originalPrice, product.currentPrice, product.salesRaw, product.sales,
                product.rating, product.reviews, product.onSaleDate, product.specType, product.primarySpec, product.primarySpecCount,
                product.secondarySpec, product.secondarySpecCount, product.skuQty,
                product.fulfillment, product.seller, product.storeType, product.trends,
                product.newArrivals, product.bestSeller, product.almostSoldOut,
                product.repeatCustomers, product.otherSellers,
            ]));
        }

        function scan(options = {}) {
            if (!isSupportedListingUrl(location.href)) return;
            const products = collectProducts(document, location.href);
            const previousProducts = new Map(state.products.map((product) => [product.goodsId, product]));
            products.forEach((product) => {
                const previous = previousProducts.get(product.goodsId);
                if (!product.imageUrl && previous?.imageUrl) {
                    product.imageUrl = previous.imageUrl;
                }
                if (previous?.specLookupDone) applyDetailSpec(product, previous);
                if (previous) {
                    applyJijiyunData(product, {
                        seller: previous.sellerSource === '极鲸云' ? previous.seller : '',
                        sales: previous.salesSource === '极鲸云' ? previous.sales : null,
                        rating: previous.ratingSource === '极鲸云' ? previous.rating : null,
                        reviews: previous.reviewsSource === '极鲸云' ? previous.reviews : null,
                        onSaleDate: previous.onSaleDateSource === '极鲸云' ? previous.onSaleDate : null,
                    });
                }
            });
            applyCachedDetailSpecs(products);
            applyCachedJijiyunData(products);
            if (state.pageNavigation) {
                const nextProductIds = products.map((product) => product.goodsId).sort().join('|');
                const isTransitionFrame = !products.length || nextProductIds === state.pageNavigation.originalProductIds;
                const isTransitionExpired = Date.now() - state.pageNavigation.startedAt >= 8000;
                if (isTransitionFrame && !isTransitionExpired) {
                    scheduleScan(450, options);
                    return false;
                }
                state.pageNavigation = null;
            }
            const signature = productSignature(products);
            if (!options.force && signature === state.scanSignature) return false;
            state.products = products;
            state.scanSignature = signature;
            state.products.forEach((product) => { if (state.selected.has(product.goodsId)) state.selected.set(product.goodsId, product); });
            render();
            scheduleDetailSpecEnrichment();
            scheduleJijiyunEnrichment();
            if (options.announce) toast(`已扫描 ${state.products.length} 个商品`);
            return true;
        }

        function scheduleScan(delay = 350, options = {}) {
            state.pendingScanOptions = {
                force: Boolean(state.pendingScanOptions?.force || options.force),
                announce: Boolean(state.pendingScanOptions?.announce || options.announce),
            };
            clearTimeout(state.scanTimer);
            state.scanTimer = setTimeout(() => {
                const pending = state.pendingScanOptions || {};
                state.pendingScanOptions = null;
                scan(pending);
            }, delay);
        }

        function elementContainsProductLink(node) {
            if (node?.nodeType !== 1) return false;
            return node.matches?.(PRODUCT_LINK_SELECTOR) || Boolean(node.querySelector?.(PRODUCT_LINK_SELECTOR));
        }

        function nodeIsInsideProductCard(node) {
            let current = node?.nodeType === 1 ? node : node?.parentElement;
            for (let depth = 0; current && depth < 11; depth += 1) {
                if (current === state.host || current === state.launcherHost) return false;
                const ids = productIdsWithin(current);
                if (ids.size === 1) return true;
                if (ids.size > 1) return false;
                current = current.parentElement;
            }
            return false;
        }

        function mutationsAffectProducts(mutations) {
            return mutations.some((mutation) => {
                if (mutation.type === 'attributes') {
                    if (STORE_CODE_ATTRIBUTE_NAMES.includes(mutation.attributeName)) {
                        return elementContainsProductLink(mutation.target) || nodeIsInsideProductCard(mutation.target);
                    }
                    return mutation.target?.matches?.('img') && nodeIsInsideProductCard(mutation.target);
                }
                if (nodeIsInsideProductCard(mutation.target)) return true;
                return [...mutation.addedNodes, ...mutation.removedNodes].some(elementContainsProductLink);
            });
        }

        function toast(message, duration = 2200) {
            const element = state.shadow.querySelector('.toast');
            element.textContent = message;
            element.classList.add('show');
            clearTimeout(element._timer);
            element._timer = setTimeout(() => element.classList.remove('show'), duration);
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
        scan({ force: true });
        const observer = new MutationObserver((mutations) => {
            if (mutationsAffectProducts(mutations)) scheduleScan();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'src', 'srcset', 'data-src', 'data-srcset', 'data-original', 'data-lazy-src', 'data-original-src', 'data-image', 'data-url',
                ...STORE_CODE_ATTRIBUTE_NAMES,
            ],
        });
        let lastUrl = location.href;
        window.setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            const supported = isSupportedListingUrl(lastUrl);
            if (state.host) state.host.style.display = supported && state.open ? '' : 'none';
            if (state.launcherHost) state.launcherHost.style.display = supported ? '' : 'none';
            if (supported) scheduleScan(0, { force: true });
        }, 800);
    }

    return {
        boot,
        getSiteProfile,
        detailApiUrl,
        isSupportedListingUrl,
        isSearchResultsUrl,
        getPageType,
        extractProductId,
        canonicalizeProductUrl,
        parseNumber,
        parseSales,
        formatCount,
        getPageNumber,
        findOfficialPaginationControl,
        getKeyword,
        productIdsWithin,
        findProductCard,
        collectProductCards,
        collectJsonProductMap,
        hasExactElementLabel,
        hasTrendLabel,
        trendStoreMetadata,
        storeCodeFromDom,
        ratingFromStars,
        listingReviewSignals,
        colorwayCountFromCard,
        parseDetailRawData,
        parseDetailSchemas,
        specStructureFromDetailData,
        specStructureFromDetailSchema,
        specStructureFromDetailDom,
        mergeSpecStructures,
        specStructureFromDetailHtml,
        specStructureFromDetailApi,
        isRiskDetailResponse,
        detailBlockKind,
        fetchDetailSpecStructure,
        specStructureFromListing,
        firstImage,
        normalizeOnSaleDate,
        jijiyunCardUrl,
        parseJijiyunCardPayload,
        needsJijiyunEnrichment,
        jijiyunFailureRetryDelay,
        jijiyunFailureReady,
        applyJijiyunData,
        fetchJijiyunProductCard,
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
