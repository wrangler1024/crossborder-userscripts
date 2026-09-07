(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.XynigoPurchaseAvailability = api;
})(globalThis, function () {
    'use strict';
    const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    const excluded = '[data-xynigo-price-compare],nav,header,footer,aside,[role="navigation"],'
        + '[class*="recommend"],[class*="Recommend"],[data-testid*="recommend"],[class*="similar"],'
        + '[class*="suggest"],[class*="review"],[class*="Review"]';
    const addLabel = /^(?:add to (?:bag|cart)|buy now|anadir (?:a la bolsa|al carrito)|agregar (?:a la bolsa|al carrito)|comprar ahora|加入购物袋|加入购物车|立即购买)$/;

    function status(state, title, detail, blocking = true) { return { state, title, detail, blocking }; }
    function unknown(detail = '尚未确认指定型号的购买状态') { return status('unknown', '可售状态待确认', detail, false); }

    function classifyText(value, allowShort = false) {
        const label = normalize(value).replace(/^[¡¿]/, '');
        if (!label || label.length > 220) return null;
        if (/(?:this (?:item|product).*(?:removed|discontinued)|este (?:articulo|producto).*(?:retirado|eliminado|descontinuado)|(?:该|此|当前)?商品.*(?:已下架|已停售))/.test(label)) {
            return status('delisted', '商品已下架', '页面明确提示商品已下架或停止销售');
        }
        if (/(?:(?:this|the) (?:item|product).*(?:sold out|out of stock)|este (?:articulo|producto).*(?:agotad[oa]|sin (?:stock|existencias))|(?:该|此|当前)商品.*(?:售罄|缺货))/.test(label)
            || (allowShort && /^(?:sold out|out of stock|agotad[oa]|sin (?:stock|existencias)|售罄|已售罄|缺货)[.!！。]?$/.test(label))) {
            return status('sold_out', '商品已售罄', '页面明确提示当前商品已售罄');
        }
        if (/(?:(?:this|the) (?:item|product).*(?:no longer available|not available|unavailable|cannot be (?:purchased|shipped))|este (?:articulo|producto).*(?:no (?:esta )?disponible|ya no esta disponible|no se puede comprar|no existe)|(?:该|此|当前)商品.*(?:不可售|无法购买|不可购买|不存在))/.test(label)
            || (allowShort && /^(?:unavailable|not available|no disponible|no esta disponible|暂不可售|暂不可购买)[.!！。]?$/.test(label))) {
            return status('unavailable', '商品不可售', '页面提示当前商品不可购买，请更换货源或人工核对');
        }
        return null;
    }

    function visible(node) {
        if (!node || node.closest(excluded) || !node.getClientRects().length) return false;
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
            const style = window.getComputedStyle(ancestor);
            if (ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true'
                || style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
    }

    function pageSignal() {
        if (!document.body) return null;
        // 只看主内容短文本/标题/状态区，不搜索整页文本、脚本或推荐卡片。
        const nodes = document.querySelectorAll('h1,h2,p,div,[role="alert"],[role="status"]');
        for (const node of nodes) {
            if (node.tagName === 'DIV' && node.children.length && !node.matches('[role="alert"],[role="status"]')) continue;
            const signal = classifyText(node.innerText || node.textContent, node.matches('h1,main > h2,[role="main"] > h2'));
            if (signal && visible(node)) return signal;
        }
        return null;
    }

    function purchaseControl(selectedRadio, singleSku = false) {
        if (!selectedRadio && !singleSku) return null;
        // 加购按钮必须位于当前规格附近，防止把推荐商品的按钮算作本商品状态。
        let scope = selectedRadio?.parentElement || document.body;
        for (let depth = 0; scope && (scope !== document.body || singleSku) && depth < 5; depth++, scope = scope.parentElement) {
            const buttons = Array.from(scope.querySelectorAll('button,[role="button"]')).filter((node) => {
                if (!visible(node) || node.getAttribute('role') === 'radio') return false;
                const label = normalize(node.innerText || node.textContent);
                return addLabel.test(label) || classifyText(label, true);
            });
            if (buttons.length === 1) return buttons[0];
            if (buttons.length > 1) return null;
            if (scope === document.body) break;
        }
        return null;
    }

    function read(snapshot, baseline) {
        const currentId = location.pathname.match(/-p-(\d+)\.html/)?.[1];
        if (baseline?.ok && currentId && currentId !== baseline.goodsId) return unknown('当前商品与采购链接不一致');
        const screen = pageSignal();
        if (screen) return screen;
        if (!snapshot?.ok || !snapshot.safeToUse) return unknown('商品页面仍在载入或需要验证，不能据此判定下架');
        if (baseline?.ok && (snapshot.site !== baseline.site || snapshot.product.goodsId !== baseline.goodsId
            || String(snapshot.product.mallCode) !== baseline.mallCode)) return unknown('当前商品或商城与采购链接不一致');
        const requested = baseline?.ok ? baseline.skuCode : new URL(location.href).searchParams.get('skucode') || snapshot.selectedSkuCode;
        const target = snapshot.variants.find((item) => item.skuCode === requested);
        if (!target) return unknown('未找到指定型号，不能据此判定商品已下架');
        const stock = target.stockText === '' || target.stockText == null ? NaN : Number(target.stockText);
        const schemaAvailability = normalize(target.availability);
        if (schemaAvailability.endsWith('discontinued')) return status('delisted', '指定型号已停售', '该型号的商品结构化数据标记为停止销售');
        if ((Number.isFinite(stock) && stock <= 0) || /(?:outofstock|soldout)$/.test(schemaAvailability)) {
            return status('sold_out', '指定型号已售罄', '采购链接对应型号的页面库存为 0，或页面数据标记售罄');
        }
        if (snapshot.selectedSkuCode !== requested || !target.isSelected) return unknown('请先定位采购链接中的型号');
        const radio = Array.from(document.querySelectorAll('[role="radio"][aria-checked="true"]')).find(visible);
        const button = purchaseControl(radio, snapshot.variants.length === 1);
        if (button) {
            const labelSignal = classifyText(button.innerText || button.textContent, true);
            if (labelSignal) return { ...labelSignal, title: labelSignal.state === 'sold_out' ? '指定型号已售罄' : labelSignal.title };
            if (button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true'
                || button.closest('[inert],.disabled,.is-disabled') || window.getComputedStyle(button).pointerEvents === 'none') {
                return status('not_buyable', '暂不可购买', '当前型号的加购按钮暂不可用，请核对规格、限购或页面提示');
            }
            return status('available', '页面可加购', '当前型号的页面加购按钮可用，实际库存以加购结果为准', false);
        }
        return unknown(Number.isFinite(stock) && stock > 0 ? '页面库存有货，尚未确认当前型号的加购按钮' : undefined);
    }

    return { classifyText, pageSignal, read };
});
