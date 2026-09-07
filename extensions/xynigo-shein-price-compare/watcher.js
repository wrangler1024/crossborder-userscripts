(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.XynigoPriceWatcher = api;
})(globalThis, function () {
    'use strict';
    const excluded = '[data-xynigo-price-compare],#xynigo-shein-variant-helper,nav,header,footer,aside,'
        + '[class*="recommend"],[class*="Recommend"],[class*="review"],[class*="Review"],[class*="similar"],[class*="suggest"]';
    const elementOf = (node) => node?.nodeType === 1 ? node : node?.parentElement;
    const isExcluded = (node) => Boolean(elementOf(node)?.closest(excluded));
    const purchaseText = (text) => /^(?:add to (?:bag|cart)|buy now|a[nñ]adir (?:a la bolsa|al carrito)|agregar (?:a la bolsa|al carrito)|comprar ahora|加入购物袋|加入购物车|立即购买)$/i.test(String(text || '').trim());
    const rawScript = (node) => node?.tagName === 'SCRIPT' && (node.type === 'application/ld+json'
        || node.id === 'goodsDetailSchema' || (node.textContent || '').includes('window.gbRawData'));
    const moneyText = (text) => {
        const value = String(text || '').trim();
        return value.length <= 80 && /^(?:US\$|\$MXN|MXN\$|\$)\s*[\d,]+(?:\.\d{1,2})?$/i.test(value.replace(/\s+/g, ''));
    };

    function captureTargets() {
        const targets = new Set();
        for (const node of document.querySelectorAll('[role="radio"],button,[role="button"],script')) {
            if (isExcluded(node)) continue;
            if (rawScript(node) || node.matches('[role="radio"]') || purchaseText(node.textContent)
                || globalThis.XynigoPurchaseAvailability.classifyText(node.textContent, true)) targets.add(node);
        }
        // 只在已启用的完整复核后记住价格节点；MutationObserver 不再重新遍历整页。
        if (!document.body) return targets;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        while ((textNode = walker.nextNode())) {
            const text = textNode.textContent.trim();
            if (!text || text.length > 220 || isExcluded(textNode)) continue;
            const parent = textNode.parentElement;
            if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName)) continue;
            if (globalThis.XynigoPurchaseAvailability.classifyText(text, parent.matches('h1,h2,[role="alert"],[role="status"]'))) targets.add(parent);
            if (!/[\d$]/.test(text) || text.length > 80) continue;
            for (const node of [parent, parent.parentElement]) {
                if (node && node !== document.body && moneyText(node.textContent)) targets.add(node);
            }
        }
        return targets;
    }

    function newSignal(node, descendants = true) {
        const element = elementOf(node);
        if (!element || isExcluded(node)) return false;
        if (rawScript(element) || element.matches('[role="radio"],[role="alert"],[role="status"]')) return true;
        if (element === document.body || element === document.documentElement) return false;
        const text = node.textContent || '';
        if (moneyText(text) || (text.length <= 220 && (purchaseText(text)
            || globalThis.XynigoPurchaseAvailability.classifyText(text, element.matches('h1,h2,button,[role="button"]'))))) return true;
        // 新商品区域整体换入时，只查询有明确语义的控件，不读大块正文。
        return descendants && node.nodeType === 1 && Boolean(node.querySelector('[role="radio"],[role="alert"],[role="status"],script[type="application/ld+json"]'));
    }

    function relevant(record, targets) {
        if (isExcluded(record.target)) return false;
        const target = elementOf(record.target);
        if (!target) return false;
        for (const tracked of targets) {
            if (tracked === target || tracked.contains(target)) return true;
            if (record.type === 'attributes' && target !== document.body && target !== document.documentElement && target.contains(tracked)) return true;
        }
        if (newSignal(record.target, false)) return true;
        for (const node of [...(record.addedNodes || []), ...(record.removedNodes || [])]) {
            if (isExcluded(node)) continue;
            for (const tracked of targets) if (node === tracked || node.contains?.(tracked)) return true;
            if (newSignal(node)) return true;
        }
        return false;
    }
    return { captureTargets, relevant };
});
