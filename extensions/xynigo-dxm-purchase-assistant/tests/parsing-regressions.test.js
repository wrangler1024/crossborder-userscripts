'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Core = require('../src/core.js');
const cases = require('./fixtures/product-parsing.json');
const link = (id) => `https://www.shein.com.mx/x-p-${id}.html?goods_id=${id}&skucode=synthetic`;
const productRow = (text, extra = {}) => ({ rowText: `GSHDEMO0001 ${text}`, cellTexts: ['GSHDEMO0001', text], ...extra });

for (const fixture of cases) {
  test(`reported product parser regression: ${fixture.name}`, () => {
    const result = Core.extractProductRows(fixture.products.map((text) => productRow(text)));
    assert.equal(result.length, 1);
    assert.equal(result[0].salesQty, 1);
    assert.equal(result[0].purchaseQty, 1);
    assert.equal(Core.extractSourceGoodsId(result[0].sellerSku), fixture.goodsId);
    assert.equal(Core.validatePurchaseItem({ ...result[0], purchaseLink: link(fixture.goodsId), guidePrice: 10 }).ok, true);
    assert.equal(Core.validatePurchaseItem({ ...result[0], purchaseQty: 2, purchaseLink: link(fixture.goodsId), guidePrice: 10 }).ok, false);
  });
}

test('quantity boundaries keep real multipacks and ignore x digits inside platform SKUs', () => {
  for (const separator of [' x 3', ' x3', ' × 3', '×3']) {
    const row = productRow(`DEMOx8n6${separator} MXN 120.00 87654321：Red-L`);
    assert.equal(Core.extractProductRows([row])[0].salesQty, 3);
  }
  const text = 'DEMOx6n4 x 2 MXN 20.00 87654321：Red-L';
  const result = Core.extractProductRows([productRow(text), productRow(text)]);
  assert.equal(result[0].salesQty, 4);
});

test('cancellation is scoped to product status, not an unrelated warehouse cell', () => {
  const product = 'DEMOx6n4 x 1 MXN 20.00 87654321：Red-L';
  const active = productRow(product, { cellTexts: ['GSHDEMO0001', product, '已取消'], cancelledCellIndexes: [2] });
  const cancelled = productRow(product, { cancelledCellIndexes: [1] });
  assert.equal(Core.extractProductRows([active, cancelled])[0].salesQty, 1);
  assert.deepEqual(Core.extractProductRows([cancelled]), []);
});

test('seven-digit YDB source wins over a platform SKU and produces a source link', () => {
  const row = productRow('DEMO-1234567 x 1 MXN 20.00 YDB--1234567-181：Blue-L');
  const [item] = Core.extractProductRows([row]);
  assert.equal(item.sellerSku, 'YDB--1234567-181');
  assert.equal(Core.buildSourceProductUrl('1234567', { salesCurrency: 'MXN' }), 'https://www.shein.com.mx/x-p-1234567.html');
  assert.equal(Core.buildSourceProductUrl('1234567', { salesCurrency: 'USD' }), 'https://us.shein.com/x-p-1234567.html');
  for (const invalid of ['123456', '1234567890', 'GSH1234567', '1234567-extra']) {
    assert.equal(Core.buildSourceProductUrl(invalid, {}), '');
  }
});

const liveItem = (sku = '87654321', variant = 'Red-L') => ({
  sellerSku: sku, variant, salesQty: 1, purchaseQty: 1, purchaseLink: '', guidePrice: '', source: 'page-parser',
});
const savedItem = (qty = 8) => ({
  ...liveItem(), salesQty: qty, purchaseQty: qty, purchaseLink: link('87654321'), guidePrice: 20, mainSpec: 'Rojo', subSpec: 'L',
});

test('old draft default quantities are corrected without losing purchases or mutating the saved record', () => {
  for (const qty of [8, 6, 2]) {
    const saved = [savedItem(qty)];
    const original = JSON.stringify(saved);
    const result = Core.reconcilePurchaseItems([liveItem()], saved);
    assert.equal(result.changed, true);
    assert.equal(result.items[0].salesQty, 1);
    assert.equal(result.items[0].purchaseQty, 1);
    assert.equal(result.items[0].purchaseLink, saved[0].purchaseLink);
    assert.equal(result.items[0].mainSpec, 'Rojo');
    assert.equal(result.items[0].guidePrice, 20);
    assert.equal(JSON.stringify(saved), original);
  }
});

test('manual quantity edits and submitted quantities are retained for explicit review', () => {
  for (const [saved, options, expected] of [
    [{ ...savedItem(), purchaseQty: 3 }, {}, 3],
    [{ ...savedItem(), purchaseQty: '' }, {}, ''],
    [savedItem(), { submitted: true }, 8],
  ]) {
    const result = Core.reconcilePurchaseItems([liveItem()], [saved], options);
    assert.equal(result.items[0].salesQty, 1);
    assert.equal(result.items[0].purchaseQty, expected);
    assert.equal(Core.validatePurchaseItem(result.items[0]).ok, false);
  }
});

test('source SKU changes match by unique goods ID and variant, never by row index', () => {
  const saved = { ...savedItem(1), sellerSku: 'DEMO-1234567', variant: 'Blue-L' };
  const manual = { ...savedItem(1), sellerSku: '手工明细-1', source: 'manual-added' };
  const live = [liveItem('76543210'), liveItem('YDB--1234567-181', 'Blue-L')];
  const result = Core.reconcilePurchaseItems(live, [saved, manual]);
  assert.equal(result.items[0].purchaseLink, '');
  assert.equal(result.items[1].purchaseLink, saved.purchaseLink);
  assert.equal(result.items[1].sellerSku, 'YDB--1234567-181');
  assert.deepEqual(result.items[2], manual);
  assert.equal(result.changed, true);
});

test('ambiguous aliases do not move a purchase link onto a different sales item', () => {
  const saved = [
    { ...savedItem(1), sellerSku: 'OLD-1234567-A' },
    { ...savedItem(1), sellerSku: 'OLD-1234567-B' },
  ];
  const result = Core.reconcilePurchaseItems([liveItem('YDB--1234567-181')], saved);
  assert.equal(result.items[0].purchaseLink, '');
  assert.equal(result.changed, true);
  assert.equal(saved.length, 2);
});

test('cancelled-only products do not reappear from saved drafts; failed parses preserve saved drafts', () => {
  const saved = [savedItem(2)];
  assert.deepEqual(Core.reconcilePurchaseItems([], saved), { items: [], changed: true });
  assert.deepEqual(Core.reconcilePurchaseItems([{ source: 'manual-fallback' }], saved).items, saved);
});
