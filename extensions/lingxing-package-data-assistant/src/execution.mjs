import { matchListing, sameBinding } from './identity.mjs';
import { readProduct, protectedProduct } from './planner.mjs';
import { samePackage } from './units.mjs';
export function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableJSON(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function preflight(client, store, intents, signal) {
  const bindings = intents.flatMap(row => row.bindings);
  const listings = await client.listings(store, bindings.map(b => b.msku), signal);
  for (const row of intents) {
    for (const binding of row.bindings) {
      const current = matchListing(binding, store, listings);
      if (!sameBinding(current, binding)) throw new Error(row.localSku + ' 的配对关系已变化，请重新匹配');
    }
    const product = readProduct(await client.product(row.productId, signal), row.bindings[0]);
    const box = product.packs.find(p => p.id === row.boxId && p.isDefault);
    if (!box || box.raw.join('|') !== row.rawOld.join('|') || box.units.join('|') !== row.oldUnits.join('|') || stableJSON(protectedProduct(product, row.boxId)) !== stableJSON(row.protectedInfo)) throw new Error(row.localSku + ' 的商品或箱规资料已变化，请重新预览');
  }
  client.assertContext();
}
export async function verifyBatch(client, batch, journal, { signal, onChange = () => {} } = {}) {
  const listings = await client.listings(batch.store, batch.rows.flatMap(r => r.bindings.map(b => b.msku)), signal);
  for (const row of batch.rows) {
    if (row.status === 'success') continue;
    let observedInfo;
    try {
      for (const binding of row.bindings) if (!sameBinding(matchListing(binding, batch.store, listings), binding)) throw new Error('配对关系发生变化');
      observedInfo = await client.product(row.productId, signal);
      const product = readProduct(observedInfo, row.bindings[0]);
      const box = product.packs.find(p => p.id === row.boxId && p.isDefault);
      if (!box) throw new Error('默认箱规发生变化');
      if (!samePackage(box.old, row.values) || box.units.join('|') !== 'cm|g') throw new Error('四项现值或单位尚未与本批目标一致');
      if (stableJSON(protectedProduct(product, row.boxId)) !== stableJSON(row.protectedInfo)) throw new Error('其他规格资料发生变化，请核对来源');
      row.status = 'success'; row.message = '四项值与单位核验一致';
    } catch (error) { client.assertContext(); row.status = 'unknown'; row.message = error.message; }
    batch.updatedAt = new Date().toISOString(); await journal.write(batch); onChange(batch, observedInfo ? { productId: row.productId, info: observedInfo } : null);
    if (signal?.aborted) throw new Error('核验已暂停');
  }
  return batch;
}
export async function executeBatch({ win, client, importer, journal, batch, bytes, signal, onChange = () => {}, waitMs = 3000, maxPolls = 20 }) {
  if (!win.navigator.locks?.request) throw new Error('当前浏览器不支持批次互斥，请升级浏览器后使用');
  return win.navigator.locks.request('lingxing-package-data:' + (journal.lockScope || journal.scope), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('另一个窗口正在处理包装资料，请等待完成');
    const history = await journal.list();
    const pending = await journal.pendingTargets?.();
    if (pending && batch.rows.some(r => pending.has(r.productId))) throw new Error('本公司存在该商品的未核实批次，请先核验');
    if (history.some(b => b.id !== batch.id && b.rows.some(r => ['prepared', 'submitted', 'verifying', 'unknown'].includes(r.status) && batch.rows.some(target => target.productId === r.productId)))) throw new Error('本批商品存在待核实执行记录，请先核验');
    await preflight(client, batch.store, batch.rows, signal);
    const handle = await importer.prepare({ signal });
    let submitted = false;
    try {
      client.assertContext(); if (signal?.aborted) throw new Error('操作已停止');
      batch.rows.forEach(r => { r.status = 'submitted'; }); await journal.write(batch);
      client.assertContext(); if (signal?.aborted) throw new Error('操作已停止');
      submitted = true;
      importer.submit(handle, bytes, '包装资料更新-' + batch.id.slice(0, 8) + '.xlsx'); onChange(batch);
      for (let poll = 0; poll < maxPolls; poll++) {
        client.assertContext(); if (signal?.aborted) break;
        const status = importer.status(handle); batch.nativeTaskId = status.taskId || batch.nativeTaskId;
        if (status.taskId || status.phase === 'complete' || poll >= 2) await verifyBatch(client, batch, journal, { signal, onChange });
        if (batch.rows.every(r => r.status === 'success')) break;
        if (status.phase === 'complete') break;
        await new Promise(resolve => { const timer = win.setTimeout(done, waitMs); function done() { win.clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); } signal?.addEventListener('abort', done, { once: true }); });
      }
    } finally {
      if (!submitted) { batch.rows.forEach(r => { r.status = 'not_submitted'; r.message = '未上传文件'; }); importer.cancel(handle); }
      else batch.rows.forEach(r => { if (r.status !== 'success') { r.status = 'unknown'; r.message ||= '结果待核实，请检查原生导入记录与商品现值'; } });
      batch.updatedAt = new Date().toISOString(); await journal.write(batch); onChange(batch);
    }
    return batch;
  });
}
