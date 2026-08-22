'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Core = require('../src/core.js');

test('parses Mexico and US precise SHEIN links', () => {
  const mexico = Core.parsePreciseLink(
    'https://www.shein.com.mx/x-p-389696689.html?mallCode=1&goods_id=389696689&skucode=I8mok5sbu6qxes&main_attr=27_447',
  );
  const us = Core.parsePreciseLink(
    'https://us.shein.com/x-p-455579396.html?mallCode=1&goods_id=455579396&skucode=I6mogk9rvox29x',
  );

  assert.equal(mexico.ok, true);
  assert.equal(mexico.goodsId, '389696689');
  assert.equal(mexico.mainAttr, '27_447');
  assert.equal(us.ok, true);
  assert.match(us.warning, /main_attr/);
});

test('rejects non-SHEIN and non-precise links', () => {
  assert.equal(Core.parsePreciseLink('https://example.com/product?goods_id=1&skucode=2').ok, false);
  assert.equal(Core.parsePreciseLink('https://www.shein.com.mx/x-p-1.html?goods_id=1').ok, false);
});

test('parses Xynigo one-line purchase metadata from the URL fragment', () => {
  const result = Core.parsePreciseLink(
    'https://www.shein.com.mx/x-p-389696689.html?mallCode=1&goods_id=389696689&skucode=I8mok5sbu6qxes&main_attr=27_447#xv=1&p=Multicolor&s=XS&gp=143.57&c=MXN',
  );
  assert.equal(result.ok, true);
  assert.equal(result.hasMetadata, true);
  assert.equal(result.mainSpec, 'Multicolor');
  assert.equal(result.subSpec, 'XS');
  assert.equal(result.guidePrice, '143.57');
  assert.equal(result.purchaseCurrency, 'MXN');
  assert.match(result.url, /#xv=1&p=Multicolor&s=XS&gp=143\.57&c=MXN$/);
});

test('extracts package and platform sales order identifiers', () => {
  const result = Core.extractOrderIdentity('包裹「 XMWU39A54385 」详情 订单号 GSH1RB07F0023Y8');
  assert.deepEqual(result, {
    packageId: 'XMWU39A54385',
    platformOrderNo: 'GSH1RB07F0023Y8',
  });
});

test('splits product variants into main and secondary specifications', () => {
  assert.deepEqual(Core.inferVariantSpecs('Multicolor / XS'), {
    mainSpec: 'Multicolor',
    subSpec: 'XS',
  });
  assert.deepEqual(Core.inferVariantSpecs('Khaki-240G/1Pair'), {
    mainSpec: 'Khaki',
    subSpec: '240G/1Pair',
  });
});

test('extracts an eight- or nine-digit source goods_id from SKU prefixes and suffixes', () => {
  assert.equal(Core.extractSourceGoodsId('60874943-8896'), '60874943');
  assert.equal(Core.extractSourceGoodsId('SKU-389696689-A'), '389696689');
  assert.equal(Core.extractSourceGoodsId('PRE60874943SUF'), '60874943');
  assert.equal(Core.extractSourceGoodsId('8896-60874943-END'), '60874943');
  assert.equal(Core.extractSourceGoodsId('6087494-8896'), '');
  assert.equal(Core.extractSourceGoodsId('SKU-1234567890'), '');
});

test('prefers a goods_id SKU over a sales order number in the same order row', () => {
  const result = Core.extractProductSku(
    'GSH1RA58 x 1 469433114-4738 MXN 56.64 469433114：Neblina azul-XXL',
    ['GSH1RA58 x 1', '469433114-4738 MXN 56.64 469433114：Neblina azul-XXL'],
  );
  assert.equal(result.sellerSku, '469433114-4738');
  assert.equal(result.salesQty, 1);
  assert.equal(Core.extractSourceGoodsId(result.sellerSku), '469433114');
});

test('never treats a SHEIN sales order number as a product SKU', () => {
  const result = Core.extractProductSku('XMWU39A54685 GSH1RA58 x 1', ['GSH1RA58 x 1']);
  assert.equal(result.sellerSku, '');
});

test('builds source product links for the order country or sales currency', () => {
  assert.equal(Core.resolveSheinMarket({ country: '美国', salesCurrency: 'MXN' }), 'US');
  assert.equal(Core.resolveSheinMarket({ country: 'México', salesCurrency: 'USD' }), 'MX');
  assert.equal(Core.resolveSheinMarket({ salesCurrency: 'USD' }), 'US');
  assert.equal(Core.resolveSheinMarket({ salesCurrency: 'MXN' }), 'MX');
  assert.equal(
    Core.buildSourceProductUrl('389696689', { salesCurrency: 'USD' }),
    'https://us.shein.com/x-p-389696689.html',
  );
  assert.equal(
    Core.buildSourceProductUrl('60874943', { salesCurrency: 'MXN' }),
    'https://www.shein.com.mx/x-p-60874943.html',
  );
});

test('calculates estimated profit, margin and ROI with the Mexico minimum cost', () => {
  assert.deepEqual(Core.calculateEstimatedProfit({
    salesCurrency: 'MXN',
    salesAmount: 200,
    country: 'MX',
  }, { MXN: 80 }), {
    ok: true,
    currency: 'MXN',
    salesAmount: 200,
    guideTotal: 80,
    estimatedTopUpAmount: 20,
    estimatedCost: 100,
    estimatedProfit: 100,
    profitMargin: 50,
    roi: 100,
    minimumApplied: true,
    costBasis: 'mexico-free-shipping-top-up-estimate',
  });
  assert.deepEqual(Core.calculateEstimatedProfit({
    salesCurrency: 'USD',
    salesAmount: 200,
    country: 'US',
  }, { USD: 80 }), {
    ok: true,
    currency: 'USD',
    salesAmount: 200,
    guideTotal: 80,
    estimatedTopUpAmount: 0,
    estimatedCost: 80,
    estimatedProfit: 120,
    profitMargin: 60,
    roi: 150,
    minimumApplied: false,
    costBasis: 'guide-purchase-total',
  });
  assert.equal(Core.calculateEstimatedProfit({
    salesCurrency: 'MXN',
    salesAmount: 200,
  }, { MXN: 80, USD: 1 }).ok, false);
});

test('creates one order with multiple purchase details and one-link-per-line remark', () => {
  const record = Core.createPurchaseRecord({
    packageId: 'XMWU-DEMO-001',
    platformOrderNo: 'GSH-DEMO-001',
    storeName: '测试店铺',
    salesCurrency: 'MXN',
    salesAmount: 630,
  }, [
    {
      sellerSku: 'SKU-A',
      variant: 'Green / L',
      mainSpec: 'Green',
      subSpec: 'L',
      guidePrice: 143.57,
      purchaseCurrency: 'MXN',
      salesQty: 2,
      purchaseQty: 2,
      purchaseLink: 'https://www.shein.com.mx/x-p-389696689.html?mallCode=1&goods_id=389696689&skucode=SKU_A&main_attr=27_447',
    },
    {
      sellerSku: 'SKU-B',
      variant: 'Maroon / S',
      mainSpec: 'Maroon',
      subSpec: 'S',
      guidePrice: 88.2,
      purchaseCurrency: 'MXN',
      salesQty: 1,
      purchaseQty: 1,
      purchaseLink: 'https://www.shein.com.mx/x-p-101655130.html?mallCode=1&goods_id=101655130&skucode=SKU_B&main_attr=27_182',
    },
  ], '2026-08-23T00:00:00.000Z');

  assert.equal(record.items.length, 2);
  assert.equal(record.items[0].guidePrice, 143.57);
  assert.equal(record.items[0].mainSpec, 'Green');
  assert.equal(record.items[0].purchaseCurrency, 'MXN');
  assert.deepEqual(record.guideTotalsByCurrency, { MXN: 375.34 });
  assert.deepEqual(record.estimatedMetrics, {
    ok: true,
    currency: 'MXN',
    salesAmount: 630,
    guideTotal: 375.34,
    estimatedTopUpAmount: 0,
    estimatedCost: 375.34,
    estimatedProfit: 254.66,
    profitMargin: 40.42,
    roi: 67.85,
    minimumApplied: false,
    costBasis: 'guide-purchase-total',
  });
  assert.equal(record.remarkText.split('\n').length, 2);
  assert.equal(record.salesAmount, 630);
  assert.equal('recipientName' in record, false);
  assert.equal('address' in record, false);
});

test('requires a positive guide price when the purchase form supplies the field', () => {
  const result = Core.validatePurchaseItem({
    salesQty: 1,
    purchaseQty: 1,
    guidePrice: '',
    purchaseLink: 'https://www.shein.com.mx/x-p-1.html?goods_id=1&skucode=SKU1',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /指导价/);
});

test('requires purchase quantity to match sales quantity in development version', () => {
  const result = Core.validatePurchaseItem({
    salesQty: 2,
    purchaseQty: 1,
    purchaseLink: 'https://www.shein.com.mx/x-p-1.html?goods_id=1&skucode=SKU1',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /销售数量 2/);
});
