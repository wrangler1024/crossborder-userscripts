'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const Core = require('../src/core.js');

function order(overrides = {}) {
  return {
    sid: 12439,
    amazonOrderId: '702-0000000-0000000',
    sellerName: '絮然-CA-代圆',
    marketplace: '加拿大',
    orderStatus: 'Pending',
    orderTotalAmount: '14.99',
    purchaseDateLocal: '2026-11-14 01:34:08',
    purchaseDate: '2026-11-14T09:34:08Z',
    isAssessed: 0,
    isPromotion: 0,
    slist: [
      {
        sku: 'SKU-1',
        sellerSku: 'MSKU-1',
        asin: 'B000000001',
        title: 'Product one',
        promotionIds: ['vine.enrollment.fixture:1'],
      },
    ],
    ...overrides,
  };
}

test('detects Vine from promotionIds prefix and keeps cancel/refund statuses eligible', () => {
  const rows = [
    order(),
    order({
      amazonOrderId: '702-0000000-0000001',
      isAssessed: 1,
      slist: [{ sku: 'SKU-2', asin: 'B000000002', promotionIds: ['other.promotion'] }],
    }),
    order({
      amazonOrderId: '702-0000000-0000002',
      orderStatus: 'Cancelled',
      slist: [{ sku: 'SKU-3', asin: 'B000000003', promotionIds: 'vine.enrollment.fixture:3' }],
    }),
    order({
      amazonOrderId: '702-0000000-0000003',
      orderStatus: 'Refunded',
      slist: [{ sku: 'SKU-4', asin: 'B000000004', promotionIds: ['vine.enrollment.fixture:4'] }],
    }),
  ];

  const classified = Core.classifyOrders(rows);
  assert.equal(classified.summary.vineCount, 3);
  assert.equal(classified.summary.assessedCount, 0);
  assert.equal(classified.summary.pendingCount, 3);
  assert.deepEqual(
    classified.pendingOrders.map((item) => item.status),
    ['Pending', 'Cancelled', 'Refunded'],
  );
});

test('uses isAssessed rather than isPromotion for marked state', () => {
  const classified = Core.classifyOrders([
    order({ amazonOrderId: '702-0000000-0000010', isAssessed: 0, isPromotion: 1 }),
    order({ amazonOrderId: '702-0000000-0000011', isAssessed: 1, isPromotion: 0 }),
  ]);
  assert.deepEqual(classified.pendingOrders.map((item) => item.amazonOrderId), ['702-0000000-0000010']);
  assert.deepEqual(classified.assessedOrders.map((item) => item.amazonOrderId), ['702-0000000-0000011']);
});

test('deduplicates pages by sid, order id and local purchase time', () => {
  const row = order();
  const classified = Core.classifyOrders([row, { ...row }]);
  assert.equal(classified.summary.vineCount, 1);
});

test('builds the observed OrderList contract and computes local date ranges', () => {
  assert.deepEqual(Core.dateRange(30, new Date(2026, 10, 16)), {
    days: 30,
    startDate: '2026-10-18',
    endDate: '2026-11-16',
  });
  assert.deepEqual(Core.buildOrderListPayload({
    startDate: '2026-10-18',
    endDate: '2026-11-16',
    pageNo: 2,
  }), {
    startDate: '2026-10-18',
    endDate: '2026-11-16',
    sortField: 'purchaseDateLocal',
    sortType: 'desc',
    searchField: 'amazonOrderId',
    searchValue: '',
    exactSearch: 0,
    fulfillmentChannel: '',
    pageNo: 2,
    pageSize: 200,
    isMcfOrder: '0',
    req_time_sequence: '2',
  });
});

test('parses paged response and rejects malformed contracts', () => {
  const page = Core.extractOrderPage({
    code: 1,
    success: true,
    data: {
      total: 293,
      totalPages: 2,
      pageNo: 1,
      pageSize: 200,
      isLast: false,
      data: [order()],
    },
  });
  assert.equal(page.total, 293);
  assert.equal(page.totalPages, 2);
  assert.equal(page.rows.length, 1);
  assert.throws(() => Core.extractOrderPage({ code: 0, msg: '无权限' }), /无权限/);
  assert.throws(() => Core.extractOrderPage({ code: 1, data: {} }), /格式变化/);
});

test('constructs only the native setAssess fields and enforces chunk size', () => {
  const payload = Core.buildAssessPayload([
    {
      sid: '12439',
      amazonOrderId: '702-1153239-8301067',
      purchaseDateLocal: '2026-11-14 01:34:08',
      promotionType: 'review',
      amount: 14.99,
    },
  ]);
  assert.deepEqual(payload, [{
    sid: 12439,
    amazonOrderId: '702-1153239-8301067',
    purchaseDateLocal: '2026-11-14 01:34:08',
  }]);
  assert.equal(Core.WRITE_CHUNK_SIZE, 20);
  assert.throws(() => Core.buildAssessPayload(Array.from({ length: 21 }, (_, index) => ({
    sid: 1,
    amazonOrderId: `A-${index}`,
    purchaseDateLocal: '2026-11-16 10:00:00',
  }))), /最多 20 笔/);
  assert.equal(Core.chunkOrders(Array.from({ length: 45 }), 20).map((chunk) => chunk.length).join(','), '20,20,5');
});

test('preflight blocks orders no longer pending and ignores newly added pending orders', () => {
  const snapshot = [order(), order({ amazonOrderId: '702-0000000-0000100' })].map((row) => Core.normalizeOrder(row));
  const latest = [Core.normalizeOrder(order())];
  const result = Core.preflightSelection(snapshot, latest);
  assert.equal(result.ok, false);
  assert.equal(result.missing.length, 1);

  const added = Core.preflightSelection([snapshot[0]], [
    snapshot[0],
    Core.normalizeOrder(order({ amazonOrderId: '702-0000000-0000101' })),
  ]);
  assert.equal(added.ok, true);
  assert.equal(added.added.length, 1);
});

test('readback distinguishes pass, still pending and missing', () => {
  const batch = [
    Core.normalizeOrder(order({ amazonOrderId: 'A' })),
    Core.normalizeOrder(order({ amazonOrderId: 'B' })),
    Core.normalizeOrder(order({ amazonOrderId: 'C' })),
  ];
  const latest = [
    Core.normalizeOrder(order({ amazonOrderId: 'A', isAssessed: 1 })),
    Core.normalizeOrder(order({ amazonOrderId: 'B', isAssessed: 0 })),
  ];
  assert.deepEqual(
    Core.evaluateReadback(batch, latest).map((item) => item.readback),
    ['passed', 'pending', 'missing'],
  );
});

test('CSV exports use default promotion type and do not include buyer fields', () => {
  const normalized = Core.normalizeOrder(order());
  const preview = Core.previewCsv([normalized], new Date('2026-11-16T12:00:00+08:00'));
  assert.match(preview, /"默认"/);
  assert.match(preview, /702-0000000-0000000/);
  assert.doesNotMatch(preview, /buyerName|buyerEmail|买家邮箱/);

  const execution = Core.executionCsv({
    batchId: 'VB-TEST',
    startedAt: '2026/11/16 20:00:00',
    items: [{
      ...normalized,
      submitResult: 'accepted',
      readback: 'passed',
    }],
  });
  assert.match(execution, /领星已受理/);
  assert.match(execution, /核验通过/);
  assert.doesNotMatch(execution, /accepted|passed/);
});

test('only the exact order-list route is treated as the working page', () => {
  assert.equal(Core.isOrderListUrl('https://erp.lingxing.com/erp/orderList'), true);
  assert.equal(Core.isOrderListUrl('https://erp.lingxing.com/erp/orderList?x=1'), true);
  assert.equal(Core.isOrderListUrl('https://erp.lingxing.com/erp/home'), false);
  assert.equal(Core.isOrderListUrl('https://evil.example/erp/orderList'), false);
});
