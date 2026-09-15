'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/core.js');

const FIXTURE_ROW = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'tracking-row-imile.json'), 'utf8'));

// ===== 时间解析与格式化 =====

test('parses and formats Beijing wall-clock times deterministically', () => {
    const ms = Core.parseWallTime('2026-09-07 12:04');
    assert.equal(Core.formatWallTime(ms), '2026-09-07 12:04');
    assert.equal(Core.wallDate(ms), '2026-09-07');
    assert.equal(Core.parseWallTime('垃圾文本'), null);
    assert.equal(Core.parseWallTime(''), null);
});

test('extracts sign time only from the trailing timestamp of lastEvent', () => {
    assert.equal(
        Core.extractSignTime('Delivered, Your order has been delivered successfully.,2026-09-15 01:50'),
        '2026-09-15 01:50');
    assert.equal(
        Core.extractSignTime('Delivered, ...,2026-09-15 01:50 尾部带文字 2026-09-15'),
        null);
    assert.equal(Core.extractSignTime(''), null);
});

// ===== 订单构建 =====

test('builds order from real iMile tracking row with precise stage times', () => {
    const order = Core.buildOrderFromRow(FIXTURE_ROW, new Map());
    assert.equal(order.packageNo, 'XMWU***318');
    assert.equal(order.orderNo, 'GSH1S***6VA');
    assert.equal(order.carrier, 'iMile');
    assert.equal(order.country, '墨西哥');
    // 无店铺名映射时回退 shopId
    assert.equal(order.store, '9003122');
    assert.equal(Core.formatWallTime(order.orderMs), '2026-09-07 12:04');
    assert.equal(Core.formatWallTime(order.shipMs), '2026-09-09 18:10');
    assert.equal(Core.formatWallTime(order.onlineMs), '2026-09-09 07:12');
    assert.equal(order.signTime, '2026-09-15 01:50');
    // lastEventTime 是日期截断值(00:00),绝不能被当作签收时刻
    assert.notEqual(order.signMs, FIXTURE_ROW.lastEventTime);
    // 揽收节点:iMile = Received(HQ-MEX.DS)
    assert.equal(order.pickupTime, '2026-09-13 08:17');

    const expect = (a, b) => Math.abs(a - b) < 0.02;
    const h = (t1, t2) => (Core.parseWallTime(t2) - Core.parseWallTime(t1)) / 3600000;
    assert.ok(expect(order.backupH, h('2026-09-07 12:04', '2026-09-09 18:10')));
    assert.ok(expect(order.handoffH, h('2026-09-09 18:10', '2026-09-13 08:17')));
    assert.ok(expect(order.transitH, h('2026-09-09 07:12', '2026-09-15 01:50')));
    assert.ok(expect(order.fulfillH, h('2026-09-07 12:04', '2026-09-15 01:50')));
    assert.equal(order.backupD, 2);
    assert.equal(order.fulfillD, 8);
    // 店小秘自带天数原样带出
    assert.equal(order.dxmTransitDays, 4);
    assert.equal(order.dxmWaybillDays, 6);
});

test('prefers shop name from mapping over shopId', () => {
    const order = Core.buildOrderFromRow(FIXTURE_ROW, new Map([['9003122', '慧心-蓝政（二组）$']]));
    assert.equal(order.store, '慧心-蓝政（二组）$');
});

test('computes exact last-leg hours/days from pickup to sign', () => {
    const order = Core.buildOrderFromRow(FIXTURE_ROW, new Map());
    const expected = (Core.parseWallTime('2026-09-15 01:50') - Core.parseWallTime('2026-09-13 08:17')) / 3600000;
    assert.ok(Math.abs(order.lastLegH - expected) < 0.02);
    assert.equal(order.lastLegD, 2);
});

test('extractShopMap reads accountMap platform lists ({id, name})', () => {
    const indexText = JSON.stringify({
        code: 0,
        data: {
            accountMap: {
                shein: [
                    { id: '9003122', name: '晨悦-蓝政（二组）' },
                    { id: '9026190', name: '慧心-蓝政（二组）$' },
                ],
                mercado: [{ id: '8350894', name: '歆悦购-$胡康德' }],
            },
            authList: [{ id: '64957566431037408', agentName: '服务商' }],
            countMap: { delivered: 14931 },
        },
    });
    const map = Core.extractShopMap(indexText);
    assert.equal(map.get('9003122'), '晨悦-蓝政（二组）');
    assert.equal(map.get('9026190'), '慧心-蓝政（二组）$');
    assert.equal(map.get('8350894'), '歆悦购-$胡康德');
});

// ===== 揽收节点:按承运商白名单 =====

test('extracts FedEx pickup node (Picked up)', () => {
    const events = [
        { Date: '2026-09-15 00:05', Details: 'MIGUEL HIDALGO, DF, MX, Delivered' },
        { Date: '2026-09-13 04:52', Details: 'COLON, QE, MX, Left FedEx origin facility' },
        { Date: '2026-09-13 01:30', Details: 'QUERETARO, QE, MX, Picked up' },
        { Date: '2026-09-13 00:49', Details: 'Shipment information sent to FedEx' },
    ];
    assert.equal(Core.extractPickupTime(events, 'FedEx 联邦快递（FedEx）'), '2026-09-13 01:30');
});

test('extracts J&T pickup node (Pick-up) and ignores Signed text containing Received!', () => {
    const events = [
        { Date: '2026-09-12 09:32', Details: 'Signed, 【San Pedro Mixtepec -Dto. 22 -】Received！Received by【】.' },
        { Date: '2026-09-10 02:27', Details: 'Pick-up, 【Tepotzotlán】【HXQ-Huixquilucan.pdv】Your J&T Courier rafael cortez.pcp Picked up。' },
    ];
    assert.equal(Core.extractPickupTime(events, 'J&T J&T Express (MX)'), '2026-09-10 02:27');
});

test('extracts iMile pickup node (Received at hub)', () => {
    const events = Core.parseOriginaInfo(FIXTURE_ROW.originaInfo);
    assert.equal(events.length, 9);
    assert.equal(Core.extractPickupTime(events, 'iMile'), '2026-09-13 08:17');
});

test('generic fallback never mistakes J&T signed "Received!" for pickup', () => {
    const events = [
        { Date: '2026-09-12 09:32', Details: 'Signed, 【San Pedro】Received！Received by【】.' },
    ];
    assert.equal(Core.extractPickupTime(events, '未知承运商'), null);
});

// ===== 负值口径 =====

test('keeps negative handoff hours when pickup precedes recorded ship time', () => {
    const row = JSON.parse(JSON.stringify(FIXTURE_ROW));
    // FedEx 案例:实际揽收早于发货登记
    row.newCarrierName = 'FedEx 联邦快递（FedEx）';
    row.orderCreateTime = Core.parseWallTime('2026-09-09 04:19');
    row.shippedTime = Core.parseWallTime('2026-09-13 17:26');
    row.onlineTime = Core.parseWallTime('2026-09-13 00:49');
    row.lastEvent = 'MIGUEL HIDALGO, DF, MX, Delivered,2026-09-15 00:05';
    row.originaInfo = JSON.stringify([
        { Date: '2026-09-15 00:05', StatusDescription: '', Details: 'MIGUEL HIDALGO, DF, MX, Delivered' },
        { Date: '2026-09-13 01:30', StatusDescription: '', Details: 'QUERETARO, QE, MX, Picked up' },
    ]);
    const order = Core.buildOrderFromRow(row, new Map());
    assert.ok(order.handoffH < 0, '揽收早于发货登记应为负值');
    const stages = Core.stageStats([order], [120, 168, 240], 'h');
    assert.equal(stages.handoff.negCount, 1);
    assert.ok(stages.handoff.avg < 0);
});

// ===== 分段与聚合 =====

test('segments follow configurable thresholds', () => {
    assert.equal(Core.segOf(120, [120, 168, 240]), 0);
    assert.equal(Core.segOf(120.1, [120, 168, 240]), 1);
    assert.equal(Core.segOf(168, [120, 168, 240]), 1);
    assert.equal(Core.segOf(240.5, [120, 168, 240]), 3);
    assert.equal(Core.segOf(null, [120, 168, 240]), -1);
    assert.deepEqual(Core.SEGMENT_NAMES, ['快速', '正常', '偏慢', '超时']);
});

test('aggregate computes kpi stats, ok rate and segment counts', () => {
    const mk = (hours) => ({
        fulfillH: hours, fulfillD: Math.round(hours / 24),
        backupH: hours / 4, handoffH: hours / 4, transitH: hours / 2,
        backupD: 0, handoffD: 0, transitD: 0,
        store: 'S1', carrier: 'iMile', country: '墨西哥', orderTime: '2026-09-10 08:00',
    });
    const orders = [mk(48), mk(96), mk(144), mk(300)];
    const agg = Core.aggregate(orders, { thresholds: [120, 168, 240], unit: 'h' });
    assert.equal(agg.count, 4);
    // 48/96 ≤120 快速,144 ≤168 正常,300 >240 超时
    assert.deepEqual(agg.segCounts, [2, 1, 0, 1]);
    assert.equal(agg.okCount, 3);
    const s = Core.statsOf([48, 96, 144, 300]);
    assert.ok(Math.abs(agg.stages.fulfill.avg - s.avg) < 1e-9);
    assert.equal(Core.statsOf([]).avg, null);
});

test('groupOrders sorts by count and computes ok rate', () => {
    const mk = (store, hours) => ({
        store, fulfillH: hours, fulfillD: 1,
        backupH: 1, handoffH: 1, transitH: 1, backupD: 0, handoffD: 0, transitD: 0,
        carrier: 'iMile', country: '墨西哥', orderTime: '2026-09-10 08:00',
    });
    const groups = Core.groupOrders(
        [mk('A', 48), mk('A', 96), mk('A', 300), mk('B', 48)],
        o => o.store, [120, 168, 240], 'h');
    assert.equal(groups[0].key, 'A');
    assert.equal(groups[0].n, 3);
    assert.ok(Math.abs(groups[0].okRate - 2 / 3) < 1e-9);
    assert.equal(groups[1].key, 'B');
});

// ===== 筛选 =====

test('applyFilters supports store fuzzy match, multi-token order search and dates', () => {
    const orders = [
        { store: '慧心-蓝政（二组）$', orderNo: 'GSH1S***13F', packageNo: 'XMWU9A001**', trackNo: 'JMX101802***', carrier: 'J&T', country: '墨西哥', orderTime: '2026-09-15 19:27', shipTime: '2026-09-16 08:00' },
        { store: '日升-蓝政（二组）$', orderNo: 'GSH1S***6VA', packageNo: 'XMWU***318', trackNo: '4947***238', carrier: 'iMile', country: '墨西哥', orderTime: '2026-09-09 08:47', shipTime: '2026-09-10 19:12' },
        { store: '听泉-郑爱华（二组）$', orderNo: 'GSH1S***0AA', packageNo: 'XMWU***555', trackNo: '8771***025', carrier: 'FedEx', country: '美国', orderTime: '2026-09-01 08:47', shipTime: '2026-09-02 08:00' },
    ];
    const base = { store: '', orderKeywords: '', carrier: '', country: '', orderFrom: '', orderTo: '', shipFrom: '', shipTo: '' };

    let r = Core.applyFilters(orders, { ...base, store: '蓝政' });
    assert.equal(r.orders.length, 2);
    assert.equal(r.matchedStoreCount, 2);
    assert.equal(r.orderTokenCount, 0);

    // 自动匹配订单号/包裹号/运单号
    r = Core.applyFilters(orders, { ...base, orderKeywords: '4947***238' });
    assert.equal(r.orders.length, 1);
    r = Core.applyFilters(orders, { ...base, orderKeywords: 'JMX101802*** XMWU***555' });
    assert.equal(r.orders.length, 2);
    assert.equal(r.orderTokenCount, 2);

    // 批量上限 1000
    r = Core.applyFilters(orders, { ...base, orderKeywords: new Array(1200).fill('x').join('\n') });
    assert.equal(r.orderTokenCount, Core.ORDER_KEYWORD_LIMIT);
    assert.equal(r.orderTokenTruncated, true);

    r = Core.applyFilters(orders, { ...base, carrier: 'iMile' });
    assert.equal(r.orders.length, 1);
    r = Core.applyFilters(orders, { ...base, country: '美国' });
    assert.equal(r.orders.length, 1);
    r = Core.applyFilters(orders, { ...base, orderFrom: '2026-09-10', orderTo: '2026-09-16' });
    assert.equal(r.orders.length, 1);
    r = Core.applyFilters(orders, { ...base, shipFrom: '2026-09-10', shipTo: '2026-09-12' });
    assert.equal(r.orders.length, 1);
});

// ===== CSV =====

test('detail csv has BOM, no PII columns and escapes values', () => {
    const order = Core.buildOrderFromRow(FIXTURE_ROW, new Map([['9003122', '慧心-蓝政（二组）$']]));
    const csv = Core.buildDetailCsv([order], [120, 168, 240]);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.ok(csv.includes('履约时效(小时)'));
    assert.ok(!csv.includes('收件人'));
    assert.ok(csv.includes('慧心-蓝政（二组）$'));
    const commentOrder = { ...order, comment: '含,逗号和"引号"' };
    const csv2 = Core.buildDetailCsv([commentOrder], [120, 168, 240]);
    assert.ok(csv2.includes('"含,逗号和""引号"""'));
});

test('summary csv header carries the active unit', () => {
    const csv = Core.buildSummaryCsv([{ key: 'A', n: 2, avg: 1, med: 1, p90: 2, okRate: 1 }], 'd');
    assert.ok(csv.includes('平均值(天)'));
    assert.ok(csv.includes('A,2,1.0,1.0,2.0,100%'));
});

// ===== 翻页参数与店铺映射 =====

test('replacePageNo keeps other filters and swaps page number', () => {
    const body = 'pageNo=2&pageSize=50&stateType=delivered&shopId=9003122&orderField=shipped_time';
    const next = Core.replacePageNo(body, 3);
    assert.ok(next.includes('pageNo=3'));
    assert.ok(next.includes('pageSize=50'));
    assert.ok(next.includes('shopId=9003122'));
    assert.ok(!next.includes('pageNo=2'));
});

test('extractShopMap scans nested structures and skips originaInfo', () => {
    const text = JSON.stringify({
        data: {
            shops: [
                { shopId: 9003122, shopName: '慧心-蓝政（二组）$' },
                { shopId: 9003123, name: '日升-蓝政（二组）$' },
                { noise: [{ shopId: 1, shopName: '不该出现' }], originaInfo: [{ shopId: 2, shopName: '轨迹里不会有店铺' }] },
            ],
        },
    });
    const map = Core.extractShopMap(text);
    assert.equal(map.get('9003122'), '慧心-蓝政（二组）$');
    assert.equal(map.get('9003123'), '日升-蓝政（二组）$');
    assert.ok(!map.has('2'));
    assert.equal(Core.extractShopMap('不是JSON').size, 0);
});


test('collection always requests delivered orders while retaining page filters', () => {
    for (const status of ['', 'all', 'transit', 'delivered']) {
        const input = new URLSearchParams({ stateType: status, pageNo: '7', pageSize: '50',
            shopId: 'demo-shop', country: 'MX', shipStartTime: '2026-09-01', searchValue: 'demo order' });
        const actual = new URLSearchParams(Core.buildDeliveredPageBody(input.toString()));
        assert.equal(actual.get('stateType'), 'delivered');
        assert.equal(actual.get('pageNo'), '1');
        assert.equal(actual.get('pageSize'), '1000');
        for (const key of ['shopId', 'country', 'shipStartTime', 'searchValue']) {
            assert.equal(actual.get(key), input.get(key));
        }
        assert.equal(new URLSearchParams(Core.replacePageNo(actual.toString(), 2)).get('stateType'), 'delivered');
    }
    assert.equal(new URLSearchParams(Core.buildDeliveredPageBody(null)).get('stateType'), 'delivered');
});


test('threshold days must be positive safe integers in strictly increasing order', () => {
    assert.deepEqual([...Core.DEFAULT_THRESHOLDS], [120, 168, 216]);
    assert.equal(Core.validateThresholdDays(['5', '7', '9']), '');
    for (const values of [['', '7', '9'], ['5', '5', '9'], ['9', '7', '5'],
        ['0', '7', '9'], ['-1', '7', '9'], ['5.5', '7', '9'], ['5', '7', 'Infinity'],
        ['5', '7', 'abc'], ['5', '7'], [5, 7, Number.MAX_SAFE_INTEGER]]) {
        assert.ok(Core.validateThresholdDays(values), JSON.stringify(values));
    }
    assert.deepEqual(Core.aggregate([], {}).thresholds, [120, 168, 216]);
});


test('online time uses API first or earliest valid trace with explicit provenance', () => {
    const events = [{Date:'2026-09-10 12:00'}, {Date:'2026-02-30 12:00'},
        {Date:'broken'}, {Date:'2026-09-08 06:00'}, {Date:'2026-09-09 06:00'}];
    const supplied = Core.parseWallTime('2026-09-09 08:00');
    assert.deepEqual(Core.resolveOnlineTime(supplied, events), {ms:supplied,source:'接口上网时间'});
    assert.deepEqual(Core.resolveOnlineTime(String(supplied), events), {ms:supplied,source:'接口上网时间'});
    for (const raw of [null, undefined, '', 0, NaN]) {
        assert.deepEqual(Core.resolveOnlineTime(raw, events),
            {ms:Core.parseWallTime('2026-09-08 06:00'),source:'轨迹起始时间补取'});
    }
    assert.deepEqual(Core.resolveOnlineTime(null, [{Date:'2026-13-01 00:00'}, {Date:'2026-09-01 25:00'}]), {ms:null,source:'缺失'});
    const order = Core.buildOrderFromRow({...FIXTURE_ROW, newCarrierName:'J&T Express (MX)', onlineTime:null,
        originaInfo:JSON.stringify(events),lastEvent:'Delivered,2026-09-10 06:00'});
    assert.equal(order.onlineTime, '2026-09-08 06:00');
    assert.equal(order.transitH, 48);
    assert.ok(Core.buildDetailCsv([order], Core.DEFAULT_THRESHOLDS).includes('轨迹起始时间补取'));
});

test('shipping anomaly flags online-before-order; negative handoff is normal', () => {
    const base = Core.buildOrderFromRow(FIXTURE_ROW);
    const orderMs = base.orderMs;
    const rows = [
        { ...base, orderNo: 'DEMO_ANOMALY', onlineMs: orderMs - 86400000, handoffH: 2 },
        { ...base, orderNo: 'DEMO_EQUAL', onlineMs: orderMs, handoffH: 2 },
        { ...base, orderNo: 'DEMO_NORMAL', onlineMs: orderMs + 3600000, handoffH: -0.01 },
        { ...base, orderNo: 'DEMO_UNKNOWN', onlineMs: null, handoffH: -0.01 },
    ];
    const anomalies = Core.shippingAnomalyOrders(rows);
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].orderNo, 'DEMO_ANOMALY');
    // 揽收负值不再计为异常(业务口径 2026-09-15 Jeff 调整)
    assert.equal(Core.isShippingAnomaly(rows[2]), false);
    const csv = Core.buildDetailCsv(anomalies, Core.DEFAULT_THRESHOLDS);
    assert.ok(csv.includes('发货判定'));
    assert.ok(csv.includes('发货异常'));
    assert.ok(csv.includes('DEMO_ANOMALY'));
    assert.ok(!csv.includes('揽收判定'));
    assert.equal(Core.shippingAnomalyOrders(Core.applyFilters(rows, { store: 'no matching store' }).orders).length, 0);
});
