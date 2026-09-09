'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const Core = require('../src/core.js');
const root = path.resolve(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/order-detail.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
const cases = require('./fixtures/product-parsing.json');

async function waitFor(predicate) {
  const until = Date.now() + 4000;
  while (Date.now() < until) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Synthetic purchase form did not become ready');
}

async function openFixture(t, products, savedItems, nested = false, recordExtras = {}) {
  const dom = new JSDOM(fixture, {
    url: 'https://dianxiaomi.com/web/order/paid',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const { document } = window;
  const body = document.querySelector('.mock-detail-body + table tbody');
  body.replaceChildren();
  for (const text of products) {
    const row = document.createElement('tr');
    const order = row.insertCell();
    order.textContent = 'GSHDEMO0001';
    const product = row.insertCell();
    if (typeof text === 'object') {
      product.innerHTML = text.html;
      body.appendChild(row);
      continue;
    }
    const parts = text.split('已取消');
    product.append(document.createTextNode(parts[0]));
    if (parts.length > 1) {
      const badge = document.createElement('span');
      badge.textContent = '已取消';
      product.append(badge, document.createTextNode(parts[1]));
    }
    body.appendChild(row);
  }
  if (nested) {
    const table = document.createElement('table');
    const innerBody = table.createTBody();
    innerBody.append(...body.children);
    body.insertRow().insertCell().appendChild(table);
  }
  // JSDOM has no layout engine; expose visible fixture geometry to the existing UI code.
  window.Element.prototype.getBoundingClientRect = function getRect() {
    const hidden = this.closest('[hidden]');
    const width = hidden ? 0 : (this.matches('.mock-tabs') ? 180 : 900);
    const height = hidden ? 0 : (this.matches('.mock-modal') ? 900 : 260);
    return { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height };
  };
  const requests = [];
  const writes = [];
  const record = savedItems ? {
    orderKey: 'synthetic-draft', packageId: 'XMWUDEMO0001', items: savedItems,
    remoteSubmissionStatus: 'draft',
    ...recordExtras,
  } : null;
  window.XynigoPurchaseCore = Core;
  window.chrome = {
    runtime: {
      sendMessage(message, callback) {
        requests.push(message);
        callback({ ok: false, error: { code: 'purchase_order_not_found', message: '合成测试无远端记录' } });
      },
    },
    storage: {
      local: {
        get(_keys, callback) { callback(record ? { 'xynigoDxmPurchaseRecord:synthetic-draft': record } : {}); },
        set(values, callback) { writes.push(values); callback(); },
      },
      onChanged: { addListener() {} },
    },
  };
  window.eval(source);
  await waitFor(() => document.querySelector('.xynigo-dxm-footer-submit'));
  return { window, document, requests, writes, record };
}

test('DOM to form: four reported cases use effective quantities and seven-digit source links', async (t) => {
  const app = await openFixture(t, cases.flatMap((entry) => entry.products), undefined, true);
  const lines = [...app.document.querySelectorAll('.xynigo-dxm-line')];
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((line) => line.querySelector('[data-field="purchaseQty"]').value), ['1', '1', '1', '1']);
  assert.ok(lines[2].querySelector('a.xynigo-dxm-source-product-link').href.endsWith('/x-p-1234567.html'));
  assert.match(lines[2].textContent, /YDB--/);
  for (const [index, line] of lines.entries()) {
    const link = line.querySelector('[data-field="purchaseLink"]');
    link.value = `https://www.shein.com.mx/x-p-${cases[index].goodsId}.html?goods_id=${cases[index].goodsId}&skucode=synthetic#xv=1&p=Test&s=L&gp=10&c=MXN`;
    link.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.doesNotMatch(line.querySelector('.xynigo-dxm-line-message').textContent, /采购数量需与销售数量/);
    const qty = line.querySelector('[data-field="purchaseQty"]');
    qty.value = '2';
    qty.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.doesNotMatch(line.querySelector('.xynigo-dxm-line-message').textContent, /采购数量需与销售数量/);
    assert.match(line.querySelector('.xynigo-dxm-source-association').textContent, /数量 1/);
  }
  assert.ok(app.requests.every((request) => request.type === 'xynigo-dxm:get-order'));
  assert.equal(app.writes.length, 0);
});

test('DOM to form: stale draft quantity is corrected while purchase data and original cache stay intact', async (t) => {
  const saved = [{
    sellerSku: '87654321', variant: 'Black-L', salesQty: 8, purchaseQty: 8,
    purchaseLink: 'https://www.shein.com.mx/x-p-87654321.html?goods_id=87654321&skucode=synthetic',
    guidePrice: 10, mainSpec: 'Negro', subSpec: 'L', source: 'page-parser',
  }];
  const original = JSON.stringify(saved);
  const app = await openFixture(t, cases[0].products, saved);
  assert.equal(app.document.querySelector('[data-field="purchaseQty"]').value, '1');
  assert.equal(app.document.querySelector('[data-field="purchaseLink"]').value, saved[0].purchaseLink);
  assert.equal(app.document.querySelector('[data-field="mainSpec"]').value, 'Negro');
  assert.match(app.document.querySelector('.xynigo-dxm-drawer').textContent, /重新核对明细/);
  assert.equal(JSON.stringify(app.record.items), original);
  assert.equal(app.writes.length, 0);
});

test('submitted edits send the loaded revision and keep it after a conflict without writing remarks', async (t) => {
  const saved = [{
    sellerSku: '87654321', variant: 'Black-L', salesQty: 1, purchaseQty: 1,
    purchaseLink: 'https://www.shein.com.mx/x-p-87654321.html?goods_id=87654321&skucode=synthetic#xv=1&p=Negro&s=L&gp=10&c=MXN',
    guidePrice: 10, mainSpec: 'Negro', subSpec: 'L', source: 'page-parser',
  }];
  const app = await openFixture(t, cases[0].products, saved, false, {
    remoteSubmissionStatus: 'submitted', remoteDraftRevision: 7,
    remoteSubmittedBy: { id: 'synthetic-operator-a', name: '合成运营甲' },
  });
  Object.defineProperty(app.window.navigator, 'clipboard', {
    configurable: true, value: { async writeText() {} },
  });
  app.window.chrome.runtime.sendMessage = (message, callback) => {
    app.requests.push(message);
    callback({ ok: false, error: {
      code: 'purchase_revision_conflict', message: '采购明细已被其他账号修改，请重新打开核对',
    } });
  };
  app.document.querySelector('.xynigo-dxm-footer-submit').click();
  await waitFor(() => app.requests.some((request) => request.type === 'xynigo-dxm:submit'));
  await waitFor(() => app.writes.length > 0);
  assert.equal(app.requests.find((request) => request.type === 'xynigo-dxm:submit').draft.expectedDraftRevision, 7);
  const cached = Object.values(app.writes.at(-1))[0];
  assert.equal(cached.remoteDraftRevision, 7);
  assert.equal(cached.remoteSubmissionStatus, 'submitted');
  assert.equal(cached.remoteSubmittedBy.id, 'synthetic-operator-a');
  assert.equal(app.document.querySelector('[data-field="purchaseLink"]').value, saved[0].purchaseLink);
  assert.equal(app.window.__nativeRemarkSaveClicks, 0);
  assert.equal(app.window.__nativeRemarkEditSubmitClicks, 0);
});

test('inline SKU, x and badge nodes do not write a quantity suffix into XYP2', async (t) => {
  const app = await openFixture(t, [
    { html: '<div><a>DEMO-87654321-027</a>x<span>1</span></div><div>MXN 100.00</div><div>6188-87654321：Burgundy-S</div>' },
    { html: '<div><a>DEMO-76543210x8</a><span>x</span><b>3</b><span hidden>x9</span></div><div>MXN 100.00</div><div>76543210：Black-L</div>' },
  ]);
  const lines = [...app.document.querySelectorAll('.xynigo-dxm-line')];
  assert.equal(lines.length, 2);
  assert.match(lines[0].querySelector('strong').textContent, /^DEMO-87654321-027$/);
  assert.match(lines[1].querySelector('strong').textContent, /^DEMO-76543210x8$/);
  assert.equal(lines[0].querySelector('[data-field="purchaseQty"]').value, '1');
  assert.equal(lines[1].querySelector('[data-field="purchaseQty"]').value, '3');
  assert.equal(app.writes.length, 0);
});

test('DOM to form: an all-cancelled order cannot create a fallback purchase or submit a saved one', async (t) => {
  const app = await openFixture(t, [cases[3].products[1]], [{
    sellerSku: '65432109-demo', variant: 'Red-L', salesQty: 2, purchaseQty: 2, source: 'page-parser',
  }]);
  assert.equal(app.document.querySelectorAll('.xynigo-dxm-line').length, 0);
  app.document.querySelector('.xynigo-dxm-footer-save').click();
  app.document.querySelector('.xynigo-dxm-footer-submit').click();
  assert.ok(app.requests.every((request) => request.type === 'xynigo-dxm:get-order'));
  assert.equal(app.writes.length, 0);
  assert.match(app.document.querySelector('.xynigo-dxm-drawer').textContent, /当前订单没有有效商品/);
});

test('operator selects manual sources and extras, deletes an owner and undoes without losing purchases', async (t) => {
  const app = await openFixture(t, [
    { html: '<img src="https://img.ltwebstatic.com/test/a.jpg"><a>SYNTH-<span>A</span></a>x<span>1</span> MXN 100 YDB--87654321-181：Black-M' },
    { html: '<img src="https://img.ltwebstatic.com/test/b.jpg"><a>SYNTH-<span>B</span></a>x<span>1</span> MXN 100 YDB--87654321-181：Black-M' },
  ]);
  const lines = () => [...app.document.querySelectorAll('.xynigo-dxm-line')];
  const select = (index, value) => {
    const field = lines()[index].querySelector('.xynigo-dxm-source-select');
    field.value = value;
    field.dispatchEvent(new app.window.Event('change', { bubbles: true }));
  };
  const sourceA = lines()[0].querySelector('.xynigo-dxm-source-select').value;
  const sourceB = lines()[1].querySelector('.xynigo-dxm-source-select').value;
  assert.notEqual(sourceA, sourceB);
  const setLink = (index, id) => {
    const field = lines()[index].querySelector('[data-field="purchaseLink"]');
    field.value = `https://www.shein.com.mx/x-p-76543210.html?goods_id=76543210&skucode=${id}#xv=1&p=Different&s=Set&gp=10&c=MXN`;
    field.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  };
  setLink(0, 'FIRST');
  assert.equal(lines()[0].querySelector('.xynigo-dxm-source-select').value, sourceA);
  app.document.querySelector('.xynigo-dxm-add-line').click();
  assert.equal(lines()[2].querySelector('details').open, true);
  assert.equal(lines()[2].querySelector('select').value, '');
  select(2, sourceA);
  assert.equal(lines()[2].querySelector('.xynigo-dxm-source-preview img').src, 'https://img.ltwebstatic.com/test/a.jpg');
  setLink(2, 'SPLIT');
  const quantity = lines()[2].querySelector('[data-field="purchaseQty"]');
  quantity.value = '3';
  quantity.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  assert.match(lines()[2].querySelector('summary').textContent, /不重复计金额/);
  lines()[0].querySelector('.xynigo-dxm-remove-line').click();
  assert.equal(lines().length, 2);
  assert.match(lines()[1].querySelector('summary').textContent, /计入商品金额/);
  app.document.querySelector('.xynigo-dxm-undo-association').click();
  assert.equal(lines().length, 3);
  assert.equal(lines()[2].querySelector('[data-field="purchaseQty"]').value, '3');
  assert.match(lines()[2].querySelector('summary').textContent, /不重复计金额/);
  app.document.querySelector('.xynigo-dxm-add-line').click();
  select(3, '__extra__');
  assert.match(lines()[3].querySelector('summary').textContent, /额外采购/);
  app.document.querySelector('.xynigo-dxm-footer-save').click();
  await waitFor(() => app.requests.some((r) => r.type === 'xynigo-dxm:save-draft'));
  const draft = app.requests.find((r) => r.type === 'xynigo-dxm:save-draft').draft;
  assert.equal(draft.items.length, 4);
  assert.equal(draft.items[2].sourceRef.key, sourceA);
  assert.equal(draft.items[2].purchaseQty, 3);
  assert.equal(draft.items[3].sourceRef.mode, 'extra');
  assert.equal(draft.items.filter((item) => item.sourceRef.key === sourceA && item.sourceAmountOwner).length, 1);
});

test('sales quantity changes in the open page require association review before formal submission', async (t) => {
  const app = await openFixture(t, ['SYNTH-A x 1 MXN 100 YDB--87654321-181：Black-M']);
  const link = app.document.querySelector('[data-field="purchaseLink"]');
  link.value = 'https://www.shein.com.mx/x-p-76543210.html?goods_id=76543210&skucode=TEST#xv=1&p=Color&s=Size&gp=10&c=MXN';
  link.dispatchEvent(new app.window.Event('input', { bubbles: true }));
  const product = app.document.querySelector('.mock-detail-body + table tbody tr td:nth-child(2)');
  product.textContent = product.textContent.replace(' x 1 ', ' x 2 ');
  app.document.querySelector('.xynigo-dxm-footer-submit').click();
  assert.match(app.document.querySelector('.xynigo-dxm-source-association summary').textContent, /待确认来源/);
  assert.equal(app.requests.some((r) => r.type === 'xynigo-dxm:submit'), false);
  assert.equal(app.document.querySelector('[data-field="purchaseQty"]').value, '1');
  app.document.querySelector('.xynigo-dxm-footer-save').click();
  await waitFor(() => app.requests.some((r) => r.type === 'xynigo-dxm:save-draft'));
  assert.equal(app.requests.find((r) => r.type === 'xynigo-dxm:save-draft').draft.items[0].sourceRef.mode, 'unconfirmed');
});
