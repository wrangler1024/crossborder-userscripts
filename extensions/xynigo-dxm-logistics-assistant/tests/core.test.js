'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Core = require('../src/core.js');

test('parses Excel-style order and tracking columns with a batch carrier', () => {
  const parsed = Core.parseInput([
    'GSU1SAMPLE0001A\t1z999aa10123456784',
    'GSH1SAMPLE0003C\tTRACKSAMPLE0003',
  ].join('\n'), { defaultCarrier: 'UPS' });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries, [
    {
      lineNumber: 1,
      orderNo: 'GSU1SAMPLE0001A',
      trackingNo: '1Z999AA10123456784',
      providerName: 'UPS',
    },
    {
      lineNumber: 2,
      orderNo: 'GSH1SAMPLE0003C',
      trackingNo: 'TRACKSAMPLE0003',
      providerName: 'UPS',
    },
  ]);
});

test('supports comma input and an optional per-row carrier override', () => {
  const parsed = Core.parseInput([
    'GSU1SAMPLE0001A,1Z999AA10123456784',
    'GSH1SAMPLE0003C，JMXTEST000000003，J&T',
    'GSU1TEST00004D，GFUSTEST000000004，GOFO',
    'GSU1TEST00005E，SPXTEST000000000000005，SpeedX',
  ].join('\n'), { defaultCarrier: 'FedEx' });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries.map((entry) => entry.providerName), ['FedEx', 'J&T', 'GOFO', 'SpeedX']);
});

test('normalizes the common Xynigo Web carrier names for Mexico and US stores', () => {
  assert.deepEqual([
    Core.resolveCarrier('J&T Express'),
    Core.resolveCarrier('IMILE'),
    Core.resolveCarrier('USPS'),
    Core.resolveCarrier('GOFO'),
    Core.resolveCarrier('SpeedX'),
  ], ['J&T', 'iMile', 'USPS', 'GOFO', 'SpeedX']);
});

test('resolves the exact platform carrier returned by Dianxiaomi for each order', () => {
  const payload = {
    code: 0,
    data: {
      orderList: [{ idStr: '987654321', platform: 'shein' }],
      sheinProviders: [
        { fProductCode: 'DHL', providerName: 'DHL' },
        { fProductCode: 'JNT-MX', providerName: 'J&T Express Mexico' },
        { fProductCode: 'JNT-MX-DUPLICATE', providerName: 'J&T Express Mexico' },
      ],
    },
  };
  const resolved = Core.resolvePlatformProvider(payload, '987654321', 'J&T');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.platform, 'shein');
  assert.equal(resolved.requestedProviderName, 'J&T');
  assert.equal(resolved.platformProviderName, 'J&T Express Mexico');
  assert.equal(resolved.platformProviderCode, 'JNT-MX');
});

test('keeps imile and iMile separate and only accepts the exact iMile platform option', () => {
  const payload = {
    code: 0,
    data: {
      orderList: [{ idStr: '987654321', platform: 'shein' }],
      sheinProviders: [
        { fProductCode: 'IMILE_LOWER', providerName: 'imile' },
        { fProductCode: 'IMILE_CANONICAL', providerName: 'iMile' },
      ],
    },
  };
  const resolved = Core.resolvePlatformProvider(payload, '987654321', 'IMILE');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.platformProviderName, 'iMile');
  assert.equal(resolved.platformProviderCode, 'IMILE_CANONICAL');
  assert.deepEqual(resolved.availableProviderNames, ['imile', 'iMile']);

  const lowercaseOnly = Core.resolvePlatformProvider({
    ...payload,
    data: {
      ...payload.data,
      sheinProviders: [{ fProductCode: 'IMILE_LOWER', providerName: 'imile' }],
    },
  }, '987654321', 'iMile');
  assert.equal(lowercaseOnly.ok, false);
  assert.match(lowercaseOnly.reason, /没有.*匹配/);
  assert.equal(Core.carrierNameMatches('IMILE', 'imile'), false);
  assert.equal(Core.carrierNameMatches('IMILE', 'iMile'), true);
});

test('blocks missing or ambiguous platform carrier matches', () => {
  const missing = Core.resolvePlatformProvider({
    orderList: [{ idStr: '987654321', platform: 'shein' }],
    sheinProviders: [{ fProductCode: 'DHL', providerName: 'DHL' }],
  }, '987654321', 'J&T');
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /没有.*匹配/);
  assert.deepEqual(missing.availableProviderNames, ['DHL']);

  const ambiguous = Core.resolvePlatformProvider({
    orderList: [{ idStr: '987654321', platform: 'shein' }],
    sheinProviders: [
      { fProductCode: 'JT-A', providerName: 'J&T Express A' },
      { fProductCode: 'JT-B', providerName: 'J&T Express B' },
    ],
  }, '987654321', 'J&T');
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.reason, /多个平台承运商/);
});

test('drops exact duplicates but blocks ambiguous order or tracking mappings', () => {
  const exactDuplicate = Core.parseInput([
    'GSU1SAMPLE0001A\t1Z999AA10123456784',
    'GSU1SAMPLE0001A\t1Z999AA10123456784',
  ].join('\n'));
  assert.equal(exactDuplicate.ok, true);
  assert.equal(exactDuplicate.entries.length, 1);
  assert.equal(exactDuplicate.warnings[0].code, 'exact_duplicate_removed');

  const ambiguous = Core.parseInput([
    'GSU1SAMPLE0001A\t1Z999AA10123456784',
    'GSU1SAMPLE0001A\t1Z999AA10123456785',
    'GSH1SAMPLE0003C\t1Z999AA10123456784',
  ].join('\n'));
  assert.equal(ambiguous.ok, false);
  assert.deepEqual(
    new Set(ambiguous.errors.map((error) => error.code)),
    new Set(['order_duplicate_conflict', 'tracking_duplicate_conflict']),
  );
});

test('parses standardized purchase sub-orders without requiring pending child rows', () => {
  const parsed = Core.parseSplitInput([
    'GSH1SAMPLE0001A-1\tJMXTEST000000001\tiMile',
    'GSH1SAMPLE0001A-3\tJMXTEST000000003\tiMile',
  ].join('\n'));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries.map((entry) => ({
    purchaseSubOrderNo: entry.purchaseSubOrderNo,
    orderNo: entry.orderNo,
    purchaseSequence: entry.purchaseSequence,
  })), [
    { purchaseSubOrderNo: 'GSH1SAMPLE0001A-1', orderNo: 'GSH1SAMPLE0001A', purchaseSequence: 1 },
    { purchaseSubOrderNo: 'GSH1SAMPLE0001A-3', orderNo: 'GSH1SAMPLE0001A', purchaseSequence: 3 },
  ]);
  assert.deepEqual(Core.uniqueSearchEntries(parsed.entries), [{ orderNo: 'GSH1SAMPLE0001A' }]);

  const invalid = Core.parseSplitInput('GSH1SAMPLE0001A\tJMXTEST000000001\tiMile');
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.code === 'purchase_sub_order_invalid'));
});

test('maps only ready purchase sub-orders to unique packages of the same original order', () => {
  const entries = Core.parseSplitInput([
    'GSH1SAMPLE0001A-1\tJMXTEST000000001\tiMile',
    'GSH1SAMPLE0001A-3\tJMXTEST000000003\tiMile',
  ].join('\n')).entries;
  const records = [
    { orderNo: 'GSH1SAMPLE0001A', internalPackageId: 'PKG-1', orderStatus: '待发货', currentTrackingNo: '' },
    { orderNo: 'GSH1SAMPLE0001A', internalPackageId: 'PKG-2', orderStatus: '待发货', currentTrackingNo: '' },
    { orderNo: 'GSH1SAMPLE0001A', internalPackageId: 'PKG-3', orderStatus: '待发货', currentTrackingNo: '' },
  ];
  const candidates = Core.prepareSplitCandidates(entries, records);
  assert.equal(candidates.ok, true);
  assert.equal(candidates.recordsByOrder.get('GSH1SAMPLE0001A').length, 3);

  const assigned = Core.assignSplitPackages(entries, records, new Map([
    ['GSH1SAMPLE0001A-1', 'PKG-2'],
    ['GSH1SAMPLE0001A-3', 'PKG-3'],
  ]));
  assert.equal(assigned.ok, true);
  assert.deepEqual(assigned.matches.map((item) => item.internalPackageId), ['PKG-2', 'PKG-3']);

  const duplicate = Core.assignSplitPackages(entries, records, {
    'GSH1SAMPLE0001A-1': 'PKG-2',
    'GSH1SAMPLE0001A-3': 'PKG-2',
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join('；'), /被分配给多个采购子单/);

  const alreadyShipped = Core.assignSplitPackages(entries.slice(0, 1), [{
    ...records[0],
    currentTrackingNo: 'JMXALREADYSHIPPED001',
  }], { 'GSH1SAMPLE0001A-1': 'PKG-1' });
  assert.equal(alreadyShipped.ok, false);
  assert.match(alreadyShipped.errors[0], /已有物流单号/);
});

test('extracts safe package product evidence from Dianxiaomi detail payloads', () => {
  const payload = {
    data: {
      dxmOrder: { orderId: 'GSH1SAMPLE0001A', orderStatusName: '待发货' },
      productList: [{
        sellerSku: 'SKU-BLACK-M',
        productName: 'Sample product',
        specification: 'Black / M',
        quantity: 2,
        imageUrl: '//img.example.com/sample.webp',
      }],
    },
  };
  const detail = Core.parseOrderDetail(payload, 'PKG-1');
  assert.deepEqual(detail.packageItems, [{
    sku: 'SKU-BLACK-M',
    title: 'Sample product',
    variant: 'Black / M',
    imageUrl: 'https://img.example.com/sample.webp',
    quantity: 2,
  }]);
});

test('parses validated SHEIN split detail and keeps the server split keys', () => {
  const detail = Core.parseSplitOrderDetail({
    code: 0,
    dxmOrder: {
      orderId: 'GSH1SAMPLE0001A',
      platform: 'shein',
      productList: [
        {
          splitKey: 'SPLIT-KEY-A',
          productCount: 2,
          productDisplaySku: 'SKU-A',
          productName: 'Sample A',
          specification: 'Black / M',
          productImageUrl: '//img.example.com/a.webp',
        },
        {
          splitKey: 'SPLIT-KEY-B',
          productCount: 1,
          sellerSku: 'SKU-B',
          imageUrl: 'https://img.example.com/b.webp',
        },
      ],
    },
  }, 'PKG-ORIGINAL', 'GSH1SAMPLE0001A');

  assert.equal(detail.ok, true);
  assert.equal(detail.platform, 'shein');
  assert.equal(detail.totalQuantity, 3);
  assert.deepEqual(detail.products, [
    {
      splitKey: 'SPLIT-KEY-A',
      productCount: 2,
      sku: 'SKU-A',
      title: 'Sample A',
      variant: 'Black / M',
      imageUrl: 'https://img.example.com/a.webp',
    },
    {
      splitKey: 'SPLIT-KEY-B',
      productCount: 1,
      sku: 'SKU-B',
      title: '',
      variant: '',
      imageUrl: 'https://img.example.com/b.webp',
    },
  ]);
  assert.match(Core.parseSplitOrderDetail({
    dxmOrder: { orderId: 'GSH1SAMPLE0001A', platform: 'amazon', productList: [{}] },
  }, 'PKG-ORIGINAL').reason, /仅支持 SHEIN/);
});

test('builds partial and fully allocated Dianxiaomi package matrices', () => {
  const detail = {
    ok: true,
    orderNo: 'GSH1SAMPLE0001A',
    internalPackageId: 'PKG-ORIGINAL',
    products: [
      { splitKey: 'A', productCount: 2, sku: 'SKU-A' },
      { splitKey: 'B', productCount: 1, sku: 'SKU-B' },
    ],
  };
  const partial = Core.buildBatchSplitPlan(detail, [{
    purchaseSubOrderNo: 'GSH1SAMPLE0001A-1', splitKey: 'A', quantity: 1,
  }]);
  assert.equal(partial.ok, true);
  assert.equal(partial.residualTotal, 2);
  assert.deepEqual(partial.packageVectors, [
    [{ sku: 'A', num: '1' }, { sku: 'B', num: '1' }],
    [{ sku: 'A', num: '1' }, { sku: 'B', num: '0' }],
  ]);

  const full = Core.buildBatchSplitPlan(detail, [
    { purchaseSubOrderNo: 'GSH1SAMPLE0001A-1', splitKey: 'A', quantity: 2 },
    { purchaseSubOrderNo: 'GSH1SAMPLE0001A-2', splitKey: 'B', quantity: 1 },
  ]);
  assert.equal(full.ok, true);
  assert.equal(full.residualTotal, 0);
  assert.deepEqual(JSON.parse(full.splitOrderList), [
    [{ sku: 'A', num: '2' }, { sku: 'B', num: '0' }],
    [{ sku: 'A', num: '0' }, { sku: 'B', num: '1' }],
  ]);
});

test('blocks incomplete and over-allocated split plans', () => {
  const detail = {
    ok: true,
    orderNo: 'GSH1SAMPLE0001A',
    internalPackageId: 'PKG-ORIGINAL',
    products: [{ splitKey: 'A', productCount: 1, sku: 'SKU-A' }],
  };
  assert.match(Core.buildBatchSplitPlan(detail, [{
    purchaseSubOrderNo: 'GSH1SAMPLE0001A-1', splitKey: '', quantity: 1,
  }]).errors[0], /尚未选择有效商品/);
  assert.match(Core.buildBatchSplitPlan(detail, [{
    purchaseSubOrderNo: 'GSH1SAMPLE0001A-1', splitKey: 'A', quantity: 2,
  }]).errors[0], /仅有 1 件/);
  assert.match(Core.buildBatchSplitPlan(detail, [{
    purchaseSubOrderNo: 'GSH1SAMPLE0001A-1', splitKey: 'A', quantity: 1,
  }]).errors[0], /无需执行/);
});

test('rejects malformed rows and batches larger than the current page-safe limit', () => {
  const malformed = Core.parseInput('GSU1SAMPLE0001A');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.errors[0].code, 'column_count_invalid');

  const tooMany = Array.from({ length: 301 }, (_, index) => (
    `ORDER_${String(index).padStart(4, '0')}\tTRACK_${String(index).padStart(4, '0')}`
  )).join('\n');
  const limited = Core.parseInput(tooMany);
  assert.equal(limited.ok, false);
  assert.ok(limited.errors.some((error) => error.code === 'entry_limit_exceeded'));
  assert.equal(Core.MAX_ENTRIES, 300);
});

test('parses Dianxiaomi detail responses and requires an exact unique match', () => {
  const detail = Core.parseOrderDetail({
    data: {
      dxmOrder: { orderId: 'gsu1sample0001a', orderStatusName: '待发货', platform: 'shein' },
      parentOrder: { countryCN: '美国', countryCode: 'US' },
    },
  }, '987654321');
  assert.deepEqual(detail, {
    ok: true,
    orderNo: 'GSU1SAMPLE0001A',
    internalPackageId: '987654321',
    orderStatus: '待发货',
    currentTrackingNo: '',
    currentProviderName: '',
    failureMessage: '',
    platform: 'shein',
    packageItems: [],
  });

  const entries = Core.parseInput([
    'GSU1SAMPLE0001A\t1Z999AA10123456784',
    'GSH1SAMPLE0003C\tTRACKSAMPLE0003',
  ].join('\n')).entries;
  const matched = Core.matchEntries(entries, [detail]);
  assert.equal(matched.ok, false);
  assert.equal(matched.matches.length, 1);
  assert.deepEqual(matched.missing.map((item) => item.orderNo), ['GSH1SAMPLE0003C']);
});

test('reads failed-shipment details and safely compares existing carrier names', () => {
  const detail = Core.parseOrderDetail({
    data: {
      dxmOrder: {
        orderId: 'GSH1TEST00006F',
        orderStatusName: '发货失败',
        trackingNumber: 'jmxtest000000006',
        agentProviderName: 'J&T Express Mexico',
        errorMsg: '物流方式不正确',
      },
    },
  }, '987654321');
  assert.equal(detail.currentTrackingNo, 'JMXTEST000000006');
  assert.equal(detail.currentProviderName, 'J&T Express Mexico');
  assert.equal(detail.failureMessage, '物流方式不正确');
  assert.equal(Core.carrierNameMatches('J&T Express', detail.currentProviderName), true);
  assert.equal(Core.carrierNameMatches('USPS', detail.currentProviderName), false);
});

test('builds the former-IT Dianxiaomi shipment request without external credentials', () => {
  const body = new URLSearchParams(Core.buildShipmentBody({
    internalPackageId: '987654321',
    trackingNo: '1z999aa10123456784',
    providerName: 'UPS',
    platformProviderName: 'UPS',
  }));
  assert.equal(body.get('packageIds'), '987654321');
  assert.equal(body.get('tracingNumbers'), '1Z999AA10123456784');
  assert.equal(body.get('providerNames'), 'UPS');
  assert.equal(body.get('isShipStr'), '1');
  assert.equal(body.get('trackUrls'), '');
});

test('refuses to submit a carrier that has not passed the platform-carrier preflight', () => {
  assert.throws(() => Core.buildShipmentBody({
    internalPackageId: '987654321',
    trackingNo: '1Z999AA10123456784',
    providerName: 'J&T',
  }), /尚未通过店小秘平台承运商预检/);
});

test('classifies success, bounded busy retries, failures and unknown responses', () => {
  assert.deepEqual(Core.interpretShipmentResponse({ code: 0, msg: 'ok' }), {
    state: 'submitted', ok: true, retryable: false, message: 'ok',
  });
  assert.equal(Core.interpretShipmentResponse({
    code: -1,
    msg: `${Core.BUSY_MESSAGE}！`,
  }).retryable, true);
  assert.equal(Core.interpretShipmentResponse({ code: -1, msg: '订单状态不支持' }).state, 'failed');
  assert.equal(Core.interpretShipmentResponse('<html>login</html>').state, 'unknown');
  assert.equal(Core.interpretShipmentResponse({ code: null }).state, 'unknown');
});

test('exports quoted UTF-8 CSV and neutralizes spreadsheet formulas', () => {
  const csv = Core.resultsToCsv([
    {
      orderNo: 'GSU1SAMPLE0001A',
      trackingNo: '1Z999AA10123456784',
      requestedProviderName: 'UPS',
      platformProviderName: 'UPS',
      internalPackageId: '987654321',
      state: 'failed',
      message: '=HYPERLINK("https://invalid.example")',
    },
    {
      orderNo: 'GSU1SAMPLE0002B',
      trackingNo: '1Z999AA10123456785',
      requestedProviderName: 'UPS',
      state: 'skipped',
      message: '当前待处理订单未找到',
    },
    {
      orderNo: 'GSU1SAMPLE0003C',
      trackingNo: '1Z999AA10123456786',
      requestedProviderName: 'UPS',
      state: 'paused',
      message: '因前序订单结果未知，已停止派发；本订单未提交',
    },
  ]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/invalid\.example""\)"/);
  assert.match(csv, /"已排除","当前待处理订单未找到"/);
  assert.match(csv, /"未提交（已暂停）","因前序订单结果未知，已停止派发；本订单未提交"/);
});
