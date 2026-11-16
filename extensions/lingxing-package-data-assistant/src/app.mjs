import { parseReportBytes, parseReportWorkbook } from './parser.mjs';
import { createPlan, recordIntent } from './planner.mjs';
import { exactId } from './json.mjs';
import { marketCode } from './identity.mjs';
import { pendingProductIds, newBatch } from './journal.mjs';
import { updateWorkbook, csvText, saveBlob } from './workbook.mjs';
import { preflight, executeBatch, verifyBatch } from './execution.mjs';
export const APP_VERSION = '0.1.4';
export function validReportDate(date) { return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date; }
export async function fileDigest(bytes, cryptoObject = crypto) {
  return [...new Uint8Array(await cryptoObject.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function createPackageApp(win, { XLSX, client, journal, importer, cryptoObject = win.crypto }) {
  const state = { version: 0, stores: [], storeId: '', report: null, reportDate: '', records: [], listings: [], products: new Map(), decisions: {}, checked: new Set(), mode: 'overwrite', view: 'preview', currentBatch: null, batches: [], pending: new Set(), busy: false, busyLabel: '', error: '', notice: '', blocked: false };
  const listeners = new Set(), confirmations = new WeakSet(); let controller;
  const emit = () => listeners.forEach(fn => fn(state));
  const store = () => state.stores.find(s => s.id === state.storeId);
  const bump = () => { state.version++; };
  function assertUsable() { if (state.blocked) throw new Error('账号已变化，请刷新领星页面'); client.assertContext(); }
  function rebuild() {
    if (state.blocked || !state.report || !store()) return;
    state.records = createPlan(state.report, store(), state.listings, state.products, { mode: state.mode, decisions: state.decisions, pending: new Set([...state.pending, ...pendingProductIds(state.batches)]) });
    const allowed = new Set(state.records.filter(r => r.status.key === 'ready').map(r => r.id));
    state.checked = new Set([...state.checked].filter(id => allowed.has(id)));
  }
  async function reloadHistory() {
    const batches = await journal.list(), pending = await journal.pendingTargets?.(); assertUsable();
    state.batches = batches; state.pending = pending || pendingProductIds(batches); return batches;
  }
  async function run(label, work) {
    assertUsable(); if (state.busy) throw new Error('请等待当前操作完成');
    state.busy = true; state.busyLabel = label; state.error = ''; state.notice = ''; controller = new AbortController(); emit();
    try { return await work(controller.signal); }
    catch (error) { if (!state.blocked) state.error = String(error?.message || '操作未完成，请核对后重试').slice(0, 220); throw error; }
    finally { state.busy = false; state.busyLabel = ''; if (!state.blocked) emit(); }
  }
  async function match(signal) {
    const selectedStore = store(); if (!state.report || !selectedStore) throw new Error('请先选择店铺并导入报告');
    state.busyLabel = '按所选店铺和 MSKU 读取已有配对关系…'; emit();
    const matchingRows = state.report.rows.filter(r => !r.errors.length && (!r.market || marketCode(r.market) === selectedStore.country));
    const listings = matchingRows.length ? await client.listings(selectedStore, matchingRows.map(r => r.msku), signal) : [];
    const products = new Map();
    const ids = [...new Set(listings.filter(l => Number(l.is_pair) === 1 && l.local_sku && String(l.product_id) !== '0').map(l => exactId(l.product_id, '商品编号')))];
    for (let i = 0; i < ids.length; i++) {
      state.busyLabel = '读取包装资料 ' + (i + 1) + ' / ' + ids.length; emit();
      try { products.set(ids[i], await client.product(ids[i], signal)); }
      catch (error) { if (signal.aborted) throw error; client.assertContext(); products.set(ids[i], new Error('无法读取该本地商品，请核对权限或稍后重试')); }
    }
    assertUsable();
    await reloadHistory(); state.listings = listings; state.products = products;
    state.decisions = {}; state.checked.clear(); rebuild();
    state.records.filter(r => r.status.key === 'ready').forEach(r => state.checked.add(r.id));
    state.view = 'preview'; bump(); state.notice = '匹配完成：自动采用领星已有配对关系。';
  }
  function intents() {
    assertUsable();
    const records = state.records.filter(r => state.checked.has(r.id));
    if (!records.length || records.some(r => r.status.key !== 'ready')) throw new Error('请勾选已核对的可更新商品');
    return records.map(recordIntent);
  }
  return {
    state, client, journal,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async initialize() { return run('正在读取领星店铺…', async signal => { const stores = await client.stores(signal); assertUsable(); await reloadHistory(); state.stores = stores; }); },
    async importReport(file, storeId, reportDate) {
      return run('正在解析费用预估报告…', async signal => {
        state.checked.clear(); bump();
        if (!file || file.size === 0 || file.size > 20 * 1024 * 1024) throw new Error('请选择非空且不超过 20 MB 的原始报告');
        if (!state.stores.some(s => s.id === storeId)) throw new Error('请选择报告所属的具体店铺');
        if (!validReportDate(reportDate)) throw new Error('请填写有效的报告日期');
        if (!/\.(txt|tsv|csv|xlsx)$/i.test(file.name)) throw new Error('首版支持 TXT、TSV、CSV、XLSX');
        const bytes = await file.arrayBuffer();
        const metadata = { filename: file.name, fileHash: await fileDigest(bytes, cryptoObject), reportDate, importedAt: new Date().toISOString() };
        const report = /\.xlsx$/i.test(file.name) ? parseReportWorkbook(XLSX, bytes, metadata) : parseReportBytes(bytes, metadata);
        assertUsable(); if (signal.aborted) throw new Error('操作已停止');
        state.storeId = storeId; state.reportDate = reportDate; state.report = report; bump(); await match(signal);
      });
    },
    async rematch() { return run('正在重新匹配…', match); },
    async selectStore(id) {
      if (state.busy) throw new Error('请等待当前操作完成');
      if (!state.stores.some(s => s.id === id)) throw new Error('请选择店铺');
      assertUsable(); state.storeId = id; state.records = []; state.checked.clear(); state.listings = []; state.products.clear(); state.decisions = {}; bump(); emit();
      if (state.report) return run('切换店铺，重新匹配…', match);
    },
    setDate(date) { assertUsable(); if (state.busy) throw new Error('请等待当前操作完成'); if (!validReportDate(date)) throw new Error('报告日期无效'); state.reportDate = date; if (state.report) state.report.reportDate = date; bump(); emit(); },
    setMode(mode) { assertUsable(); if (!['fill', 'overwrite'].includes(mode) || state.busy) return; state.mode = mode; bump(); rebuild(); emit(); },
    chooseSource(productId, sourceKey) { assertUsable(); const record = state.records.find(r => r.productId === productId); if (!record?.sources.some(s => s.key === sourceKey)) throw new Error('来源记录无效'); state.decisions[productId] = { ...state.decisions[productId], sourceKey }; bump(); rebuild(); emit(); },
    chooseBox(productId, boxId) { assertUsable(); const record = state.records.find(r => r.productId === productId); if (!record?.product.packs.some(p => p.id === boxId && p.isDefault) || record.product.packs.filter(p => p.isDefault).length !== 1) throw new Error('首版原生模板仅支持维护已明确的默认箱规'); state.decisions[productId] = { ...state.decisions[productId], boxId }; bump(); rebuild(); emit(); },
    select(id, checked) { if (state.busy || state.blocked) return; const r = state.records.find(r => r.id === id); if (r?.status.key !== 'ready') return; if (checked) state.checked.add(id); else state.checked.delete(id); bump(); emit(); },
    selectAll() { if (state.busy || state.blocked) return; state.records.filter(r => r.status.key === 'ready').forEach(r => state.checked.add(r.id)); bump(); emit(); },
    clearSelection() { if (state.busy) return; state.checked.clear(); bump(); emit(); },
    confirmation() {
      const rows = intents();
      const confirmation = { version: state.version, rows, store: { ...store() }, report: { ...state.report, rows: undefined }, mode: state.mode };
      confirmations.add(confirmation); return confirmation;
    },
    async execute(confirmation) {
      if (!confirmations.has(confirmation) || confirmation.version !== state.version) throw new Error('预览已变化，请重新核对本批');
      confirmations.delete(confirmation);
      return run('正在核对提交前的商品与箱规…', async signal => {
        const bytes = updateWorkbook(XLSX, confirmation.rows);
        const batch = newBatch(journal.scope, confirmation.report, confirmation.store, confirmation.mode, confirmation.rows, cryptoObject);
        state.currentBatch = batch;
        try {
          await executeBatch({ win, client, importer, journal, batch, bytes, signal, onChange: (current, observed) => {
            if (state.blocked) return;
            if (observed && state.products.has(observed.productId)) state.products.set(observed.productId, observed.info);
            state.currentBatch = current; state.view = 'result'; state.busyLabel = '已交给领星原生导入，正在核验商品现值…'; emit();
          } });
        } finally {
          if (!state.blocked) {
            await reloadHistory(); state.currentBatch = state.batches.find(b => b.id === batch.id) || null;
            state.view = state.currentBatch ? 'result' : 'preview'; rebuild();
          }
        }
      });
    },
    async verify(batchId) {
      return run('正在读取商品现值并核验…', async signal => {
        const batch = (await journal.list()).find(b => b.id === batchId); if (!batch) throw new Error('未找到本账号执行记录');
        state.currentBatch = batch; state.view = 'result';
        await verifyBatch(client, batch, journal, { signal, onChange: (current, observed) => { if (!state.blocked) { if (observed && state.products.has(observed.productId)) state.products.set(observed.productId, observed.info); state.currentBatch = current; emit(); } } });
        assertUsable(); await reloadHistory(); rebuild();
      });
    },
    showPreview() { state.view = 'preview'; emit(); },
    showBatch(id) { assertUsable(); const batch = state.batches.find(b => b.id === id); if (!batch) throw new Error('未找到本批记录'); state.currentBatch = structuredClone(batch); state.view = 'result'; emit(); },
    async refreshHistory() { assertUsable(); const batches = await reloadHistory(); rebuild(); emit(); return batches; },
    async exportUpdate() { return run('正在核对导出商品…', async signal => { const rows = intents(); await preflight(client, store(), rows, signal); const bytes = updateWorkbook(XLSX, rows); saveBlob(win, bytes, '包装资料更新-' + state.reportDate + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); }); },
    exportPreview(onlyIssues = false) {
      assertUsable();
      const rows = (onlyIssues ? state.records.filter(r => r.status.key === 'issue') : state.records).map(r => [state.stores.find(s => s.id === state.storeId)?.name, r.sources.map(s => s.msku).join(' / '), r.localSku, r.title, r.box?.title || '', ...(r.box?.old || ['', '', '', '']), ...(r.values || ['', '', '', '']), r.status.text, state.reportDate, state.report?.filename || '']);
      saveBlob(win, csvText([['店铺', '报告MSKU', '本地SKU', '品名', '箱规', '原长cm', '原宽cm', '原高cm', '原毛重g', '报告长cm', '报告宽cm', '报告高cm', '报告包装重g', '状态', '报告日期', '文件名'], ...rows]), onlyIssues ? '包装资料异常清单.csv' : '包装资料差异预览.csv', 'text/csv;charset=utf-8');
    },
    exportBatch() { assertUsable(); if (!state.currentBatch) throw new Error('暂无执行记录'); const data = structuredClone(state.currentBatch); delete data.scope; saveBlob(win, JSON.stringify(data, null, 2), '包装资料执行记录-' + data.id.slice(0, 8) + '.json', 'application/json'); },
    stop() { controller?.abort(); },
    dismissError() { state.error = ''; emit(); },
    invalidate() { state.blocked = true; controller?.abort(); state.busy = false; state.busyLabel = ''; state.report = null; state.records = []; state.listings = []; state.products.clear(); state.decisions = {}; state.batches = []; state.currentBatch = null; state.checked.clear(); state.stores = []; state.storeId = ''; state.reportDate = ''; state.view = 'preview'; state.notice = ''; state.error = '领星账号已变化，本批已暂停。请刷新页面后重新核对。'; emit(); },
    dispose() { controller?.abort(); listeners.clear(); journal.close(); }
  };
}
