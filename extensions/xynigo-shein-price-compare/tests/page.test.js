'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '../../..');
const fixture = fs.readFileSync(path.join(root, 'scripts/shein-product-variant-helper/tests/fixtures/us-product-312187195.html'), 'utf8');
const helperCode = fs.readFileSync(path.join(root, 'scripts/shein-product-variant-helper/shein_product_variant_helper.user.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(__dirname, '../core.js'), 'utf8');
const availabilityCode = fs.readFileSync(path.join(__dirname, '../availability.js'), 'utf8');
const watcherCode = fs.readFileSync(path.join(__dirname, '../watcher.js'), 'utf8');
const contentCode = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const baseUrl = 'https://shein.com.mx/x-p-312187195.html?goods_id=312187195&skucode=I3c0auhysow1&mallCode=1#xv=1&op=100.00&c=MXN&p=Black&s=11Y';

function page(t, options = {}) {
    const dom = new JSDOM(fixture, { url: options.url || baseUrl, runScripts: 'outside-only' });
    t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); });
    const w = dom.window;
    w.document.body.innerHTML = `<div><del>$MXN200.00</del></div><div style="text-decoration:line-through">$MXN180.00</div><div id="price">$MXN110.00</div>
        <button role="radio" aria-checked="false" data-attr_id="87" data-size-radio="1009391">11Y</button>
        <button role="radio" aria-checked="true" data-attr_id="87" data-size-radio="1009392">12Y</button>`;
    if (options.body) w.document.body.innerHTML = options.body;
    if (options.noData) Array.from(w.document.scripts).forEach((script) => script.remove());
    Object.defineProperty(w.document, 'readyState', { get: () => 'complete' });
    // jsdom 没有布局及 innerText，用可见脱敏节点的 textContent 模拟浏览器返回值。
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    w.HTMLElement.prototype.getClientRects = function () { return this.hidden || this.style.display === 'none' ? [] : [{ width: 100, height: 20 }]; };
    for (const radio of w.document.querySelectorAll('[role=radio]')) radio.addEventListener('click', () => {
        for (const option of w.document.querySelectorAll('[role=radio]')) option.setAttribute('aria-checked', String(option === radio));
    });
    let now = Date.parse('2026-09-07T02:00:00Z');
    w.Date.now = () => now;
    let hidden = false;
    Object.defineProperty(w.document, 'hidden', { get: () => hidden });
    const timers = new Map();
    let timerId = 0;
    w.setInterval = (fn, interval) => { const id = ++timerId; timers.set(id, { fn, due: now + interval, interval }); return id; };
    w.clearInterval = (id) => timers.delete(id);
    w.setTimeout = (fn, delay = 0) => { const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id; };
    w.clearTimeout = (id) => timers.delete(id);
    const observers = [];
    const NativeObserver = w.MutationObserver;
    w.MutationObserver = class extends NativeObserver {
        constructor(callback) { super(callback); observers.push({ observer: this, callback }); }
    };
    const messageHandlers = [];
    w.chrome = { runtime: { id: 'xynigo-test', onMessage: { addListener: (handler) => messageHandlers.push(handler) } } };
    w.XynigoSheinVariantLibraryOnly = true;
    w.eval(helperCode);
    w.eval(coreCode);
    w.eval(availabilityCode);
    w.eval(watcherCode);
    let scans = 0;
    let availabilityReads = 0;
    const read = w.XynigoSheinVariantHelper.readPageSnapshot;
    w.XynigoSheinVariantHelper.readPageSnapshot = (...args) => { scans++; return read(...args); };
    const readAvailability = w.XynigoPurchaseAvailability.read;
    w.XynigoPurchaseAvailability.read = (...args) => { availabilityReads++; return readAvailability(...args); };
    w.eval(contentCode);
    function flushMutations() {
        for (let i = 0; i < 20; i++) {
            let any = false;
            for (const item of observers) {
                const records = item.observer.takeRecords();
                if (records.length) { any = true; item.callback(records); }
            }
            if (!any) break;
        }
    }
    function tick(ms = 1000) {
        flushMutations();
        const end = now + ms;
        for (let count = 0; count < 10000; count++) {
            const next = [...timers.entries()].filter(([, task]) => task.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
            if (!next) break;
            const [id, task] = next; now = task.due;
            if (task.interval) task.due += task.interval; else timers.delete(id);
            task.fn(); flushMutations();
        }
        now = end;
    }
    const host = w.document.getElementById('xynigo-shein-price-compare');
    return { w, tick, host, ui: host.shadowRoot,
        counts: () => ({ scans, availabilityReads, observers: observers.length }),
        resetCounts: () => { scans = 0; availabilityReads = 0; },
        setHidden: (value) => { hidden = value; w.document.dispatchEvent(new w.Event('visibilitychange')); },
        toolbarOpen: (senderId = 'xynigo-test') => {
            let response;
            for (const handler of messageHandlers) handler({ type: 'XYNIGO_PRICE_COMPARE_OPEN_DETAILS' }, { id: senderId }, (value) => { response = value; });
            return response;
        },
    };
}

test('independent extension selects requested SKU and ignores crossed-out prices', (t) => {
    const p = page(t);
    assert.equal(p.w.document.getElementById('xynigo-shein-variant-helper'), null);
    assert.equal(p.w.document.querySelector('[aria-checked=true]').textContent, '11Y');
    p.tick(); p.tick(2300);
    assert.equal(p.host.dataset.status, 'up');
    assert.equal(p.ui.querySelector('#original').textContent, '100.00 MXN');
    assert.equal(p.ui.querySelector('#current').textContent, '110.00 MXN');
    assert.match(p.ui.querySelector('#delta').textContent, /\+10.00 MXN.*\+10.00%/);
});

test('live price changes invalidate old result and must settle again', (t) => {
    const p = page(t); p.tick(); p.tick(2300);
    p.w.document.getElementById('price').textContent = '$MXN90.00'; p.tick(1);
    assert.equal(p.host.dataset.status, 'settling');
    assert.equal(p.ui.querySelector('#current').textContent, '—');
    p.tick(3000);
    assert.equal(p.host.dataset.status, 'down');
    p.w.document.getElementById('price').remove(); p.tick();
    assert.equal(p.host.dataset.status, 'price_missing');
});

test('manual variant changes never reuse baseline price or force the user back', (t) => {
    const p = page(t); p.tick(); p.tick(2300);
    p.w.document.querySelector('[data-size-radio="1009392"]').click(); p.tick(3000);
    assert.equal(p.host.dataset.status, 'sku_mismatch');
    assert.equal(p.w.document.querySelector('[aria-checked=true]').textContent, '12Y');
    p.w.history.replaceState(null, '', baseUrl.replace('skucode=I3c0auhysow1', 'skucode=I3c0auhz2ddh'));
    p.tick(3000);
    assert.equal(p.host.dataset.status, 'sku_mismatch');
    p.ui.querySelector('#locate').click(); p.tick(2300);
    assert.equal(p.host.dataset.status, 'up');
});

test('missing metadata has no invented baseline; pasting an original link recovers it', (t) => {
    const p = page(t, { url: baseUrl.split('#')[0] }); p.tick(4000);
    assert.equal(p.host.dataset.status, 'idle');
    p.ui.querySelector('#link').value = baseUrl;
    p.ui.querySelector('#import').click(); p.tick(); p.tick(2300);
    assert.equal(p.host.dataset.status, 'up');
    p.w.history.replaceState(null, '', baseUrl.split('#')[0]); p.tick();
    assert.equal(p.host.dataset.status, 'up');
});

test('multiple different sale prices are unverified rather than arbitrarily picking one', (t) => {
    const p = page(t);
    const extra = p.w.document.createElement('div'); extra.textContent = '$MXN99.00';
    p.w.document.getElementById('price').before(extra);
    p.tick(); p.tick(4000);
    assert.equal(p.host.dataset.status, 'price_missing');
});

test('an original-price sibling does not incorrectly exclude the current sale price', (t) => {
    const p = page(t);
    const section = p.w.document.createElement('section');
    const price = p.w.document.getElementById('price');
    price.before(section);
    section.appendChild(price);
    const original = p.w.document.createElement('div');
    original.innerHTML = 'Precio original <del>$MXN200.00</del>';
    section.appendChild(original);
    p.tick(); p.tick(2300);
    assert.equal(p.host.dataset.status, 'up');
    assert.equal(p.ui.querySelector('#current').textContent, '110.00 MXN');
});

test('collapse keeps live status and baseline specification is rendered as text', (t) => {
    const p = page(t, { url: baseUrl.replace('p=Black', 'p=%3Cimg%20src=x%20onerror=alert(1)%3E') });
    p.tick(); p.tick(2300);
    assert.equal(p.ui.querySelector('#spec img'), null);
    p.ui.querySelector('#toggle').click();
    assert.equal(p.ui.querySelector('.body').hidden, true);
    p.w.document.getElementById('price').textContent = '$MXN100.00'; p.tick(); p.tick(2300);
    assert.equal(p.ui.querySelector('#badge').textContent, '售价未变');
});

function changeStock(p, skuCode, stock) {
    const script = p.w.document.scripts[0];
    const data = JSON.parse(p.w.XynigoSheinVariantHelper.extractBalancedJson(script.textContent, 'window.gbRawData = '));
    const sku = data.modules.saleAttr.multiLevelSaleAttribute.sku_list.find((item) => item.sku_code === skuCode);
    sku.stock = String(stock);
    sku.mall_stock[0].stock = String(stock);
    script.textContent = 'window.gbRawData = ' + JSON.stringify(data) + ';';
}

function buyButton(p, label = 'AÑADIR A LA BOLSA') {
    const section = p.w.document.createElement('section');
    p.w.document.body.appendChild(section);
    for (const radio of p.w.document.querySelectorAll('[role=radio]')) section.appendChild(radio);
    const button = p.w.document.createElement('button'); button.textContent = label; section.appendChild(button);
    return button;
}

test('target SKU becoming sold out overrides price and expands the warning; recovery clears it', (t) => {
    const p = page(t); p.tick(); p.tick(2300);
    p.ui.querySelector('#toggle').click();
    changeStock(p, 'I3c0auhysow1', 0); p.tick();
    assert.equal(p.host.dataset.status, 'sold_out');
    assert.equal(p.ui.querySelector('#availability-title').textContent, '指定型号已售罄');
    assert.equal(p.ui.querySelector('#current').textContent, '—');
    assert.equal(p.ui.querySelector('.body').hidden, false);
    changeStock(p, 'I3c0auhysow1', 20); p.tick(); p.tick(2300);
    assert.equal(p.host.dataset.status, 'up');
});

test('another SKU being sold out does not mark the requested SKU unsellable', (t) => {
    const p = page(t); changeStock(p, 'I3c0auhz2ddh', 0); p.tick(); p.tick(2300);
    assert.equal(p.host.dataset.status, 'up');
    assert.equal(p.ui.querySelector('#availability').dataset.state, 'unknown');
});

test('explicit product unavailable page works without product JSON or price metadata', (t) => {
    const p = page(t, { url: baseUrl.split('#')[0], noData: true,
        body: '<main><h1>Lo sentimos, este artículo ya no está disponible.</h1></main>' });
    assert.equal(p.host.dataset.status, 'idle');
    assert.equal(p.counts().scans, 0);
    p.ui.querySelector('#toggle').click();
    assert.equal(p.host.dataset.status, 'unavailable');
    assert.equal(p.ui.querySelector('.body').hidden, false);
    assert.equal(p.ui.querySelector('#availability-title').textContent, '商品不可售');
});

test('disabled buy button is temporarily unbuyable, not sold out, and updates on recovery', (t) => {
    const p = page(t); const button = buyButton(p); p.tick(); p.tick(2300);
    assert.equal(p.ui.querySelector('#availability').dataset.state, 'available');
    button.disabled = true; p.tick();
    assert.equal(p.host.dataset.status, 'not_buyable');
    assert.equal(p.ui.querySelector('#title').textContent, '暂不可购买');
    button.disabled = false; button.setAttribute('aria-disabled', 'true'); p.tick();
    assert.equal(p.host.dataset.status, 'not_buyable');
    button.removeAttribute('aria-disabled'); p.tick(); p.tick(2300);
    assert.equal(p.host.dataset.status, 'up');
});

test('live Spanish sold-out purchase label overrides stale positive snapshot stock', (t) => {
    const p = page(t); buyButton(p, '¡Agotado!'); p.tick();
    assert.equal(p.host.dataset.status, 'sold_out');
});

test('recommendation, review, hidden and script text cannot produce a product-unavailable alert', (t) => {
    const p = page(t, { noData: true, body: `<main><h1>Verify you are human</h1>
        <div class="recommend-products"><p>This product is no longer available.</p></div>
        <div class="review"><p>This item is sold out.</p></div>
        <p hidden>Este producto ha sido retirado.</p>
        <div style="display:none"><p>This item is unavailable.</p></div>
        <script type="application/json">{"text":"This item is sold out."}</script></main>` });
    p.tick(5000);
    assert.equal(p.host.dataset.status, 'loading');
    assert.equal(p.ui.querySelector('#availability').dataset.state, 'unknown');
});

test('an explicit unavailable error after SPA redirect keeps the warning visible', (t) => {
    const p = page(t);
    const main = p.w.document.createElement('main'); main.innerHTML = '<h1>This product has been removed.</h1>';
    p.w.document.body.appendChild(main);
    p.w.history.replaceState(null, '', '/404.html'); p.tick();
    assert.equal(p.host.dataset.status, 'delisted');
    assert.equal(p.host.hidden, false);
});

test('a plain error div without semantic main markup still reports the explicit item message', (t) => {
    const p = page(t, { noData: true, body: '<div><div>Lo sentimos, este producto no está disponible.</div></div>' });
    assert.equal(p.host.dataset.status, 'unavailable');
});

test('ordinary links perform zero product scans and do not create a DOM observer until explicitly enabled', (t) => {
    const p = page(t, { url: baseUrl.split('#')[0] });
    p.w.document.getElementById('price').textContent = '$MXN120.00';
    p.w.document.querySelector('[data-size-radio="1009392"]').click();
    p.tick(60000);
    assert.deepEqual(p.counts(), { scans: 0, availabilityReads: 0, observers: 0 });
    assert.equal(p.host.dataset.mode, 'idle');
    assert.equal(p.ui.querySelector('.body').hidden, true);
    assert.equal(p.w.document.querySelector('[aria-checked=true]').textContent, '12Y');
    p.ui.querySelector('#toggle').click();
    assert.equal(p.host.dataset.mode, 'enabled');
    assert.ok(p.counts().scans > 0);
});

test('normal results stay compact and stable pages perform only two fallback checks per minute', (t) => {
    const p = page(t, { url: baseUrl.replace('op=100.00', 'op=110.00') });
    assert.equal(p.ui.querySelector('.body').hidden, true);
    p.tick(5000);
    assert.equal(p.host.dataset.status, 'same');
    assert.equal(p.ui.querySelector('.body').hidden, true);
    assert.match(p.host.style.width, /232px/);
    p.resetCounts(); p.tick(60000);
    assert.equal(p.counts().scans, 2);
    t.diagnostic('稳定页面 60 秒完整检查次数：' + p.counts().scans);
});

test('recommendation animations and unrelated counters do not trigger full product scans', (t) => {
    const p = page(t, { url: baseUrl.replace('op=100.00', 'op=110.00') }); p.tick(5000);
    p.resetCounts();
    const recommendation = p.w.document.createElement('div'); recommendation.className = 'recommend-items';
    p.w.document.body.appendChild(recommendation);
    const counter = p.w.document.createElement('span'); p.w.document.body.appendChild(counter);
    for (let i = 0; i < 40; i++) {
        recommendation.innerHTML = `<button>ADD TO BAG</button><span>$MXN${i + 1}.00</span>`;
        counter.textContent = String(i);
        p.tick(500);
    }
    assert.equal(p.counts().scans, 0);
    assert.equal(p.host.dataset.status, 'same');
});

test('new price alerts expand once, respect dismissal and reopen only for a changed alert', (t) => {
    const p = page(t); p.tick(5000);
    assert.equal(p.ui.querySelector('.body').hidden, false);
    p.ui.querySelector('#toggle').click(); p.tick(60000);
    assert.equal(p.ui.querySelector('.body').hidden, true);
    p.resetCounts();
    p.ui.querySelector('#toggle').click(); p.ui.querySelector('#toggle').click();
    assert.equal(p.counts().scans, 0, 'opening or closing the panel uses cached state');
    p.w.document.getElementById('price').textContent = '$MXN120.00'; p.tick(3500);
    assert.equal(p.host.dataset.status, 'up');
    assert.equal(p.ui.querySelector('.body').hidden, false);
    assert.match(p.ui.querySelector('#current').textContent, /120.00/);
});

test('background tabs stop scans and recheck changed prices when visible again', (t) => {
    const p = page(t, { url: baseUrl.replace('op=100.00', 'op=110.00') }); p.tick(5000);
    p.setHidden(true); p.resetCounts();
    p.w.document.getElementById('price').textContent = '$MXN120.00'; p.tick(120000);
    assert.equal(p.counts().scans, 0);
    p.setHidden(false); p.tick(3500);
    assert.equal(p.host.dataset.status, 'up');
    assert.match(p.ui.querySelector('#current').textContent, /120.00/);
});

test('pausing stops checks and SPA navigation activates only a new standard link', (t) => {
    const p = page(t); p.tick(5000);
    p.ui.querySelector('#pause').click(); p.resetCounts(); p.tick(60000);
    assert.equal(p.counts().scans, 0);
    assert.equal(p.host.dataset.mode, 'idle');
    p.w.history.replaceState(null, '', baseUrl.replace('op=100.00', 'op=110.00')); p.tick(5000);
    assert.equal(p.host.dataset.status, 'same');
    assert.equal(p.host.dataset.mode, 'enabled');
    p.w.history.replaceState(null, '', 'https://shein.com.mx/x-p-999.html'); p.tick(1000);
    p.resetCounts(); p.tick(60000);
    assert.equal(p.host.dataset.mode, 'idle');
    assert.equal(p.counts().scans, 0);
});

test('missing product data stops fast retries after the initial loading window', (t) => {
    const p = page(t, { noData: true }); p.tick(20000); p.resetCounts(); p.tick(60000);
    assert.equal(p.counts().scans, 2);
    assert.equal(p.host.dataset.status, 'loading');
});

test('icon, status text and header empty area all open details without another product scan', (t) => {
    const p = page(t, { url: baseUrl.replace('op=100.00', 'op=110.00') }); p.tick(5000); p.resetCounts();
    for (const selector of ['.brand-mark', '#badge', 'header']) {
        p.ui.querySelector(selector).click();
        assert.equal(p.ui.querySelector('.body').hidden, false, selector);
        p.w.document.getElementById('price').click();
        assert.equal(p.ui.querySelector('.body').hidden, true, 'outside click closes details');
    }
    assert.equal(p.counts().scans, 0);
});

test('inside shadow-DOM clicks stay open; outside pointerdown closes without cancelling normal browsing or polling', (t) => {
    const p = page(t, { url: baseUrl.replace('op=100.00', 'op=110.00') }); p.tick(5000);
    p.ui.querySelector('.brand').click();
    p.ui.querySelector('#link').click();
    assert.equal(p.ui.querySelector('.body').hidden, false);
    p.ui.querySelector('#refresh').click();
    assert.equal(p.ui.querySelector('.body').hidden, false);
    p.tick(3500); p.resetCounts();
    const outside = new p.w.MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true });
    p.w.document.body.dispatchEvent(outside);
    assert.equal(p.ui.querySelector('.body').hidden, true);
    assert.equal(outside.defaultPrevented, false);
    assert.equal(p.host.dataset.mode, 'enabled');
    p.tick(60000);
    assert.equal(p.counts().scans, 2);
});

test('whole status bar activates ordinary links and supports keyboard opening', (t) => {
    const p = page(t, { url: baseUrl.split('#')[0] });
    assert.equal(p.counts().scans, 0);
    p.ui.querySelector('#badge').click();
    assert.equal(p.host.dataset.mode, 'enabled');
    assert.equal(p.ui.querySelector('.body').hidden, false);
    p.ui.querySelector('#toggle').click();
    p.ui.querySelector('.brand').dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(p.ui.querySelector('.body').hidden, false);
});

test('waiting UI reports sampled progress, resets when price changes, and stops when stable', (t) => {
    const p = page(t);
    p.ui.querySelector('.brand-mark').click();
    assert.equal(p.ui.querySelector('.body').hidden, false);
    assert.equal(p.ui.querySelector('.card').dataset.busy, 'true');
    assert.equal(p.ui.querySelector('#waiting').hidden, false);
    assert.equal(p.ui.querySelector('#waiting-track').hasAttribute('aria-valuenow'), false);
    p.tick(1000);
    const first = Number(p.ui.querySelector('#waiting-track').getAttribute('aria-valuenow'));
    assert.ok(first > 0 && first < 100);
    p.tick(500);
    const second = Number(p.ui.querySelector('#waiting-track').getAttribute('aria-valuenow'));
    assert.ok(second > first);
    assert.match(p.ui.querySelector('#waiting-label').textContent, /2.2 秒/);
    p.w.document.getElementById('price').textContent = '$MXN120.00'; p.tick(500);
    assert.ok(Number(p.ui.querySelector('#waiting-track').getAttribute('aria-valuenow')) < second);
    p.tick(3500);
    assert.equal(p.host.dataset.status, 'up');
    assert.equal(p.ui.querySelector('.card').dataset.busy, 'false');
    assert.equal(p.ui.querySelector('#waiting').hidden, true);
});

test('dragging the header does not open details on release, while the next deliberate click does', (t) => {
    const p = page(t, { url: baseUrl.replace('op=100.00', 'op=110.00') }); p.tick(5000);
    const header = p.ui.querySelector('header');
    for (const [type, y] of [['pointerdown', 100], ['pointermove', 140], ['pointerup', 140]]) {
        header.dispatchEvent(new p.w.MouseEvent(type, { button: 0, clientX: 100, clientY: y, bubbles: true, composed: true }));
    }
    header.click();
    assert.equal(p.ui.querySelector('.body').hidden, true);
    p.tick(500); header.click();
    assert.equal(p.ui.querySelector('.body').hidden, false);
});

test('toolbar command opens details from waiting, stable and idle states; other extensions cannot trigger it', (t) => {
    const p = page(t, { url: baseUrl.replace('op=100.00', 'op=110.00') });
    assert.equal(p.toolbarOpen('another-extension'), undefined);
    assert.equal(p.ui.querySelector('.body').hidden, true);
    assert.equal(p.toolbarOpen().ok, true);
    assert.equal(p.ui.querySelector('.body').hidden, false);
    p.ui.querySelector('#toggle').click(); p.tick(5000); p.resetCounts();
    assert.equal(p.toolbarOpen().ok, true);
    assert.equal(p.counts().scans, 0);
    p.ui.querySelector('#pause').click();
    assert.equal(p.toolbarOpen().ok, true);
    assert.equal(p.host.dataset.mode, 'enabled');
    assert.equal(p.ui.querySelector('.body').hidden, false);
});
