'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const shelf = require('../shein_removed_shelves.user.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'shein_removed_shelves.user.js'), 'utf8');

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return typeof body === 'string' ? body : JSON.stringify(body);
        },
    };
}

function planWithCount(count) {
    return shelf.buildPlan({
        actionKey: 'UNLIST',
        rawSkcs: Array.from({ length: count }, (_, index) => `SKC-${index + 1}`).join('\n'),
        siteNames: ['墨西哥站'],
    });
}

test('normalizes separators, preserves order and removes duplicate SKCs', () => {
    const parsed = shelf.parseSkcInput('A001\nA002\tA001，A003;A002');
    assert.deepEqual(parsed.skcs, ['A001', 'A002', 'A003']);
    assert.equal(parsed.duplicateCount, 2);
    assert.deepEqual(parsed.invalidTokens, []);
});

test('requires an explicit site selection and builds a reviewable plan', () => {
    assert.throws(() => shelf.buildPlan({
        actionKey: 'LIST',
        rawSkcs: 'A001',
        siteNames: [],
    }), /至少选择一个目标站点/);

    const plan = shelf.buildPlan({
        actionKey: 'LIST',
        rawSkcs: Array.from({ length: 51 }, (_, index) => `A${index + 1}`).join('\n'),
        siteNames: ['墨西哥站', '美国站'],
    });
    assert.equal(plan.shelfState, 1);
    assert.equal(plan.confirmationText, '确认上架');
    assert.equal(plan.batchCount, 2);
    assert.equal(plan.operationCount, 102);
    assert.deepEqual(plan.sites, [
        { site_abbr: 'shein-mx', store_type: 1 },
        { site_abbr: 'shein-us', store_type: 1 },
    ]);
});

test('rejects malformed sold-out pagination instead of continuing with partial data', () => {
    assert.throws(() => shelf.extractSoldOutPage({ msg: 'FAIL' }), /返回结构异常/);
    const page = shelf.extractSoldOutPage({
        info: {
            data: [{ skc_info_list: [{ skc_name: 'S1' }, { skc_name: 'S2' }] }],
            meta: { count: 101 },
        },
    });
    assert.deepEqual(page, { skcs: ['S1', 'S2'], totalCount: 101, totalPages: 2 });
});

test('reads every sold-out page and deduplicates SKCs', async () => {
    let calls = 0;
    const fetchImpl = async () => {
        calls += 1;
        if (calls === 1) {
            return response(200, {
                info: {
                    data: [{ skc_info_list: [{ skc_name: 'S1' }, { skc_name: 'S2' }] }],
                    meta: { count: 101 },
                },
            });
        }
        return response(200, {
            info: {
                data: [{ skc_info_list: [{ skc_name: 'S2' }, { skc_name: 'S3' }] }],
                meta: { count: 101 },
            },
        });
    };
    const result = await shelf.fetchAllSoldOutSkcs({ fetchImpl, timeoutMs: 0 });
    assert.equal(calls, 2);
    assert.deepEqual(result.skcs, ['S1', 'S2', 'S3']);
    assert.equal(result.duplicateCount, 1);
});

test('retries transient HTTP failures but does not turn them into success', async () => {
    let calls = 0;
    const waits = [];
    const result = await shelf.fetchJsonWithRetry('/test', {}, {
        fetchImpl: async () => {
            calls += 1;
            return calls === 1 ? response(503, '<html>temporary</html>') : response(200, { msg: 'OK' });
        },
        sleepImpl: async (ms) => { waits.push(ms); },
        timeoutMs: 0,
    });
    assert.equal(calls, 2);
    assert.equal(result.attempts, 2);
    assert.deepEqual(result.data, { msg: 'OK' });
    assert.deepEqual(waits, [shelf.CONFIG.retryBaseDelayMs]);
});

test('treats a business rejection as a failed batch', async () => {
    const plan = planWithCount(1);
    await assert.rejects(
        shelf.submitShelfBatch(plan, plan.skcs, {
            fetchImpl: async () => response(200, { msg: 'FAIL', info: { meta: { message: 'permission denied' } } }),
            timeoutMs: 0,
        }),
        /permission denied/,
    );
});

test('reports accepted, failed and unexecuted counts without false success', async () => {
    const plan = planWithCount(120);
    const execution = await shelf.executePlan(plan, {
        sleepImpl: async () => {},
        executor: async (batch, batchIndex) => {
            if (batchIndex === 2) throw new shelf.RequestError('business failed', { attempts: 1 });
            return { attempts: 1, responseMessage: 'OK' };
        },
    });
    assert.equal(execution.results.length, 3);
    assert.deepEqual(execution.results.map((item) => item.status), ['accepted', 'failed', 'accepted']);
    assert.deepEqual(execution.summary, {
        totalSkcCount: 120,
        acceptedSkcCount: 70,
        failedSkcCount: 50,
        notExecutedSkcCount: 0,
        acceptedBatchCount: 2,
        failedBatchCount: 1,
        stopped: false,
    });
});

test('stops before sending the next batch', async () => {
    const plan = planWithCount(120);
    let stop = false;
    let calls = 0;
    const execution = await shelf.executePlan(plan, {
        shouldStop: () => stop,
        sleepImpl: async () => {},
        executor: async () => {
            calls += 1;
            stop = true;
            return { attempts: 1, responseMessage: 'OK' };
        },
    });
    assert.equal(calls, 1);
    assert.equal(execution.summary.acceptedSkcCount, 50);
    assert.equal(execution.summary.notExecutedSkcCount, 70);
    assert.equal(execution.summary.stopped, true);
});

test('exports explicit review states and protects CSV from formula injection', () => {
    const plan = planWithCount(2);
    plan.skcs[0] = '=1+1';
    const record = {
        operationId: 'SHELF-TEST',
        createdAt: '2026-08-24T00:00:00.000Z',
        plan: shelf.compactPlan(plan),
        results: [{ batchIndex: 1, status: 'accepted', skcs: ['=1+1'], attempts: 1, error: '' }],
        summary: {
            totalSkcCount: 2,
            acceptedSkcCount: 1,
            failedSkcCount: 0,
            notExecutedSkcCount: 1,
            stopped: true,
        },
    };
    const csv = shelf.buildResultCsv(record);
    assert.match(csv, /API已受理_待复核/);
    assert.match(csv, /未执行/);
    assert.match(csv, /"'=1\+1"/);
});

test('limits the UI to the SHEIN product list and removes unused privileged grants', () => {
    assert.equal(shelf.isTargetPage('https://sellerhub.shein.com/#/spmp/commdities/list'), true);
    assert.equal(shelf.isTargetPage('https://sellerhub.shein.com/#/spmp/commodities/list'), true);
    assert.equal(shelf.isTargetPage('https://sellerhub.shein.com/#/home'), false);
    assert.doesNotMatch(source, /@grant\s+unsafeWindow/);
    assert.doesNotMatch(source, /@grant\s+GM_notification/);
    assert.match(source, /目标站点（默认不选）/);
    assert.match(source, /API 已受理/);
});

test('keeps every site unchecked and sends no request before typed confirmation', async () => {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
        url: 'https://sellerhub.shein.com/#/spmp/commdities/list',
        runScripts: 'outside-only',
    });
    let fetchCalls = 0;
    dom.window.fetch = async () => {
        fetchCalls += 1;
        return response(200, { msg: 'OK' });
    };
    dom.window.eval(source);

    const launcher = dom.window.document.getElementById(`${shelf.CONFIG.appId}-launcher`);
    assert.ok(launcher);
    launcher.click();
    const overlay = dom.window.document.getElementById(`${shelf.CONFIG.appId}-overlay`);
    const role = (name) => overlay.querySelector(`[data-role="${name}"]`);
    assert.equal(overlay.hidden, false);
    assert.equal(role('sites').querySelectorAll('input:checked').length, 0);
    assert.equal(role('execute').disabled, true);

    role('skcs').value = 'A001\nA002';
    role('skcs').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const mx = [...role('sites').querySelectorAll('input')].find((input) => input.value === '墨西哥站');
    mx.checked = true;
    mx.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    role('preview-button').click();
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));

    assert.equal(fetchCalls, 0);
    assert.equal(role('preview').hidden, false);
    assert.equal(role('confirm-field').hidden, false);
    assert.equal(role('execute').disabled, true);
    role('confirm-input').value = '确认下架';
    role('confirm-input').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(role('execute').disabled, false);
    assert.equal(fetchCalls, 0);

    dom.window.location.hash = '#/home';
    dom.window.dispatchEvent(new dom.window.Event('hashchange'));
    assert.equal(overlay.hidden, true);
    assert.equal(role('execute').disabled, true);
    assert.equal(dom.window.document.getElementById(`${shelf.CONFIG.appId}-launcher`), null);
    dom.window.close();
});
