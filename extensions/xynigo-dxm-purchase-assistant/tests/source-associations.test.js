'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.js');
const fixture = require('./fixtures/source-association-builder.cjs');

test('same goods ID has distinct sales SKU references, independent of purchasing specs', () => {
  const f = fixture();
  assert.equal(f.products[0].sellerSku, f.products[1].sellerSku);
  assert.notEqual(f.products[0].sourceRef.key, f.products[1].sourceRef.key);
  assert.equal(f.products[0].sourceRef.sku, 'SYNTH-A');
  assert.equal(Core.createSalesSourceKey(' ＳＹＮＴＨ-Ａ ', ' Black – M '), f.products[0].sourceRef.key);
  const key = f.draft.items[1].sourceRef.key;
  f.draft.items[1].purchaseLink = f.draft.items[0].purchaseLink;
  f.draft.items[1].mainSpec = 'Changed color';
  f.draft.items[1].subSpec = 'Changed size';
  assert.equal(f.draft.items[1].sourceRef.key, key);
  assert.equal(Core.createXyp2Remark(f.draft).ok, true);
});

test('split purchasing shares a source with exactly one sales amount owner; extras have none', () => {
  const { draft, remark } = fixture();
  const payload = JSON.parse(remark.slice(6, -7));
  assert.equal(payload.a[0], 1);
  assert.equal(payload.i[1][10][0], payload.i[2][10][0]);
  assert.equal(payload.i[1][10][1], 1);
  assert.equal(payload.i[2][10][1], 0);
  assert.deepEqual(payload.i[3][10], ['', 0, 0]);
  assert.equal(draft.items[2].purchaseQty, 3);
  assert.equal(draft.items[2].sourceRef.quantity, 1);
  const parsed = Core.parseXyp2Remark(remark);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.items[2].sourceRef.key, draft.items[2].sourceRef.key);
  assert.equal(Core.createXyp2Remark({ ...draft, items: parsed.items }).text, remark);
  assert.equal(Core.createXyp2Remark(draft, 100).ok, false, 'the export limit must never drop associations');
});

test('deleting or reassigning the amount owner transfers ownership without changing purchases', () => {
  const { draft, products, order } = fixture();
  const items = draft.items;
  items.splice(1, 1);
  Core.normalizeSourceOwners(items);
  assert.equal(items[1].sourceAmountOwner, true);
  assert.equal(items[1].purchaseQty, 3);
  const purchaseLink = items[1].purchaseLink;
  Core.setSalesSource(items, items[1], products[1], order);
  assert.equal(items[1].sourceAmountOwner, false);
  assert.equal(items[0].sourceAmountOwner, true);
  assert.equal(items[1].purchaseLink, purchaseLink);
  assert.equal(Core.validateSourceReferences(items, order), '');
});

test('draft recovery preserves split references and flags removed or changed sales sources', () => {
  const f = fixture();
  const restored = Core.reconcilePurchaseItems(f.products, f.draft.items);
  assert.equal(restored.items.length, 4);
  assert.equal(restored.items[2].purchaseQty, 3);
  assert.equal(restored.items[2].sourceRef.key, f.products[0].sourceRef.key);
  assert.deepEqual(Core.createValidatedPurchaseDraft(f.order, restored.items).items, f.draft.items);
  const changed = [{ ...f.products[0], sourceRef: { ...f.products[0].sourceRef, quantity: 2 } }, f.products[1]];
  const pending = Core.reconcilePurchaseItems(changed, restored.items);
  assert.equal(pending.items[1].sourceRef.mode, 'unconfirmed');
  assert.equal(pending.items[2].sourceRef.mode, 'unconfirmed');
  assert.equal(pending.items[2].purchaseQty, 3);
  assert.equal(Core.createXyp2Remark({ ...f.draft, items: pending.items }).ok, false);
  const removed = Core.reconcilePurchaseItems([f.products[1]], restored.items);
  assert.equal(removed.items[1].sourceRef.mode, 'unconfirmed');
  assert.equal(removed.items[2].sourceRef.mode, 'unconfirmed');
  assert.equal(removed.items[3].sourceRef.mode, 'extra');
});

test('new unconfirmed lines can be saved as drafts but require selection before submission', () => {
  const f = fixture();
  f.draft.items[2].sourceRef.mode = 'unconfirmed';
  const draft = Core.createPurchaseDraft(f.order, f.draft.items);
  assert.equal(draft.items[2].sourceRef.mode, 'unconfirmed');
  assert.equal(Core.createXyp2Remark(draft).ok, false);
  assert.throws(() => Core.createValidatedPurchaseDraft(f.order, draft.items), /请选择来源/);
  draft.items[2].sourceRef.mode = 'linked';
  draft.items[2].sourceAmountOwner = true;
  assert.equal(Core.createXyp2Remark(draft).ok, false, 'duplicate sales amount owners cannot be submitted');
});

test('cross-package references are rejected and legacy remarks keep their original ten columns', () => {
  const f = fixture();
  assert.match(Core.validateSourceReferences(f.draft.items, { ...f.order, packageId: 'XMWUSYNTHOTHER' }), /当前订单包裹/);
  const legacy = { ...f.draft, items: [f.draft.items[0]].map(({ sourceRef, sourceAmountOwner, ...item }) => item) };
  const remark = Core.createXyp2Remark(legacy);
  assert.equal(remark.ok, true);
  assert.equal(remark.payload.i[0].length, 10);
  assert.equal(remark.payload.a, undefined);
  assert.equal(Core.parseXyp2Remark(remark.text).items[0].sourceRef, undefined);
});

test('damaged optional association metadata is visible without losing purchasing data', () => {
  const f = fixture();
  for (const change of [
    (payload) => { payload.a[0] = 99; },
    (payload) => { payload.i[1].pop(); },
    (payload) => { payload.i[1][10][1] = true; },
  ]) {
    const payload = JSON.parse(f.remark.slice(6, -7));
    change(payload);
    const parsed = Core.parseXyp2Remark(`[XYP2]${JSON.stringify(payload)}[/XYP2]`);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.items.length, 4);
    assert.equal(parsed.items[2].purchaseQty, 3);
    assert.ok(parsed.associationWarnings.length);
    assert.equal(Core.createXyp2Remark({ ...f.draft, items: parsed.items }).ok, false);
  }
});
