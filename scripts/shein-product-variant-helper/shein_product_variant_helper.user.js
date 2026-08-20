// ==UserScript==
// @name         Xynigo SHEIN 商品型号助手
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      0.1.8
// @description  在 SHEIN 美国站和墨西哥站校验主规格、次规格、实时售价与库存，生成精简精准链接并复制三行采购信息。
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/scripts/shein-product-variant-helper
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @match        https://us.shein.com/*
// @match        https://shein.com.mx/*
// @match        https://*.shein.com.mx/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=shein.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-product-variant-helper/shein_product_variant_helper.user.js
// @updateURL    https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/shein-product-variant-helper/shein_product_variant_helper.user.js
// ==/UserScript==

(function expose(root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    root.XynigoSheinVariantHelper = api;

    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
        api.boot();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHelper() {
    'use strict';

    const RAW_MARKER = 'window.gbRawData = ';
    const LEGACY_SIZE_ATTR_ID = '87';
    const LEGACY_COLOR_ATTR_ID = '27';
    const HOST_ID = 'xynigo-shein-variant-helper';
    const POSITION_KEY = 'xynigo-shein-variant-position-v1';
    const COUPON_KEY = 'xynigo-shein-coupon-rate-v1';
    const AUTO_REFRESH_KEY = 'xynigo-shein-auto-refresh-v1';
    const AUTO_REFRESH_MAX_AGE = 45_000;
    const AUTO_REFRESH_DELAY = 700;
    const RESTORE_RETRY_LIMIT = 60;
    const COUPON_RATES = [0, 0.3, 0.5, 0.6, 0.65];
    const BUTTON_WIDTH = 146;
    const BUTTON_HEIGHT = 44;
    const EDGE_GAP = 12;

    function text(value) {
        return value === undefined || value === null ? '' : String(value);
    }

    function normalizeCouponRate(value) {
        const rate = Number(value);
        return COUPON_RATES.includes(rate) ? rate : 0;
    }

    function couponLabel(value) {
        const rate = normalizeCouponRate(value);
        return rate ? `${Math.round(rate * 100)}% 优惠券` : '无优惠券';
    }

    function calculatePurchasePrice(pagePrice, couponRate = 0) {
        const amount = Number.parseFloat(text(pagePrice).replaceAll(',', ''));
        if (!Number.isFinite(amount)) return '';
        const rate = normalizeCouponRate(couponRate);
        return (Math.round((amount * (1 - rate) + Number.EPSILON) * 100) / 100).toFixed(2);
    }

    function parseRenderedPriceText(value, fallbackCurrency = '') {
        const normalized = text(value).replaceAll(/\s/g, '');
        const match = normalized.match(/^(US\$|\$MXN|MXN\$|\$)([\d,]+(?:\.\d{1,2})?)$/i);
        if (!match) return null;
        const amount = Number.parseFloat(match[2].replaceAll(',', ''));
        if (!Number.isFinite(amount)) return null;
        const marker = match[1].toUpperCase();
        const currency = marker.includes('MXN') ? 'MXN' : marker === 'US$' ? 'USD' : text(fallbackCurrency);
        return { price: amount.toFixed(2), currency };
    }

    function applyRenderedPriceSnapshot(variants, selectedSkuCode, renderedPrice) {
        const source = Array.from(variants || []).map((item) => ({
            ...item,
            priceSource: item.price ? 'schema' : '',
        }));
        const price = text(renderedPrice?.price).trim();
        if (!price || !Number.isFinite(Number.parseFloat(price.replaceAll(',', '')))) return source;

        const selected = source.find((item) => item.skuCode === selectedSkuCode);
        const currency = text(renderedPrice?.currency || selected?.currency || source.find((item) => item.currency)?.currency);
        return source.map((item) => {
            if (item.skuCode === selectedSkuCode) {
                return { ...item, price, currency, priceSource: 'rendered' };
            }
            return { ...item, price: '', priceSource: 'unverified' };
        });
    }

    function toUrl(value) {
        try {
            return new URL(value);
        } catch (_error) {
            return null;
        }
    }

    function extractUrlGoodsId(url) {
        const match = toUrl(url)?.pathname.match(/-p-(\d+)\.html(?:\/)?$/i);
        return match ? match[1] : '';
    }

    function isProductUrl(url) {
        return Boolean(extractUrlGoodsId(url));
    }

    function productPageKey(url) {
        const parsed = toUrl(url);
        const goodsId = extractUrlGoodsId(url);
        return parsed && goodsId ? `${parsed.origin}:${goodsId}` : '';
    }

    function reconcilePreciseProductUrl(result) {
        const parsed = toUrl(result?.url);
        const pathGoodsId = text(result?.consistency?.ids?.url || extractUrlGoodsId(result?.url));
        if (!parsed || !pathGoodsId) return text(result?.url);
        const queryGoodsId = text(parsed.searchParams.get('goods_id'));
        if (!queryGoodsId || queryGoodsId === pathGoodsId) return parsed.toString();

        parsed.searchParams.set('goods_id', pathGoodsId);
        parsed.searchParams.delete('skucode');
        return parsed.toString();
    }

    function shouldAutoRefreshAfterPrimarySwitch(result) {
        const urlGoodsId = text(result?.consistency?.ids?.url);
        const pageGoodsId = text(result?.product?.goodsId);
        const parsed = toUrl(result?.url);
        const queryGoodsId = text(parsed?.searchParams.get('goods_id'));
        const preciseProductMismatch = Boolean(queryGoodsId && urlGoodsId && queryGoodsId !== urlGoodsId);
        const mixedPageIds = Array.from(result?.consistency?.actualGoodsIds || [])
            .some((goodsId) => text(goodsId) && text(goodsId) !== urlGoodsId);
        return result?.code === 'STALE_PRODUCT_DATA'
            && Boolean(urlGoodsId && (
                (pageGoodsId && urlGoodsId !== pageGoodsId)
                || preciseProductMismatch
                || mixedPageIds
            ));
    }

    function shouldAutoRefreshAfterColorSwitch(result) {
        return shouldAutoRefreshAfterPrimarySwitch(result);
    }

    function normalizeSpecLabel(value) {
        return text(value).trim().replace(/\s*\([^)]*\)\s*$/u, '').toLowerCase();
    }

    function normalizeSizeLabel(value) {
        return normalizeSpecLabel(value);
    }

    function getVariantStockState(variant) {
        const rawStock = text(variant?.stockText).trim();
        if (rawStock) {
            const stock = Number.parseFloat(rawStock.replaceAll(',', ''));
            if (Number.isFinite(stock)) return stock > 0 ? 'in_stock' : 'out_of_stock';
        }

        const availability = text(variant?.availability).toLowerCase().replaceAll(/[^a-z]/g, '');
        if (availability.includes('outofstock') || availability.includes('soldout')) return 'out_of_stock';
        if (availability.includes('instock')) return 'in_stock';
        return 'unknown';
    }

    function canCopyVariant(result, variant) {
        return Boolean(result?.safeToUse && variant?.price && getVariantStockState(variant) === 'in_stock');
    }

    function detectSite(hostname) {
        const normalized = text(hostname).toLowerCase();
        if (normalized === 'us.shein.com') return 'US';
        if (normalized === 'shein.com.mx' || normalized.endsWith('.shein.com.mx')) return 'MX';
        return normalized || 'UNKNOWN';
    }

    function extractBalancedJson(source, marker) {
        const markerIndex = source.indexOf(marker);
        if (markerIndex < 0) return '';

        let start = markerIndex + marker.length;
        while (/\s/.test(source[start] || '')) start += 1;

        const opener = source[start];
        const closer = opener === '{' ? '}' : opener === '[' ? ']' : '';
        if (!closer) return '';

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let index = start; index < source.length; index += 1) {
            const char = source[index];
            if (inString) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') inString = false;
                continue;
            }

            if (char === '"') inString = true;
            else if (char === opener) depth += 1;
            else if (char === closer) {
                depth -= 1;
                if (depth === 0) return source.slice(start, index + 1);
            }
        }

        return '';
    }

    function normalizeScripts(scripts) {
        return Array.from(scripts || []).map((script) => ({
            id: text(script.id),
            type: text(script.type),
            content: text(script.content ?? script.text ?? script.textContent),
        }));
    }

    function parseRawData(scripts) {
        for (const script of normalizeScripts(scripts)) {
            if (!script.content.includes(RAW_MARKER)) continue;
            const json = extractBalancedJson(script.content, RAW_MARKER);
            if (!json) continue;
            try {
                return { value: JSON.parse(json), error: '' };
            } catch (error) {
                return { value: null, error: `gbRawData 解析失败: ${error.message}` };
            }
        }
        return { value: null, error: '页面中未找到 window.gbRawData' };
    }

    function flattenSchema(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.flatMap(flattenSchema);
        if (Array.isArray(value['@graph'])) return value['@graph'].flatMap(flattenSchema);
        return [value];
    }

    function parseSchemas(scripts) {
        const result = [];
        for (const script of normalizeScripts(scripts)) {
            const candidate = script.id === 'goodsDetailSchema' || script.type === 'application/ld+json';
            if (!candidate || !script.content.trim()) continue;
            try {
                for (const node of flattenSchema(JSON.parse(script.content))) {
                    if (node?.['@type'] === 'ProductGroup' || Array.isArray(node?.hasVariant)) {
                        result.push(node);
                    }
                }
            } catch (_error) {
                // 面包屑等其他 JSON-LD 不影响商品解析。
            }
        }
        return result;
    }

    function goodsIdFromUrl(url) {
        const parsed = toUrl(url);
        return parsed?.searchParams.get('goods_id') || extractUrlGoodsId(url);
    }

    function pickSchema(schemas, goodsId) {
        return schemas.find((schema) => (
            goodsIdFromUrl(schema.url) === goodsId
            || (schema.hasVariant || []).some((item) => goodsIdFromUrl(item?.offers?.url) === goodsId)
        )) || schemas[0] || null;
    }

    function normalizeAttribute(value) {
        return {
            id: text(value?.attr_id),
            name: text(value?.attr_name || value?.attr_name_en),
            valueId: text(value?.attr_value_id),
            value: text(value?.attr_value_name || value?.attr_value_name_en),
        };
    }

    function pickMallEntry(entries, mallCode) {
        if (!Array.isArray(entries) || !entries.length) return null;
        return entries.find((item) => text(item.mall_code) === text(mallCode)) || entries[0];
    }

    function makeExactUrl(currentUrl, goodsId, skuCode, primarySpec) {
        const current = toUrl(currentUrl);
        if (!current) return currentUrl;
        const result = new URL(`${current.origin}/x-p-${goodsId}.html`);
        result.searchParams.set('mallCode', current.searchParams.get('mallCode') || '1');
        result.searchParams.set('goods_id', goodsId);
        result.searchParams.set('skucode', skuCode);
        if (primarySpec?.id && primarySpec?.valueId) {
            result.searchParams.set('main_attr', `${primarySpec.id}_${primarySpec.valueId}`);
        }
        return result.toString();
    }

    function makeConsistency(urlGoodsId, rawData, schema) {
        const modules = rawData?.modules || {};
        const ids = {
            url: text(urlGoodsId),
            canonical: text(rawData?.canonicalInfo?.goods_id),
            productInfo: text(modules.productInfo?.goods_id),
            saleAttribute: text(modules.saleAttr?.multiLevelSaleAttribute?.goods_id),
            schema: text(goodsIdFromUrl(schema?.url)),
        };
        const present = Object.values(ids).filter(Boolean);
        const unique = [...new Set(present)];
        return { ids, isConsistent: present.length > 0 && unique.length === 1, actualGoodsIds: unique };
    }

    function selectedSkuFromPage(url, selectedAttributes, variants) {
        if (variants.length === 1) return variants[0].skuCode;

        const selected = Array.from(selectedAttributes || []).map((item) => ({
            id: text(item.attrId ?? item.id),
            valueId: text(item.attrValueId ?? item.valueId),
            label: normalizeSpecLabel(item.label ?? item.value),
        }));
        const variantAttrIds = new Set(variants.flatMap((item) => (
            Array.from(item.attributes || []).map((attr) => text(attr.id)).filter(Boolean)
        )));
        const relevant = selected.filter((item) => (
            (item.id && variantAttrIds.has(item.id))
            || variants.some((variant) => Array.from(variant.attributes || []).some((attr) => (
                (item.valueId && text(attr.valueId) === item.valueId)
                || (item.label && normalizeSpecLabel(attr.value) === item.label)
            )))
        ));
        if (!relevant.length) return '';

        const matches = variants.filter((variant) => relevant.every((selection) => (
            Array.from(variant.attributes || []).some((attr) => (
                (!selection.id || text(attr.id) === selection.id)
                && (
                    (selection.valueId && text(attr.valueId) === selection.valueId)
                    || (selection.label && normalizeSpecLabel(attr.value) === selection.label)
                )
            ))
        )));
        return matches.length === 1 ? matches[0].skuCode : '';
    }

    function parseProductPage(input) {
        const url = text(input?.url);
        const parsedUrl = toUrl(url);
        const urlGoodsId = extractUrlGoodsId(url);
        if (!urlGoodsId) {
            return { ok: false, code: 'NOT_PRODUCT_PAGE', message: '当前页面不是 SHEIN 商品详情页' };
        }

        const site = detectSite(input?.hostname || parsedUrl?.hostname);
        const rawResult = parseRawData(input?.scripts);
        const rawData = rawResult.value;
        const schemas = parseSchemas(input?.scripts);
        const schema = pickSchema(schemas, urlGoodsId);
        const modules = rawData?.modules || {};
        const productInfo = modules.productInfo || {};
        const saleAttr = modules.saleAttr || {};
        const multiLevel = saleAttr.multiLevelSaleAttribute || {};
        const goodsId = text(productInfo.goods_id || rawData?.canonicalInfo?.goods_id || urlGoodsId);
        const mallCode = text(productInfo.selectedMallCode || parsedUrl?.searchParams.get('mallCode') || '1');
        const schemaMap = new Map((schema?.hasVariant || []).map((item) => [text(item.sku), item]));

        const relatedListings = Array.from(saleAttr.mainSaleAttribute?.info || []).map((item) => {
            const primarySpec = {
                id: text(item.attr_id),
                name: text(item.attr_name),
                valueId: text(item.attr_value_id),
                value: text(item.attr_value),
            };
            return {
                goodsId: text(item.goods_id),
                goodsSn: text(item.goods_sn),
                title: text(item.goods_url_name),
                primarySpec,
                color: primarySpec,
                isCurrent: text(item.goods_id) === goodsId,
            };
        });
        const currentListing = relatedListings.find((item) => item.isCurrent);
        const primaryAttrInfo = saleAttr.mainSaleAttribute || {};
        const currentPrimarySpec = currentListing?.primarySpec || {
            id: text(primaryAttrInfo.attr_id || LEGACY_COLOR_ATTR_ID),
            name: text(primaryAttrInfo.attr_name || (schema?.color ? 'Color' : '')),
            valueId: '',
            value: text(schema?.color),
        };

        const secondaryDefinitions = Array.from(multiLevel.skc_sale_attr || [])
            .filter((attr) => text(attr.attr_id) !== currentPrimarySpec.id);
        const secondaryDefinition = secondaryDefinitions[0] || null;
        const secondaryOrder = new Map();
        for (const attr of secondaryDefinitions) {
            (attr.attr_value_list || []).forEach((item, index) => {
                if (item?.attr_value_id) secondaryOrder.set(text(item.attr_value_id), index);
            });
        }

        let variants = Array.from(multiLevel.sku_list || []).map((sku) => {
            const skuCode = text(sku.sku_code);
            const attributes = Array.from(sku.sku_sale_attr || []).map(normalizeAttribute);
            const primarySpec = attributes.find((item) => item.id === currentPrimarySpec.id) || currentPrimarySpec;
            const secondarySpec = attributes.find((item) => (
                secondaryDefinition && item.id === text(secondaryDefinition.attr_id)
            )) || attributes.find((item) => item.id !== primarySpec.id) || null;
            const stockRecord = pickMallEntry(sku.mall_stock, sku.skuSelectedMallCode || mallCode);
            const stockText = text(stockRecord?.stock ?? sku.stock);
            const schemaVariant = schemaMap.get(skuCode);
            return {
                skuCode,
                uniqueKey: `${site}:${goodsId}:${skuCode}`,
                attributes,
                primarySpec,
                secondarySpec,
                color: primarySpec,
                size: secondarySpec,
                stockText,
                price: text(schemaVariant?.offers?.price),
                currency: text(schemaVariant?.offers?.priceCurrency),
                availability: text(schemaVariant?.offers?.availability).split('/').pop(),
                exactUrl: makeExactUrl(url, goodsId, skuCode, currentPrimarySpec),
            };
        });

        if (!variants.length && schema?.hasVariant) {
            variants = schema.hasVariant.map((item) => {
                const skuCode = text(item.sku);
                const schemaSize = text(item.size);
                const secondarySpec = schemaSize ? {
                    id: text(secondaryDefinition?.attr_id || LEGACY_SIZE_ATTR_ID),
                    name: text(secondaryDefinition?.attr_name || 'Size'),
                    valueId: '',
                    value: schemaSize,
                } : null;
                return {
                    skuCode,
                    uniqueKey: `${site}:${goodsId}:${skuCode}`,
                    attributes: secondarySpec ? [secondarySpec] : [],
                    primarySpec: currentPrimarySpec,
                    secondarySpec,
                    color: currentPrimarySpec,
                    size: secondarySpec,
                    stockText: '',
                    price: text(item?.offers?.price),
                    currency: text(item?.offers?.priceCurrency),
                    availability: text(item?.offers?.availability).split('/').pop(),
                    exactUrl: makeExactUrl(url, goodsId, skuCode, currentPrimarySpec),
                };
            });
        }

        variants.sort((left, right) => (
            (secondaryOrder.get(left.secondarySpec?.valueId) ?? Number.MAX_SAFE_INTEGER)
            - (secondaryOrder.get(right.secondarySpec?.valueId) ?? Number.MAX_SAFE_INTEGER)
        ));
        const selectedSkuCode = selectedSkuFromPage(url, input?.selectedAttributes, variants);
        const requestedSkuCode = text(parsedUrl?.searchParams.get('skucode'));
        const secondarySpec = {
            id: text(secondaryDefinition?.attr_id || variants.find((item) => item.secondarySpec)?.secondarySpec?.id),
            name: text(secondaryDefinition?.attr_name || variants.find((item) => item.secondarySpec)?.secondarySpec?.name),
        };
        variants = applyRenderedPriceSnapshot(variants, selectedSkuCode, input?.renderedPrice);
        variants = variants.map((item) => ({ ...item, isSelected: item.skuCode === selectedSkuCode }));
        const hasSecondarySpec = Boolean(secondaryDefinition || variants.some((item) => item.secondarySpec?.value));

        const consistency = makeConsistency(urlGoodsId, rawData, schema);
        const safeToUse = consistency.isConsistent && variants.some((item) => item.skuCode);
        const warnings = [];
        if (!rawData && rawResult.error) warnings.push(rawResult.error);
        if (!consistency.isConsistent) {
            warnings.push(`商品 ID 不一致：URL=${urlGoodsId}，页面数据=${consistency.actualGoodsIds.join('/') || '缺失'}。请刷新后重试。`);
        }
        if (!selectedSkuCode) warnings.push('当前未锁定型号，请先在商品页选择次规格。');

        return {
            ok: Boolean(rawData || schema),
            code: safeToUse ? 'OK' : consistency.isConsistent ? 'PARTIAL' : 'STALE_PRODUCT_DATA',
            source: rawData ? 'gbRawData' : schema ? 'JSON-LD' : 'none',
            safeToUse,
            site,
            url,
            capturedAt: new Date().toISOString(),
            consistency,
            warnings,
            requestedSkuCode: variants.some((item) => item.skuCode === requestedSkuCode) ? requestedSkuCode : '',
            selectedSkuCode,
            product: {
                goodsId,
                goodsSn: text(productInfo.goods_sn || multiLevel.goods_sn),
                title: text(productInfo.goods_name || schema?.name),
                productRelationId: text(productInfo.productRelationID || schema?.productGroupID),
                primarySpec: currentPrimarySpec,
                secondarySpec,
                hasSecondarySpec,
                color: currentPrimarySpec,
                mallCode,
            },
            relatedListings,
            variants,
        };
    }

    function createElement(tag, options = {}) {
        const node = document.createElement(tag);
        if (options.className) node.className = options.className;
        if (options.text !== undefined) node.textContent = String(options.text);
        if (options.title) node.title = options.title;
        if (options.type) node.type = options.type;
        if (options.disabled) node.disabled = true;
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([name, value]) => node.setAttribute(name, value));
        }
        return node;
    }

    function collectPageScripts() {
        return Array.from(document.scripts).map((script) => ({
            id: script.id,
            type: script.type,
            content: script.textContent || '',
        }));
    }

    function collectSelectedAttributes() {
        return Array.from(document.querySelectorAll('[role="radio"][aria-checked="true"]')).map((node) => ({
            attrId: node.getAttribute('data-attr_id') || '',
            attrValueId: node.getAttribute('data-size-radio') || node.getAttribute('data-attr_value_id') || '',
            label: node.getAttribute('aria-label') || node.textContent?.trim() || '',
        }));
    }

    function collectRenderedPagePrice() {
        const firstSpecOption = document.querySelector('[role="radio"]');
        const fallbackCurrency = detectSite(location.hostname) === 'MX' ? 'MXN' : 'USD';
        const candidates = [];

        for (const node of document.querySelectorAll('body *')) {
            if (stateHostContains(node)) continue;
            if (firstSpecOption) {
                const position = node.compareDocumentPosition(firstSpecOption);
                if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
            }
            if (!node.getClientRects().length) continue;
            const parsed = parseRenderedPriceText(node.innerText, fallbackCurrency);
            if (!parsed) continue;
            if (node.closest('del,s')) continue;
            const control = node.closest('button,a,[role="button"]');
            if (control && control !== node) continue;
            const context = text(node.parentElement?.innerText);
            if (context !== text(node.innerText)
                && /precio original|original price|ahorra|save|shein club/i.test(context)) continue;
            candidates.push(parsed);
        }

        return candidates[0] || null;
    }

    function stateHostContains(node) {
        return Boolean(document.getElementById(HOST_ID)?.contains(node));
    }

    function parseCurrentPage() {
        return parseProductPage({
            url: location.href,
            hostname: location.hostname,
            scripts: collectPageScripts(),
            selectedAttributes: collectSelectedAttributes(),
            renderedPrice: collectRenderedPagePrice(),
        });
    }

    function copyToClipboard(value, notify) {
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(value, 'text');
                notify('已复制');
                return;
            }
        } catch (_error) {
            // 继续使用浏览器剪贴板。
        }

        navigator.clipboard.writeText(value)
            .then(() => notify('已复制'))
            .catch(() => notify('复制失败，请手动复制', 'error'));
    }

    function readSavedPosition() {
        try {
            return typeof GM_getValue === 'function' ? GM_getValue(POSITION_KEY, null) : null;
        } catch (_error) {
            return null;
        }
    }

    function savePosition(value) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(POSITION_KEY, value);
        } catch (_error) {
            // 位置记忆失败不影响商品解析。
        }
    }

    function readSavedCouponRate() {
        try {
            const value = typeof GM_getValue === 'function' ? GM_getValue(COUPON_KEY, 0) : 0;
            return normalizeCouponRate(value);
        } catch (_error) {
            return 0;
        }
    }

    function saveCouponRate(value) {
        try {
            if (typeof GM_setValue === 'function') GM_setValue(COUPON_KEY, normalizeCouponRate(value));
        } catch (_error) {
            // 优惠券记忆失败不影响当次计算。
        }
    }

    function readAutoRefreshMarker() {
        try {
            const marker = JSON.parse(window.sessionStorage.getItem(AUTO_REFRESH_KEY) || 'null');
            if (!marker || !marker.key || !Number.isFinite(marker.at)) return null;
            if (Date.now() - marker.at > AUTO_REFRESH_MAX_AGE) {
                window.sessionStorage.removeItem(AUTO_REFRESH_KEY);
                return null;
            }
            return marker;
        } catch (_error) {
            return null;
        }
    }

    function saveAutoRefreshMarker(marker) {
        try {
            window.sessionStorage.setItem(AUTO_REFRESH_KEY, JSON.stringify(marker));
            return true;
        } catch (_error) {
            return false;
        }
    }

    function clearAutoRefreshMarker() {
        try {
            window.sessionStorage.removeItem(AUTO_REFRESH_KEY);
        } catch (_error) {
            // sessionStorage 不可用时不影响手动校验。
        }
    }

    function specSummary(spec) {
        const name = text(spec?.name).trim();
        const value = text(spec?.value).trim();
        if (name && value) return `${name}：${value}`;
        return value || name;
    }

    function variantSpecValues(result, variant) {
        const values = [
            text(variant?.primarySpec?.value || result?.product?.primarySpec?.value).trim(),
            text(variant?.secondarySpec?.value).trim(),
        ].filter(Boolean);
        return [...new Set(values)];
    }

    function variantModelLabel(result, variant) {
        return text(variant?.secondarySpec?.value || variant?.primarySpec?.value || result?.product?.primarySpec?.value).trim()
            || '单规格';
    }

    function variantFullModelLabel(result, variant) {
        return variantSpecValues(result, variant).join('/') || '单规格';
    }

    function buildOrderRemark(result, variant, couponRate = 0) {
        const specifications = variantSpecValues(result, variant).join(' / ') || '单规格';
        const purchasePrice = calculatePurchasePrice(variant.price, couponRate) || '-';
        return [
            variant.exactUrl || result.url || '-',
            specifications,
            purchasePrice,
        ].join('\n');
    }

    function styles() {
        return `
            :host { all: initial; }
            *, *::before, *::after { box-sizing: border-box; }
            button, select { font: inherit; }
            .xv-button { width:${BUTTON_WIDTH}px; height:${BUTTON_HEIGHT}px; display:flex; align-items:center; justify-content:center; gap:8px; border:1px solid rgba(255,255,255,.2); border-radius:999px; background:#111827; color:#fff; box-shadow:0 10px 28px rgba(15,23,42,.28); cursor:grab; user-select:none; touch-action:none; font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
            .xv-button:hover { background:#0f766e; transform:translateY(-1px); }
            .xv-button:focus-visible { outline:3px solid rgba(20,184,166,.35); outline-offset:2px; }
            .xv-button.is-dragging { cursor:grabbing; transform:scale(.98); }
            .xv-mark { width:24px; height:24px; display:grid; place-items:center; border-radius:8px; background:#14b8a6; color:#042f2e; font-weight:900; }
            .xv-panel { position:absolute; width:min(380px,calc(100vw - 24px)); max-height:min(720px,calc(100vh - 76px)); overflow:auto; border:1px solid #e5e7eb; border-radius:18px; background:#fff; color:#111827; box-shadow:0 22px 56px rgba(15,23,42,.24); font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; overscroll-behavior:contain; }
            .xv-panel[hidden] { display:none; }
            .xv-header { position:sticky; top:0; z-index:2; display:flex; justify-content:space-between; gap:16px; padding:16px 16px 12px; background:rgba(255,255,255,.96); border-bottom:1px solid #eef2f7; backdrop-filter:blur(10px); }
            .xv-eyebrow { color:#0f766e; font-size:10px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
            .xv-header h2 { margin:2px 0 0; font-size:18px; line-height:1.25; }
            .xv-actions { display:flex; gap:6px; }
            .xv-icon { width:30px; height:30px; border:1px solid #e5e7eb; border-radius:9px; background:#fff; color:#4b5563; cursor:pointer; font-size:18px; }
            .xv-icon:hover { background:#f3f4f6; color:#111827; }
            .xv-status { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px 6px; color:#6b7280; font-size:11px; }
            .xv-badge { padding:4px 8px; border-radius:999px; font-weight:700; }
            .xv-badge.ok { background:#ccfbf1; color:#115e59; }
            .xv-badge.warn { background:#ffedd5; color:#9a3412; }
            .xv-notice { margin:8px 16px 0; padding:10px 12px; border:1px solid #fed7aa; border-radius:10px; background:#fff7ed; color:#9a3412; }
            .xv-card { margin:12px 16px 0; padding:8px 12px; border:1px solid #e5e7eb; border-radius:14px; background:#f9fafb; }
            .xv-details { margin:12px 16px 0; border:1px solid #e5e7eb; border-radius:14px; background:#f9fafb; overflow:hidden; }
            .xv-details summary { padding:10px 12px; color:#475569; cursor:pointer; font-weight:750; list-style-position:inside; }
            .xv-details summary:hover { color:#0f766e; }
            .xv-details[open] summary { border-bottom:1px solid #e5e7eb; }
            .xv-details .xv-identification { margin:0; border:0; border-radius:0; }
            .xv-coupon { padding:12px; background:#fff; }
            .xv-coupon-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
            .xv-coupon-row label { color:#334155; font-weight:750; }
            .xv-coupon-select { min-width:132px; padding:7px 30px 7px 10px; border:1px solid #cbd5e1; border-radius:9px; background:#fff; color:#0f172a; cursor:pointer; }
            .xv-coupon-hint { margin:7px 0 0; color:#64748b; font-size:10px; }
            .xv-row { display:grid; grid-template-columns:84px minmax(0,1fr); gap:10px; padding:6px 0; border-bottom:1px dashed #e5e7eb; }
            .xv-row:last-child { border-bottom:0; }
            .xv-label { color:#6b7280; }
            .xv-value { min-width:0; overflow:hidden; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
            .mono, code { font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; }
            .xv-selected { background:linear-gradient(145deg,#f0fdfa,#f8fafc); border-color:#99f6e4; }
            .xv-section-label { color:#0f766e; font-size:11px; font-weight:800; }
            .xv-selected-title { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:6px; }
            .xv-selected-title strong { font-size:19px; }
            .xv-selected-title code { font-size:11px; }
            .xv-key { margin-top:4px; color:#475569; font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
            .xv-price-preview { margin-top:7px; color:#0f766e; font-size:11px; font-weight:700; }
            .xv-primary { width:100%; margin-top:10px; padding:9px 12px; border:0; border-radius:10px; background:#0f766e; color:#fff; cursor:pointer; font-weight:750; }
            .xv-primary:hover:not(:disabled) { background:#115e59; }
            .xv-primary:disabled { cursor:not-allowed; opacity:.45; }
            .xv-muted { margin:6px 0 0; color:#64748b; }
            .xv-variants { padding:14px 16px 0; }
            .xv-section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
            .xv-section-head span { color:#6b7280; font-size:11px; }
            .xv-list { border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
            .xv-variant { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 11px; border-bottom:1px solid #eef2f7; background:#fff; }
            .xv-variant:last-child { border-bottom:0; }
            .xv-variant.selected { background:#f0fdfa; }
            .xv-variant-main { min-width:0; }
            .xv-size { display:flex; align-items:center; gap:7px; }
            .xv-selected-tag { padding:2px 6px; border-radius:999px; background:#14b8a6; color:#042f2e; font-size:9px; font-weight:800; }
            .xv-stock-tag { padding:2px 6px; border-radius:999px; background:#fee2e2; color:#991b1b; font-size:9px; font-weight:800; }
            .xv-stock-warning { margin:8px 0 0; padding:8px 10px; border:1px solid #fecaca; border-radius:9px; background:#fef2f2; color:#991b1b; font-size:11px; font-weight:700; }
            .xv-meta { margin-top:2px; color:#6b7280; font-size:10px; }
            .xv-sku { display:block; margin-top:3px; color:#334155; font-size:10px; }
            .xv-copy { flex:0 0 auto; padding:6px 8px; border:1px solid #d1d5db; border-radius:8px; background:#fff; color:#374151; cursor:pointer; font-size:10px; font-weight:700; }
            .xv-copy:hover:not(:disabled) { border-color:#14b8a6; color:#0f766e; }
            .xv-copy:disabled { cursor:not-allowed; opacity:.45; }
            .xv-footnote { margin:12px 16px 16px; color:#94a3b8; font-size:10px; }
            .xv-empty { padding:28px 18px; text-align:center; color:#6b7280; }
            .xv-toast { position:absolute; left:50%; top:-42px; transform:translate(-50%,-8px); padding:7px 11px; border-radius:999px; background:#111827; color:#fff; opacity:0; pointer-events:none; transition:.16s ease; font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; white-space:nowrap; }
            .xv-toast.visible { opacity:1; transform:translate(-50%,0); }
            .xv-toast.error { background:#b91c1c; }
            @media (prefers-reduced-motion:reduce) { .xv-button,.xv-toast { transition:none; } }
        `;
    }

    function boot() {
        const state = {
            host: null,
            button: null,
            panel: null,
            toast: null,
            open: false,
            lastUrl: location.href,
            ignoreClick: false,
            parseTimer: 0,
            autoRefreshTimer: 0,
            restoreTimer: 0,
            requestedSkuTimer: 0,
            restoreNotice: '',
            requestedSkuCode: '',
            lastSelectedSecondarySpec: null,
            secondaryAttrId: '',
            couponRate: readSavedCouponRate(),
        };

        function rememberSelectedSecondarySpec(result) {
            const relationId = text(result?.product?.productRelationId);
            const selected = result?.variants?.find((item) => item.isSelected);
            state.secondaryAttrId = text(result?.product?.secondarySpec?.id);
            if (selected?.secondarySpec?.value || selected?.secondarySpec?.valueId) {
                state.lastSelectedSecondarySpec = {
                    relationId,
                    attrId: text(selected.secondarySpec.id),
                    valueId: text(selected.secondarySpec.valueId),
                    label: text(selected.secondarySpec.value),
                };
                return;
            }

            if (result?.safeToUse && state.lastSelectedSecondarySpec?.relationId !== relationId) {
                state.lastSelectedSecondarySpec = null;
            }
        }

        function rememberSelectedSecondarySpecFromDom() {
            const selected = collectSelectedAttributes().find((item) => (
                state.secondaryAttrId && text(item.attrId) === state.secondaryAttrId
            ));
            if (!selected?.attrValueId && !selected?.label) return;
            state.lastSelectedSecondarySpec = {
                relationId: text(state.lastSelectedSecondarySpec?.relationId),
                attrId: text(selected.attrId || state.secondaryAttrId),
                valueId: text(selected.attrValueId),
                label: text(selected.label).trim(),
            };
        }

        function automaticRefreshState(result) {
            const targetUrl = reconcilePreciseProductUrl(result);
            const key = productPageKey(targetUrl || location.href);
            const marker = readAutoRefreshMarker();

            if (!shouldAutoRefreshAfterPrimarySwitch(result)) {
                if (result.safeToUse && marker?.key === key) clearAutoRefreshMarker();
                return 'none';
            }

            if (state.autoRefreshTimer) return 'scheduled';
            if (marker?.key === key && (!marker.targetUrl || marker.targetUrl === targetUrl)) return 'attempted';
            const rememberedSpec = state.lastSelectedSecondarySpec || {};
            if (!saveAutoRefreshMarker({
                key,
                at: Date.now(),
                targetUrl,
                reopen: true,
                relationId: text(rememberedSpec.relationId),
                secondaryAttrId: text(rememberedSpec.attrId),
                secondaryValueId: text(rememberedSpec.valueId),
                secondaryLabel: text(rememberedSpec.label),
            })) return 'unavailable';

            state.autoRefreshTimer = window.setTimeout(() => {
                if (targetUrl && targetUrl !== location.href) window.location.replace(targetUrl);
                else window.location.reload();
            }, AUTO_REFRESH_DELAY);
            return 'scheduled';
        }

        function currentPosition() {
            return {
                left: Number.parseFloat(state.host?.style.left || '0'),
                top: Number.parseFloat(state.host?.style.top || '0'),
            };
        }

        function clamp(left, top) {
            return {
                left: Math.max(EDGE_GAP, Math.min(left, innerWidth - BUTTON_WIDTH - EDGE_GAP)),
                top: Math.max(EDGE_GAP, Math.min(top, innerHeight - BUTTON_HEIGHT - EDGE_GAP)),
            };
        }

        function positionPanel() {
            if (!state.panel) return;
            const { left, top } = currentPosition();
            const onLeft = left < innerWidth / 2;
            const onTop = top < innerHeight / 2;
            Object.assign(state.panel.style, {
                left: onLeft ? '0' : 'auto',
                right: onLeft ? 'auto' : '0',
                top: onTop ? '52px' : 'auto',
                bottom: onTop ? 'auto' : '52px',
            });
        }

        function setPosition(left, top, persist = false) {
            if (!state.host) return;
            const next = clamp(left, top);
            state.host.style.setProperty('left', `${next.left}px`, 'important');
            state.host.style.setProperty('top', `${next.top}px`, 'important');
            positionPanel();
            if (persist) savePosition(next);
        }

        function notify(message, tone = 'success') {
            if (!state.toast) return;
            state.toast.textContent = message;
            state.toast.classList.toggle('error', tone === 'error');
            state.toast.classList.add('visible');
            window.setTimeout(() => state.toast?.classList.remove('visible'), 1800);
        }

        function summaryRow(container, label, value, mono = false) {
            const row = createElement('div', { className: 'xv-row' });
            row.appendChild(createElement('span', { className: 'xv-label', text: label }));
            row.appendChild(createElement('span', {
                className: `xv-value${mono ? ' mono' : ''}`,
                text: value || '-',
                title: value || '',
            }));
            container.appendChild(row);
        }

        function renderVariant(result, variant) {
            const row = createElement('div', { className: `xv-variant${variant.isSelected ? ' selected' : ''}` });
            const main = createElement('div', { className: 'xv-variant-main' });
            const model = createElement('div', { className: 'xv-size' });
            const stockState = getVariantStockState(variant);
            model.appendChild(createElement('strong', { text: variantModelLabel(result, variant) }));
            if (variant.isSelected) model.appendChild(createElement('span', { className: 'xv-selected-tag', text: '已选' }));
            if (stockState === 'out_of_stock') {
                model.appendChild(createElement('span', { className: 'xv-stock-tag', text: '已售罄' }));
            } else if (stockState === 'unknown') {
                model.appendChild(createElement('span', { className: 'xv-stock-tag', text: '库存待确认' }));
            }
            main.appendChild(model);
            const meta = [];
            meta.push(variant.stockText ? `库存 ${variant.stockText}` : '库存未返回');
            if (variant.price) meta.push(`${variant.currency || ''} ${variant.price}`.trim());
            const purchasePrice = calculatePurchasePrice(variant.price, state.couponRate);
            if (purchasePrice) meta.push(`采购价 ${purchasePrice}`);
            main.appendChild(createElement('div', { className: 'xv-meta', text: meta.join(' · ') || '库存/价格未返回' }));
            main.appendChild(createElement('code', { className: 'xv-sku', text: variant.skuCode }));
            row.appendChild(main);

            const copy = createElement('button', {
                className: 'xv-copy',
                text: '复制备注',
                type: 'button',
                disabled: !canCopyVariant(result, variant),
                title: !result.safeToUse
                    ? '商品 ID 未通过校验'
                    : !variant.price
                        ? '页面售价未返回'
                        : stockState === 'out_of_stock'
                            ? '快照库存为 0，已禁止复制'
                            : stockState === 'unknown'
                                ? '库存未返回，已禁止复制'
                                : '复制该型号的店小秘订单备注',
            });
            copy.addEventListener('click', () => copyToClipboard(buildOrderRemark(result, variant, state.couponRate), notify));
            row.appendChild(copy);
            return row;
        }

        function render() {
            if (!state.panel) return;
            const result = parseCurrentPage();
            rememberSelectedSecondarySpec(result);
            const refreshState = automaticRefreshState(result);
            state.panel.replaceChildren();

            const header = createElement('div', { className: 'xv-header' });
            const title = createElement('div');
            title.appendChild(createElement('div', { className: 'xv-eyebrow', text: 'Xynigo · 小犀代采' }));
            title.appendChild(createElement('h2', { text: 'SHEIN 商品型号' }));
            header.appendChild(title);
            const actions = createElement('div', { className: 'xv-actions' });
            const refresh = createElement('button', { className: 'xv-icon', text: '↻', type: 'button', title: '重新解析' });
            refresh.addEventListener('click', render);
            const close = createElement('button', { className: 'xv-icon', text: '×', type: 'button', title: '收起' });
            close.addEventListener('click', closePanel);
            actions.append(refresh, close);
            header.appendChild(actions);
            state.panel.appendChild(header);

            if (!result.ok) {
                state.panel.appendChild(createElement('div', { className: 'xv-empty', text: result.message || '商品数据未载入' }));
                return;
            }

            const status = createElement('div', { className: 'xv-status' });
            status.appendChild(createElement('span', {
                className: `xv-badge ${result.safeToUse ? 'ok' : 'warn'}`,
                text: result.safeToUse ? 'ID 校验通过' : '需刷新校验',
            }));
            status.appendChild(createElement('span', { text: `来源 ${result.source}` }));
            state.panel.appendChild(status);
            if (refreshState === 'scheduled') {
                state.panel.appendChild(createElement('div', {
                    className: 'xv-notice',
                    text: '检测到主规格已切换，正在自动刷新页面并重新校验…',
                }));
            } else if (refreshState === 'attempted') {
                state.panel.appendChild(createElement('div', {
                    className: 'xv-notice',
                    text: '已自动刷新一次，但页面数据仍未同步。请稍后点击 ↻ 重新校验。',
                }));
            }
            for (const warning of result.warnings) {
                state.panel.appendChild(createElement('div', { className: 'xv-notice', text: warning }));
            }
            if (state.restoreNotice) {
                state.panel.appendChild(createElement('div', { className: 'xv-notice', text: state.restoreNotice }));
            }

            const identification = createElement('details', { className: 'xv-details' });
            identification.appendChild(createElement('summary', { text: '商品识别信息' }));
            const summary = createElement('section', { className: 'xv-card xv-identification' });
            summaryRow(summary, '站点', result.site);
            summaryRow(summary, 'goods_id', result.product.goodsId, true);
            summaryRow(summary, 'goods_sn', result.product.goodsSn, true);
            summaryRow(summary, '关系组', result.product.productRelationId, true);
            summaryRow(summary, '主规格', specSummary(result.product.primarySpec));
            summaryRow(summary, '次规格', result.product.hasSecondarySpec
                ? (result.product.secondarySpec?.name || '未命名')
                : '无（单规格）');
            identification.appendChild(summary);
            state.panel.appendChild(identification);

            const couponCard = createElement('section', { className: 'xv-card xv-coupon' });
            const couponRow = createElement('div', { className: 'xv-coupon-row' });
            couponRow.appendChild(createElement('label', { text: '买家号优惠券', attributes: { for: 'xv-coupon-select' } }));
            const couponSelect = createElement('select', {
                className: 'xv-coupon-select',
                attributes: { id: 'xv-coupon-select', 'aria-label': '选择买家号优惠券' },
            });
            COUPON_RATES.forEach((rate) => couponSelect.appendChild(createElement('option', {
                text: couponLabel(rate),
                attributes: { value: String(rate) },
            })));
            couponSelect.value = String(state.couponRate);
            couponSelect.addEventListener('change', () => {
                state.couponRate = normalizeCouponRate(couponSelect.value);
                saveCouponRate(state.couponRate);
                render();
            });
            couponRow.appendChild(couponSelect);
            couponCard.appendChild(couponRow);
            couponCard.appendChild(createElement('p', {
                className: 'xv-coupon-hint',
                text: `采购价 = 页面售价 × ${Math.round((1 - state.couponRate) * 100)}%`,
            }));
            state.panel.appendChild(couponCard);

            const selected = result.variants.find((item) => item.isSelected);
            const selectedCard = createElement('section', { className: 'xv-card xv-selected' });
            selectedCard.appendChild(createElement('div', { className: 'xv-section-label', text: '当前选中型号' }));
            if (selected && result.safeToUse) {
                const selectedStockState = getVariantStockState(selected);
                const selectedTitle = createElement('div', { className: 'xv-selected-title' });
                selectedTitle.appendChild(createElement('strong', { text: variantFullModelLabel(result, selected) }));
                selectedTitle.appendChild(createElement('code', { text: selected.skuCode }));
                selectedCard.appendChild(selectedTitle);
                selectedCard.appendChild(createElement('div', { className: 'xv-key', text: selected.uniqueKey }));
                selectedCard.appendChild(createElement('div', {
                    className: 'xv-price-preview',
                    text: selected.price
                        ? `快照库存 ${selected.stockText || '未返回'} · 页面售价 ${selected.price} → 采购价 ${calculatePurchasePrice(selected.price, state.couponRate)}`
                        : '页面售价未返回',
                }));
                if (selectedStockState !== 'in_stock') {
                    selectedCard.appendChild(createElement('div', {
                        className: 'xv-stock-warning',
                        text: selectedStockState === 'out_of_stock'
                            ? '快照库存为 0，当前型号已售罄，已禁止复制采购备注。'
                            : '库存未返回，无法确认可售，已禁止复制采购备注。',
                    }));
                }
                const copy = createElement('button', { className: 'xv-primary', text: '复制当前型号', type: 'button' });
                copy.disabled = !canCopyVariant(result, selected);
                copy.title = !selected.price
                    ? '页面售价未返回'
                    : selectedStockState === 'out_of_stock'
                        ? '快照库存为 0，已禁止复制'
                        : selectedStockState === 'unknown'
                            ? '库存未返回，已禁止复制'
                            : '复制当前型号的店小秘订单备注';
                copy.addEventListener('click', () => copyToClipboard(buildOrderRemark(result, selected, state.couponRate), notify));
                selectedCard.appendChild(copy);
            } else {
                selectedCard.appendChild(createElement('p', {
                    className: 'xv-muted',
                    text: result.safeToUse ? '请先在 SHEIN 页面选择次规格。' : '刷新页面并通过 ID 校验后才能复制。',
                }));
            }
            state.panel.appendChild(selectedCard);

            const variants = createElement('section', { className: 'xv-variants' });
            const variantsHeader = createElement('div', { className: 'xv-section-head' });
            const inStockCount = result.variants.filter((item) => getVariantStockState(item) === 'in_stock').length;
            variantsHeader.appendChild(createElement('strong', {
                text: result.product.hasSecondarySpec ? '次规格库存' : '单规格库存',
            }));
            variantsHeader.appendChild(createElement('span', { text: `可售 ${inStockCount}/${result.variants.length}` }));
            variants.appendChild(variantsHeader);
            const list = createElement('div', { className: 'xv-list' });
            result.variants.forEach((item) => list.appendChild(renderVariant(result, item)));
            variants.appendChild(list);
            state.panel.appendChild(variants);
            state.panel.appendChild(createElement('p', {
                className: 'xv-footnote',
                text: '页面售价和库存为当前快照；采购价按所选优惠券估算，下单前仍需以购物车为准。',
            }));
        }

        function openPanel() {
            state.open = true;
            state.panel.hidden = false;
            state.button.setAttribute('aria-expanded', 'true');
            positionPanel();
            render();
        }

        function closePanel() {
            state.open = false;
            state.panel.hidden = true;
            state.button.setAttribute('aria-expanded', 'false');
        }

        function scheduleRender() {
            if (!state.open) return;
            clearTimeout(state.parseTimer);
            state.parseTimer = window.setTimeout(render, 120);
        }

        function specOptionIdentity(node) {
            const source = node.closest('[data-size-radio],[data-attr_value_id],[data-attr_id]') || node;
            return {
                attrId: text(node.getAttribute('data-attr_id') || source.getAttribute('data-attr_id')),
                valueId: text(
                    node.getAttribute('data-size-radio')
                    || node.getAttribute('data-attr_value_id')
                    || source.getAttribute('data-size-radio')
                    || source.getAttribute('data-attr_value_id'),
                ),
                label: text(node.getAttribute('aria-label') || node.textContent).trim(),
            };
        }

        function markerSecondarySpec(marker) {
            return {
                attrId: text(marker.secondaryAttrId),
                valueId: text(marker.secondaryValueId || marker.sizeValueId),
                label: text(marker.secondaryLabel || marker.sizeLabel),
            };
        }

        function findSecondarySpecOption(marker) {
            const remembered = markerSecondarySpec(marker);
            const targetLabel = normalizeSpecLabel(remembered.label);
            return Array.from(document.querySelectorAll('[role="radio"]')).find((node) => {
                const identity = specOptionIdentity(node);
                const matchesAttr = !remembered.attrId || !identity.attrId || identity.attrId === remembered.attrId;
                const matchesValue = remembered.valueId && identity.valueId === remembered.valueId;
                const matchesLabel = targetLabel && normalizeSpecLabel(identity.label) === targetLabel;
                return matchesAttr && (matchesValue || matchesLabel) && node.getClientRects().length > 0;
            }) || null;
        }

        function ensureRequestedSkuSelection(attempt = 0) {
            const result = parseCurrentPage();
            const requestedSkuCode = result.requestedSkuCode || state.requestedSkuCode;
            if (!requestedSkuCode) return;
            state.requestedSkuCode = requestedSkuCode;

            if (!result.ok || !result.safeToUse) {
                if (attempt < RESTORE_RETRY_LIMIT) {
                    state.requestedSkuTimer = window.setTimeout(
                        () => ensureRequestedSkuSelection(attempt + 1),
                        250,
                    );
                }
                return;
            }

            const target = result.variants.find((item) => item.skuCode === requestedSkuCode);
            if (!target || !target.secondarySpec) return;
            if (target.isSelected) {
                state.restoreNotice = `已按精简链接定位型号：${variantFullModelLabel(result, target)}。`;
                scheduleRender();
                return;
            }

            const stockState = getVariantStockState(target);
            if (stockState !== 'in_stock') {
                state.restoreNotice = stockState === 'out_of_stock'
                    ? `精简链接对应的型号 ${variantFullModelLabel(result, target)} 快照库存为 0，已禁止复制采购备注。`
                    : '精简链接对应型号的库存未返回，请手动确认。';
                scheduleRender();
                return;
            }

            const option = findSecondarySpecOption({
                secondaryAttrId: target.secondarySpec.id,
                secondaryValueId: target.secondarySpec.valueId,
                secondaryLabel: target.secondarySpec.value,
            });
            if (!option) {
                if (attempt < RESTORE_RETRY_LIMIT) {
                    state.requestedSkuTimer = window.setTimeout(
                        () => ensureRequestedSkuSelection(attempt + 1),
                        250,
                    );
                } else {
                    state.restoreNotice = `未能自动定位精简链接中的型号 ${variantFullModelLabel(result, target)}，请手动选择。`;
                    scheduleRender();
                }
                return;
            }

            if (option.matches(':disabled') || option.getAttribute('aria-disabled') === 'true') {
                state.restoreNotice = `精简链接对应的型号 ${variantFullModelLabel(result, target)} 当前不可选。`;
                scheduleRender();
                return;
            }

            option.click();
            state.requestedSkuTimer = window.setTimeout(() => ensureRequestedSkuSelection(attempt + 1), 300);
        }

        function showRestoredPanel(message) {
            state.restoreNotice = message;
            if (!state.open) openPanel(); else render();
        }

        function restoreSecondarySpecAfterRefresh(marker, attempt = 0) {
            const remembered = markerSecondarySpec(marker);
            if (!remembered.valueId && !remembered.label) {
                window.setTimeout(() => {
                    if (state.host && !state.open) openPanel();
                }, 350);
                return;
            }

            const result = parseCurrentPage();
            if (!result.ok || !result.safeToUse) {
                if (attempt < RESTORE_RETRY_LIMIT) {
                    state.restoreTimer = window.setTimeout(() => restoreSecondarySpecAfterRefresh(marker, attempt + 1), 250);
                } else {
                    showRestoredPanel(`页面数据未就绪，未能恢复原选次规格 ${remembered.label || remembered.valueId}。`);
                }
                return;
            }

            if (marker.relationId
                && result.product.productRelationId
                && marker.relationId !== result.product.productRelationId) {
                showRestoredPanel('切换后已变为其他商品，未自动恢复原选次规格。');
                return;
            }

            const targetLabel = normalizeSpecLabel(remembered.label);
            const target = result.variants.find((item) => (
                (remembered.valueId && item.secondarySpec?.valueId === remembered.valueId)
                || (targetLabel && normalizeSpecLabel(item.secondarySpec?.value) === targetLabel)
            ));
            const displaySpec = target?.secondarySpec?.value || remembered.label || remembered.valueId;
            if (!target) {
                showRestoredPanel(`当前主规格没有原选次规格 ${displaySpec}，请重新选择。`);
                return;
            }

            const stockState = getVariantStockState(target);
            if (stockState !== 'in_stock') {
                showRestoredPanel(stockState === 'out_of_stock'
                    ? `原选次规格 ${displaySpec} 在当前主规格快照库存为 0，请改选有库存型号。`
                    : `原选次规格 ${displaySpec} 的库存未返回，请重新确认。`);
                return;
            }

            if (target.isSelected) {
                state.lastSelectedSecondarySpec = {
                    relationId: text(result.product.productRelationId),
                    attrId: text(target.secondarySpec?.id),
                    valueId: text(target.secondarySpec?.valueId),
                    label: text(target.secondarySpec?.value),
                };
                showRestoredPanel(`已恢复切换主规格前选择的次规格：${displaySpec}。`);
                return;
            }

            const option = findSecondarySpecOption(marker);
            if (!option) {
                if (attempt < RESTORE_RETRY_LIMIT) {
                    state.restoreTimer = window.setTimeout(() => restoreSecondarySpecAfterRefresh(marker, attempt + 1), 250);
                } else {
                    showRestoredPanel(`找到次规格 ${displaySpec}，但页面选项未就绪，请手动选择。`);
                }
                return;
            }

            if (option.matches(':disabled') || option.getAttribute('aria-disabled') === 'true') {
                showRestoredPanel(`原选次规格 ${displaySpec} 在当前主规格不可选，请改选有库存型号。`);
                return;
            }

            option.click();
            state.restoreTimer = window.setTimeout(() => restoreSecondarySpecAfterRefresh(marker, attempt + 1), 300);
        }

        function attachDrag() {
            let drag = null;
            state.button.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) return;
                const position = currentPosition();
                drag = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    left: position.left,
                    top: position.top,
                    moved: false,
                };
                state.button.setPointerCapture(event.pointerId);
                state.button.classList.add('is-dragging');
            });

            state.button.addEventListener('pointermove', (event) => {
                if (!drag || event.pointerId !== drag.pointerId) return;
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                if (Math.hypot(dx, dy) > 5) drag.moved = true;
                if (!drag.moved) return;
                event.preventDefault();
                setPosition(drag.left + dx, drag.top + dy);
            });

            const finish = (event) => {
                if (!drag || event.pointerId !== drag.pointerId) return;
                if (drag.moved) {
                    state.ignoreClick = true;
                    savePosition(currentPosition());
                }
                state.button.classList.remove('is-dragging');
                if (state.button.hasPointerCapture(event.pointerId)) state.button.releasePointerCapture(event.pointerId);
                drag = null;
            };
            state.button.addEventListener('pointerup', finish);
            state.button.addEventListener('pointercancel', finish);
            state.button.addEventListener('click', () => {
                if (state.ignoreClick) {
                    state.ignoreClick = false;
                    return;
                }
                if (state.open) closePanel(); else openPanel();
            });
        }

        function mount() {
            if (state.host || !isProductUrl(location.href)) return;
            const host = createElement('div', { attributes: { id: HOST_ID } });
            host.style.setProperty('all', 'initial', 'important');
            host.style.setProperty('position', 'fixed', 'important');
            host.style.setProperty('z-index', '2147483647', 'important');
            host.style.setProperty('width', '1px', 'important');
            host.style.setProperty('height', '1px', 'important');
            const shadow = host.attachShadow({ mode: 'open' });
            const style = createElement('style', { text: styles() });
            const button = createElement('button', {
                className: 'xv-button',
                type: 'button',
                title: '点击解析，按住可拖动',
                attributes: { 'aria-expanded': 'false', 'aria-label': '解析 SHEIN 商品型号' },
            });
            button.appendChild(createElement('span', { className: 'xv-mark', text: 'X' }));
            button.appendChild(createElement('span', { text: '解析商品型号' }));
            const panel = createElement('aside', { className: 'xv-panel', attributes: { 'aria-label': 'SHEIN 商品型号面板' } });
            panel.hidden = true;
            const toast = createElement('div', { className: 'xv-toast', attributes: { role: 'status' } });
            shadow.append(style, button, panel, toast);
            document.documentElement.appendChild(host);
            state.host = host;
            state.button = button;
            state.panel = panel;
            state.toast = toast;
            attachDrag();

            const stored = readSavedPosition();
            setPosition(stored?.left ?? innerWidth - BUTTON_WIDTH - 24, stored?.top ?? 180);

            const marker = readAutoRefreshMarker();
            if (marker?.reopen && marker.key === productPageKey(location.href)) {
                state.restoreTimer = window.setTimeout(() => restoreSecondarySpecAfterRefresh(marker), 350);
            }
            state.requestedSkuCode = text(toUrl(location.href)?.searchParams.get('skucode'));
            if (state.requestedSkuCode) {
                state.requestedSkuTimer = window.setTimeout(() => ensureRequestedSkuSelection(), 500);
            }
        }

        function unmount() {
            state.host?.remove();
            state.host = null;
            state.button = null;
            state.panel = null;
            state.toast = null;
            state.open = false;
            if (state.autoRefreshTimer) window.clearTimeout(state.autoRefreshTimer);
            state.autoRefreshTimer = 0;
            if (state.restoreTimer) window.clearTimeout(state.restoreTimer);
            state.restoreTimer = 0;
            if (state.requestedSkuTimer) window.clearTimeout(state.requestedSkuTimer);
            state.requestedSkuTimer = 0;
        }

        new MutationObserver((mutations) => {
            if (!mutations.some((item) => item.attributeName === 'aria-checked')) return;
            rememberSelectedSecondarySpecFromDom();
            state.restoreNotice = '';
            scheduleRender();
        }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['aria-checked'] });

        window.addEventListener('resize', () => {
            if (!state.host) return;
            const position = currentPosition();
            setPosition(position.left, position.top, true);
        });

        window.setInterval(() => {
            if (location.href === state.lastUrl) return;
            state.lastUrl = location.href;
            if (isProductUrl(location.href)) {
                mount();
                scheduleRender();
                state.requestedSkuCode = text(toUrl(location.href)?.searchParams.get('skucode'));
                if (state.requestedSkuCode) {
                    if (state.requestedSkuTimer) window.clearTimeout(state.requestedSkuTimer);
                    state.requestedSkuTimer = window.setTimeout(() => ensureRequestedSkuSelection(), 350);
                }
            } else {
                unmount();
            }
        }, 800);

        mount();
    }

    return {
        boot,
        detectSite,
        extractBalancedJson,
        extractUrlGoodsId,
        isProductUrl,
        productPageKey,
        reconcilePreciseProductUrl,
        shouldAutoRefreshAfterPrimarySwitch,
        shouldAutoRefreshAfterColorSwitch,
        normalizeSpecLabel,
        normalizeSizeLabel,
        getVariantStockState,
        canCopyVariant,
        makeExactUrl,
        selectedSkuFromPage,
        parseProductPage,
        calculatePurchasePrice,
        parseRenderedPriceText,
        applyRenderedPriceSnapshot,
        specSummary,
        variantSpecValues,
        variantModelLabel,
        variantFullModelLabel,
        buildOrderRemark,
    };
});
