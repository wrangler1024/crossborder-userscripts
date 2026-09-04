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
  const csv = Core.resultsToCsv([{
    orderNo: 'GSU1SAMPLE0001A',
    trackingNo: '1Z999AA10123456784',
    requestedProviderName: 'UPS',
    platformProviderName: 'UPS',
    internalPackageId: '987654321',
    state: 'failed',
    message: '=HYPERLINK("https://invalid.example")',
  }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/invalid\.example""\)"/);
});
