// ==UserScript==
// @name         Shein Global Selector
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      0.5.1
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
    const SESSION_SCHEMA_VERSION = 6;
    const LAUNCHER_POSITION_KEY = `${APP_ID}-launcher-top-v1`;
    const COPY_SHORTCUT_KEY = `${APP_ID}-copy-shortcut-v1`;
    const COPY_SCOPE_KEY = `${APP_ID}-copy-scope-v1`;
    const FILTER_TEMPLATE_KEY_PREFIX = `${APP_ID}-filter-templates-v1`;
    const FILTER_STATE_KEY_PREFIX = `${APP_ID}-filter-state-v1`;
    const MAX_FILTER_TEMPLATES = 12;
    const PRODUCT_COLUMN_WIDTH_KEY = `${APP_ID}-product-column-width-v1`;
    const SOLD_BY_COLUMN_WIDTH_KEY = `${APP_ID}-sold-by-column-width-v1`;
    const PAGE_FILTER_STYLE_ID = `${APP_ID}-page-filter-style`;
    const PAGE_FILTER_ATTRIBUTE = `data-${APP_ID}-filtered-out`;
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
    const PAGE_NAVIGATION_TIMEOUT_MS = 12 * 1000;
    const OFFICIAL_GRID_SELECTOR = [
        '.product-list-v2__container',
        '.product-list-v2',
        '.S-product-list',
        '[class*="product-list-v2"]',
        '[class*="product-list"]',
        '[class*="goods-list"]',
        '[class*="product-grid"]',
        '[class*="product_grid"]',
        '[data-testid*="product-list"]',
        '[data-testid*="product-grid"]',
        '[data-component*="product-list"]',
        '[data-component*="product-grid"]',
        '[aria-label*="LISTA DE PRODUCTOS"]',
        '[aria-label*="Product list"]',
    ].join(',');
    const OFFICIAL_GRID_IDENTITY = /(?:^|[\s_-])(?:product|goods)(?:[\s_-]*(?:list|grid|results?))(?:$|[\s_-])/i;
    const RECOMMENDATION_IDENTITY = /(?:selectclasse?mptyrecommend|product[\s_-]*recommend[\s_-]*component|recommend(?:ation|ed|s)?|also[\s_-]*(?:like|love)|you[\s_-]*may[\s_-]*also[\s_-]*like|tambien[\s_-]*(?:podria|te)[\s_-]*(?:gustar|guste)|guess[\s_-]*you[\s_-]*like|similar[\s_-]*products?)/i;
    const RECOMMENDATION_HEADING = /(?:tambi[eé]n podr[ií]a gustarte|tambi[eé]n te puede gustar|you may also like|you might also like|recommended for you|猜你喜欢|为你推荐)/i;
    const EMPTY_RESULT_TEXT = /(?:no hay coincidencias|no se encontraron resultados|sin resultados|no matches found|no results found|we couldn.t find|0 resultados)/i;
    const RISK_TEXT = /(?:captcha|crawler[\s_-]*block|verify (?:that )?you are human|security verification|unusual (?:traffic|activity)|access denied|verifica que eres humano|verificaci[oó]n de seguridad)/i;
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

    function listingContextKey(url, doc) {
        const parsed = toUrl(url);
        const site = getSiteProfile(url);
        if (!parsed || !site || !isSupportedListingUrl(url)) return '';
        const ignored = /^(?:page|ici|scici|src_identifier|src_module|src_tab_page_id|ref|refer_page_name|refer_page_id|requestid|url_from|from)$/i;
        const params = Array.from(parsed.searchParams.entries())
            .filter(([key]) => !ignored.test(key))
            .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        const path = parsed.pathname.replace(/\/+$/, '') || '/';
        return [site.code, getPageType(url), path.toLowerCase(), params, lowerText(getKeyword(url, doc))].join('|');
    }

    function elementIdentity(element) {
        if (!element) return '';
        return lowerText([
            element.id,
            typeof element.className === 'string' ? element.className : '',
            element.getAttribute?.('data-component'),
            element.getAttribute?.('data-module'),
            element.getAttribute?.('data-testid'),
            element.getAttribute?.('data-expose-id'),
            element.getAttribute?.('aria-label'),
            element.getAttribute?.('role'),
        ].filter(Boolean).join(' '));
    }

    function hasRecommendationHeading(element) {
        const directHeadings = Array.from(element?.children || []).filter((child) => /^(?:H[1-6]|HEADER)$/i.test(child.tagName));
        const siblingText = normalizeText(element?.previousElementSibling?.textContent);
        return directHeadings.some((heading) => RECOMMENDATION_HEADING.test(normalizeText(heading.textContent)))
            || RECOMMENDATION_HEADING.test(siblingText);
    }

    function isExcludedProductRegion(element) {
        let current = element;
        for (let depth = 0; current && depth < 14; depth += 1, current = current.parentElement) {
            if (/^(?:BODY|HTML)$/i.test(current.tagName)) break;
            if (/^(?:ASIDE|FOOTER)$/i.test(current.tagName)) return true;
            if (RECOMMENDATION_IDENTITY.test(elementIdentity(current)) || hasRecommendationHeading(current)) return true;
        }
        return false;
    }

    function officialGridScore(element) {
        if (!element || isExcludedProductRegion(element)) return Number.NEGATIVE_INFINITY;
        const identity = elementIdentity(element);
        const label = lowerText(element.getAttribute?.('aria-label'));
        const hasMarker = OFFICIAL_GRID_IDENTITY.test(identity)
            || /(?:lista de productos|product list|product results)/i.test(label);
        if (!hasMarker) return Number.NEGATIVE_INFINITY;
        const links = Array.from(element.querySelectorAll?.(PRODUCT_LINK_SELECTOR) || []).filter((link) => !isExcludedProductRegion(link));
        const ids = new Set(links.map((link) => extractProductId(link.href || link.getAttribute?.('href'))).filter(Boolean));
        const exactContainerBonus = /(?:container|grid|__list|list__)/i.test(identity) ? 120 : 0;
        const versionBonus = /product-list-v2/i.test(identity) ? 200 : 0;
        return ids.size * 10 + exactContainerBonus + versionBonus;
    }

    function findOfficialProductGrid(doc) {
        const candidates = new Set(Array.from(doc?.querySelectorAll?.(OFFICIAL_GRID_SELECTOR) || []));
        Array.from(doc?.querySelectorAll?.(PRODUCT_LINK_SELECTOR) || []).forEach((link) => {
            if (isExcludedProductRegion(link)) return;
            let current = link.parentElement;
            for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
                if (/^(?:BODY|HTML)$/i.test(current.tagName)) break;
                if (OFFICIAL_GRID_IDENTITY.test(elementIdentity(current))) candidates.add(current);
            }
        });
        return Array.from(candidates)
            .map((element) => ({ element, score: officialGridScore(element) }))
            .filter(({ score }) => Number.isFinite(score))
            .sort((left, right) => right.score - left.score)[0]?.element || null;
    }

    function isRiskListingPage(doc, url = doc?.location?.href || '') {
        const parsed = toUrl(url);
        if (/\/(?:risk\/(?:challenge|action)|captcha)(?:\/|$)/i.test(parsed?.pathname || '')) return true;
        if (doc?.querySelector?.('[class*="captcha"],[id*="captcha"],iframe[src*="captcha"],[class*="crawler-block"],[data-testid*="challenge"]')) return true;
        const title = normalizeText(doc?.title);
        const bodyText = normalizeText(doc?.body?.textContent).slice(0, 20000);
        return RISK_TEXT.test(`${title} ${bodyText}`);
    }

    function isEmptyListingPage(doc) {
        if (doc?.querySelector?.('[class*="SelectClassEmpty"],[class*="empty-result"],[class*="search-empty"],[data-testid*="empty-result"]')) return true;
        return EMPTY_RESULT_TEXT.test(normalizeText(doc?.body?.textContent).slice(0, 20000));
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

    function findProductCard(link, boundary = null) {
        const goodsId = extractProductId(link?.href || link?.getAttribute?.('href'));
        if (!goodsId) return null;
        let current = link;
        let best = null;
        for (let depth = 0; current?.parentElement && depth < 11; depth += 1) {
            current = current.parentElement;
            if (boundary && current === boundary) break;
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
            const card = findProductCard(link, root);
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

    function collectListingSnapshot(doc, url = doc?.location?.href || '') {
        const supported = isSupportedListingUrl(url);
        const site = getSiteProfile(url);
        const page = getPageNumber(url, doc);
        const risk = isRiskListingPage(doc, url);
        if (!site || (!supported && !risk)) {
            return { status: 'unsupported', products: [], page, contextKey: '', grid: null, message: '当前页面不受支持' };
        }
        if (risk) {
            return { status: 'risk', products: [], page, contextKey: '', grid: null, message: '页面需要风险验证' };
        }
        const grid = findOfficialProductGrid(doc);
        if (!grid) {
            const empty = isEmptyListingPage(doc);
            return {
                status: empty ? 'empty' : 'loading',
                products: [],
                page,
                contextKey: listingContextKey(url, doc),
                grid: null,
                message: empty ? '当前页无正式商品' : '正在等待 SHEIN 正式商品列表',
            };
        }
        const context = {
            url,
            site,
            pageType: getPageType(url),
            keyword: getKeyword(url, doc),
            page: getPageNumber(url, doc),
            productMap: collectJsonProductMap(doc),
        };
        const products = new Map();
        collectProductCards(grid).filter((card) => !isExcludedProductRegion(card)).forEach((card) => {
            const product = extractProduct(card, context);
            if (product) products.set(product.goodsId, product);
        });
        const values = Array.from(products.values());
        const empty = !values.length && isEmptyListingPage(doc);
        return {
            status: values.length ? 'ready' : (empty ? 'empty' : 'loading'),
            products: values,
            page,
            contextKey: listingContextKey(url, doc),
            grid,
            message: values.length ? `${values.length} 个正式商品` : (empty ? '当前页无正式商品' : '正在等待 SHEIN 正式商品列表'),
        };
    }

    function collectProducts(doc, url = doc?.location?.href || '') {
        return collectListingSnapshot(doc, url).products;
    }

    function clearPageProductFilter(doc) {
        Array.from(doc?.querySelectorAll?.(`[${PAGE_FILTER_ATTRIBUTE}]`) || [])
            .forEach((card) => card.removeAttribute(PAGE_FILTER_ATTRIBUTE));
    }

    function ensurePageProductFilterStyle(doc) {
        if (!doc || doc.getElementById(PAGE_FILTER_STYLE_ID)) return;
        const style = doc.createElement('style');
        style.id = PAGE_FILTER_STYLE_ID;
        style.textContent = `[${PAGE_FILTER_ATTRIBUTE}="true"]{display:none!important}`;
        (doc.head || doc.documentElement)?.appendChild(style);
    }

    function applyPageProductFilter(doc, url = doc?.location?.href || '', rawFilters = {}, enrichedProducts = []) {
        const grid = findOfficialProductGrid(doc);
        clearPageProductFilter(doc);
        if (!grid) return { total: 0, matched: 0, hidden: 0, grid: null };
        ensurePageProductFilterStyle(doc);
        const site = getSiteProfile(url);
        const productMap = new Map(Array.from(enrichedProducts || [])
            .filter((product) => product?.goodsId)
            .map((product) => [asText(product.goodsId), product]));
        let context = null;
        let total = 0;
        let matched = 0;
        collectProductCards(grid).filter((card) => !isExcludedProductRegion(card)).forEach((card) => {
            const goodsId = Array.from(productIdsWithin(card))[0] || '';
            let product = productMap.get(goodsId);
            if (!product) {
                context ||= {
                    url,
                    site,
                    pageType: getPageType(url),
                    keyword: getKeyword(url, doc),
                    page: getPageNumber(url, doc),
                    productMap: collectJsonProductMap(doc),
                };
                product = extractProduct(card, context);
            }
            if (!product) return;
            total += 1;
            if (evaluateProduct(product, rawFilters).matched) {
                matched += 1;
                return;
            }
            card.setAttribute(PAGE_FILTER_ATTRIBUTE, 'true');
        });
        return { total, matched, hidden: total - matched, grid };
    }

    function updatePageAccumulator(pageGroups, pageOrder, snapshot) {
        const groups = new Map(pageGroups instanceof Map ? pageGroups : []);
        const page = Math.max(1, Number(snapshot?.page) || 1);
        const previous = groups.get(page);
        const isSuccess = snapshot?.status === 'ready' || snapshot?.status === 'empty';
        if (isSuccess) {
            Array.from(groups.keys()).forEach((groupPage) => {
                if (Number(groupPage) > page) groups.delete(groupPage);
            });
        }
        const products = snapshot?.status === 'ready'
            ? Array.from(snapshot.products || [])
            : Array.from(previous?.products || []);
        products.forEach((product) => {
            product.page = page;
            product.sourcePage = page;
        });
        const group = {
            page,
            status: snapshot?.status || 'loading',
            message: normalizeText(snapshot?.message),
            products,
            formalCount: snapshot?.status === 'ready' ? products.length : Number(previous?.formalCount || products.length || 0),
            hasSuccessfulSnapshot: Boolean(isSuccess || previous?.hasSuccessfulSnapshot),
            updatedAt: new Date().toISOString(),
        };
        groups.set(page, group);
        const order = [page, ...Array.from(pageOrder || []).map(Number).filter((item) => item !== page && groups.has(item))];
        return { groups, order, group, products: flattenPageGroups(groups, order) };
    }

    function flattenPageGroups(pageGroups, pageOrder) {
        const seen = new Set();
        const products = [];
        Array.from(pageOrder || []).forEach((page) => {
            const group = pageGroups?.get?.(Number(page));
            Array.from(group?.products || []).forEach((product) => {
                if (!product?.goodsId || seen.has(product.goodsId)) return;
                seen.add(product.goodsId);
                product.page = Number(page);
                product.sourcePage = Number(page);
                products.push(product);
            });
        });
        return products;
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

    function defaultFilterTemplates(siteCode = 'MX') {
        const site = String(siteCode || 'MX').toUpperCase() === 'US' ? 'US' : 'MX';
        const priceFloor = site === 'MX' ? 100 : 25;
        return [
            {
                id: `${site.toLowerCase()}-global-base`,
                name: 'GlobalShip 基础',
                site,
                filters: normalizeFilters({ globalShip: true }, site),
            },
            {
                id: `${site.toLowerCase()}-procurement-65`,
                name: `${site}代采 · 65%券`,
                site,
                filters: normalizeFilters({ globalShip: true, salesMin: 1000, priceMin: priceFloor, couponOff: 65, ratingMin: 4.2 }, site),
            },
            {
                id: `${site.toLowerCase()}-single-spec`,
                name: '单规格轻量选品',
                site,
                filters: normalizeFilters({ globalShip: true, singleSpec: true, ratingMin: 4.2 }, site),
            },
        ];
    }

    function normalizeFilterTemplate(template, siteCode = 'MX') {
        const site = String(siteCode || 'MX').toUpperCase() === 'US' ? 'US' : 'MX';
        const name = normalizeText(template?.name).slice(0, 24);
        if (!name || !template?.filters || typeof template.filters !== 'object') return null;
        return {
            id: normalizeText(template.id) || `${site.toLowerCase()}-${Date.now().toString(36)}`,
            name,
            site,
            filters: normalizeFilters(template.filters, site),
        };
    }

    function filterTemplateSummary(filters, siteCode = 'MX') {
        const site = String(siteCode || 'MX').toUpperCase() === 'US' ? 'US' : 'MX';
        const currency = site === 'US' ? 'USD' : 'MXN';
        const value = normalizeFilters(filters, site);
        const parts = [];
        if (value.globalShip) parts.push('GlobalShip');
        if (value.quickShip) parts.push('QuickShip');
        if (value.trends) parts.push('Trends');
        if (value.newArrivals) parts.push('New Arrivals');
        if (value.singleSpec) parts.push('Single-Spec');
        if (value.salesMin !== null) parts.push(`销量 ≥${Number(value.salesMin).toLocaleString('en-US')}`);
        if (value.priceMin !== null || value.priceMax !== null || value.couponOff > 0) {
            parts.push(`${currency} ${value.priceMin ?? 0}–${value.priceMax ?? '∞'}`);
            parts.push(`${value.couponOff}%券`);
        }
        if (value.ratingMin !== null) parts.push(`${Number(value.ratingMin).toFixed(1)}★+`);
        return parts.length ? parts : ['无筛选条件'];
    }

    function filterTemplateMatches(filters, templateFilters, siteCode = 'MX') {
        return JSON.stringify(normalizeFilters(filters, siteCode)) === JSON.stringify(normalizeFilters(templateFilters, siteCode));
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
        let imageFailures = 0;
        for (let index = 0; index < products.length; index += 1) {
            const product = products[index];
            let imageData = null;
            let imageCell = '';
            if (options.includeImages) {
                try {
                    imageData = product.imageUrl ? await options.imageLoader(product.imageUrl) : null;
                    if (!imageData) {
                        imageCell = '图片获取失败';
                        imageFailures += 1;
                    }
                } catch (_error) {
                    imageCell = '图片获取失败';
                    imageFailures += 1;
                }
            }
            const row = sheet.addRow(productToExportRow(product, filters, imageCell));
            row.alignment = { vertical: 'middle', wrapText: true };
            if (imageData) {
                const imageId = workbook.addImage({ base64: imageData.dataUrl, extension: imageData.extension || 'jpeg' });
                sheet.addImage(imageId, { tl: { col: 9.08, row: row.number - 0.92 }, ext: { width: 60, height: 80 } });
                row.height = 62;
            }
            options.onProgress?.({
                stage: options.includeImages ? 'images' : 'rows',
                completed: index + 1,
                total: products.length,
                failed: imageFailures,
            });
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

    async function boot() {
        if (window.__xynigoSheinSelectorBooted) return;
        window.__xynigoSheinSelectorBooted = true;
        if (!isSupportedListingUrl(location.href)) return;

        const site = getSiteProfile(location.href);

        const extensionStorageArea = (() => {
            try {
                return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
            } catch (_error) {
                return null;
            }
        })();
        let persistentWriteQueue = Promise.resolve();

        function readExtensionStorage(key) {
            if (!extensionStorageArea?.get) return Promise.resolve(undefined);
            return new Promise((resolve) => {
                let settled = false;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                };
                try {
                    const pending = extensionStorageArea.get(key, (result) => finish(result?.[key]));
                    if (pending && typeof pending.then === 'function') {
                        pending.then((result) => finish(result?.[key])).catch(() => finish(undefined));
                    }
                } catch (_error) {
                    finish(undefined);
                }
            });
        }

        function writeExtensionStorage(key, value) {
            if (!extensionStorageArea?.set) return Promise.resolve();
            return new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };
                try {
                    const pending = extensionStorageArea.set({ [key]: value }, finish);
                    if (pending && typeof pending.then === 'function') pending.then(finish).catch(finish);
                } catch (_error) {
                    finish();
                }
            });
        }

        async function readPersistentValue(key) {
            const extensionValue = await readExtensionStorage(key);
            if (extensionValue !== undefined) return extensionValue;
            let legacyValue;
            try {
                const raw = window.localStorage.getItem(key);
                if (raw === null) return undefined;
                legacyValue = JSON.parse(raw);
            } catch (_error) {
                return undefined;
            }
            if (extensionStorageArea) await writeExtensionStorage(key, legacyValue);
            return legacyValue;
        }

        function writePersistentValue(key, value) {
            try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_error) { /* Page storage is a compatibility fallback. */ }
            persistentWriteQueue = persistentWriteQueue
                .catch(() => undefined)
                .then(() => writeExtensionStorage(key, value));
        }

        function readCopyShortcut() {
            try { return normalizeShortcut(JSON.parse(window.localStorage.getItem(COPY_SHORTCUT_KEY) || 'null')); } catch (_error) { return { ...DEFAULT_COPY_SHORTCUT }; }
        }

        function readCopyScope() {
            try { return window.localStorage.getItem(COPY_SCOPE_KEY) === 'selected' ? 'selected' : 'filtered'; } catch (_error) { return 'filtered'; }
        }

        const filterTemplateStorageKey = `${FILTER_TEMPLATE_KEY_PREFIX}-${site.code}`;
        const filterStateStorageKey = `${FILTER_STATE_KEY_PREFIX}-${site.code}`;

        async function readFilterTemplates() {
            try {
                const saved = await readPersistentValue(filterTemplateStorageKey);
                if (Array.isArray(saved)) {
                    return saved
                        .map((template) => normalizeFilterTemplate(template, site.code))
                        .filter(Boolean)
                        .slice(0, MAX_FILTER_TEMPLATES);
                }
            } catch (_error) { /* Use the built-in templates. */ }
            return defaultFilterTemplates(site.code);
        }

        function saveFilterTemplates() {
            writePersistentValue(filterTemplateStorageKey, state.filterTemplates);
        }

        async function readPersistentFilterState() {
            const saved = await readPersistentValue(filterStateStorageKey);
            return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : null;
        }

        function savePersistentFilterState() {
            writePersistentValue(filterStateStorageKey, {
                filters: normalizeFilters(state.filters, state.site.code),
                activeTemplateId: state.activeTemplateId || null,
            });
        }

        function saveFilterSettings() {
            saveSession();
            savePersistentFilterState();
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

        const numericFilterKeys = new Set(['salesMin', 'priceMin', 'priceMax', 'couponOff']);
        const draftScopeKeys = Object.freeze({
            sales: ['salesMin'],
            price: ['priceMin', 'priceMax', 'couponOff'],
        });
        const draftValue = (filters, key) => filters[key] === null || filters[key] === undefined ? '' : String(filters[key]);
        const createFilterDrafts = (filters) => Object.fromEntries(
            Array.from(numericFilterKeys).map((key) => [key, draftValue(filters, key)]),
        );

        const initialContextKey = listingContextKey(location.href, document);
        const restoredSession = readSession();
        const persistentFilterState = await readPersistentFilterState();
        const initialFilterTemplates = await readFilterTemplates();
        const restoredAccumulator = restoreAccumulator(restoredSession, initialContextKey);
        const restoredProducts = flattenPageGroups(restoredAccumulator.groups, restoredAccumulator.order);
        const restoredSelectedIds = new Set(Array.isArray(restoredSession?.selectedIds) ? restoredSession.selectedIds.map(asText) : []);
        const initialFilters = normalizeFilters(persistentFilterState?.filters ?? restoredSession?.filters, site.code);
        const initialActiveTemplateId = initialFilterTemplates.some((template) => template.id === persistentFilterState?.activeTemplateId)
            ? persistentFilterState.activeTemplateId
            : null;
        const state = {
            site,
            products: restoredProducts,
            pageGroups: restoredAccumulator.groups,
            pageOrder: restoredAccumulator.order,
            listContextKey: initialContextKey,
            currentPage: getPageNumber(location.href, document),
            currentPageStatus: 'loading',
            currentPageFormalCount: 0,
            selected: new Map(restoredProducts.filter((product) => restoredSelectedIds.has(product.goodsId)).map((product) => [product.goodsId, product])),
            filters: initialFilters,
            filterDrafts: createFilterDrafts(initialFilters),
            filterDraftDirty: { sales: false, price: false },
            copyShortcut: readCopyShortcut(),
            pendingCopyShortcut: readCopyShortcut(),
            copyScope: readCopyScope(),
            recordingShortcut: false,
            filterTemplates: initialFilterTemplates,
            activeTemplateId: initialActiveTemplateId,
            templateDialogMode: 'create',
            templateDialogTemplateId: '',
            open: true,
            compact: Boolean(restoredSession?.compact ?? (restoredSession?.open === false)),
            maximized: false,
            sort: { key: null, direction: 'ascending' },
            tableDirty: false,
            scanTimer: 0,
            pendingScanOptions: null,
            numericFilterEditing: false,
            scanDeferredByEditor: false,
            pageNavigation: null,
            officialGrid: null,
            officialGridObserver: null,
            officialGridContentRevision: 0,
            containerObserver: null,
            containerScanTimer: 0,
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
            exportActive: false,
            exportProgress: { stage: 'idle', completed: 0, total: 0, failed: 0, message: '' },
            exportProgressTimer: 0,
            host: null,
            shadow: null,
            launcherHost: null,
            launcher: null,
            launcherTop: Math.round(window.innerHeight * 0.38),
            productColumnWidth: readProductColumnWidth(),
            soldByColumnWidth: readSoldByColumnWidth(),
        };
        savePersistentFilterState();

        function readSession() {
            try {
                const session = JSON.parse(sessionStorage.getItem(`${SESSION_KEY}-${site.code}`) || 'null');
                if (!session) return null;
                if (session.schemaVersion === SESSION_SCHEMA_VERSION) return session;
                if (Number(session.schemaVersion) >= 5) {
                    return {
                        ...session,
                        schemaVersion: SESSION_SCHEMA_VERSION,
                        open: true,
                        compact: Boolean(session.compact ?? (session.open === false)),
                    };
                }
                if (Number(session.schemaVersion) >= 4) {
                    return { ...session, schemaVersion: SESSION_SCHEMA_VERSION, open: true, compact: false, pageGroups: [], pageOrder: [], selectedIds: [] };
                }
                return {
                    ...session,
                    schemaVersion: SESSION_SCHEMA_VERSION,
                    filters: normalizeFilters({}, site.code),
                    pageGroups: [],
                    pageOrder: [],
                    selectedIds: [],
                };
            } catch (_error) {
                return null;
            }
        }

        function restoreAccumulator(session, contextKey) {
            if (!session || session.contextKey !== contextKey || !Array.isArray(session.pageGroups)) {
                return { groups: new Map(), order: [] };
            }
            const groups = new Map();
            session.pageGroups.forEach((group) => {
                const page = Math.max(1, Number(group?.page) || 1);
                groups.set(page, {
                    page,
                    status: normalizeText(group?.status) || 'ready',
                    message: normalizeText(group?.message),
                    products: Array.isArray(group?.products) ? group.products : [],
                    formalCount: Number(group?.formalCount || group?.products?.length || 0),
                    hasSuccessfulSnapshot: Boolean(group?.hasSuccessfulSnapshot),
                    updatedAt: group?.updatedAt || '',
                });
            });
            const order = Array.isArray(session.pageOrder)
                ? session.pageOrder.map(Number).filter((page, index, values) => groups.has(page) && values.indexOf(page) === index)
                : Array.from(groups.keys()).sort((left, right) => right - left);
            return { groups, order };
        }

        function saveSession() {
            try {
                sessionStorage.setItem(`${SESSION_KEY}-${site.code}`, JSON.stringify({
                    schemaVersion: SESSION_SCHEMA_VERSION,
                    filters: state.filters,
                    open: !state.compact,
                    compact: state.compact,
                    contextKey: state.listContextKey,
                    pageOrder: state.pageOrder,
                    pageGroups: state.pageOrder.map((page) => state.pageGroups.get(page)).filter(Boolean),
                    selectedIds: Array.from(state.selected.keys()),
                }));
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
                <button id="${LAUNCHER_ID}" type="button" aria-controls="${HOST_ID}" aria-expanded="${!state.compact}" aria-label="SHEIN选品助手，鼠标悬停展开，点击${state.compact ? '展开完整工作台' : '最小化并保留筛选器'}，上下拖动调整位置" title="悬停展开 · 点击${state.compact ? '展开完整工作台' : '最小化并保留筛选器'} · 上下拖动位置">
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
                setCompactMode(!state.compact);
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
                    <nav aria-label="选品工具栏"><button data-action="prev" aria-label="上一页"><span aria-hidden="true">‹</span><span class="button-label">上一页</span></button><strong class="page"></strong><button data-action="next" aria-label="下一页"><span class="button-label">下一页</span><span aria-hidden="true">›</span></button><button data-action="scan" aria-label="重新扫描"><span aria-hidden="true">${icon('refresh')}</span><span class="button-label">重新扫描</span></button><span class="template-toolbar"><button class="template-menu-button" data-action="template-menu" aria-haspopup="true" aria-expanded="false" title="选择或管理当前站点的常用筛选模板"><span aria-hidden="true">▤</span><span class="template-menu-label">常用模板</span><i class="template-dirty-dot" hidden></i><span aria-hidden="true">⌄</span></button><button class="template-save-quick" data-action="template-create" aria-label="保存当前筛选为常用模板" title="保存当前筛选为常用模板">＋</button></span><button data-action="clear" aria-label="清空筛选" title="关闭全部筛选条件，不清除累计商品和已选商品"><span aria-hidden="true">⊘</span><span class="button-label">清空筛选</span></button><button data-action="spec-scan" aria-label="补全当前页商品规格" title="补全累计商品中待确认的 Spec Type"><span aria-hidden="true">◇</span><span class="button-label">补全规格</span></button><button data-action="copy" aria-label="复制商品链接" title="默认复制全部累计页面中的筛选命中商品链接"><span aria-hidden="true">${icon('copy')}</span><span class="button-label">复制商品链接</span></button><button class="shortcut-button" data-action="shortcut" title="设置复制商品链接快捷键">⌨ ${shortcutLabel(state.copyShortcut, true)}</button><button class="primary" data-action="export" aria-busy="false">${icon('export')} 导出已选 <span class="selected-count">0</span></button><button class="summary-toggle" data-action="summary" aria-controls="xynigo-selector-summary" aria-expanded="false" aria-label="显示或收起选品概览" title="显示或收起选品概览"><span aria-hidden="true">●</span><span class="button-label">概览</span></button><button data-action="max" aria-label="最大化或还原"><span aria-hidden="true">${icon('maximize')}</span><span class="button-label">最大化</span></button><button data-action="close" aria-label="收起工作台">—</button></nav>
                  </header>
                  <div class="filters"></div>
                  <div class="body"><div class="table-wrap"><table><thead><tr><th class="check"><input type="checkbox" data-action="all"></th><th class="product product-heading">PRODUCT <span class="product-column-resizer" role="separator" aria-label="调整 Product 列宽" aria-orientation="vertical" aria-valuemin="${PRODUCT_COLUMN_MIN_WIDTH}" aria-valuemax="${PRODUCT_COLUMN_MAX_WIDTH}" tabindex="0"></span></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="pagePrice">PAGE PRICE <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="effectivePrice">EFFECTIVE PRICE <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="sales">SALES <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th>RATING</th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="reviews">REVIEWS <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th aria-sort="none"><button class="sort-button" type="button" data-action="sort" data-sort-key="onSaleDate">LISTED ON <span class="sort-indicator" aria-hidden="true">↕</span></button></th><th title="Specification type">SPEC TYPE</th><th title="Primary specification">PRI SPEC</th><th title="Secondary specification">SEC SPEC</th><th>FULFILLMENT</th><th class="sold-by sold-by-heading">SOLD BY <span class="sold-by-column-resizer" role="separator" aria-label="调整 Sold by 列宽" aria-orientation="vertical" aria-valuemin="${SOLD_BY_COLUMN_MIN_WIDTH}" aria-valuemax="${SOLD_BY_COLUMN_MAX_WIDTH}" tabindex="0"></span></th><th>OFFICIAL SIGNALS</th><th>DECISION</th></tr></thead><tbody></tbody></table></div><aside id="xynigo-selector-summary"><h3><span></span>选品概览</h3><dl class="summary"></dl><p class="note">规格结构优先读取列表结构化数据；数据不足时显示“—”，不会推测为单规格。极鲸云一期仅补全缺失的店铺、销量、评分、评论数和上架日期，不覆盖 SHEIN 原值。</p></aside></div>
                  <div class="spec-error-tooltip" role="tooltip"></div>
                  <div class="export-progress" role="status" aria-live="polite" hidden><div class="export-progress-head"><b>Excel 导出</b><span class="export-progress-count"></span></div><div class="export-progress-track"><span class="export-progress-bar"></span></div><small class="export-progress-detail"></small></div>
                  <div class="toast" role="status"></div>
                  <dialog class="export-dialog"><form method="dialog"><h2>导出已选商品</h2><p>每个商品一行，导出为 Excel 工作簿。</p><label class="image-option"><input type="checkbox" name="images"> 将商品主图插入 Excel（压缩至约 60×80 px，导出更慢）</label><div><button value="cancel">取消</button><button value="confirm" class="primary">开始导出</button></div></form></dialog>
                  <dialog class="shortcut-dialog"><form method="dialog"><h2>复制商品链接快捷键</h2><p>快捷键只在 SHEIN 商品列表页生效，与工具栏“复制商品链接”使用相同范围。</p><label class="shortcut-scope"><span>复制范围</span><select name="copyScope"><option value="filtered">全部累计页面筛选结果</option><option value="selected">已选商品</option></select></label><button class="shortcut-recorder" type="button" data-action="record-shortcut">${shortcutLabel(state.copyShortcut)}</button><div class="shortcut-help">点击上方按键框，然后按下新的组合键。</div><div class="shortcut-actions"><button type="button" data-action="reset-shortcut">恢复默认</button><span><button value="cancel">取消</button><button class="primary" type="button" data-action="save-shortcut">保存快捷键</button></span></div></form></dialog>
                  <dialog class="template-dialog"><form method="dialog"><h2 class="template-dialog-title">保存常用模板</h2><p class="template-dialog-description">保存当前已应用的筛选条件，之后可一键恢复。</p><label class="template-name-field"><span>模板名称</span><input name="templateName" maxlength="24" autocomplete="off" placeholder="例如：${state.site.code}代采 · 65%券"></label><div class="template-filter-editor" hidden><section class="template-editor-section"><h3>一键筛选条件</h3><div class="template-toggle-grid"><label class="template-toggle-chip"><input type="checkbox" data-template-field="globalShip"><span>GlobalShip</span></label><label class="template-toggle-chip"><input type="checkbox" data-template-field="quickShip"><span>QuickShip</span></label><label class="template-toggle-chip"><input type="checkbox" data-template-field="trends"><span>Trends</span></label><label class="template-toggle-chip"><input type="checkbox" data-template-field="newArrivals"><span>New Arrivals</span></label><label class="template-toggle-chip"><input type="checkbox" data-template-field="singleSpec"><span>Single-Spec</span></label></div></section><div class="template-rule-grid"><section class="template-rule-card"><label class="template-rule-head"><span>Sales</span><input type="checkbox" data-template-field="salesActive" aria-label="启用销量筛选"></label><label class="template-editor-field"><span>Minimum sold</span><input type="number" min="0" step="100" data-template-field="salesMin"></label></section><section class="template-rule-card"><label class="template-rule-head"><span>Price · ${state.site.currency}</span><input type="checkbox" data-template-field="priceActive" aria-label="启用价格与优惠券筛选"></label><div class="template-editor-fields"><label class="template-editor-field"><span>Min</span><input type="number" min="0" step="1" data-template-field="priceMin"></label><span class="template-editor-separator">—</span><label class="template-editor-field"><span>Max</span><input type="number" min="0" step="1" placeholder="∞" data-template-field="priceMax"></label><label class="template-editor-field"><span>Coupon % OFF</span><input type="number" min="0" max="100" step="1" data-template-field="couponOff"></label></div></section><section class="template-rule-card"><div class="template-rule-head"><span>Rating</span></div><label class="template-editor-field"><span>Minimum rating</span><select data-template-field="ratingMin"><option value="">All</option><option value="4">4.0+</option><option value="4.2">4.2+</option><option value="4.5">4.5+</option></select></label></section></div></div><div class="template-dialog-meta"><span class="template-preview-label">保存的筛选条件</span><span class="template-site-pill">${state.site.code}</span></div><div class="template-filter-preview"></div><div class="template-dialog-error" role="alert"></div><div class="template-dialog-actions"><span class="template-edit-actions" hidden><button type="button" data-action="template-dialog-duplicate">复制模板</button><button class="danger" type="button" data-action="template-dialog-delete">删除模板</button></span><span><button value="cancel">取消</button><button class="primary" type="button" data-action="template-save">保存模板</button></span></div></form></dialog>
                </section><section class="template-popover" aria-label="常用筛选模板" hidden><div class="template-popover-head"><span><b>常用筛选模板</b><small>点击卡片应用，不影响累计商品和已选状态</small></span><i class="template-site-pill">${state.site.code}</i></div><div class="template-list"></div><footer><small class="template-limit"></small><button class="primary" data-action="template-create">＋ 保存当前筛选</button></footer></section>`;
            document.body.appendChild(host);
            state.host = host;
            state.shadow = shadow;
            bindEvents();
            bindResize();
            bindProductColumnResize();
            bindSoldByColumnResize();
        }

        function workbenchCss() {
            return `:host{all:initial}*{box-sizing:border-box}.panel{--green:#16835a;--dark:#17221e;--line:#dce8e2;position:fixed;z-index:2147483000;left:0;right:0;bottom:0;height:42vh;min-height:290px;max-height:92vh;background:#fff;color:var(--dark);box-shadow:0 -10px 28px rgba(21,55,42,.16);font:12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.panel.max{height:92vh}.resize{position:absolute;z-index:3;top:-5px;left:0;right:0;height:10px;cursor:ns-resize}.resize:after{content:"";display:block;width:44px;height:3px;margin:3px auto;border-radius:3px;background:#9fb9ae}header{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:#fbfefc}.brand{display:flex;align-items:center;gap:9px}.mascot{display:grid;place-items:center;width:32px;height:32px;border:1px solid #b9ddcd;border-radius:9px;background:#eaf8f1;overflow:hidden}.mascot img{width:30px;height:30px;display:block;object-fit:contain}.brand b{display:block;font-size:13px}.brand small{display:flex;align-items:center;gap:5px;color:#718079;margin-top:2px}.brand-sub:after{content:"·";margin-left:5px}nav{display:flex;align-items:center;gap:5px}button{height:30px;padding:0 9px;border:1px solid #d7dfdb;border-radius:6px;background:#fff;color:#24302b;font:600 11px inherit;cursor:pointer}button:hover{border-color:#78b99d;background:#f1faf6}button:disabled{cursor:wait;opacity:.64}.primary{border-color:var(--green);background:var(--green);color:#fff}.primary:hover{background:#126f4c}.shortcut-button{padding:0 8px;color:#176d4d}.page{min-width:34px;text-align:center}.filters{display:grid;grid-template-columns:repeat(4,minmax(112px,1fr)) minmax(145px,1.1fr) minmax(238px,1.7fr) minmax(86px,.62fr) minmax(82px,.55fr);gap:6px;padding:7px 10px;border-bottom:1px solid var(--line);background:#f7fbf9}.filter{min-width:0;height:48px;display:flex;align-items:center;gap:7px;padding:5px 7px;border:1px solid #b9daca;border-radius:7px;background:#fff}.filter .ico{flex:0 0 26px;height:26px;display:grid;place-items:center;border-radius:7px;background:#e8f7f0;color:var(--green);font-size:16px;font-weight:800}.filter .ico.official{overflow:hidden;border:1px solid rgba(36,50,44,.08);background:#fff}.filter .ico.official img{width:22px;height:22px;object-fit:contain}.filter .ico.trends-icon{background:#eef8f3}.filter .ico.trends-icon img{filter:brightness(0) saturate(100%) invert(38%) sepia(47%) saturate(1004%) hue-rotate(105deg) brightness(91%) contrast(91%)}.filter .ico.designed{border:1px solid rgba(22,130,87,.18);background:#eef8f3}.pictogram{position:relative;display:block;width:18px;height:18px;color:var(--green);font-style:normal}.pictogram-new:before{content:"";position:absolute;left:1px;top:3px;width:13px;height:13px;background:currentColor;clip-path:polygon(50% 0,63% 36%,100% 50%,63% 64%,50% 100%,37% 64%,0 50%,37% 36%)}.pictogram-new:after{content:"";position:absolute;right:0;top:1px;width:3px;height:3px;border-radius:50%;background:currentColor;box-shadow:0 13px 0 rgba(22,130,87,.48)}.pictogram-sales:before{content:"";position:absolute;bottom:2px;left:2px;width:3px;height:6px;border-radius:1px 1px 0 0;background:currentColor;box-shadow:5px -3px 0 currentColor,10px -7px 0 currentColor}.pictogram-sales:after{content:"";position:absolute;bottom:1px;left:1px;width:16px;height:1px;background:rgba(22,130,87,.32)}.pictogram-price{display:grid;place-items:center;border:1.5px solid currentColor;border-radius:50%;background:#fff;font-size:10px;font-weight:800}.coupon-mark{position:relative;width:15px;height:11px;margin-right:1px;border-radius:3px;background:var(--green);color:#fff;font-size:7px;font-weight:800;text-align:center;line-height:11px;clip-path:polygon(0 0,72% 0,100% 50%,72% 100%,0 100%)}.filter label{min-width:0;display:block;flex:1}.filter small{display:block;color:#75827c;font-size:9px;white-space:nowrap}.filter b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.switch{position:relative;width:28px;height:16px;flex:0 0 28px}.switch input{opacity:0}.switch span{position:absolute;inset:0;border-radius:12px;background:#ccd5d1}.switch span:after{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #777}.switch input:checked+span{background:var(--green)}.switch input:checked+span:after{transform:translateX(12px)}.inline-field{display:flex;align-items:center;gap:4px}.inline-field input,.inline-field select{width:66px;height:25px;padding:0 7px;border:1px solid #d5e2dc;border-radius:7px;background:#fff;font-size:10px;outline:none}.inline-field input:focus,.inline-field select:focus{border-color:var(--green)}.rating-filter{gap:4px;padding:5px}.rating-filter .inline-field select{width:50px;height:25px;padding:0 2px;border-radius:6px}.price-filter{gap:5px}.price-copy{display:grid;grid-template-rows:16px 25px;gap:2px;min-width:0;flex:1}.coupon-row{display:flex;align-items:center;gap:3px}.coupon-row b{margin-right:auto}.coupon-row button{height:17px;padding:0 5px;border-radius:5px;font-size:9px}.coupon-row button.active{border-color:var(--green);background:#e9f8f1;color:var(--green)}.price-inputs{display:grid;grid-template-columns:1fr 8px 1fr 1.15fr;align-items:center;gap:3px}.price-inputs input{min-width:0;width:100%;height:25px;padding:0 6px;border:1px solid #d5e2dc;border-radius:7px;font-size:9px}.body{display:grid;grid-template-columns:minmax(0,1fr) 190px;height:calc(100% - 113px)}.table-wrap{overflow:auto}.table-wrap table{width:100%;border-collapse:collapse;table-layout:fixed}.table-wrap th{position:sticky;top:0;z-index:3;height:30px;padding:0 7px;border-bottom:1px solid var(--line);background:#f8faf9;color:#64716b;font-size:9px;letter-spacing:.04em;text-align:left}.table-wrap td{height:48px;padding:5px 7px;border-bottom:1px solid #e8efeb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.table-wrap tr.matched{background:#f0fbf6}.table-wrap tr:hover{background:#f7fbf9}.table-wrap tr.page-divider:hover{background:#e7f5ee}.page-divider td{position:sticky;top:30px;z-index:2;height:24px;padding:3px 10px;border-top:1px solid #a7d5c1;border-bottom:1px solid #c9e4d8;background:#eaf7f1;color:#116c4a;box-shadow:0 2px 4px rgba(17,108,74,.08);font-size:10px;font-weight:700;letter-spacing:.01em}.page-divider-content,.page-divider-actions,.page-select-all{display:flex;align-items:center}.page-divider-content{justify-content:space-between;gap:10px}.page-divider-actions{gap:9px}.page-divider-content small{color:#4f7e69;font-size:9px;font-weight:600}.page-select-all{gap:4px;color:#126f4c;font-size:9px;white-space:nowrap;cursor:pointer}.page-select-all input{width:13px;height:13px;margin:0;accent-color:var(--green)}.page-select-all input:disabled+span{opacity:.5}.page-divider[data-status="risk"] td,.page-divider[data-status="timeout"] td{border-color:#e8c77e;background:#fff8e7;color:#865c08}.page-divider[data-status="empty"] td{background:#f3f8f5;color:#507064}.check{width:32px}.product{width:210px}.product-cell{display:grid;grid-template-columns:34px 1fr;gap:7px;align-items:center}.product-cell img{width:34px;height:40px;object-fit:cover;background:#eee}.product-cell b,.product-cell small{display:block;overflow:hidden;text-overflow:ellipsis}.product-cell small,.sub{color:#7b8781;font-size:9px}.money{color:#11764f;font-weight:700}.pill{display:inline-block;padding:3px 6px;border-radius:10px;background:#e8f6ef;color:#16734f;font-size:9px}.pill.loading{background:#eef2f0;color:#607068}.pill.failed{background:#fff1dc;color:#986400;cursor:help}.spec-error-tooltip{position:fixed;z-index:2147483646;display:none;max-width:340px;padding:7px 9px;border:1px solid #e5c98e;border-radius:7px;background:#fff9e9;color:#604b1d;box-shadow:0 8px 24px rgba(36,48,42,.2);font-size:10px;line-height:1.45;white-space:normal;pointer-events:none}.spec-error-tooltip.show{display:block}.signal{display:inline-block;margin:1px 2px;padding:2px 5px;border:1px solid #b9decf;border-radius:9px;color:#16734f;font-size:8px}aside{overflow:auto;border-left:1px solid var(--line);padding:10px;background:#fbfdfc}aside h3{margin:0 0 7px;font-size:12px}aside h3 span{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:var(--green)}dl{margin:0}dl div{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e8efeb}dt{color:#66736d}dd{margin:0;font-weight:700}.note{margin:10px 0 0;padding:8px;border:1px solid #efd9a6;border-radius:7px;background:#fff9e9;color:#725b22;font-size:9px}.export-progress{position:absolute;z-index:6;top:53px;right:14px;width:min(292px,calc(100vw - 28px));padding:9px 10px;border:1px solid #9fd0ba;border-radius:9px;background:#f3fbf7;color:#214035;box-shadow:0 10px 28px rgba(21,55,42,.2)}.export-progress[hidden]{display:none}.export-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.export-progress-head b{font-size:11px}.export-progress-count{color:#126f4c;font-weight:800;font-variant-numeric:tabular-nums}.export-progress-track{height:5px;margin:7px 0 5px;border-radius:5px;background:#dceee6;overflow:hidden}.export-progress-bar{display:block;width:0;height:100%;border-radius:inherit;background:var(--green);transition:width .16s ease}.export-progress-detail{display:block;color:#5c7067;font-size:9px}.export-progress.error{border-color:#e5c98e;background:#fff9e9}.export-progress.error .export-progress-bar{background:#b47416}.toast{position:absolute;right:14px;top:53px;display:none;padding:8px 12px;border-radius:6px;background:#17221e;color:#fff}.toast.show{display:block}dialog{width:430px;border:0;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.28)}dialog::backdrop{background:rgba(13,30,23,.35)}dialog form{padding:8px}dialog h2{margin:0 0 8px;font-size:18px}dialog p{color:#637169}.image-option{display:flex;gap:8px;align-items:flex-start;margin:18px 0;padding:12px;border-radius:8px;background:#eff8f4}dialog form>div{display:flex;justify-content:flex-end;gap:8px}.shortcut-scope{display:grid;gap:6px;margin:16px 0}.shortcut-scope span{font-weight:700}.shortcut-scope select{height:34px;padding:0 9px;border:1px solid #cadbd3;border-radius:7px;background:#fff}.shortcut-recorder{width:100%;height:48px;border:1px dashed #75b89b;background:#f1faf6;color:#126f4c;font-size:16px}.shortcut-recorder.is-recording{border-style:solid;background:#e2f5ec;color:#126f4c;font-size:16px}.shortcut-help{margin:8px 0 16px;color:#718079}.shortcut-actions{display:flex;align-items:center;justify-content:space-between}.shortcut-actions span{display:flex;gap:8px}.template-toolbar{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto}.template-menu-button{max-width:144px;padding:0 7px;border-color:rgba(22,130,87,.26);background:#f8fcfa;color:#176d4d}.template-menu-button.active{background:#e8f7f0;border-color:#78b99d}.template-menu-label{max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.template-save-quick{width:28px;padding:0;color:#176d4d;font-size:16px}.template-dirty-dot{width:6px;height:6px;border-radius:50%;background:#d58a16;box-shadow:0 0 0 2px rgba(213,138,22,.14)}.template-dirty-dot[hidden]{display:none}.template-popover{position:fixed;z-index:2147483645;width:min(390px,calc(100vw - 24px));padding:12px;border:1px solid #cfe2d9;border-radius:13px;background:#fff;color:#17221e;box-shadow:0 18px 54px rgba(17,54,39,.24);font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}.template-popover[hidden]{display:none}.template-popover-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:9px}.template-popover-head>span{min-width:0}.template-popover-head b{display:block;font-size:14px}.template-popover-head small{display:block;margin-top:2px;color:#718079;font-size:9px}.template-site-pill{display:inline-flex;align-items:center;justify-content:center;padding:3px 7px;border:1px solid #b9decf;border-radius:999px;background:#edf8f3;color:#126f4c;font-size:9px;font-style:normal;font-weight:750}.template-list{display:grid;gap:6px;max-height:286px;overflow:auto;padding:1px}.template-empty{padding:22px 12px;border:1px dashed #cadbd3;border-radius:9px;color:#718079;text-align:center}.template-item{display:grid;grid-template-columns:minmax(0,1fr) 92px;border:1px solid #e0ebe6;border-radius:10px;background:#fff;overflow:hidden}.template-item:hover{border-color:#bdd8cc}.template-item.active{border-color:rgba(22,130,87,.46);background:#f7fcf9;box-shadow:inset 3px 0 0 #16835a}.template-apply{min-width:0;height:auto;min-height:48px;padding:9px 8px 9px 11px;border:0;border-radius:0;background:transparent;text-align:left}.template-row-head{display:flex;align-items:center;gap:6px}.template-row-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.template-apply small{display:block;margin-top:4px;overflow:hidden;color:#718079;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.template-active-pill,.template-modified-pill{flex:0 0 auto;padding:2px 5px;border-radius:999px;background:#e7f7ef;color:#126f4c;font-size:8px;font-weight:750}.template-modified-pill{background:#fff3df;color:#9a6510}.template-row-controls{display:grid;grid-template-columns:62px 30px;border-left:1px solid #edf2ef}.template-edit-button{width:62px;height:auto;border:0;border-radius:0;background:transparent;color:#536f63;font-size:10px;font-weight:700}.template-more{width:30px;height:auto;padding:0;border:0;border-left:1px solid #edf2ef;border-radius:0;background:transparent;color:#66766e;font-size:15px}.template-edit-button:hover,.template-more:hover{background:#eaf7f1;color:#126f4c}.template-row-actions{grid-column:1/-1;display:none;grid-template-columns:1.4fr .7fr .7fr;gap:3px;padding:5px;border-top:1px solid #e3ece8;background:#f7faf8}.template-item.menu-open .template-row-actions{display:grid}.template-row-actions button{min-width:0;height:27px;padding:0 6px;border:0;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.template-row-actions .danger:hover{background:#fff0ed;color:#a84533}.template-popover footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:9px;padding-top:9px;border-top:1px solid #e5ede9}.template-popover footer small{color:#718079;font-size:9px}.template-dialog{width:min(620px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 28px))}.template-dialog form{max-height:calc(100vh - 30px);overflow:auto}.template-name-field{display:grid;gap:6px;margin:14px 0 10px;color:#53645c;font-weight:650}.template-name-field input{height:36px;padding:0 10px;border:1px solid #cddbd4;border-radius:8px;outline:none;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.template-name-field input:focus{border-color:#16835a;box-shadow:0 0 0 3px rgba(22,130,87,.1)}.template-dialog form>.template-dialog-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;color:#718079;font-size:9px}.template-dialog form>.template-filter-preview{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:5px;min-height:42px;padding:9px;border:1px solid #e1ebe6;border-radius:9px;background:#f6faf8}.template-filter-preview span{padding:3px 6px;border-radius:999px;background:#e7f6ee;color:#176d4d;font-size:9px;font-weight:650}.template-dialog form>.template-dialog-error{display:block;min-height:17px;margin-top:5px;color:#a84533;font-size:9px}.template-dialog form>.template-filter-editor{display:grid;gap:10px;margin:10px 0 12px}.template-filter-editor[hidden],.template-edit-actions[hidden]{display:none!important}.template-editor-section,.template-rule-card{padding:10px;border:1px solid #dfeae5;border-radius:10px;background:#fbfdfc}.template-editor-section h3{margin:0 0 8px;color:#53645c;font-size:10px}.template-toggle-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}.template-toggle-chip{position:relative;min-width:0}.template-toggle-chip input{position:absolute;opacity:0;pointer-events:none}.template-toggle-chip span{display:flex;align-items:center;justify-content:center;height:30px;padding:0 7px;border:1px solid #d8e4de;border-radius:8px;background:#fff;color:#66766e;cursor:pointer;overflow:hidden;font-size:9px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.template-toggle-chip input:checked+span{border-color:rgba(22,130,87,.48);background:#e8f7ef;color:#126f4c}.template-rule-grid{display:grid;grid-template-columns:.8fr 1.55fr .72fr;gap:8px}.template-rule-card{min-width:0;padding:9px}.template-rule-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;color:#43564d;font-size:10px;font-weight:750}.template-rule-head input{accent-color:#16835a}.template-editor-fields{display:flex;align-items:end;gap:6px}.template-editor-field{display:grid;min-width:0;flex:1 1 0;gap:4px;color:#718079;font-size:8px}.template-editor-field input,.template-editor-field select{width:100%;height:31px;min-width:0;padding:0 8px;border:1px solid #cedcd5;border-radius:8px;background:#fff;color:#17221e;outline:none;font:650 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.template-editor-field input:disabled{background:#f2f5f3;color:#a3aea9}.template-editor-separator{align-self:end;padding-bottom:8px;color:#83928b}.template-dialog form>.template-dialog-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px}.template-dialog-actions>span{display:flex;gap:8px}.template-dialog-actions .danger{border-color:#efc6be;color:#a84533}@media(max-width:660px){.template-toggle-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.template-rule-grid{grid-template-columns:1fr}}`;
        }

        function responsiveWorkbenchCss() {
            return `
              .table-wrap tr.empty-state:hover{background:#fff}
              .empty-state td{height:96px!important;text-align:center!important;white-space:normal!important;color:#53635b}
              .empty-state b{display:block;margin-bottom:6px;font-size:13px;color:#24352d}
              .empty-state small{display:block;font-size:10px;color:#718079}
              .filters{grid-template-columns:repeat(4,minmax(112px,1fr)) minmax(132px,1.05fr) minmax(145px,1.1fr) 346px minmax(86px,.62fr) minmax(82px,.55fr)}
              .pictogram-single-spec:before{content:"";position:absolute;top:3px;left:1px;width:15px;height:11px;border:1.5px solid currentColor;border-radius:3px;background:rgba(255,255,255,.82)}
              .pictogram-single-spec:after{content:"";position:absolute;top:7px;left:4px;width:3px;height:3px;border-radius:50%;background:currentColor}
              .pictogram-single-spec>i{position:absolute;top:8px;left:9px;width:6px;height:1.5px;border-radius:2px;background:currentColor;opacity:.62}
              .filter label.switch{width:22px;height:13px;flex:0 0 22px}
              .switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0}
              .switch span:after{width:9px;height:9px}
              .switch input:checked+span:after{transform:translateX(9px)}
              .coupon-row{display:grid;grid-template-columns:182px 80px;gap:0}
              .coupon-row b{margin-right:0}
              .coupon-tools{min-height:17px;display:inline-flex;align-items:center;justify-self:start;gap:2px;padding-left:5px;border-left:1px solid #cad4cf}
              .coupon-row button{height:15px;padding:0 2px;border-radius:4px;font-size:7px}
              .inline-field input,.inline-field select{flex:0 0 auto;max-width:66px}
              .price-inputs{grid-template-columns:83px 7px 83px 80px;justify-content:start;gap:3px}
              .coupon-custom{min-width:0;height:25px;display:grid;grid-template-columns:minmax(0,1fr) 10px;align-items:center;gap:2px;padding-left:5px;border-left:1px solid #cad4cf}
              .coupon-custom input{width:100%}
              .coupon-suffix{color:#506159;font-size:9px;font-weight:700;text-align:left}
              .filter-apply{flex:0 0 30px;width:30px;height:25px;padding:0;border-color:#c9d9d1;color:#718079;font-size:9px}
              .filter-apply:disabled{cursor:default;opacity:.42}
              .filter-apply.is-dirty{border-color:var(--green);background:#e9f8f1;color:var(--green);box-shadow:0 0 0 1px rgba(22,131,90,.08)}
              .numeric-filter .inline-field input{width:58px}
              .table-wrap th .sort-button{height:26px;display:inline-flex;align-items:center;gap:3px;padding:0;border:0;background:transparent;color:inherit;font-size:inherit;letter-spacing:inherit}
              .table-wrap th .sort-button:hover{border:0;background:transparent;color:#126f4c}
              .sort-indicator{width:9px;color:#9aa39f;text-align:center}
              .table-wrap th[aria-sort="ascending"] .sort-button,.table-wrap th[aria-sort="descending"] .sort-button{color:#126f4c}
              .numeric-value{font-variant-numeric:tabular-nums}
              .panel{--product-column-width:210px;--sold-by-column-width:100px;display:grid;grid-template-rows:auto auto minmax(0,1fr);overflow:hidden}
              .panel.compact{height:113px!important;min-height:113px;max-height:113px;grid-template-rows:auto auto;box-shadow:0 -8px 24px rgba(21,55,42,.14)}
              .panel.compact .resize{cursor:default;pointer-events:none}
              .panel.compact .body{display:none}
              .panel.compact .filters{border-bottom:0}
              header{height:auto;min-height:50px;display:grid;grid-template-columns:minmax(190px,max-content) minmax(0,1fr);gap:10px}
              .brand{min-width:0;max-width:none}
              .brand>span:last-child{min-width:0}
              .brand b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
              .brand small{min-width:max-content;overflow:visible;white-space:nowrap}
              .brand small span{min-width:max-content;overflow:visible;text-overflow:clip;white-space:nowrap}
              .brand-sub,.status{flex:0 0 auto}
              .status{font-variant-numeric:tabular-nums}
              .status-match{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border:1px solid #acd9c5;border-radius:999px;background:#e8f7f0;color:#0f7651;font-size:10px;font-weight:750;line-height:16px;vertical-align:baseline}
              .status-match strong{color:#087249;font-size:12px;font-weight:850;line-height:1;font-variant-numeric:tabular-nums}
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
                .brand{max-width:300px}
                .brand-sub{display:none}
                .brand-sub:after{content:none}
                nav{gap:4px}
                nav button{padding-inline:7px}
                .filters{grid-template-columns:repeat(4,106px) 128px 140px 346px 82px 80px}
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
                if (state.compact || state.maximized) return;
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
                if (!action) {
                    if (!event.target.closest('.template-popover')) closeTemplatePopover();
                    return;
                }
                const templateItem = event.target.closest('[data-template-id]');
                const template = templateItem
                    ? state.filterTemplates.find((item) => item.id === templateItem.dataset.templateId)
                    : state.filterTemplates.find((item) => item.id === state.templateDialogTemplateId);
                if (action === 'template-menu') {
                    const popover = state.shadow.querySelector('.template-popover');
                    if (popover.hidden) openTemplatePopover();
                    else closeTemplatePopover();
                    return;
                }
                if (action === 'template-create') { openTemplateDialog('create'); return; }
                if (action === 'template-apply') { applyTemplate(template); return; }
                if (action === 'template-edit') { openTemplateDialog('edit', template?.id); return; }
                if (action === 'template-more') {
                    const opening = !templateItem.classList.contains('menu-open');
                    state.shadow.querySelectorAll('.template-item.menu-open').forEach((item) => item.classList.remove('menu-open'));
                    templateItem.classList.toggle('menu-open', opening);
                    return;
                }
                if (action === 'template-update') {
                    if (!template) return;
                    template.filters = normalizeFilters(state.filters, state.site.code);
                    state.activeTemplateId = template.id;
                    saveFilterTemplates();
                    savePersistentFilterState();
                    renderTemplateControls();
                    renderTemplateList();
                    toast(`已用当前筛选覆盖：${template.name}`);
                    return;
                }
                if (action === 'template-duplicate') {
                    if (duplicateTemplate(template)) toast('模板已复制');
                    return;
                }
                if (action === 'template-delete') {
                    const button = event.target.closest('[data-action="template-delete"]');
                    if (button.dataset.confirm !== 'true') {
                        button.dataset.confirm = 'true';
                        button.textContent = '确认删除';
                        return;
                    }
                    removeTemplate(template);
                    toast('模板已删除');
                    return;
                }
                if (action === 'template-save') { saveTemplateDialog(); return; }
                if (action === 'template-dialog-duplicate') {
                    if (!template) return;
                    const duplicate = duplicateTemplate({ ...template, name: normalizeText(state.shadow.querySelector('[name="templateName"]').value) || template.name }, captureTemplateEditorFilters());
                    if (!duplicate) return;
                    closeDialog(state.shadow.querySelector('.template-dialog'));
                    openTemplatePopover();
                    toast('模板已复制');
                    return;
                }
                if (action === 'template-dialog-delete') {
                    const button = event.target.closest('[data-action="template-dialog-delete"]');
                    if (button.dataset.confirm !== 'true') {
                        button.dataset.confirm = 'true';
                        button.textContent = '再次点击确认删除';
                        return;
                    }
                    removeTemplate(template);
                    closeDialog(state.shadow.querySelector('.template-dialog'));
                    openTemplatePopover();
                    toast('模板已删除');
                    return;
                }
                if (!action.startsWith('template-')) closeTemplatePopover();
                if (action === 'scan') scan({ force: true, announce: true });
                if (action === 'close') setCompactMode(!state.compact);
                if (action === 'max') {
                    const expanding = state.compact;
                    if (expanding) state.compact = false;
                    state.maximized = !state.maximized;
                    saveSession();
                    if (expanding && state.tableDirty) render();
                    else renderVisibility();
                }
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
                if (action === 'apply-numeric') applyNumericFilterDraft(event.target.closest('[data-draft-scope]')?.dataset.draftScope);
                if (action === 'coupon') {
                    const value = Number(event.target.dataset.value);
                    state.filters.couponOff = value;
                    state.filterDrafts.couponOff = String(value);
                    refreshNumericDraftDirty('price');
                    saveFilterSettings();
                    render();
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
            state.shadow.addEventListener('focusin', (event) => {
                showSpecError(event.target);
                const filter = event.target.dataset?.filter;
                if (!numericFilterKeys.has(filter)) return;
                event.stopPropagation();
                pauseScheduledScanForNumericEditing();
            });
            state.shadow.addEventListener('focusout', (event) => {
                hideSpecError();
                const filter = event.target.dataset?.filter;
                if (!numericFilterKeys.has(filter)) return;
                event.stopPropagation();
                window.setTimeout(releaseNumericEditingLock, 0);
            });
            state.shadow.querySelector('.table-wrap')?.addEventListener('scroll', hideSpecError, { passive: true });
            state.shadow.addEventListener('beforeinput', (event) => {
                if (numericFilterKeys.has(event.target.dataset?.filter)) event.stopPropagation();
            });
            state.shadow.addEventListener('input', (event) => {
                if (event.target.matches('[name="templateName"]')) {
                    state.shadow.querySelector('.template-dialog-error').textContent = '';
                    return;
                }
                if (event.target.dataset.templateField) {
                    refreshTemplateEditorPreview();
                    return;
                }
                const filter = event.target.dataset.filter;
                if (!numericFilterKeys.has(filter)) return;
                event.stopPropagation();
                state.filterDrafts[filter] = event.target.value;
                refreshNumericDraftDirty(draftScopeForFilter(filter));
                updateNumericApplyButtons();
            });
            state.shadow.addEventListener('keydown', (event) => {
                if (event.target.matches('[name="templateName"]') && event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    saveTemplateDialog();
                    return;
                }
                const filter = event.target.dataset.filter;
                if (!numericFilterKeys.has(filter)) return;
                event.stopPropagation();
                if (event.key !== 'Enter') return;
                event.preventDefault();
                state.filterDrafts[filter] = event.target.value;
                applyNumericFilterDraft(draftScopeForFilter(filter));
            });
            state.shadow.addEventListener('keyup', (event) => {
                if (numericFilterKeys.has(event.target.dataset?.filter)) event.stopPropagation();
            });
            state.shadow.addEventListener('change', (event) => {
                const templateField = event.target.dataset.templateField;
                if (templateField) {
                    const dialog = state.shadow.querySelector('.template-dialog');
                    if (templateField === 'globalShip' && event.target.checked) dialog.querySelector('[data-template-field="quickShip"]').checked = false;
                    if (templateField === 'quickShip' && event.target.checked) dialog.querySelector('[data-template-field="globalShip"]').checked = false;
                    if (templateField === 'salesActive' && event.target.checked && !dialog.querySelector('[data-template-field="salesMin"]').value) {
                        dialog.querySelector('[data-template-field="salesMin"]').value = '1000';
                    }
                    if (templateField === 'priceActive' && event.target.checked) {
                        const minimum = dialog.querySelector('[data-template-field="priceMin"]');
                        const coupon = dialog.querySelector('[data-template-field="couponOff"]');
                        if (!minimum.value) minimum.value = state.site.code === 'MX' ? '100' : '25';
                        if (!coupon.value || Number(coupon.value) === 0) coupon.value = '65';
                    }
                    refreshTemplateEditorPreview();
                    return;
                }
                const filter = event.target.dataset.filter;
                if (filter) {
                    if (numericFilterKeys.has(filter)) {
                        event.stopPropagation();
                        state.filterDrafts[filter] = event.target.value;
                        refreshNumericDraftDirty(draftScopeForFilter(filter));
                        updateNumericApplyButtons();
                        return;
                    }
                    let value = event.target.type === 'checkbox' ? event.target.checked : (event.target.value === '' ? null : Number(event.target.value));
                    state.filters[filter] = value;
                    if (filter === 'globalShip' && value) state.filters.quickShip = false;
                    if (filter === 'quickShip' && value) state.filters.globalShip = false;
                    saveFilterSettings();
                    render();
                    if (filter === 'singleSpec') scheduleDetailSpecEnrichment();
                }
                if (event.target.dataset.selectId) {
                    const product = state.products.find((item) => item.goodsId === event.target.dataset.selectId);
                    if (event.target.checked && product) state.selected.set(product.goodsId, product);
                    else state.selected.delete(event.target.dataset.selectId);
                    saveSession();
                    render();
                }
                if (event.target.dataset.action === 'select-page') {
                    const page = Number(event.target.dataset.page);
                    const pageGroup = visiblePageGroups().find(({ group }) => Number(group.page) === page);
                    const canonicalProducts = new Map(state.products.map((product) => [product.goodsId, product]));
                    pageGroup?.entries.forEach(({ product }) => event.target.checked
                        ? state.selected.set(product.goodsId, canonicalProducts.get(product.goodsId) || product)
                        : state.selected.delete(product.goodsId));
                    saveSession();
                    render();
                }
                if (event.target.dataset.action === 'all') {
                    visibleProducts().forEach(({ product }) => event.target.checked ? state.selected.set(product.goodsId, product) : state.selected.delete(product.goodsId));
                    saveSession();
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
            window.addEventListener('resize', positionTemplatePopover);
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

        function draftScopeForFilter(filter) {
            return filter === 'salesMin' ? 'sales' : (['priceMin', 'priceMax', 'couponOff'].includes(filter) ? 'price' : '');
        }

        function normalizedDraftFilters(scope) {
            const keys = draftScopeKeys[scope] || [];
            const patch = {};
            keys.forEach((key) => {
                const raw = normalizeText(state.filterDrafts[key]);
                const number = Number(raw);
                patch[key] = raw === '' ? (key === 'couponOff' ? 0 : null) : (key === 'couponOff' ? number : Math.max(0, number));
            });
            return normalizeFilters({ ...state.filters, ...patch }, state.site.code);
        }

        function refreshNumericDraftDirty(scope) {
            const keys = draftScopeKeys[scope] || [];
            if (!keys.length) return false;
            const normalized = normalizedDraftFilters(scope);
            state.filterDraftDirty[scope] = keys.some((key) => normalized[key] !== state.filters[key]);
            return state.filterDraftDirty[scope];
        }

        function updateNumericApplyButtons() {
            state.shadow?.querySelectorAll?.('[data-action="apply-numeric"]').forEach((button) => {
                const dirty = Boolean(state.filterDraftDirty[button.dataset.draftScope]);
                button.disabled = !dirty;
                button.classList.toggle('is-dirty', dirty);
                button.setAttribute('aria-label', dirty ? '应用已修改的数字筛选' : '数字筛选已应用');
                button.title = dirty ? '应用筛选（也可按 Enter）' : '当前数字筛选已应用';
            });
        }

        function isNumericFilterEditing() {
            const activeFilter = state.shadow?.activeElement?.dataset?.filter;
            return state.numericFilterEditing || numericFilterKeys.has(activeFilter);
        }

        function mergePendingScanOptions(options = {}) {
            state.pendingScanOptions = {
                force: Boolean(state.pendingScanOptions?.force || options.force),
                announce: Boolean(state.pendingScanOptions?.announce || options.announce),
            };
        }

        function pauseScheduledScanForNumericEditing() {
            state.numericFilterEditing = true;
            if (!state.scanTimer && !state.pendingScanOptions) return;
            clearTimeout(state.scanTimer);
            state.scanTimer = 0;
            state.scanDeferredByEditor = true;
        }

        function deferScanWhileNumericEditing(options = {}) {
            if (!isNumericFilterEditing()) return false;
            mergePendingScanOptions(options);
            clearTimeout(state.scanTimer);
            state.scanTimer = 0;
            state.scanDeferredByEditor = true;
            return true;
        }

        function releaseNumericEditingLock() {
            const activeFilter = state.shadow?.activeElement?.dataset?.filter;
            if (numericFilterKeys.has(activeFilter)) return;
            state.numericFilterEditing = false;
            if (!state.scanDeferredByEditor) return;
            state.scanDeferredByEditor = false;
            const pending = state.pendingScanOptions || {};
            state.pendingScanOptions = null;
            scheduleScan(80, pending);
        }

        function applyNumericFilterDraft(scope) {
            const keys = draftScopeKeys[scope] || [];
            if (!keys.length) return;
            const normalized = normalizedDraftFilters(scope);
            keys.forEach((key) => {
                state.filters[key] = normalized[key];
                state.filterDrafts[key] = draftValue(normalized, key);
            });
            state.filterDraftDirty[scope] = false;
            state.shadow.activeElement?.blur?.();
            saveFilterSettings();
            render();
        }

        function clearFilters() {
            state.filters = clearedFilters(state.site.code);
            state.filterDrafts = createFilterDrafts(state.filters);
            state.filterDraftDirty = { sales: false, price: false };
            state.activeTemplateId = null;
            saveFilterSettings();
            render();
            scheduleDetailSpecEnrichment();
            toast('筛选条件已清空，累计商品和已选商品保持不变');
        }

        function uniqueTemplateName(baseName, ignoreId = '') {
            let candidate = normalizeText(baseName).slice(0, 24) || '未命名模板';
            let index = 2;
            while (state.filterTemplates.some((template) => template.id !== ignoreId && template.name.toLowerCase() === candidate.toLowerCase())) {
                const suffix = ` ${index}`;
                candidate = `${normalizeText(baseName).slice(0, Math.max(1, 24 - suffix.length))}${suffix}`;
                index += 1;
            }
            return candidate;
        }

        function activeTemplateModified() {
            const active = state.filterTemplates.find((template) => template.id === state.activeTemplateId);
            return Boolean(active && !filterTemplateMatches(state.filters, active.filters, state.site.code));
        }

        function renderTemplatePreview(filters) {
            const preview = state.shadow?.querySelector('.template-filter-preview');
            if (!preview) return;
            preview.replaceChildren(...filterTemplateSummary(filters, state.site.code).map((label) => {
                const chip = document.createElement('span');
                chip.textContent = label;
                return chip;
            }));
        }

        function renderTemplateList() {
            const list = state.shadow?.querySelector('.template-list');
            const limit = state.shadow?.querySelector('.template-limit');
            if (!list || !limit) return;
            limit.textContent = `${state.filterTemplates.length} / ${MAX_FILTER_TEMPLATES} · ${state.site.code} 站独立保存`;
            if (!state.filterTemplates.length) {
                list.innerHTML = '<div class="template-empty">还没有常用模板<br><small>保存当前筛选后可在这里一键应用</small></div>';
                return;
            }
            const modified = activeTemplateModified();
            list.innerHTML = state.filterTemplates.map((template) => {
                const active = template.id === state.activeTemplateId;
                const pill = active ? `<i class="${modified ? 'template-modified-pill' : 'template-active-pill'}">${modified ? '已修改' : '已启用'}</i>` : '';
                return `<article class="template-item${active ? ' active' : ''}" data-template-id="${safeHtml(template.id)}"><button class="template-apply" data-action="template-apply" title="应用 ${safeHtml(template.name)}"><span class="template-row-head"><strong>${safeHtml(template.name)}</strong>${pill}</span><small>${safeHtml(filterTemplateSummary(template.filters, state.site.code).join(' · '))}</small></button><div class="template-row-controls"><button class="template-edit-button" data-action="template-edit" aria-label="编辑模板 ${safeHtml(template.name)}"><span aria-hidden="true">✎</span> 编辑</button><button class="template-more" data-action="template-more" aria-label="更多模板操作 ${safeHtml(template.name)}">⋮</button></div><div class="template-row-actions"><button data-action="template-update">覆盖为当前筛选</button><button data-action="template-duplicate">复制</button><button class="danger" data-action="template-delete">删除</button></div></article>`;
            }).join('');
        }

        function renderTemplateControls() {
            const button = state.shadow?.querySelector('[data-action="template-menu"]');
            if (!button) return;
            const active = state.filterTemplates.find((template) => template.id === state.activeTemplateId);
            const modified = activeTemplateModified();
            button.classList.toggle('active', Boolean(active));
            button.querySelector('.template-menu-label').textContent = active?.name || '常用模板';
            button.querySelector('.template-dirty-dot').hidden = !modified;
            button.title = active
                ? `${active.name}${modified ? ' · 当前筛选已修改' : ' · 已应用'}（点击切换或管理）`
                : '选择或管理当前站点的常用筛选模板';
            if (!state.shadow.querySelector('.template-popover').hidden) renderTemplateList();
        }

        function positionTemplatePopover() {
            const popover = state.shadow?.querySelector('.template-popover');
            const button = state.shadow?.querySelector('[data-action="template-menu"]');
            if (!popover || !button || popover.hidden) return;
            const anchor = button.getBoundingClientRect();
            const rect = popover.getBoundingClientRect();
            const width = rect.width || 390;
            const height = rect.height || 360;
            popover.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, anchor.right - width))}px`;
            if (anchor.top > height + 14) {
                popover.style.top = 'auto';
                popover.style.bottom = `${Math.max(8, window.innerHeight - anchor.top + 7)}px`;
            } else {
                popover.style.bottom = 'auto';
                popover.style.top = `${Math.min(window.innerHeight - height - 8, anchor.bottom + 7)}px`;
            }
        }

        function openTemplatePopover() {
            const popover = state.shadow.querySelector('.template-popover');
            renderTemplateList();
            popover.hidden = false;
            state.shadow.querySelector('[data-action="template-menu"]').setAttribute('aria-expanded', 'true');
            if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(positionTemplatePopover);
            else window.setTimeout(positionTemplatePopover, 0);
        }

        function closeTemplatePopover() {
            const popover = state.shadow?.querySelector('.template-popover');
            if (!popover) return;
            popover.hidden = true;
            state.shadow.querySelector('[data-action="template-menu"]')?.setAttribute('aria-expanded', 'false');
        }

        function setTemplateEditorFilters(filters) {
            const dialog = state.shadow.querySelector('.template-dialog');
            const value = normalizeFilters(filters, state.site.code);
            ['globalShip', 'quickShip', 'trends', 'newArrivals', 'singleSpec'].forEach((key) => {
                dialog.querySelector(`[data-template-field="${key}"]`).checked = value[key];
            });
            const salesActive = value.salesMin !== null;
            const priceActive = value.priceMin !== null || value.priceMax !== null || value.couponOff > 0;
            dialog.querySelector('[data-template-field="salesActive"]').checked = salesActive;
            dialog.querySelector('[data-template-field="salesMin"]').value = value.salesMin ?? '';
            dialog.querySelector('[data-template-field="priceActive"]').checked = priceActive;
            dialog.querySelector('[data-template-field="priceMin"]').value = value.priceMin ?? '';
            dialog.querySelector('[data-template-field="priceMax"]').value = value.priceMax ?? '';
            dialog.querySelector('[data-template-field="couponOff"]').value = value.couponOff;
            dialog.querySelector('[data-template-field="ratingMin"]').value = value.ratingMin ?? '';
            syncTemplateEditorDisabledState();
        }

        function captureTemplateEditorFilters() {
            const dialog = state.shadow.querySelector('.template-dialog');
            const field = (key) => dialog.querySelector(`[data-template-field="${key}"]`);
            const salesActive = field('salesActive').checked;
            const priceActive = field('priceActive').checked;
            return normalizeFilters({
                globalShip: field('globalShip').checked,
                quickShip: field('quickShip').checked,
                trends: field('trends').checked,
                newArrivals: field('newArrivals').checked,
                singleSpec: field('singleSpec').checked,
                salesMin: salesActive ? (field('salesMin').value || 0) : null,
                priceMin: priceActive ? (field('priceMin').value || null) : null,
                priceMax: priceActive ? (field('priceMax').value || null) : null,
                couponOff: priceActive ? (field('couponOff').value || 0) : 0,
                ratingMin: field('ratingMin').value || null,
            }, state.site.code);
        }

        function syncTemplateEditorDisabledState() {
            const dialog = state.shadow.querySelector('.template-dialog');
            const salesActive = dialog.querySelector('[data-template-field="salesActive"]').checked;
            const priceActive = dialog.querySelector('[data-template-field="priceActive"]').checked;
            dialog.querySelector('[data-template-field="salesMin"]').disabled = !salesActive;
            ['priceMin', 'priceMax', 'couponOff'].forEach((key) => {
                dialog.querySelector(`[data-template-field="${key}"]`).disabled = !priceActive;
            });
        }

        function refreshTemplateEditorPreview() {
            syncTemplateEditorDisabledState();
            renderTemplatePreview(captureTemplateEditorFilters());
            state.shadow.querySelector('.template-dialog-error').textContent = '';
        }

        function openTemplateDialog(mode = 'create', templateId = '') {
            const dialog = state.shadow.querySelector('.template-dialog');
            const template = state.filterTemplates.find((item) => item.id === templateId);
            const editing = mode === 'edit' && Boolean(template);
            state.templateDialogMode = editing ? 'edit' : 'create';
            state.templateDialogTemplateId = editing ? template.id : '';
            const filters = editing ? template.filters : state.filters;
            dialog.querySelector('.template-dialog-title').textContent = editing ? '编辑常用模板' : '保存常用模板';
            dialog.querySelector('.template-dialog-description').textContent = editing
                ? '直接修改模板名称和筛选条件；保存后下次点击即使用新配置。'
                : '保存当前已应用的筛选条件，之后可一键恢复。';
            const nameInput = dialog.querySelector('[name="templateName"]');
            nameInput.value = editing ? template.name : '';
            nameInput.placeholder = editing ? '' : `例如：${state.site.code}代采 · 65%券`;
            dialog.querySelector('.template-filter-editor').hidden = !editing;
            dialog.querySelector('.template-edit-actions').hidden = !editing;
            dialog.querySelector('.template-preview-label').textContent = editing ? '修改后模板摘要' : '保存的筛选条件';
            dialog.querySelector('[data-action="template-save"]').textContent = editing ? '保存修改' : '保存模板';
            const deleteButton = dialog.querySelector('[data-action="template-dialog-delete"]');
            deleteButton.textContent = '删除模板';
            delete deleteButton.dataset.confirm;
            dialog.querySelector('.template-dialog-error').textContent = '';
            if (editing) setTemplateEditorFilters(filters);
            renderTemplatePreview(filters);
            closeTemplatePopover();
            showDialog(dialog);
            window.setTimeout(() => nameInput.focus(), 0);
        }

        function applyTemplate(template) {
            if (!template) return;
            state.filters = normalizeFilters(template.filters, state.site.code);
            state.filterDrafts = createFilterDrafts(state.filters);
            state.filterDraftDirty = { sales: false, price: false };
            state.activeTemplateId = template.id;
            saveFilterSettings();
            closeTemplatePopover();
            render();
            scheduleDetailSpecEnrichment();
            toast(`已应用模板：${template.name}`);
        }

        function saveTemplateDialog() {
            const dialog = state.shadow.querySelector('.template-dialog');
            const nameInput = dialog.querySelector('[name="templateName"]');
            const error = dialog.querySelector('.template-dialog-error');
            const name = normalizeText(nameInput.value).slice(0, 24);
            if (!name) {
                error.textContent = '请输入模板名称。';
                nameInput.focus();
                return;
            }
            const duplicateName = state.filterTemplates.some((template) => template.id !== state.templateDialogTemplateId && template.name.toLowerCase() === name.toLowerCase());
            if (duplicateName) {
                error.textContent = '当前站点已经存在同名模板。';
                nameInput.focus();
                return;
            }
            if (state.templateDialogMode === 'edit') {
                const template = state.filterTemplates.find((item) => item.id === state.templateDialogTemplateId);
                if (!template) return;
                template.name = name;
                template.filters = captureTemplateEditorFilters();
                if (state.activeTemplateId === template.id) {
                    state.filters = normalizeFilters(template.filters, state.site.code);
                    state.filterDrafts = createFilterDrafts(state.filters);
                    state.filterDraftDirty = { sales: false, price: false };
                    saveFilterSettings();
                }
            } else {
                if (state.filterTemplates.length >= MAX_FILTER_TEMPLATES) {
                    error.textContent = `当前站点最多保存 ${MAX_FILTER_TEMPLATES} 个模板。`;
                    return;
                }
                const template = {
                    id: `${state.site.code.toLowerCase()}-${Date.now().toString(36)}`,
                    name,
                    site: state.site.code,
                    filters: normalizeFilters(state.filters, state.site.code),
                };
                state.filterTemplates.push(template);
                state.activeTemplateId = template.id;
                savePersistentFilterState();
            }
            saveFilterTemplates();
            closeDialog(dialog);
            render();
            toast('常用筛选模板已保存');
        }

        function duplicateTemplate(template, filters = template?.filters) {
            if (!template || state.filterTemplates.length >= MAX_FILTER_TEMPLATES) {
                toast(`当前站点最多保存 ${MAX_FILTER_TEMPLATES} 个模板`);
                return null;
            }
            const duplicate = {
                id: `${state.site.code.toLowerCase()}-${Date.now().toString(36)}`,
                name: uniqueTemplateName(`${template.name} 副本`),
                site: state.site.code,
                filters: normalizeFilters(filters, state.site.code),
            };
            state.filterTemplates.push(duplicate);
            state.activeTemplateId = duplicate.id;
            saveFilterTemplates();
            savePersistentFilterState();
            renderTemplateControls();
            renderTemplateList();
            return duplicate;
        }

        function removeTemplate(template) {
            if (!template) return;
            state.filterTemplates = state.filterTemplates.filter((item) => item.id !== template.id);
            if (state.activeTemplateId === template.id) state.activeTemplateId = null;
            saveFilterTemplates();
            savePersistentFilterState();
            renderTemplateControls();
            renderTemplateList();
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
            const currentPage = getPageNumber(location.href, document);
            const targetPage = Math.max(1, currentPage + delta);
            const officialControl = findOfficialPaginationControl(document, delta, currentPage);
            if (officialControl) {
                state.pageNavigation = {
                    startedAt: Date.now(),
                    originalPage: currentPage,
                    originalUrl: location.href,
                    originalGrid: state.officialGrid,
                    originalGridContentRevision: state.officialGridContentRevision,
                    originalProductIds: (state.pageGroups.get(currentPage)?.products || []).map((product) => product.goodsId).sort().join('|'),
                    targetPage,
                };
                state.currentPage = targetPage;
                state.currentPageStatus = 'loading';
                state.currentPageFormalCount = 0;
                state.shadow.querySelector('.status').textContent = `正在加载第 ${targetPage} 页…`;
                state.shadow.querySelector('.page').textContent = String(targetPage);
                officialControl.click();
                scheduleScan(250, { force: true });
                return;
            }
            const url = new URL(location.href);
            url.searchParams.set('page', String(targetPage));
            state.pageNavigation = {
                startedAt: Date.now(),
                originalPage: currentPage,
                originalUrl: location.href,
                originalGrid: state.officialGrid,
                originalGridContentRevision: state.officialGridContentRevision,
                originalProductIds: (state.pageGroups.get(currentPage)?.products || []).map((product) => product.goodsId).sort().join('|'),
                targetPage,
            };
            saveSession();
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
            if (!state.products.length) return toast('累计页面中没有可补全的商品');
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

        function sortVisibleEntries(entries) {
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

        function visiblePageGroups() {
            const pagesByGoodsId = new Map();
            state.pageOrder.forEach((page) => {
                const pageIds = new Set();
                Array.from(state.pageGroups.get(page)?.products || []).forEach((product) => {
                    if (!product?.goodsId || pageIds.has(product.goodsId)) return;
                    pageIds.add(product.goodsId);
                    if (!pagesByGoodsId.has(product.goodsId)) pagesByGoodsId.set(product.goodsId, []);
                    pagesByGoodsId.get(product.goodsId).push(Number(page));
                });
            });
            return state.pageOrder.map((page) => {
                const group = state.pageGroups.get(page);
                const products = Array.from(group?.products || []);
                const entries = products
                    .map((product) => ({
                        product,
                        evaluation: evaluateProduct(product, state.filters),
                        duplicatePages: pagesByGoodsId.get(product.goodsId) || [Number(page)],
                    }))
                    .filter((entry) => entry.evaluation.matched);
                const duplicateCount = products.filter((product) => (pagesByGoodsId.get(product.goodsId) || []).length > 1).length;
                return { group, entries: sortVisibleEntries(entries), duplicateCount };
            }).filter(({ group }) => Boolean(group));
        }

        function visibleProducts(pageGroups = visiblePageGroups()) {
            const seen = new Set();
            return pageGroups.flatMap(({ entries }) => entries).filter(({ product }) => {
                if (!product?.goodsId || seen.has(product.goodsId)) return false;
                seen.add(product.goodsId);
                return true;
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
            const applyButton = (scope, label) => `<button type="button" class="filter-apply ${state.filterDraftDirty[scope] ? 'is-dirty' : ''}" data-action="apply-numeric" data-draft-scope="${scope}" ${state.filterDraftDirty[scope] ? '' : 'disabled'} aria-label="${state.filterDraftDirty[scope] ? `应用${label}筛选` : `${label}筛选已应用`}" title="${state.filterDraftDirty[scope] ? '应用筛选（也可按 Enter）' : '当前数字筛选已应用'}">应用</button>`;
            filters.innerHTML = toggle('globalShip', 'GlobalShip', 'plane', counts.globalShip, 'Fulfillment')
                + toggle('quickShip', 'QuickShip', 'truck', counts.quickShip, 'Fulfillment')
                + toggle('trends', 'Trends', 'trends', counts.trends, 'Official signal')
                + toggle('newArrivals', 'New Arrivals', 'new', counts.newArrivals, 'Official signal')
                + toggle('singleSpec', 'Single-Spec', 'singleSpec', counts.singleSpec, 'Specification')
                + `<div class="filter numeric-filter">${filterIcon('sales')}<label><small>Sales · minimum</small><span class="inline-field"><input type="number" min="0" step="100" data-filter="salesMin" value="${safeHtml(state.filterDrafts.salesMin)}" title="按 Enter 或点击应用"></span></label>${applyButton('sales', 'Sales')}</div>`
                + `<div class="filter price-filter numeric-filter">${filterIcon('price')}<div class="price-copy"><div class="coupon-row"><b>Price · ${state.site.currency}</b><span class="coupon-tools"><span class="coupon-mark" title="Coupon">%</span>${[65, 30, 0].map((value) => `<button type="button" data-action="coupon" data-value="${value}" class="${state.filters.couponOff === value ? 'active' : ''}">${value}%</button>`).join('')}</span></div><div class="price-inputs"><input aria-label="Minimum price" type="number" min="0" placeholder="${state.site.symbol} 0" data-filter="priceMin" value="${safeHtml(state.filterDrafts.priceMin)}" title="按 Enter 或点击应用"><span>—</span><input aria-label="Maximum price" type="number" min="0" placeholder="${state.site.symbol} ∞" data-filter="priceMax" value="${safeHtml(state.filterDrafts.priceMax)}" title="按 Enter 或点击应用"><span class="coupon-custom"><input aria-label="Coupon percent off" type="number" min="0" max="100" placeholder="0" data-filter="couponOff" value="${safeHtml(state.filterDrafts.couponOff)}" title="按 Enter 或点击应用"><span class="coupon-suffix" aria-hidden="true">%</span></span></div></div>${applyButton('price', 'Price')}</div>`
                + `<div class="filter rating-filter">${filterIcon('star')}<label><small>Rating</small><span class="inline-field"><select data-filter="ratingMin" aria-label="星级门槛；All 表示不筛选，另支持4.0、4.2、4.5三档"><option value="" ${state.filters.ratingMin === null ? 'selected' : ''}>All</option><option value="4" ${state.filters.ratingMin === 4 ? 'selected' : ''}>4.0+</option><option value="4.2" ${state.filters.ratingMin === 4.2 ? 'selected' : ''}>4.2+</option><option value="4.5" ${state.filters.ratingMin === 4.5 ? 'selected' : ''}>4.5+</option></select></span></label></div>`
                + `<div class="filter metrics"><span class="ico">✓</span><label><small>最终命中</small><b>${visibleProducts().length} · ${state.products.length ? Math.round(visibleProducts().length / state.products.length * 1000) / 10 : 0}%</b></label></div>`;
        }

        function renderTable() {
            const tableWrap = state.shadow.querySelector('.table-wrap');
            const scrollTop = tableWrap.scrollTop;
            const scrollLeft = tableWrap.scrollLeft;
            const body = state.shadow.querySelector('tbody');
            body.replaceChildren();
            const pageGroups = visiblePageGroups();
            const entries = visibleProducts();
            if (!pageGroups.length) {
                const row = document.createElement('tr');
                row.className = 'empty-state';
                const cell = document.createElement('td');
                cell.colSpan = 15;
                cell.innerHTML = `<b>${safeHtml(pageStatusLabel(state.currentPageStatus, state.currentPage))}</b><small>推荐商品不会计入结果；请等待正式商品列表加载，或点击“重新扫描”。</small>`;
                row.appendChild(cell);
                body.appendChild(row);
            }
            pageGroups.forEach(({ group, entries: groupEntries, duplicateCount }) => {
                const divider = document.createElement('tr');
                divider.className = 'page-divider';
                divider.dataset.status = group.status;
                const dividerCell = document.createElement('td');
                dividerCell.colSpan = 15;
                const preserved = group.status !== 'ready' && group.products.length
                    ? ` · 保留上次 ${group.formalCount} 个正式商品`
                    : '';
                const mainLabel = group.status === 'ready'
                    ? `第 ${group.page} 页 · ${group.formalCount} 个正式商品`
                    : `第 ${group.page} 页 · ${pageStatusLabel(group.status, group.page)}${preserved}`;
                const selectedCount = groupEntries.filter(({ product }) => state.selected.has(product.goodsId)).length;
                const allSelected = groupEntries.length > 0 && selectedCount === groupEntries.length;
                const partiallySelected = selectedCount > 0 && !allSelected;
                const duplicateSummary = duplicateCount ? ` · 跨页重复 ${duplicateCount}` : '';
                dividerCell.innerHTML = `<span class="page-divider-content"><span>${safeHtml(mainLabel)}</span><span class="page-divider-actions"><small>筛选命中 ${groupEntries.length}${duplicateSummary} · 已选 ${selectedCount}</small><label class="page-select-all" title="选择第 ${group.page} 页当前筛选命中的正式商品"><input type="checkbox" data-action="select-page" data-page="${group.page}" ${allSelected ? 'checked' : ''} ${groupEntries.length ? '' : 'disabled'}><span>全选本页</span></label></span></span>`;
                dividerCell.querySelector('[data-action="select-page"]').indeterminate = partiallySelected;
                divider.appendChild(dividerCell);
                body.appendChild(divider);
                groupEntries.forEach(({ product, evaluation, duplicatePages }) => {
                const row = document.createElement('tr');
                row.className = evaluation.matched ? 'matched' : '';
                row.dataset.goodsId = product.goodsId;
                row.dataset.sourcePage = String(group.page);
                if (duplicatePages.length > 1) row.dataset.crossPageDuplicate = 'true';
                const signals = [product.trends ? 'Trends' : '', product.newArrivals ? 'New Arrivals' : '', product.bestSeller ? 'Best Seller' : '', product.almostSoldOut ? 'Almost sold out' : ''].filter(Boolean);
                const officialSignals = signals.map((signal) => `<span class="signal">${safeHtml(signal)}</span>`).join('');
                const duplicateSignal = duplicatePages.length > 1
                    ? `<span class="signal duplicate-signal" style="border-color:#e4c988;background:#fff8e6;color:#8b6209" title="同一 Goods ID 同时出现在第 ${duplicatePages.join('、')} 页">跨页重复</span>`
                    : '';
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
                    { html: officialSignals + duplicateSignal || '—' },
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
            });
            if (state.products.length && !entries.length) {
                const row = document.createElement('tr');
                row.className = 'empty-state';
                const cell = document.createElement('td');
                cell.colSpan = 15;
                cell.innerHTML = `<b>累计 ${state.products.length} 个正式商品，当前筛选条件无命中</b><small>请调整条件，或点击工具栏“清空筛选”查看全部累计数据。</small>`;
                row.appendChild(cell);
                body.appendChild(row);
            }
            const all = state.shadow.querySelector('[data-action="all"]');
            if (all) {
                all.checked = Boolean(entries.length) && entries.every(({ product }) => state.selected.has(product.goodsId));
                all.indeterminate = entries.some(({ product }) => state.selected.has(product.goodsId)) && !all.checked;
            }
            tableWrap.scrollTop = scrollTop;
            tableWrap.scrollLeft = scrollLeft;
            state.tableDirty = false;
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

        function pageStatusLabel(status, page) {
            if (status === 'empty') return '当前页无正式商品';
            if (status === 'risk') return 'SHEIN 风险验证';
            if (status === 'timeout') return '页面加载超时';
            if (status === 'ready') return `第 ${page} 页正式商品已加载`;
            return '正在等待正式商品列表';
        }

        function accumulatedPageCount() {
            return Array.from(state.pageGroups.values()).filter((group) => group.hasSuccessfulSnapshot).length;
        }

        function renderWorkbenchStatus() {
            if (!state.shadow || state.detailSpecActive) return;
            const pageGroups = visiblePageGroups();
            const matched = visibleProducts(pageGroups).length;
            const currentMatched = state.currentPageStatus === 'ready'
                ? (pageGroups.find(({ group }) => Number(group.page) === Number(state.currentPage))?.entries.length || 0)
                : 0;
            const accumulatedPages = accumulatedPageCount();
            const status = state.shadow.querySelector('.status');
            if (state.pageNavigation) {
                status.textContent = `正在加载第 ${state.pageNavigation.targetPage} 页 · 已累计 ${accumulatedPages} 页 / ${state.products.length} 个正式商品`;
                return;
            }
            const current = state.currentPageStatus === 'ready'
                ? `当前 ${state.currentPageFormalCount}`
                : pageStatusLabel(state.currentPageStatus, state.currentPage);
            const createMatchBadge = (label, value) => {
                const badge = document.createElement('span');
                const number = document.createElement('strong');
                badge.className = 'status-match';
                badge.append(`${label} `);
                number.textContent = String(value);
                badge.append(number);
                return badge;
            };
            status.replaceChildren(
                document.createTextNode(`第 ${state.currentPage} 页 · ${current} · 累计 ${accumulatedPages} 页 / ${state.products.length} · `),
                createMatchBadge('当前命中', currentMatched),
                document.createTextNode(' · '),
                createMatchBadge('累计命中', matched),
            );
        }

        function renderSummary() {
            const matched = visibleProducts().length;
            const confirmedSpecs = state.products.filter((product) => product.specConfirmed).length;
            const failedSpecs = state.products.filter((product) => product.specLookupStatus === 'failed').length;
            const pendingSpecs = Math.max(0, state.products.length - confirmedSpecs - failedSpecs);
            const entries = [
                ['当前站点', state.site.code], ['页面类型', getPageType(location.href)], ['当前结果页', `${state.currentPage}`], ['当前页正式商品', state.currentPageFormalCount],
                ['已累计页数', accumulatedPageCount()], ['累计正式商品', state.products.length],
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

        function setCompactMode(compact) {
            const nextCompact = Boolean(compact);
            const refreshTable = state.compact && !nextCompact && state.tableDirty;
            state.compact = nextCompact;
            if (state.compact) state.maximized = false;
            saveSession();
            if (refreshTable) render();
            else renderVisibility();
        }

        function renderVisibility() {
            const visible = isSupportedListingUrl(location.href) || (isRiskListingPage(document, location.href) && Boolean(state.pageNavigation));
            if (state.host) state.host.style.display = visible ? '' : 'none';
            if (state.launcherHost) state.launcherHost.style.display = visible ? '' : 'none';
            const panel = state.shadow?.querySelector('.panel');
            panel?.classList.toggle('compact', state.compact);
            panel?.classList.toggle('max', state.maximized && !state.compact);
            if (state.compact) {
                panel?.classList.remove('summary-open');
                state.shadow?.querySelector('[data-action="summary"]')?.setAttribute('aria-expanded', 'false');
            }
            const closeButton = state.shadow?.querySelector('[data-action="close"]');
            if (closeButton) {
                closeButton.textContent = state.compact ? '▲' : '—';
                closeButton.setAttribute('aria-label', state.compact ? '展开完整工作台' : '最小化并保留工具栏和筛选器');
                closeButton.title = state.compact ? '展开完整工作台' : '最小化并保留工具栏和筛选器';
            }
            if (!state.launcher) return;
            state.launcher.setAttribute('aria-expanded', String(!state.compact));
            state.launcher.setAttribute('aria-label', `SHEIN选品助手，鼠标悬停展开，点击${state.compact ? '展开完整工作台' : '最小化并保留筛选器'}，上下拖动调整位置`);
            state.launcher.title = `悬停展开 · 点击${state.compact ? '展开完整工作台' : '最小化并保留筛选器'} · 上下拖动位置`;
        }

        function renderShortcutButton() {
            const button = state.shadow?.querySelector('[data-action="shortcut"]');
            if (!button) return;
            button.textContent = `⌨ ${shortcutLabel(state.copyShortcut, true)}`;
            button.title = `设置复制商品链接快捷键（当前 ${shortcutLabel(state.copyShortcut)}）`;
        }

        function renderExportControls() {
            const exportButton = state.shadow?.querySelector('[data-action="export"]');
            const confirmButton = state.shadow?.querySelector('.export-dialog button[value="confirm"]');
            if (exportButton) {
                exportButton.disabled = state.exportActive;
                exportButton.setAttribute('aria-busy', String(state.exportActive));
                exportButton.title = state.exportActive ? '导出任务正在进行，请查看进度提示' : '导出已勾选商品';
            }
            if (confirmButton) confirmButton.disabled = state.exportActive;
        }

        function setExportProgress(progress) {
            state.exportProgress = {
                stage: progress.stage || 'preparing',
                completed: Math.max(0, Number(progress.completed || 0)),
                total: Math.max(0, Number(progress.total || 0)),
                failed: Math.max(0, Number(progress.failed || 0)),
                message: normalizeText(progress.message),
            };
            clearTimeout(state.exportProgressTimer);
            const element = state.shadow?.querySelector('.export-progress');
            if (!element) return;
            const { stage, completed, total, failed, message } = state.exportProgress;
            const percentage = stage === 'workbook' || stage === 'done'
                ? 100
                : (total ? Math.min(100, Math.round(completed / total * 100)) : 0);
            const labels = {
                preparing: '正在准备导出',
                images: '正在处理商品主图',
                rows: '正在整理商品数据',
                workbook: '正在生成 Excel 文件',
                done: 'Excel 导出完成',
                error: 'Excel 导出失败',
            };
            const detail = message || (stage === 'images'
                ? `主图成功 ${Math.max(0, completed - failed)} · 失败 ${failed} · ${percentage}%`
                : (stage === 'rows'
                    ? `已整理 ${completed} 条商品数据`
                    : (stage === 'workbook' ? '商品数据已处理完成，正在写入文件' : '请保持当前页面打开')));
            element.hidden = false;
            element.classList.toggle('error', stage === 'error');
            element.querySelector('.export-progress-head b').textContent = labels[stage] || 'Excel 导出';
            element.querySelector('.export-progress-count').textContent = total ? `${Math.min(completed, total)} / ${total}` : '';
            element.querySelector('.export-progress-bar').style.width = `${percentage}%`;
            element.querySelector('.export-progress-detail').textContent = detail;
            renderExportControls();
            if (stage === 'done' || stage === 'error') {
                state.exportProgressTimer = setTimeout(() => {
                    element.hidden = true;
                    state.exportProgress = { stage: 'idle', completed: 0, total: 0, failed: 0, message: '' };
                }, stage === 'done' ? 5200 : 8000);
            }
        }

        function render() {
            if (!state.shadow) return;
            const activeFilter = state.shadow.activeElement?.dataset?.filter;
            const preserveActiveDraft = numericFilterKeys.has(activeFilter);
            if (preserveActiveDraft) {
                state.tableDirty = true;
                if (state.detailSpecActive) updateDetailSpecStatus();
                else renderWorkbenchStatus();
                state.shadow.querySelector('.page').textContent = String(state.pageNavigation?.targetPage || state.currentPage);
                state.shadow.querySelector('.selected-count').textContent = String(state.selected.size);
                renderExportControls();
                renderShortcutButton();
                renderTemplateControls();
                renderVisibility();
                return;
            }
            renderFilters();
            applyPageProductFilter(document, location.href, state.filters, state.products);
            if (state.compact) {
                state.tableDirty = true;
            } else {
                renderTable();
                renderSortHeaders();
                renderSummary();
            }
            if (state.detailSpecActive) updateDetailSpecStatus();
            else renderWorkbenchStatus();
            state.shadow.querySelector('.page').textContent = String(state.pageNavigation?.targetPage || state.currentPage);
            state.shadow.querySelector('.selected-count').textContent = String(state.selected.size);
            renderExportControls();
            renderShortcutButton();
            renderTemplateControls();
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

        function resetAccumulator(contextKey) {
            state.listContextKey = contextKey;
            state.pageGroups = new Map();
            state.pageOrder = [];
            state.products = [];
            state.selected.clear();
            state.pageNavigation = null;
            state.currentPageStatus = 'loading';
            state.currentPageFormalCount = 0;
            saveSession();
        }

        function mergeExistingProductData(products) {
            const previousProducts = new Map(state.products.map((product) => [product.goodsId, product]));
            products.forEach((product) => {
                const previous = previousProducts.get(product.goodsId);
                if (!product.imageUrl && previous?.imageUrl) product.imageUrl = previous.imageUrl;
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
        }

        function commitPageSnapshot(snapshot) {
            const previousFirstPage = state.pageOrder[0];
            const accumulated = updatePageAccumulator(state.pageGroups, state.pageOrder, snapshot);
            state.pageGroups = accumulated.groups;
            state.pageOrder = accumulated.order;
            state.products = accumulated.products;
            state.currentPage = accumulated.group.page;
            state.currentPageStatus = accumulated.group.status;
            state.currentPageFormalCount = snapshot.status === 'ready' ? snapshot.products.length : 0;
            const retainedProductIds = new Set(state.products.map((product) => product.goodsId));
            Array.from(state.selected.keys()).forEach((goodsId) => {
                if (!retainedProductIds.has(goodsId)) state.selected.delete(goodsId);
            });
            state.products.forEach((product) => {
                if (state.selected.has(product.goodsId)) state.selected.set(product.goodsId, product);
            });
            saveSession();
            return previousFirstPage !== accumulated.group.page;
        }

        function scan(options = {}) {
            if (deferScanWhileNumericEditing(options)) return false;
            const supported = isSupportedListingUrl(location.href);
            const risk = isRiskListingPage(document, location.href);
            if (!supported && !(risk && state.pageNavigation)) return false;
            const snapshot = collectListingSnapshot(document, location.href);
            bindOfficialGridObserver(snapshot.grid);
            if (snapshot.contextKey && snapshot.contextKey !== state.listContextKey) resetAccumulator(snapshot.contextKey);
            mergeExistingProductData(snapshot.products);

            if (state.pageNavigation) {
                const navigation = state.pageNavigation;
                const officialPage = getPageNumber(location.href, document);
                const pageChanged = snapshot.status === 'risk' || (officialPage === navigation.targetPage
                    && (officialPage !== navigation.originalPage || location.href !== navigation.originalUrl));
                const nextProductIds = snapshot.products.map((product) => product.goodsId).sort().join('|');
                const formalGridAdvanced = snapshot.status === 'ready' && (
                    snapshot.grid !== navigation.originalGrid
                    || state.officialGridContentRevision > Number(navigation.originalGridContentRevision || 0)
                    || nextProductIds !== navigation.originalProductIds
                );
                const loadFinished = snapshot.status === 'empty' || snapshot.status === 'risk' || formalGridAdvanced;
                const expired = Date.now() - navigation.startedAt >= PAGE_NAVIGATION_TIMEOUT_MS;
                if ((!pageChanged || !loadFinished) && !expired) {
                    state.currentPage = navigation.targetPage;
                    state.currentPageStatus = 'loading';
                    state.currentPageFormalCount = 0;
                    render();
                    scheduleScan(450, options);
                    return false;
                }
                if ((!pageChanged || !loadFinished) && expired) {
                    const timeoutSnapshot = {
                        status: 'timeout',
                        products: [],
                        page: navigation.targetPage,
                        message: '页面加载超时',
                    };
                    state.pageNavigation = null;
                    commitPageSnapshot(timeoutSnapshot);
                    render();
                    return false;
                }
                snapshot.page = navigation.targetPage;
                state.pageNavigation = null;
            }

            if (snapshot.status === 'loading') {
                state.currentPage = snapshot.page;
                state.currentPageStatus = 'loading';
                state.currentPageFormalCount = 0;
                render();
                if (options.announce) toast('正式商品列表尚未加载完成，未采集推荐商品');
                return false;
            }
            if (!['ready', 'empty', 'risk'].includes(snapshot.status)) return false;
            const previousGroup = state.pageGroups.get(Number(snapshot.page));
            const unchanged = previousGroup
                && previousGroup.status === snapshot.status
                && productSignature(previousGroup.products) === productSignature(snapshot.products);
            const hasFuturePageGroups = ['ready', 'empty'].includes(snapshot.status)
                && state.pageOrder.some((page) => Number(page) > Number(snapshot.page));
            if (!options.force && unchanged && !hasFuturePageGroups) return false;
            const scrollToTop = commitPageSnapshot(snapshot);
            render();
            if (scrollToTop) state.shadow.querySelector('.table-wrap').scrollTop = 0;
            if (snapshot.status === 'ready') {
                scheduleDetailSpecEnrichment();
                scheduleJijiyunEnrichment();
            }
            if (options.announce) {
                const message = snapshot.status === 'ready'
                    ? `已扫描 ${snapshot.products.length} 个商品（第 ${snapshot.page} 页正式列表）`
                    : pageStatusLabel(snapshot.status, snapshot.page);
                toast(message);
            }
            return true;
        }

        function scheduleScan(delay = 350, options = {}) {
            mergePendingScanOptions(options);
            clearTimeout(state.scanTimer);
            state.scanTimer = 0;
            if (isNumericFilterEditing()) {
                state.scanDeferredByEditor = true;
                return;
            }
            state.scanTimer = setTimeout(() => {
                const pending = state.pendingScanOptions || {};
                state.pendingScanOptions = null;
                state.scanTimer = 0;
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

        function bindOfficialGridObserver(grid) {
            if (grid === state.officialGrid && grid?.isConnected) return;
            const gridChanged = Boolean(grid && grid !== state.officialGrid);
            state.officialGridObserver?.disconnect();
            state.officialGridObserver = null;
            state.officialGrid = grid || null;
            if (!grid) return;
            if (gridChanged) state.officialGridContentRevision += 1;
            state.officialGridObserver = new MutationObserver((mutations) => {
                if (!mutationsAffectProducts(mutations)) return;
                const contentChanged = mutations.some((mutation) => mutation.type === 'childList'
                    && (nodeIsInsideProductCard(mutation.target)
                        || [...mutation.addedNodes, ...mutation.removedNodes].some(elementContainsProductLink)));
                if (contentChanged) state.officialGridContentRevision += 1;
                scheduleScan(350);
            });
            state.officialGridObserver.observe(grid, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'src', 'srcset', 'data-src', 'data-srcset', 'data-original', 'data-lazy-src', 'data-original-src', 'data-image', 'data-url',
                    ...STORE_CODE_ATTRIBUTE_NAMES,
                ],
            });
        }

        function nodeMayContainListingState(node) {
            if (node?.nodeType !== 1) return false;
            if (node.matches?.(OFFICIAL_GRID_SELECTOR) || node.querySelector?.(OFFICIAL_GRID_SELECTOR)) return true;
            const identity = elementIdentity(node);
            return /(?:selectclasse?mpty|empty[\s_-]*result|search[\s_-]*empty|captcha|crawler[\s_-]*block|challenge)/i.test(identity);
        }

        function scheduleContainerRefresh(delay = 220) {
            clearTimeout(state.containerScanTimer);
            state.containerScanTimer = setTimeout(() => scheduleScan(0, { force: true }), delay);
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
            if (!links) return toast(state.copyScope === 'selected' ? '请先选择商品' : '累计页面中没有筛选命中商品');
            if (typeof GM_setClipboard === 'function') GM_setClipboard(links, 'text');
            else await navigator.clipboard.writeText(links);
            toast(`已复制 ${products.length} 条链接（${state.copyScope === 'selected' ? '已选商品' : '全部累计页面筛选结果'}，每行一条）`);
        }

        function openExportDialog() {
            if (!state.selected.size) return toast('请先选择商品');
            if (state.exportActive) {
                setExportProgress(state.exportProgress);
                return;
            }
            const dialog = state.shadow.querySelector('.export-dialog');
            dialog.returnValue = '';
            dialog.showModal();
        }

        async function exportSelected(includeImages) {
            const products = Array.from(state.selected.values());
            if (!products.length) return;
            if (state.exportActive) {
                setExportProgress(state.exportProgress);
                return;
            }
            const startedAt = Date.now();
            state.exportActive = true;
            let failedImages = 0;
            setExportProgress({
                stage: 'preparing',
                completed: 0,
                total: products.length,
                failed: 0,
                message: includeImages ? `准备处理 ${products.length} 张商品主图` : `准备导出 ${products.length} 条商品数据`,
            });
            try {
                const workbook = await createWorkbook(products, state.filters, {
                    includeImages,
                    imageLoader: loadCompressedImage,
                    onProgress(progress) {
                        failedImages = progress.failed;
                        setExportProgress(progress);
                    },
                });
                setExportProgress({ stage: 'workbook', completed: products.length, total: products.length, failed: failedImages });
                await new Promise((resolve) => setTimeout(resolve, 0));
                const buffer = await workbook.xlsx.writeBuffer();
                const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                downloadBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Shein-Global-Selector-${state.site.code}-${escapeFilePart(getKeyword(location.href, document))}-${date}.xlsx`);
                const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
                const imageSummary = includeImages ? `主图成功 ${products.length - failedImages} · 失败 ${failedImages} · ` : '';
                setExportProgress({
                    stage: 'done', completed: products.length, total: products.length, failed: failedImages,
                    message: `已导出 ${products.length} 个商品 · ${imageSummary}耗时 ${seconds} 秒`,
                });
            } catch (error) {
                setExportProgress({
                    stage: 'error', completed: state.exportProgress.completed, total: products.length, failed: failedImages,
                    message: `导出失败：${error.message}`,
                });
            } finally {
                state.exportActive = false;
                renderExportControls();
            }
        }

        mountLauncher();
        mountWorkbench();
        scan({ force: true });
        state.containerObserver = new MutationObserver((mutations) => {
            if (state.officialGrid?.isConnected) return;
            const relevant = mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some(nodeMayContainListingState));
            if (relevant) scheduleContainerRefresh();
        });
        state.containerObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
        let lastUrl = location.href;
        window.setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            const supported = isSupportedListingUrl(lastUrl);
            const riskPage = isRiskListingPage(document, lastUrl);
            const visible = supported || (riskPage && Boolean(state.pageNavigation));
            if (!visible) clearPageProductFilter(document);
            renderVisibility();
            if (visible) scheduleScan(0, { force: true });
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
        listingContextKey,
        isExcludedProductRegion,
        findOfficialProductGrid,
        isRiskListingPage,
        isEmptyListingPage,
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
        collectListingSnapshot,
        collectProducts,
        clearPageProductFilter,
        applyPageProductFilter,
        updatePageAccumulator,
        flattenPageGroups,
        normalizeFilters,
        clearedFilters,
        defaultFilterTemplates,
        normalizeFilterTemplate,
        filterTemplateSummary,
        filterTemplateMatches,
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
