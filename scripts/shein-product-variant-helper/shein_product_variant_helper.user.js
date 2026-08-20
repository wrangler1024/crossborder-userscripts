// ==UserScript==
// @name         Xynigo SHEIN 商品型号助手
// @namespace    https://github.com/wrangler1024/crossborder-userscripts
// @version      0.1.0
// @description  在 SHEIN 商品页解析 goods_id、goods_sn、颜色、尺码和精确 sku_code，提供可拖动的悬浮按钮。
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
    const SIZE_ATTR_ID = '87';
    const COLOR_ATTR_ID = '27';
    const HOST_ID = 'xynigo-shein-variant-helper';
    const POSITION_KEY = 'xynigo-shein-variant-position-v1';
    const BUTTON_WIDTH = 146;
    const BUTTON_HEIGHT = 44;
    const EDGE_GAP = 12;

    function text(value) {
        return value === undefined || value === null ? '' : String(value);
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

    function findAttribute(attributes, id, namePattern) {
        return attributes.find((item) => item.id === id)
            || attributes.find((item) => namePattern.test(item.name))
            || null;
    }

    function pickMallEntry(entries, mallCode) {
        if (!Array.isArray(entries) || !entries.length) return null;
        return entries.find((item) => text(item.mall_code) === text(mallCode)) || entries[0];
    }

    function makeExactUrl(currentUrl, goodsId, skuCode, color) {
        const current = toUrl(currentUrl);
        if (!current) return currentUrl;
        const result = new URL(`${current.origin}${current.pathname}`);
        result.searchParams.set('mallCode', current.searchParams.get('mallCode') || '1');
        result.searchParams.set('goods_id', goodsId);
        result.searchParams.set('skucode', skuCode);
        if (color?.id && color?.valueId) {
            result.searchParams.set('main_attr', `${color.id}_${color.valueId}`);
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
        const fromUrl = text(toUrl(url)?.searchParams.get('skucode'));
        if (fromUrl && variants.some((item) => item.skuCode === fromUrl)) return fromUrl;

        const selectedSize = Array.from(selectedAttributes || []).find(
            (item) => text(item.attrId ?? item.id) === SIZE_ATTR_ID,
        );
        if (!selectedSize) return '';
        const selectedValueId = text(selectedSize.attrValueId ?? selectedSize.valueId);
        return variants.find((item) => item.size?.valueId === selectedValueId)?.skuCode || '';
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

        const relatedListings = Array.from(saleAttr.mainSaleAttribute?.info || []).map((item) => ({
            goodsId: text(item.goods_id),
            goodsSn: text(item.goods_sn),
            title: text(item.goods_url_name),
            color: {
                id: text(item.attr_id),
                name: text(item.attr_name),
                valueId: text(item.attr_value_id),
                value: text(item.attr_value),
            },
            isCurrent: text(item.goods_id) === goodsId,
        }));
        const currentListing = relatedListings.find((item) => item.isCurrent);
        const currentColor = currentListing?.color || {
            id: COLOR_ATTR_ID,
            name: 'Color',
            valueId: '',
            value: text(schema?.color),
        };

        const sizeOrder = new Map();
        for (const attr of multiLevel.skc_sale_attr || []) {
            if (text(attr.attr_id) !== SIZE_ATTR_ID) continue;
            (attr.attr_value_list || []).forEach((item, index) => {
                if (item?.attr_value_id) sizeOrder.set(text(item.attr_value_id), index);
            });
        }

        let variants = Array.from(multiLevel.sku_list || []).map((sku) => {
            const skuCode = text(sku.sku_code);
            const attributes = Array.from(sku.sku_sale_attr || []).map(normalizeAttribute);
            const size = findAttribute(attributes, SIZE_ATTR_ID, /size|尺码|talla/i);
            const color = findAttribute(attributes, COLOR_ATTR_ID, /color|颜色/i) || currentColor;
            const stockRecord = pickMallEntry(sku.mall_stock, sku.skuSelectedMallCode || mallCode);
            const stockText = text(stockRecord?.stock ?? sku.stock);
            const schemaVariant = schemaMap.get(skuCode);
            return {
                skuCode,
                uniqueKey: `${site}:${goodsId}:${skuCode}`,
                attributes,
                color,
                size,
                stockText,
                price: text(schemaVariant?.offers?.price),
                currency: text(schemaVariant?.offers?.priceCurrency),
                availability: text(schemaVariant?.offers?.availability).split('/').pop(),
                exactUrl: text(schemaVariant?.offers?.url)
                    || makeExactUrl(url, goodsId, skuCode, currentColor),
            };
        });

        if (!variants.length && schema?.hasVariant) {
            variants = schema.hasVariant.map((item) => {
                const skuCode = text(item.sku);
                const size = { id: SIZE_ATTR_ID, name: 'Size', valueId: '', value: text(item.size) };
                return {
                    skuCode,
                    uniqueKey: `${site}:${goodsId}:${skuCode}`,
                    attributes: [size],
                    color: currentColor,
                    size,
                    stockText: '',
                    price: text(item?.offers?.price),
                    currency: text(item?.offers?.priceCurrency),
                    availability: text(item?.offers?.availability).split('/').pop(),
                    exactUrl: text(item?.offers?.url) || makeExactUrl(url, goodsId, skuCode, currentColor),
                };
            });
        }

        variants.sort((left, right) => (
            (sizeOrder.get(left.size?.valueId) ?? Number.MAX_SAFE_INTEGER)
            - (sizeOrder.get(right.size?.valueId) ?? Number.MAX_SAFE_INTEGER)
        ));
        const selectedSkuCode = selectedSkuFromPage(url, input?.selectedAttributes, variants);
        variants = variants.map((item) => ({ ...item, isSelected: item.skuCode === selectedSkuCode }));

        const consistency = makeConsistency(urlGoodsId, rawData, schema);
        const safeToUse = consistency.isConsistent && variants.some((item) => item.skuCode);
        const warnings = [];
        if (!rawData && rawResult.error) warnings.push(rawResult.error);
        if (!consistency.isConsistent) {
            warnings.push(`商品 ID 不一致：URL=${urlGoodsId}，页面数据=${consistency.actualGoodsIds.join('/') || '缺失'}。请刷新后重试。`);
        }
        if (!selectedSkuCode) warnings.push('当前未锁定尺码，请先在商品页选择尺码。');

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
            selectedSkuCode,
            product: {
                goodsId,
                goodsSn: text(productInfo.goods_sn || multiLevel.goods_sn),
                title: text(productInfo.goods_name || schema?.name),
                productRelationId: text(productInfo.productRelationID || schema?.productGroupID),
                color: currentColor,
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

    function parseCurrentPage() {
        return parseProductPage({
            url: location.href,
            hostname: location.hostname,
            scripts: collectPageScripts(),
            selectedAttributes: collectSelectedAttributes(),
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

    function buildCopyText(result, variant) {
        return [
            `站点: ${result.site}`,
            `商品: ${result.product.title || '-'}`,
            `颜色: ${variant.color?.value || result.product.color?.value || '-'}`,
            `尺码: ${variant.size?.value || '-'}`,
            `goods_id: ${result.product.goodsId || '-'}`,
            `goods_sn: ${result.product.goodsSn || '-'}`,
            `sku_code: ${variant.skuCode || '-'}`,
            `唯一键: ${variant.uniqueKey || '-'}`,
            `采购链接: ${variant.exactUrl || result.url}`,
        ].join('\n');
    }

    function styles() {
        return `
            :host { all: initial; }
            *, *::before, *::after { box-sizing: border-box; }
            button { font: inherit; }
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
            .xv-primary { width:100%; margin-top:10px; padding:9px 12px; border:0; border-radius:10px; background:#0f766e; color:#fff; cursor:pointer; font-weight:750; }
            .xv-primary:hover { background:#115e59; }
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
        };

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
            const size = createElement('div', { className: 'xv-size' });
            size.appendChild(createElement('strong', { text: variant.size?.value || '未知尺码' }));
            if (variant.isSelected) size.appendChild(createElement('span', { className: 'xv-selected-tag', text: '已选' }));
            main.appendChild(size);
            const meta = [];
            if (variant.stockText) meta.push(`库存 ${variant.stockText}`);
            if (variant.price) meta.push(`${variant.currency || ''} ${variant.price}`.trim());
            main.appendChild(createElement('div', { className: 'xv-meta', text: meta.join(' · ') || '库存/价格未返回' }));
            main.appendChild(createElement('code', { className: 'xv-sku', text: variant.skuCode }));
            row.appendChild(main);

            const copy = createElement('button', {
                className: 'xv-copy',
                text: '复制链接',
                type: 'button',
                disabled: !result.safeToUse,
                title: result.safeToUse ? '复制精确到该尺码的采购链接' : '商品 ID 未通过校验',
            });
            copy.addEventListener('click', () => copyToClipboard(variant.exactUrl, notify));
            row.appendChild(copy);
            return row;
        }

        function render() {
            if (!state.panel) return;
            const result = parseCurrentPage();
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
            for (const warning of result.warnings) {
                state.panel.appendChild(createElement('div', { className: 'xv-notice', text: warning }));
            }

            const summary = createElement('section', { className: 'xv-card' });
            summaryRow(summary, '站点', result.site);
            summaryRow(summary, 'goods_id', result.product.goodsId, true);
            summaryRow(summary, 'goods_sn', result.product.goodsSn, true);
            summaryRow(summary, '关系组', result.product.productRelationId, true);
            summaryRow(summary, '颜色', result.product.color?.value);
            state.panel.appendChild(summary);

            const selected = result.variants.find((item) => item.isSelected);
            const selectedCard = createElement('section', { className: 'xv-card xv-selected' });
            selectedCard.appendChild(createElement('div', { className: 'xv-section-label', text: '当前选中型号' }));
            if (selected && result.safeToUse) {
                const selectedTitle = createElement('div', { className: 'xv-selected-title' });
                selectedTitle.appendChild(createElement('strong', { text: selected.size?.value || '-' }));
                selectedTitle.appendChild(createElement('code', { text: selected.skuCode }));
                selectedCard.appendChild(selectedTitle);
                selectedCard.appendChild(createElement('div', { className: 'xv-key', text: selected.uniqueKey }));
                const copy = createElement('button', { className: 'xv-primary', text: '复制当前型号', type: 'button' });
                copy.addEventListener('click', () => copyToClipboard(buildCopyText(result, selected), notify));
                selectedCard.appendChild(copy);
            } else {
                selectedCard.appendChild(createElement('p', {
                    className: 'xv-muted',
                    text: result.safeToUse ? '请先在 SHEIN 页面选择尺码。' : '刷新页面并通过 ID 校验后才能复制。',
                }));
            }
            state.panel.appendChild(selectedCard);

            const variants = createElement('section', { className: 'xv-variants' });
            const variantsHeader = createElement('div', { className: 'xv-section-head' });
            variantsHeader.appendChild(createElement('strong', { text: '可购尺码' }));
            variantsHeader.appendChild(createElement('span', { text: `${result.variants.length} 个 SKU` }));
            variants.appendChild(variantsHeader);
            const list = createElement('div', { className: 'xv-list' });
            result.variants.forEach((item) => list.appendChild(renderVariant(result, item)));
            variants.appendChild(list);
            state.panel.appendChild(variants);
            state.panel.appendChild(createElement('p', {
                className: 'xv-footnote',
                text: '库存和价格为当前页面快照；下单前仍需以 SHEIN 购物车为准。',
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
        }

        function unmount() {
            state.host?.remove();
            state.host = null;
            state.button = null;
            state.panel = null;
            state.toast = null;
            state.open = false;
        }

        new MutationObserver((mutations) => {
            if (mutations.some((item) => item.attributeName === 'aria-checked')) scheduleRender();
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
        parseProductPage,
    };
});
