(function () {
    'use strict';
    const helper = globalThis.XynigoSheinVariantHelper;
    const core = globalThis.XynigoPriceCompare;
    const availabilityReader = globalThis.XynigoPurchaseAvailability;
    const watcher = globalThis.XynigoPriceWatcher;
    const HOST = 'xynigo-shein-price-compare';
    if (!helper || !core || !availabilityReader || !watcher || globalThis.XynigoPriceCompareRunning) return;
    globalThis.XynigoPriceCompareRunning = true;

    // document_start 就读取 fragment，避免 SPA 初始化时清理元数据。
    let baseline = core.parseLink(location.href);
    let baselineHash = location.hash;
    let route = helper.productPageKey(location.href);
    let lastUrl = location.href;
    let host, shadow, observer;
    let enabled = baseline.ok;
    let collapsed = true;
    let scanTimer = null;
    let scanDue = Infinity;
    let lastScanAt = -Infinity;
    let burstUntil = Date.now() + 15000;
    let observed = false;
    let targets = new Set();
    let stability = null;
    let aligned = false;
    let selecting = false;
    let startedAt = Date.now();
    let lastDisplay = '';
    let availability = { state: 'unknown', title: '可售状态待确认', detail: '等待商品页面载入', blocking: false };
    let lastAlarm = '';
    let lastResult = { code: 'loading', message: '正在检查', comparable: false };
    let lastResultAt = Date.now();
    let openRequested = false;
    let dragging = false;
    let suppressHeaderClickUntil = 0;

    const formatMoney = (value) => (value / 100).toFixed(2);
    const setText = (selector, value) => { shadow.querySelector(selector).textContent = value; };
    const timeText = (timestamp) => new Date(timestamp).toLocaleString('zh-CN', { hour12: false });

    function reset() {
        stability = null;
        lastDisplay = '';
    }

    function applyBaseline(value) {
        baseline = value;
        enabled = value.ok;
        aligned = false;
        startedAt = Date.now();
        burstUntil = startedAt + 15000;
        lastAlarm = '';
        availability = { state: 'unknown', title: '可售状态待确认', detail: '等待重新核对当前商品', blocking: false };
        reset();
    }

    function syncUrl() {
        if (lastUrl === location.href) return;
        const newRoute = helper.productPageKey(location.href);
        const incoming = new URLSearchParams(location.hash.slice(1));
        if (incoming.has('xv') && location.hash !== baselineHash) {
            applyBaseline(core.parseLink(location.href));
            baselineHash = location.hash;
            collapsed = true;
        } else if (newRoute !== route && !incoming.has('xv') && !(enabled && baseline.ok && isErrorRoute())) {
            baseline = core.parseLink(location.href);
            baselineHash = location.hash;
            enabled = false;
            collapsed = true;
            lastAlarm = '';
            aligned = true;
            reset();
        }
        // 同一 fragment 下切 SKU/主规格时，保留原始基准，绝不把旧价格绑定到新型号。
        lastUrl = location.href;
        route = newRoute;
    }

    function align(snapshot) {
        if (!baseline.ok || !snapshot?.safeToUse || snapshot.site !== baseline.site
            || snapshot.product?.goodsId !== baseline.goodsId || String(snapshot.product.mallCode) !== baseline.mallCode) return false;
        const target = snapshot.variants.find((item) => item.skuCode === baseline.skuCode);
        if (!target) return false;
        if (target.isSelected) { aligned = true; return false; }
        if (helper.getVariantStockState(target) !== 'in_stock') return false;
        const option = helper.findVariantOption(target);
        if (!option) return false;
        aligned = true;
        reset();
        selecting = true;
        try { option.click(); } finally { selecting = false; }
        return true;
    }

    function render(result, now) {
        lastResult = result;
        lastResultAt = now;
        const ready = result.comparable && stability?.ready;
        const code = result.comparable && !ready ? 'settling' : result.code;
        const message = code === 'settling' ? '正在等待售价稳定' : result.message;
        const busy = enabled && (code === 'settling' || (code === 'loading' && now < burstUntil));
        const progress = busy && result.comparable && stability?.key
            ? Math.min(100, Math.floor(Math.max(0, now - stability.since) / core.STABILITY_WINDOW_MS * 100)) : null;
        const alarm = enabled && availability.blocking ? `${availability.state}:${baseline.skuCode || ''}`
            : enabled && ready && code === 'up' ? `up:${result.currentCents}` : '';
        if (alarm && alarm !== lastAlarm) { collapsed = false; lastAlarm = alarm; }
        if (ready && code !== 'up' && !availability.blocking) lastAlarm = '';
        const displayKey = JSON.stringify([baseline, code, result.currentCents, result.deltaCents, result.spec, collapsed, availability, enabled, busy, progress]);
        if (displayKey === lastDisplay) return;
        lastDisplay = displayKey;
        host.dataset.status = code;
        host.dataset.mode = enabled ? 'enabled' : 'idle';
        host.style.width = `min(${collapsed ? 232 : 340}px,calc(100vw - 32px))`;
        shadow.querySelector('.card').classList.toggle('compact', collapsed);
        shadow.querySelector('.card').dataset.tone = code;
        shadow.querySelector('.card').dataset.busy = String(busy);
        shadow.querySelector('.body').hidden = collapsed;
        shadow.querySelector('.body').setAttribute('aria-busy', String(busy));
        shadow.querySelector('.brand').setAttribute('aria-expanded', String(!collapsed));
        const toggle = shadow.querySelector('#toggle');
        toggle.textContent = !enabled ? '启用' : collapsed ? '详情' : '收起';
        toggle.setAttribute('aria-expanded', String(!collapsed));
        setText('#badge', !enabled ? '售价对比 · 未启用' : message);
        shadow.querySelector('#badge').title = message;
        setText('#title', message);
        const waiting = shadow.querySelector('#waiting');
        waiting.hidden = !busy;
        waiting.classList.toggle('indeterminate', progress === null);
        const track = shadow.querySelector('#waiting-track');
        shadow.querySelector('#waiting-fill').style.width = progress === null ? '' : `${progress}%`;
        if (progress === null) track.removeAttribute('aria-valuenow');
        else track.setAttribute('aria-valuenow', String(progress));
        const waitingText = progress === null ? '正在读取当前型号售价…'
            : `已连续稳定 ${(Math.max(0, now - stability.since) / 1000).toFixed(1)} / ${(core.STABILITY_WINDOW_MS / 1000).toFixed(1)} 秒`;
        setText('#waiting-label', waitingText);
        track.setAttribute('aria-valuetext', waitingText);
        shadow.querySelector('#availability').dataset.state = availability.state;
        setText('#availability-title', availability.title);
        setText('#availability-detail', availability.detail);
        setText('#original', baseline.ok ? `${formatMoney(baseline.originalCents)} ${baseline.currency}` : '—');
        setText('#current', ready ? `${formatMoney(result.currentCents)} ${baseline.currency}` : '—');
        const signed = result.deltaCents > 0 ? '+' : result.deltaCents < 0 ? '−' : '';
        setText('#delta', ready ? `${signed}${formatMoney(Math.abs(result.deltaCents))} ${baseline.currency} · ${signed}${Math.abs(result.percent).toFixed(2)}%` : '价格稳定且型号一致后显示差额');
        setText('#spec', baseline.ok ? baseline.spec : '请打开带审单售价的采购链接');
        setText('#sku', baseline.ok ? `SKU ${baseline.skuCode}` : '');
        setText('#captured', baseline.ok && baseline.capturedAt
            ? `审单采价：${timeText(baseline.capturedAt)}`
            : baseline.timeWarning || '审单采价：未记录（旧链接仍可比价）');
        setText('#checked', ready ? `本次比价：${timeText(now)}` : '');
        setText('#notice', ready
            ? result.code === 'up' ? '页面售价已上涨，请核对采购成本。' : '已核对链接型号的页面售价。'
            : availability.blocking ? availability.detail : message);
        shadow.querySelector('#locate').disabled = !enabled || !baseline.ok || availability.blocking;
        shadow.querySelector('#pause').hidden = !enabled;
    }

    function isErrorRoute() {
        return /\/(?:404|not-found|product-unavailable)(?:\.html)?\/?$/.test(location.pathname);
    }

    function showSurface() {
        return helper.isProductUrl(location.href) || (enabled && baseline.ok && isErrorRoute());
    }

    function openDetails() {
        if (!showSurface()) return false;
        if (!document.body) { openRequested = true; return true; }
        mount();
        host.hidden = false; host.style.display = 'block';
        collapsed = false;
        if (!enabled) {
            enabled = true;
            startedAt = Date.now(); burstUntil = startedAt + 15000;
            reset(); inspect();
        } else { lastDisplay = ''; render(lastResult, lastResultAt); }
        return true;
    }

    function closeDetails() {
        if (collapsed || !shadow) return;
        collapsed = true;
        lastDisplay = '';
        render(lastResult, lastResultAt);
    }

    function insidePlugin(event) {
        return Boolean(host && (event.composedPath?.().includes(host) || host.contains(event.target)));
    }

    function stopChecks() {
        if (scanTimer !== null) window.clearTimeout(scanTimer);
        scanTimer = null;
        scanDue = Infinity;
        observer?.disconnect();
        observed = false;
        targets = new Set();
    }

    function observe() {
        if (!enabled || document.hidden || observed) return;
        if (!observer) observer = new MutationObserver((records) => {
            if (records.some((record) => watcher.relevant(record, targets))) requestCheck();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ['aria-checked', 'aria-disabled', 'disabled', 'hidden', 'aria-hidden', 'inert', 'class', 'style'] });
        observed = true;
    }

    function schedule(delay) {
        if (!enabled || document.hidden || !showSurface()) return;
        const due = Date.now() + delay;
        if (scanTimer !== null && scanDue <= due) return;
        if (scanTimer !== null) window.clearTimeout(scanTimer);
        scanDue = due;
        scanTimer = window.setTimeout(() => {
            scanTimer = null;
            scanDue = Infinity;
            inspect();
        }, delay);
    }

    function requestCheck() {
        if (!enabled || document.hidden || !showSurface()) return;
        burstUntil = Date.now() + 15000;
        if (stability?.ready) reset();
        if (shadow) render({ code: 'settling', message: '正在重新核对页面', comparable: false }, Date.now());
        // 合并短时间内的事件；相关内容连续变化时完整检查最多每 500ms 一次。
        schedule(Math.max(200, lastScanAt + 500 - Date.now()));
    }

    function inspect() {
        syncUrl();
        if (!showSurface()) {
            stopChecks();
            if (host) { host.hidden = true; host.style.display = 'none'; }
            reset();
            return;
        }
        if (!document.body) return;
        mount();
        host.hidden = false;
        host.style.display = 'block';
        const now = Date.now();
        if (!enabled) {
            stopChecks();
            availability = { state: 'unknown', title: '检查尚未启用', detail: '点击启用后检查可售状态；粘贴原采购链接可对比价格', blocking: false };
            render({ code: 'idle', message: baseline.ok ? '本页检查已暂停' : '普通链接未自动检查', comparable: false }, now);
            return;
        }
        if (document.hidden) { stopChecks(); return; }
        observe();
        lastScanAt = now;
        let snapshot;
        let fast = false;
        try {
            try { snapshot = helper.readPageSnapshot({ strictPrice: true }); } catch { snapshot = { ok: false }; }
            availability = availabilityReader.read(snapshot, baseline);
            if (!availability.blocking && !aligned && now - startedAt < 15000 && align(snapshot)) {
                render({ code: 'settling', message: '正在定位链接型号并等待售价稳定', comparable: false }, now);
                fast = true;
            } else {
                if (snapshot.selectedSkuCode === baseline.skuCode) aligned = true;
                const result = core.compare(baseline, snapshot, availability);
                const identity = result.comparable ? `${baseline.goodsId}:${baseline.skuCode}:${baseline.currency}:${result.currentCents}` : '';
                if (identity && stability?.key !== identity) burstUntil = now + 15000;
                stability = core.settle(stability, identity, now);
                render(result, now);
                const waiting = !snapshot.ok || ['loading', 'price_missing', 'stale', 'sku_mismatch', 'sku_missing'].includes(result.code);
                fast = !availability.blocking && now < burstUntil && (waiting || (result.comparable && !stability.ready));
            }
            targets = watcher.captureTargets();
        } catch {
            reset();
            render({ code: 'error', message: '页面暂时无法解析，请稍后重新比价', comparable: false }, now);
        }
        schedule(fast ? 500 : 30000);
    }

    function mount() {
        if (host?.isConnected) return;
        host = document.createElement('aside');
        host.id = HOST;
        host.setAttribute('data-xynigo-price-compare', '');
        host.style.cssText = 'all:initial;position:fixed;right:16px;top:100px;z-index:2147483646;width:min(340px,calc(100vw - 32px));';
        shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
          <style>
            :host{color-scheme:light}*{box-sizing:border-box}[hidden]{display:none!important}
            .card{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#182c3a;background:#fff;border:1px solid #d5e3e8;border-radius:16px;box-shadow:0 14px 48px #102d3b24;overflow:hidden}
            header{background:#102d3b;color:white;padding:13px 16px;display:flex;align-items:center;gap:8px;cursor:grab;touch-action:none}
            .brand{font-size:13px;font-weight:750;flex:1;cursor:pointer}.brand span{color:#70dece;margin-right:8px}
            .brand:focus-visible{outline:2px solid #70dece;outline-offset:4px;border-radius:4px}
            .brand-mark{display:inline-block;vertical-align:middle}.brand-icon{display:block;width:24px;height:24px;object-fit:contain}
            button{font:inherit;cursor:pointer;border:1px solid #d6e2e7;background:#fff;color:#183f4d;border-radius:8px;padding:7px 10px}
            button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #1a9587;outline-offset:2px}
            header button{background:#ffffff10;border-color:#ffffff28;color:#fff;font-size:11px;padding:3px 8px}
            .body{padding:17px;max-height:calc(100vh - 185px);overflow:auto}
            #badge{display:block;font-size:11px;color:#bdced7;font-weight:400;margin-top:2px}
            .compact{border-radius:10px}.compact header{padding:8px 10px;cursor:pointer}
            .compact .brand{display:flex;align-items:center;gap:6px;min-width:0}
            .compact .brand-name{display:none}.compact .brand span{margin:0}
            .compact .brand-icon{width:20px;height:20px}
            .compact #badge{margin:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
            .activity{display:none;width:12px;height:12px;flex-shrink:0;vertical-align:middle;border:2px solid #ffffff35;border-top-color:#70dece;border-radius:50%;box-sizing:border-box}
            .card[data-busy=true] .activity{display:inline-block;animation:price-spin .85s linear infinite}
            #waiting{margin:0 0 13px;padding:11px;border-radius:9px;background:#eef8f8;color:#27777a}
            #waiting-label{font-size:11px;margin-bottom:8px}
            #waiting-track{height:5px;overflow:hidden;border-radius:5px;background:#cee6e5}
            #waiting-fill{height:100%;background:#20aeb3;border-radius:5px;transition:width .35s linear}
            .indeterminate #waiting-fill{width:35%;animation:price-sweep 1.3s ease-in-out infinite}
            @keyframes price-spin{to{transform:rotate(360deg)}}
            @keyframes price-sweep{from{transform:translateX(-110%)}to{transform:translateX(300%)}}
            @media(prefers-reduced-motion:reduce){.activity,#waiting-fill{animation:none!important;transition:none!important}}
            #pause{display:block;margin:10px 0 0 auto;padding:3px 0;border:0;color:#7b8e98;background:transparent;font-size:11px}
            #title{font-size:19px;line-height:1.3;font-weight:750;color:#56727f;margin:0 0 13px}
            [data-tone=up] #title,[data-tone=up] #delta{color:#c94336}[data-tone=up] #badge{color:#ffb0a3}
            [data-tone=down] #title,[data-tone=down] #delta{color:#16805f}[data-tone=down] #badge{color:#89e7ba}
            [data-tone=same] #title{color:#187b83}[data-tone=same] #badge{color:#70dece}
            [data-tone=sold_out] #title,[data-tone=delisted] #title,[data-tone=unavailable] #title,[data-tone=not_buyable] #title{color:#c94336}
            [data-tone=sold_out] #badge,[data-tone=delisted] #badge,[data-tone=unavailable] #badge,[data-tone=not_buyable] #badge{color:#ffb0a3}
            #availability{margin:0 0 13px;padding:10px 11px;border:1px solid #e4d7b4;border-radius:9px;background:#fffaf0;color:#8b6a20}
            #availability-title{display:block;font-size:12px;font-weight:700}#availability-detail{font-size:11px;line-height:1.5;margin-top:3px}
            #availability[data-state=available]{background:#edf9f3;border-color:#c3e7d6;color:#237458}
            #availability:is([data-state=sold_out],[data-state=delisted],[data-state=unavailable],[data-state=not_buyable]){background:#fff1ed;border-color:#f1c6bb;color:#b24334}
            .prices{display:grid;grid-template-columns:1fr 1fr;gap:9px}.price{padding:11px 10px;border-radius:10px;background:#f2f6f8}
            .label{font-size:11px;color:#647985}.price strong{display:block;font-size:19px;letter-spacing:-.5px;margin-top:4px;font-variant-numeric:tabular-nums}
            #delta{font-size:15px;font-weight:700;margin:12px 0}#spec{font-weight:600;word-break:break-word}#sku{font-size:10px;color:#69808b;overflow-wrap:anywhere}
            .times{color:#71818a;font-size:11px;border-top:1px solid #e7eef1;margin-top:12px;padding-top:11px}
            #notice{background:#f3f7f9;border-radius:8px;padding:9px 10px;margin:12px 0;color:#526b76;font-size:12px}
            [data-tone=up] #notice{background:#fff2ee;color:#a54437}.actions{display:flex;gap:8px}.actions button{flex:1}
            button:disabled{opacity:.45;cursor:default}details{margin-top:12px;font-size:11px;color:#687e88}summary{cursor:pointer}
            input{display:block;width:100%;margin:8px 0;padding:9px;border:1px solid #cddce2;border-radius:7px;font:12px/1.4 inherit}
            #import-error{color:#b54235;font-size:11px}.foot{margin:12px 0 0;font-size:10px;color:#82949d}
          </style>
          <section class="card" data-tone="loading">
            <header><div class="brand" role="button" tabindex="0" aria-label="打开采购售价对比详情" aria-controls="price-compare-details" aria-expanded="false"><span class="brand-mark">X</span><span class="brand-name">采购售价对比</span><span class="activity" aria-hidden="true"></span><small id="badge">读取页面中</small></div><button id="toggle" aria-expanded="false">详情</button></header>
            <div class="body" id="price-compare-details">
              <div id="title" role="status" aria-live="polite">读取页面中</div>
              <div id="waiting" hidden><div id="waiting-label"></div><div id="waiting-track" role="progressbar" aria-label="售价稳定进度" aria-valuemin="0" aria-valuemax="100"><div id="waiting-fill"></div></div></div>
              <div id="availability" data-state="unknown" role="status"><strong id="availability-title">可售状态待确认</strong><div id="availability-detail">等待商品页面载入</div></div>
              <div class="prices"><div class="price"><span class="label">审单页面售价</span><strong id="original">—</strong></div><div class="price"><span class="label">当前页面售价</span><strong id="current">—</strong></div></div>
              <div id="delta"></div><div id="spec"></div><div id="sku"></div>
              <div class="times"><div id="captured"></div><div id="checked"></div></div>
              <div id="notice"></div><div class="actions"><button id="refresh">重新比价</button><button id="locate">定位链接型号</button></div>
              <details><summary>换用原采购链接 / 补充链接</summary><label for="link">粘贴型号助手复制的一行采购链接</label><input id="link" type="url" autocomplete="off" placeholder="https://shein.com.mx/…#xv=1…"><button id="import">使用此链接比价</button><div id="import-error" role="status"></div></details>
              <button id="pause">暂停本页检查</button>
              <p class="foot">比较优惠券前页面售价 · 实付以购物车为准</p>
            </div>
          </section>`;
        document.body.appendChild(host);
        if (globalThis.XynigoPriceCompareIconData) {
            const icon = document.createElement('img');
            icon.className = 'brand-icon'; icon.alt = '';
            icon.src = globalThis.XynigoPriceCompareIconData;
            shadow.querySelector('.brand-mark').replaceChildren(icon);
        }
        shadow.querySelector('#toggle').addEventListener('click', (event) => {
            event.stopPropagation();
            if (!enabled || collapsed) openDetails(); else closeDetails();
        });
        shadow.querySelector('#refresh').addEventListener('click', () => {
            enabled = true; burstUntil = Date.now() + 15000; reset(); inspect();
        });
        shadow.querySelector('#pause').addEventListener('click', () => {
            enabled = false; collapsed = true; reset(); inspect();
        });
        shadow.querySelector('#locate').addEventListener('click', () => {
            reset();
            burstUntil = Date.now() + 15000;
            align(helper.readPageSnapshot({ strictPrice: true }));
            inspect();
        });
        shadow.querySelector('#import').addEventListener('click', () => {
            const value = core.parseLink(shadow.querySelector('#link').value);
            setText('#import-error', value.ok ? '' : value.message);
            if (!value.ok) return;
            applyBaseline(value);
            shadow.querySelector('#link').value = '';
            inspect();
        });
        const header = shadow.querySelector('header');
        header.addEventListener('click', (event) => {
            if (event.target.closest('button') || Date.now() < suppressHeaderClickUntil) return;
            openDetails();
        });
        shadow.querySelector('.brand').addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openDetails();
        });
        header.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const top = host.getBoundingClientRect().top;
            const startY = event.clientY, startX = event.clientX;
            let moved = false;
            dragging = true;
            header.setPointerCapture?.(event.pointerId);
            const move = (e) => {
                if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
                moved = true;
                const max = Math.max(12, innerHeight - Math.min(host.offsetHeight, innerHeight - 24) - 12);
                host.style.top = `${Math.max(12, Math.min(max, top + e.clientY - startY))}px`;
            };
            const end = () => {
                dragging = false;
                if (moved) suppressHeaderClickUntil = Date.now() + 400;
                header.removeEventListener('pointermove', move);
                header.removeEventListener('pointerup', end);
                header.removeEventListener('pointercancel', end);
                header.removeEventListener('lostpointercapture', end);
                if (header.hasPointerCapture?.(event.pointerId)) header.releasePointerCapture(event.pointerId);
            };
            header.addEventListener('pointermove', move);
            header.addEventListener('pointerup', end, { once: true });
            header.addEventListener('pointercancel', end, { once: true });
            header.addEventListener('lostpointercapture', end, { once: true });
        });
        lastDisplay = '';
    }

    function start() {
        inspect();
        if (openRequested) { openRequested = false; openDetails(); }
        const checkLocation = () => {
            if (location.href === lastUrl) return;
            stopChecks(); syncUrl(); reset(); burstUntil = Date.now() + 15000; inspect();
        };
        // 普通页面只比较 URL 字符串以发现 SPA 导航，不扫描 DOM/价格/库存。
        window.setInterval(checkLocation, 1000);
        document.addEventListener('pointerdown', (event) => {
            if (!selecting && !dragging && !insidePlugin(event)) closeDetails();
        }, true);
        document.addEventListener('click', (event) => {
            if (!selecting && !dragging && Date.now() >= suppressHeaderClickUntil && !insidePlugin(event)) closeDetails();
            if (enabled && !selecting && event.target?.closest?.('[role="radio"]')) {
                aligned = true;
                reset();
                if (shadow) render({ code: 'settling', message: '型号已切换，重新读取售价', comparable: false }, Date.now());
                requestCheck();
            }
        }, true);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopChecks();
            else if (enabled) { reset(); burstUntil = Date.now() + 15000; inspect(); }
        });
        window.addEventListener('pagehide', stopChecks);
        window.addEventListener('pageshow', () => { if (enabled && !document.hidden) { reset(); burstUntil = Date.now() + 15000; inspect(); } });
        window.addEventListener('popstate', checkLocation);
        window.addEventListener('hashchange', checkLocation);
    }
    globalThis.chrome?.runtime?.onMessage?.addListener((message, sender, respond) => {
        if (message?.type !== 'XYNIGO_PRICE_COMPARE_OPEN_DETAILS' || sender.id !== globalThis.chrome.runtime.id) return;
        respond({ ok: openDetails() });
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
