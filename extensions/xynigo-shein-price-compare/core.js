(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.XynigoPriceCompare = api;
})(globalThis, function () {
    'use strict';
    const STABILITY_WINDOW_MS = 2200;

    function cents(value) {
        const text = String(value ?? '').trim();
        if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
        const [whole, fraction = ''] = text.split('.');
        const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        return Number.isSafeInteger(result) ? result : null;
    }

    function parseLink(value, now = Date.now()) {
        let url;
        try { url = new URL(String(value).trim()); } catch { return { ok: false, message: '请粘贴完整的采购链接' }; }
        const site = url.hostname === 'us.shein.com' ? 'US'
            : /(^|\.)shein\.com\.mx$/.test(url.hostname) ? 'MX' : '';
        if (url.protocol !== 'https:' || !site || url.username || url.password) {
            return { ok: false, message: '仅支持 SHEIN 墨西哥站或美国站 HTTPS 商品链接' };
        }
        const goodsId = url.pathname.match(/-p-(\d+)\.html/)?.[1];
        const skuCode = url.searchParams.get('skucode');
        const metadata = new URLSearchParams(url.hash.slice(1));
        if (!metadata.has('xv')) return { ok: false, message: '链接未带审单售价，请使用型号助手的“复制采购链接”' };
        if (metadata.get('xv') !== '1') return { ok: false, message: '采购链接格式版本暂不支持' };
        for (const key of ['xv', 'op', 'c', 'pt', 'p', 's', 'cr', 'gp']) {
            if (metadata.getAll(key).length > 1) return { ok: false, message: '采购链接含重复元数据，请重新复制' };
        }
        for (const key of ['goods_id', 'skucode', 'mallCode', 'main_attr']) {
            if (url.searchParams.getAll(key).length > 1) return { ok: false, message: '采购链接含重复型号参数，请重新复制' };
        }
        if (!goodsId || !skuCode || (url.searchParams.has('goods_id') && url.searchParams.get('goods_id') !== goodsId)) {
            return { ok: false, message: '采购链接的商品编号或 SKU 缺失、不一致' };
        }
        const originalCents = cents(metadata.get('op'));
        if (originalCents === null || originalCents <= 0) return { ok: false, message: '链接中的审单售价无效，无法比较' };
        const currency = metadata.get('c');
        if (currency !== (site === 'MX' ? 'MXN' : 'USD')) return { ok: false, message: '链接币种缺失或与站点不一致' };
        const rawTime = metadata.get('pt');
        const milliseconds = /^\d{10}$/.test(rawTime || '') ? Number(rawTime) * 1000 : NaN;
        const capturedAt = Number.isFinite(milliseconds) && milliseconds <= now + 300000 ? milliseconds : null;
        return {
            ok: true, url: url.toString(), site, goodsId, skuCode, currency, originalCents,
            mallCode: url.searchParams.get('mallCode') || '1', mainAttr: url.searchParams.get('main_attr') || '',
            spec: [metadata.get('p'), metadata.get('s')].filter(Boolean).join(' / ') || skuCode,
            capturedAt, timeWarning: rawTime && !capturedAt ? '链接采价时间无效' : '',
        };
    }

    function compare(baseline, snapshot, availability) {
        const blocked = (code, message) => ({ code, message, comparable: false });
        if (availability?.blocking) return blocked(availability.state, availability.title);
        if (!baseline?.ok) return blocked('missing', baseline?.message || '未读取到审单售价');
        if (!snapshot?.ok) return blocked('loading', '等待商品数据载入');
        if (snapshot.site !== baseline.site || snapshot.product?.goodsId !== baseline.goodsId) {
            return blocked('product_mismatch', '当前商品与采购链接不一致，请打开原采购链接');
        }
        if (!snapshot.safeToUse) return blocked('stale', '页面商品数据尚未同步，请刷新后重新核对');
        if (String(snapshot.product.mallCode) !== baseline.mallCode) return blocked('mall_mismatch', '当前商城与采购链接不一致');
        const primary = snapshot.product.primarySpec;
        if (baseline.mainAttr && primary?.id && primary?.valueId && `${primary.id}_${primary.valueId}` !== baseline.mainAttr) {
            return blocked('product_mismatch', '当前主规格与采购链接不一致');
        }
        const variant = snapshot.variants.find((item) => item.skuCode === baseline.skuCode);
        if (!variant) return blocked('sku_missing', '页面未找到链接中的型号，请核对商品');
        if (variant.stockText === '0' || variant.availability === 'OutOfStock') {
            return blocked('sold_out', '链接对应型号的页面库存显示售罄');
        }
        if (snapshot.selectedSkuCode !== baseline.skuCode || !variant.isSelected) {
            return blocked('sku_mismatch', '当前选中型号不同，请定位链接型号后比较');
        }
        if (variant.priceSource !== 'rendered' || cents(variant.price) === null || cents(variant.price) <= 0) {
            return blocked('price_missing', '未读到唯一的页面当前售价，请等待或手动核对');
        }
        if (variant.currency !== baseline.currency) return blocked('currency_mismatch', '当前售价币种与审单币种不一致');
        const currentCents = cents(variant.price);
        const deltaCents = currentCents - baseline.originalCents;
        return {
            comparable: true, code: deltaCents > 0 ? 'up' : deltaCents < 0 ? 'down' : 'same',
            message: deltaCents > 0 ? '售价上涨' : deltaCents < 0 ? '售价下降' : '售价未变',
            currentCents, deltaCents, percent: deltaCents / baseline.originalCents * 100,
            spec: [variant.primarySpec?.value, variant.secondarySpec?.value].filter(Boolean).join(' / '),
        };
    }

    // 连续采样而非固定延时后盲目放行；任何价格/型号变化都会重启稳定窗口。
    function settle(previous, identity, now) {
        if (!identity) return { key: '', since: now, ready: false };
        if (!previous || previous.key !== identity) return { key: identity, since: now, ready: false };
        return { ...previous, ready: now - previous.since >= STABILITY_WINDOW_MS };
    }

    return { cents, parseLink, compare, settle, STABILITY_WINDOW_MS };
});
