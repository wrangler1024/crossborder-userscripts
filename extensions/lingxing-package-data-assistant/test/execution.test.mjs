import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openJournal, newBatch, pendingProductIds } from '../src/journal.mjs';
import { executeBatch, preflight, verifyBatch } from '../src/execution.mjs';
import { createNativeImporter, validateNativeImport, NATIVE_IMPORT_PATH } from '../src/native-import.mjs';
import { intent, journal, memoryJournal, reportRows, product, testClient, testWindow, setPackage, STORE, SCOPE, COMPANY, cryptoObject } from './fixtures.mjs';
function batch() { return newBatch(SCOPE, reportRows(), STORE, 'fill', [intent()], cryptoObject); }
function importerFor(client, { update = true, throwAfter = false } = {}) {
  return { submissions: 0, async prepare() { return {}; }, submit(_handle, _bytes, name) { this.submissions++; assert.match(name, /\.xlsx$/); if (update) setPackage(client.p, intent().values); if (throwAfter) throw new Error('timeout after dispatch'); }, status() { return { phase: 'complete', taskId: 'TEST-TASK-001' }; }, cancel() {} };
}
test('journal isolates account details while company-level pending target guards span local accounts', async () => {
  const factory = new IDBFactory(), a = await openJournal(factory, SCOPE, COMPANY), b = await openJournal(factory, 'b'.repeat(64), COMPANY), c = await openJournal(factory, 'd'.repeat(64), 'e'.repeat(64));
  const value = batch(); value.rows[0].status = 'submitted'; await a.write(value);
  assert.equal((await a.list()).length, 1); assert.deepEqual(await b.list(), []); assert.deepEqual([...await b.pendingTargets()], ['2001']); assert.equal((await c.pendingTargets()).size, 0);
  await assert.rejects(b.write(value), /账号不一致/); a.close(); b.close(); c.close();
});
test('durable submission intent is saved before native file dispatch and completion requires readback', async () => {
  const repo = await journal(), client = testClient(), importer = importerFor(client), value = batch();
  const originalWrite = repo.write; let durable = false;
  repo.write = async b => { await originalWrite(b); if (b.rows.every(r => r.status === 'submitted')) durable = true; };
  const originalSubmit = importer.submit;
  importer.submit = function(...args) { assert.ok(durable); return originalSubmit.apply(this, args); };
  await executeBatch({ win: testWindow(), client, importer, journal: repo, batch: value, bytes: new Uint8Array([1]), maxPolls: 1 });
  assert.equal(importer.submissions, 1); assert.equal(value.rows[0].status, 'success'); assert.equal(value.nativeTaskId, 'TEST-TASK-001'); assert.equal((await repo.list())[0].rows[0].old[0], '0.00'); assert.equal((await repo.pendingTargets()).size, 0); repo.close();
});
test('missing stock units and packaging weight below net weight pass preflight and readback with net untouched', async () => {
  const p = product({ unit: '' }); p.spec_info.cg_product_net_weight = '300';
  const client = testClient(p), importer = importerFor(client), repo = memoryJournal();
  const value = newBatch(SCOPE, reportRows(), STORE, 'overwrite', [intent({ products: new Map([['2001', p]]) })], cryptoObject);
  await executeBatch({ win: testWindow(), client, importer, journal: repo, batch: value, bytes: [], maxPolls: 1 });
  assert.equal(importer.submissions, 1); assert.equal(value.rows[0].status, 'success');
  assert.equal(client.p.spec_info.cg_product_net_weight, '300'); assert.equal(client.p.unit, '');
  assert.equal(client.p.spec_info.spec_pack_list[0].cg_product_gross_weight, '90.1250');
});
test('a storage failure prevents native preparation from dispatching any file', async () => {
  const client = testClient(), importer = importerFor(client), repo = memoryJournal(); repo.write = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(executeBatch({ win: testWindow(), client, importer, journal: repo, batch: batch(), bytes: [], maxPolls: 1 }), /storage/); assert.equal(importer.submissions, 0);
});
test('stale pairing, old value, unit or target box stops execution before native upload', async () => {
  for (const mutate of [c => { c.p.sku = 'OTHER'; }, c => { c.p.spec_info.spec_pack_list[0].cg_package_width = '7'; }, c => { c.p.spec_info.spec_pack_list[0].cg_product_gross_weight_unit = 'kg'; }, c => { c.p.spec_info.spec_pack_list[0].pps_id = '210752555712800099'; }]) {
    const client = testClient(); mutate(client); const importer = importerFor(client);
    await assert.rejects(executeBatch({ win: testWindow(), client, importer, journal: memoryJournal(), batch: batch(), bytes: [] })); assert.equal(importer.submissions, 0);
  }
  const changed = testClient(); changed.listings = async () => [{ store_id: '1001', msku: 'AMZ-001', asin: 'B0TEST0001', fnsku: 'X0TEST0001', product_id: '2002', local_sku: 'LOCAL-002', is_pair: 1 }]; await assert.rejects(preflight(changed, STORE, [intent()]), /配对关系/);
});
test('timeout after dispatch remains unknown, blocks resubmission, and can be recovered by reads only', async () => {
  const client = testClient(), repo = await journal(), importer = importerFor(client, { update: false, throwAfter: true }), first = batch();
  await assert.rejects(executeBatch({ win: testWindow(), client, importer, journal: repo, batch: first, bytes: [] }), /timeout/);
  assert.equal((await repo.list())[0].rows[0].status, 'unknown'); assert.ok(pendingProductIds(await repo.list()).has('2001'));
  await assert.rejects(executeBatch({ win: testWindow(), client, importer, journal: repo, batch: batch(), bytes: [] }), /未核实/); assert.equal(importer.submissions, 1);
  setPackage(client.p, first.rows[0].values); await verifyBatch(client, first, repo); assert.equal(first.rows[0].status, 'success'); assert.equal(importer.submissions, 1); repo.close();
});
test('native success message alone cannot mark an unchanged product successful', async () => {
  const client = testClient(), importer = importerFor(client, { update: false }), value = batch(), repo = memoryJournal();
  await executeBatch({ win: testWindow(), client, importer, journal: repo, batch: value, bytes: [], maxPolls: 1 }); assert.equal(value.rows[0].status, 'unknown'); assert.match(value.rows[0].message, /尚未/);
});
test('non-target specs, net weight and other boxes are part of readback invariants', async () => {
  const client = testClient(), value = batch(), repo = memoryJournal(); setPackage(client.p, value.rows[0].values); client.p.spec_info.cg_product_length = '999'; value.rows[0].status = 'unknown';
  await verifyBatch(client, value, repo); assert.equal(value.rows[0].status, 'unknown'); assert.match(value.rows[0].message, /其他规格/);
});
test('company mutex denial never starts native preparation or writes', async () => {
  const client = testClient(), importer = importerFor(client), win = testWindow(); win.navigator.locks.request = async (name, _opts, callback) => { assert.ok(name.endsWith(COMPANY)); return callback(null); };
  await assert.rejects(executeBatch({ win, client, importer, journal: memoryJournal(), batch: batch(), bytes: [] }), /另一个窗口/); assert.equal(importer.submissions, 0);
});
test('aborting after dispatch retains unknown state without cancelling or repeating the ERP task', async () => {
  const client = testClient(), repo = memoryJournal(), controller = new AbortController(), importer = importerFor(client, { update: false }); importer.submit = function() { this.submissions++; controller.abort(); };
  const value = batch(); await executeBatch({ win: testWindow(), client, importer, journal: repo, batch: value, bytes: [], signal: controller.signal }); assert.equal(value.rows[0].status, 'unknown'); assert.equal(importer.submissions, 1);
});
function nativeFixture() {
  const input = { isConnected: true, multiple: false, files: [], dispatches: 0, dispatchEvent() { this.dispatches++; } };
  const uploader = { action: 'https://gw.lingxingerp.com' + NATIVE_IMPORT_PATH, autoUpload: true, accept: '.xlsx', data: {} };
  const component = { businessId: '001001002', importChildData: { importDialogVisible: false, params: {} }, skuUpdate: [{ options: [{ id: 'cg_price' }, { id: 'cg_package' }, { id: 'cg_product_gross_weight' }], value: [] }], async $nextTick() { uploader.data = importer.importData; }, beforeUpload(_e, _deny) { this.importChildData.businessId = this.businessId; this.importChildData.params.selected_fields = this.skuUpdate.flatMap(g => g.value).join(','); } };
  const importer = { uploadedFile: null, $el: { querySelector: () => input }, $refs: { upload: uploader }, computeImportData() { return { businessId: component.importChildData.businessId, extParams: JSON.stringify(component.importChildData.params) }; } }; component.$refs = { compoundImport: importer };
  class Transfer { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } }
  return { component, importer, input, uploader, win: { DataTransfer: Transfer, File, Event } };
}
test('native adapter selects exactly two update groups and dispatches a generated file at most once', async () => {
  const f = nativeFixture(), adapter = createNativeImporter(f.win, { context: () => f.component }), handle = await adapter.prepare();
  assert.deepEqual(f.component.skuUpdate[0].value.sort(), ['cg_package', 'cg_product_gross_weight']); assert.equal(f.input.dispatches, 0);
  adapter.submit(handle, new Uint8Array([1, 2]), 'test.xlsx'); assert.equal(f.input.dispatches, 1); assert.equal(f.input.files[0].name, 'test.xlsx'); assert.throws(() => adapter.submit(handle, [], 'again.xlsx'), /已使用/); assert.equal(f.input.dispatches, 1);
});
test('native adapter refuses extra fields, changed upload routes and preexisting imports', async () => {
  const f = nativeFixture(), adapter = createNativeImporter(f.win, { context: () => f.component }), handle = await adapter.prepare();
  f.component.skuUpdate[0].value.push('cg_price'); assert.throws(() => adapter.submit(handle, [], 'test.xlsx'), /额外字段/); assert.equal(f.input.dispatches, 0);
  f.component.skuUpdate[0].value.pop(); f.uploader.action = 'https://other.example/import'; assert.throws(() => validateNativeImport(f.component, f.uploader), /入口已变化/);
  await assert.rejects(adapter.prepare(), /当前原生导入窗口/);
});
test('native preparation clears a completed previous task before observing the new batch', async () => {
  const f = nativeFixture(); Object.assign(f.importer, { uploadedFile: {}, importCenterStatus: '2', importCenterTaskId: 'OLD-TASK', current_task: 'OLD-TASK', succ_num: 50 });
  const adapter = createNativeImporter(f.win, { context: () => f.component }), handle = await adapter.prepare();
  assert.equal(adapter.status(handle).taskId, ''); assert.equal(adapter.status(handle).phase, 'processing'); assert.equal(adapter.status(handle).successful, 0); assert.equal(f.input.dispatches, 0);
});
test('a cold native page is switched from add to update before validating business ID and waits for its lazy uploader', async () => {
  const f = nativeFixture();
  Object.defineProperty(f.component, 'businessId', { get() { return this.importChildData.params.import_type === 'set' ? '001001002' : '001001001'; } });
  f.importer.$refs = {}; f.component.$nextTick = async () => { if (f.component.importChildData.importDialogVisible) f.importer.$refs.upload = f.uploader; f.uploader.data = f.importer.importData; };
  assert.equal(f.component.businessId, '001001001');
  const adapter = createNativeImporter(f.win, { context: () => f.component }), handle = await adapter.prepare();
  assert.equal(f.component.businessId, '001001002'); assert.equal(f.input.dispatches, 0); assert.equal(adapter.status(handle).taskId, ''); adapter.cancel(handle); assert.equal(f.component.importChildData.importDialogVisible, false);
});
