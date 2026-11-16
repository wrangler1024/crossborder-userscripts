import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { createPackageApp, validReportDate } from '../src/app.mjs';
import { mountPackageUI } from '../src/ui.mjs';
import { HEADERS, XLSX, STORE, cryptoObject, memoryJournal, testClient, setPackage, intent } from './fixtures.mjs';
function setup({ client = testClient(), journal = memoryJournal() } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://erp.lingxing.com/erp/productManage', pretendToBeVisual: true });
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); }; dom.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  const app = createPackageApp(dom.window, { XLSX, client, journal, importer: {}, cryptoObject });
  const ui = mountPackageUI(dom.window, app); return { app, ui, dom };
}
function file() { return new File([[HEADERS, ['AMZ-001', 'B0TEST0001', 'X0TEST0001', 'UK', '标题', '15', '10', '3', 'cm', '90.125', 'g']].map(row => row.join('\t')).join('\n')], 'FeePreview.txt'); }
test('calendar validation rejects rollover dates', () => { assert.ok(validReportDate('2026-11-01')); for (const d of ['', '2026-02-30', '2026-13-01', '01/11/2026']) assert.equal(validReportDate(d), false); });
test('real application imports a report and uses the existing pairing without any operator mapping data', async () => {
  const { app, ui, dom } = setup(); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01');
  assert.equal(app.state.records[0].localSku, 'LOCAL-001'); assert.equal(app.state.checked.size, 1); assert.equal(app.state.report.fileHash.length, 64); assert.match(ui.root.getElementById('main').textContent, /AMZ-001/); assert.match(ui.root.getElementById('main').textContent, /LOCAL-001/);
  assert.equal(ui.root.querySelector('button[data-action=confirm]').disabled, false); assert.equal(ui.root.querySelector('button[data-action=history]').disabled, false); dom.window.close();
});
test('the product preview displays the ERP image and retains a placeholder if image loading fails', async () => {
  const client = testClient(); client.p.pic_url = 'https://images.example.test/product.jpg';
  const { app, ui, dom } = setup({ client }); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01');
  const image = ui.root.querySelector('.product-art img'); assert.ok(image);
  assert.equal(image.getAttribute('src'), client.p.pic_url); assert.equal(image.getAttribute('alt'), client.p.name);
  image.dispatchEvent(new dom.window.Event('error'));
  assert.equal(ui.root.querySelector('.product-art img'), null); assert.ok(ui.root.querySelector('.product-art svg'));
  assert.equal(ui.root.querySelector('.product-art').title, '商品图片加载失败'); assert.equal(app.state.records[0].status.key, 'ready'); dom.window.close();
});
test('the default mode replaces existing packaging values with the report despite missing stock units and larger net weight', async () => {
  const client = testClient(); client.p.unit = ''; client.p.spec_info.cg_product_net_weight = '300'; setPackage(client.p, ['12.00', '8.00', '2.00', '200.0000']);
  const { app, ui, dom } = setup({ client }); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01');
  assert.equal(app.state.mode, 'overwrite'); assert.equal(app.state.records[0].status.key, 'ready'); assert.equal(app.state.checked.size, 1);
  assert.deepEqual(app.confirmation().rows[0].values, ['15.00', '10.00', '3.00', '90.1250']);
  assert.ok(ui.root.querySelector('[data-mode="overwrite"]').classList.contains('active')); dom.window.close();
});
test('foreign records are omitted from reads, counted separately and show the report and selected sites', async () => {
  const client = testClient(), original = client.listings; let queried;
  client.listings = async (store, mskus) => { queried = mskus; return original(store, mskus); };
  const { app, ui, dom } = setup({ client }); await app.initialize();
  const rows = [HEADERS, ['AMZ-001', 'B0TEST0001', 'X0TEST0001', 'UK', 'Local', '15', '10', '3', 'cm', '90', 'g'], ['AMZ-FOREIGN', 'B0TEST0002', '', 'US', 'Foreign product', '15', '10', '3', 'cm', '95', 'g']];
  await app.importReport(new File([rows.map(r => r.join('\t')).join('\n')], 'FeePreview.txt'), STORE.id, '2026-11-01');
  assert.deepEqual(queried, ['AMZ-001']); assert.equal(app.state.checked.size, 1);
  const skipped = app.state.records.find(r => r.status.key === 'skipped'); app.select(skipped.id, true); app.selectAll();
  assert.equal(app.state.checked.size, 1); assert.equal(app.confirmation().rows.length, 1);
  assert.match(ui.root.querySelector('[data-filter="issue"]').textContent, /0待处理/);
  assert.match(ui.root.querySelector('[data-filter="skipped"]').textContent, /1已跳过/);
  assert.match(ui.root.getElementById('sourceLine').textContent, /已跳过 1 条其他站点/);
  ui.root.querySelector('[data-row="' + skipped.id + '"]').click();
  assert.match(ui.root.getElementById('main').textContent, /报表站点 US.*当前店铺 GB.*已跳过/);
  assert.match(ui.root.getElementById('main').textContent, /不参与本次更新/); dom.window.close();
});
test('an entirely foreign report causes no listing or product reads and cannot produce an update', async () => {
  const client = testClient(); client.listings = async () => { throw new Error('Must not read listings'); }; client.product = async () => { throw new Error('Must not read products'); };
  const { app, dom } = setup({ client }); await app.initialize();
  const rows = [HEADERS, ['AMZ-FOREIGN', 'B0TEST0002', '', 'US', '', '15', '10', '3', 'cm', '95', 'g']];
  await app.importReport(new File([rows.map(r => r.join('\t')).join('\n')], 'FeePreview.txt'), STORE.id, '2026-11-01');
  assert.equal(app.state.records[0].status.key, 'skipped'); assert.equal(app.state.checked.size, 0);
  assert.throws(() => app.confirmation(), /请勾选/); dom.window.close();
});
test('legacy CSV reaches the existing pairing flow with original file hash and no update submission', async () => {
  const { app, ui, dom } = setup(); await app.initialize();
  const rows = [HEADERS, ['AMZ-001', 'B0TEST0001', 'X0TEST0001', 'UK', 'Masajeador eléctrico', '15', '10', '3', 'centimeters', '90.125', 'grams']];
  const bytes = Buffer.from('?' + rows.map(row => row.map(v => '"' + v + '"').join(',')).join('\r\n'), 'latin1');
  await app.importReport(new File([bytes], 'FeePreview.csv'), STORE.id, '2026-11-01');
  assert.equal(app.state.report.encoding, 'windows-1252'); assert.equal(app.state.report.headerPrefixRemoved, true);
  assert.equal(app.state.report.fileHash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(app.state.records[0].localSku, 'LOCAL-001'); assert.equal(app.state.checked.size, 1);
  assert.match(ui.root.getElementById('main').textContent, /LOCAL-001/);
  assert.equal(app.state.currentBatch, null); dom.window.close();
});
test('initial loading does not leave static toolbar controls disabled, and user must acknowledge actual update confirmation', async () => {
  const { app, ui, dom } = setup(); await app.initialize(); assert.equal(ui.root.querySelector('button[data-action=import]').disabled, false);
  await app.importReport(file(), STORE.id, '2026-11-01'); ui.open(); ui.root.querySelector('button[data-action=confirm]').click();
  assert.equal(ui.root.getElementById('executeButton').disabled, true); const check = ui.root.getElementById('confirmChecked'); check.checked = true; check.dispatchEvent(new dom.window.Event('change')); assert.equal(ui.root.getElementById('executeButton').disabled, false); assert.match(ui.root.getElementById('dialog').textContent, /领星原生导入/); dom.window.close();
});
test('changing mode or report date invalidates an already-prepared confirmation', async () => {
  const { app, dom } = setup(); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01'); const confirmation = app.confirmation(); app.setDate('2026-11-02'); await assert.rejects(app.execute(confirmation), /预览已变化/); dom.window.close();
});
test('a failed replacement import clears the old selection instead of leaving an executable old batch selected', async () => {
  const { app, dom } = setup(); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01'); assert.equal(app.state.checked.size, 1);
  await assert.rejects(app.importReport(new File(['bad'], 'bad.csv'), STORE.id, '2026-11-01')); assert.equal(app.state.checked.size, 0); assert.throws(() => app.confirmation(), /请勾选/); dom.window.close();
});
test('company pending records are excluded from the preview and cannot be selected in overwrite mode', async () => {
  const repo = memoryJournal(); repo.pendingTargets = async () => new Set(['2001']); const { app, dom } = setup({ journal: repo }); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01'); app.setMode('overwrite'); app.selectAll(); assert.equal(app.state.checked.size, 0); assert.equal(app.state.records[0].status.kind, 'unknown'); dom.window.close();
});
test('successful readback refreshes the preview so completed products are not proposed for another upload', async () => {
  const client = testClient(), { app, dom } = setup({ client });
  // This separate controller exercises the same UI model with an offline native adapter.
  app.dispose();
  Object.defineProperty(dom.window.navigator, 'locks', { value: { request: async (_name, _opts, callback) => callback({}) } });
  const importer = { async prepare() { return {}; }, submit() { setPackage(client.p, ['15.00', '10.00', '3.00', '90.1250']); }, status() { return { phase: 'complete', taskId: 'TEST-TASK' }; }, cancel() {} };
  const model = createPackageApp(dom.window, { XLSX, client, journal: memoryJournal(), importer, cryptoObject });
  await model.initialize(); await model.importReport(file(), STORE.id, '2026-11-01'); await model.execute(model.confirmation());
  assert.equal(model.state.currentBatch.rows[0].status, 'success'); assert.equal(model.state.records[0].status.key, 'same'); assert.equal(model.state.checked.size, 0); model.selectAll(); assert.equal(model.state.checked.size, 0); dom.window.close();
});
test('HTML in source and local product names is displayed as text; account invalidation clears visible records', async () => {
  const client = testClient(); client.p.name = '<img src=x onerror=alert(1)>'; const { app, ui, dom } = setup({ client }); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01'); assert.equal(ui.root.querySelectorAll('img').length, 0); assert.match(ui.root.getElementById('main').textContent, /<img src=x/); app.invalidate(); assert.equal(app.state.records.length, 0); assert.equal(app.state.report, null); assert.equal(ui.root.getElementById('store').options.length, 1); assert.equal(ui.root.querySelector('button[data-action=import]').disabled, true); dom.window.close();
});
test('account invalidation closes and empties old dialogs and clears retained report and product data', async () => {
  const { app, ui, dom } = setup(); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01');
  ui.open(); ui.root.querySelector('button[data-action=confirm]').click();
  const dialog = ui.root.getElementById('dialog'); assert.equal(dialog.open, true); assert.match(dialog.textContent, /示例店铺 UK/);
  app.invalidate();
  assert.equal(dialog.open, false); assert.equal(dialog.textContent, '');
  assert.equal(app.state.products.size, 0); assert.deepEqual(app.state.listings, []); assert.equal(app.state.storeId, ''); assert.equal(app.state.reportDate, '');
  assert.equal(ui.root.getElementById('reportDate').value, ''); assert.equal(ui.root.querySelector('button[data-action=confirm]').disabled, true); dom.window.close();
});
test('late journal responses cannot restore a previous account batch after invalidation', async () => {
  const journal = memoryJournal(), { app, ui, dom } = setup({ journal }); await app.initialize(); await app.importReport(file(), STORE.id, '2026-11-01');
  let finishList; journal.list = () => new Promise(resolve => { finishList = resolve; });
  const pending = app.verify('previous-batch'); app.invalidate();
  finishList([{ id: 'previous-batch', filename: 'previous-account-report.txt', reportDate: '2026-11-01', store: STORE, nativeTaskId: '', rows: [{ ...intent(), localSku: 'PREVIOUS-ACCOUNT-SKU' }] }]);
  await assert.rejects(pending, /账号已变化/); ui.open();
  assert.equal(app.state.currentBatch, null); assert.equal(app.state.view, 'preview'); assert.deepEqual(app.state.batches, []);
  assert.doesNotMatch(ui.root.textContent, /previous-account-report|PREVIOUS-ACCOUNT-SKU/); dom.window.close();
});
