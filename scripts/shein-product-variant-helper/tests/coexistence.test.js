'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../shein_product_variant_helper.user.js'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/us-product-312187195.html'), 'utf8');
const url = 'https://us.shein.com/x-p-312187195.html';
const pauseKey = 'xynigo-shein-manual-pause-v1';
const refreshKey = 'xynigo-shein-auto-refresh-v1';

// Run the actual userscript against sanitized product data with a deterministic
// browser clock. JSDOM reports attempted navigations instead of performing them.
function page(t, { initialUrl = url, paused = false, busy = false, marker = false } = {}) {
    const navigation = [];
    const errors = [];
    const console = new VirtualConsole();
    console.on('jsdomError', (error) => {
        if (/navigation/.test(error.message)) navigation.push(error);
        else errors.push(error);
    });
    const dom = new JSDOM(fixture, { url: initialUrl, runScripts: 'outside-only', virtualConsole: console });
    const w = dom.window;
    let now = 100_000;
    let nextId = 0;
    const timers = new Map();
    w.Date.now = () => now;
    w.setTimeout = (fn, delay = 0) => {
        const id = ++nextId;
        timers.set(id, { fn, at: now + delay });
        return id;
    };
    w.setInterval = (fn, delay) => {
        const id = ++nextId;
        timers.set(id, { fn, at: now + delay, interval: delay });
        return id;
    };
    w.clearTimeout = w.clearInterval = (id) => timers.delete(id);
    w.localStorage.setItem('xynigo-shein-panel-open-v1', 'true');
    if (paused) w.sessionStorage.setItem(pauseKey, 'true');
    if (marker) w.sessionStorage.setItem(refreshKey, JSON.stringify({
        at: now, key: 'https://us.shein.com:312187195', reopen: true,
        secondaryValueId: '1009391', secondaryLabel: '11Y',
    }));
    const option = w.document.createElement('button');
    option.className = 'product-intro__size-radio';
    option.setAttribute('role', 'radio');
    option.getClientRects = () => [{ width: 60, height: 30 }];
    option.setAttribute('data-attr_id', '87');
    option.setAttribute('data-attr_value_id', '1009391');
    option.setAttribute('aria-checked', 'false');
    option.textContent = '11Y';
    let clicks = 0;
    option.addEventListener('click', () => {
        clicks++;
        option.setAttribute('aria-checked', 'true');
    });
    w.document.body.append(option);
    function addMask() {
        const mask = w.document.createElement('div');
        mask.className = 'earth-wxt-loading-mask is-fullscreen';
        mask.style.display = 'none'; // Earliest entry phase, before Vue shows it.
        mask.innerHTML = '<div class="earth-wxt-loading-spinner"><p class="earth-wxt-loading-text">Loading</p></div>';
        w.document.body.append(mask);
        return mask;
    }
    const initialMask = busy ? addMask() : null;
    w.eval(source);
    const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
    const advance = async (ms) => {
        const until = now + ms;
        await flush();
        let count = 0;
        while (true) {
            const entry = [...timers].filter(([, timer]) => timer.at <= until)
                .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (!entry) break;
            assert.ok(++count < 5000, 'timer loop must converge');
            const [id, timer] = entry;
            now = timer.at;
            if (timer.interval) timer.at += timer.interval;
            else timers.delete(id);
            timer.fn();
            await flush();
        }
        now = until;
        await flush();
    };
    t.after(() => { w.close(); assert.deepEqual(errors, []); });
    return {
        w, advance, flush, addMask, initialMask, navigation, option,
        clicks: () => clicks,
        host: () => w.document.getElementById('xynigo-shein-variant-helper'),
        shortcut: () => {
            const event = new w.KeyboardEvent('keydown', {
                code: 'KeyC', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
            });
            w.document.dispatchEvent(event);
            return event.defaultPrevented;
        },
    };
}

test('both idle layouts and unrelated loading overlays leave the helper enabled', async (t) => {
    const p = page(t);
    for (const layout of ['bottom', 'sidebar']) {
        p.w.document.body.insertAdjacentHTML('beforeend', `<div class="earth-wxt-collect-panel earth-wxt-collect-${layout}"></div>`);
        await p.flush();
        assert.ok(p.host());
    }
    p.w.document.body.insertAdjacentHTML('beforeend', '<div class="el-loading-mask"><div class="el-loading-spinner"></div></div>');
    await p.advance(500);
    assert.ok(p.host());
    assert.equal(p.shortcut(), true);
});

test('busy at boot blocks stale restore and SKU clicks, then restores current precise link', async (t) => {
    const p = page(t, { initialUrl: url + '?skucode=I3c0auhysow1', busy: true, marker: true });
    await p.advance(20_000);
    assert.equal(p.host(), null);
    assert.equal(p.clicks(), 0);
    assert.equal(p.shortcut(), false);
    assert.equal(p.w.sessionStorage.getItem(refreshKey), null);
    p.initialMask.remove();
    await p.advance(799);
    assert.equal(p.host(), null);
    await p.advance(501);
    assert.ok(p.host());
    assert.equal(p.clicks(), 1);
    assert.equal(p.option.getAttribute('aria-checked'), 'true');
    assert.deepEqual(p.navigation, []);
});

test('busy cancels a queued reload and does not replay it after the mask disappears', async (t) => {
    const p = page(t);
    p.w.history.replaceState(null, '', '/x-p-97573275.html');
    await p.advance(300);
    assert.ok(p.w.sessionStorage.getItem(refreshKey), 'control: stale data queued a reload');
    const mask = p.addMask();
    await p.advance(3000);
    assert.equal(p.host(), null);
    assert.equal(p.w.sessionStorage.getItem(refreshKey), null);
    assert.deepEqual(p.navigation, []);
    mask.remove();
    await p.advance(6000);
    assert.ok(p.host());
    assert.deepEqual(p.navigation, []);
    assert.equal(p.w.sessionStorage.getItem(refreshKey), null);
});

test('normal manual browsing still refreshes genuinely stale product data', async (t) => {
    const p = page(t);
    p.w.history.replaceState(null, '', '/x-p-97573275.html');
    await p.advance(1000);
    assert.equal(p.navigation.length, 1);
});

test('queued SKU selection is cancelled immediately and recomputed for the final URL', async (t) => {
    const p = page(t, { initialUrl: url + '?skucode=I3c0auhysow1' });
    await p.advance(450);
    const mask = p.addMask();
    // The last-moment guard must work before the MutationObserver is delivered.
    assert.equal(p.shortcut(), false);
    await p.advance(1000);
    assert.equal(p.clicks(), 0);
    p.w.history.replaceState(null, '', url);
    mask.remove();
    await p.advance(6000);
    assert.equal(p.clicks(), 0, 'old skucode must not leak into the current page');
    assert.ok(p.host());
});

test('manual pause survives mask cycles and reload, resume is explicit', async (t) => {
    const p = page(t);
    p.host().shadowRoot.querySelector('[aria-label="暂停本标签页助手"]').click();
    assert.equal(p.w.sessionStorage.getItem(pauseKey), 'true');
    assert.equal(p.host().dataset.runState, 'manual-paused');
    assert.equal(p.shortcut(), false);
    const mask = p.addMask();
    await p.advance(2000);
    assert.equal(p.host(), null);
    mask.remove();
    await p.advance(2000);
    assert.equal(p.host().dataset.runState, 'manual-paused');
    assert.equal(p.clicks(), 0);
    const reload = page(t, { paused: true, initialUrl: url + '?skucode=I3c0auhysow1', marker: true });
    await reload.advance(2000);
    assert.equal(reload.clicks(), 0);
    assert.equal(reload.w.sessionStorage.getItem(refreshKey), null);
    reload.host().shadowRoot.querySelector('.xv-button').click();
    await reload.advance(2000);
    assert.equal(reload.host().dataset.runState, 'normal');
    assert.equal(reload.clicks(), 1);
});

test('recovery restarts on spec/URL changes and a second busy period', async (t) => {
    const p = page(t, { busy: true });
    p.initialMask.remove();
    await p.advance(700);
    p.option.setAttribute('aria-checked', 'true');
    await p.advance(700);
    assert.equal(p.host(), null);
    p.w.history.replaceState(null, '', url + '?mallCode=1');
    await p.advance(100);
    assert.equal(p.host(), null);
    const mask = p.addMask();
    await p.advance(1000);
    assert.equal(p.host(), null);
    mask.remove();
    await p.advance(801);
    assert.ok(p.host());
    assert.equal(p.w.document.querySelectorAll('#xynigo-shein-variant-helper').length, 1);
});

test('all masks must leave and late initial spinner attachment is detected', async (t) => {
    const p = page(t);
    const partial = p.w.document.createElement('div');
    partial.className = 'earth-wxt-loading-mask';
    p.w.document.body.append(partial);
    await p.flush();
    assert.ok(p.host());
    partial.innerHTML = '<div class="earth-wxt-loading-spinner"></div>';
    await p.flush();
    assert.equal(p.host(), null);
    const other = p.addMask();
    partial.remove();
    await p.advance(2000);
    assert.equal(p.host(), null);
    other.remove();
    await p.advance(1000);
    assert.ok(p.host());
});

test('library-only mode never boots UI or coexistence watchers', (t) => {
    const dom = new JSDOM(fixture, { url, runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    dom.window.XynigoSheinVariantLibraryOnly = true;
    dom.window.eval(source);
    assert.equal(dom.window.document.querySelector('#xynigo-shein-variant-helper'), null);
    assert.equal(typeof dom.window.XynigoSheinVariantHelper.parseProductPage, 'function');
});
