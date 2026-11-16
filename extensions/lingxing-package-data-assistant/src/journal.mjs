const ACTIVE_STATES = new Set(['prepared', 'submitted', 'verifying', 'unknown']);
const DB_NAME = 'lingxing-package-data-assistant';
export function pendingProductIds(batches) {
  return new Set(batches.flatMap(b => b.rows.filter(r => ACTIVE_STATES.has(r.status)).map(r => r.productId)));
}
export function openJournal(indexedDB, scope, lockScope = scope) {
  if (![scope, lockScope].every(s => /^[a-f0-9]{64}$/.test(s))) throw new Error('账号隔离标识无效');
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => { const store = opening.result.createObjectStore('batches', { keyPath: 'id' }); store.createIndex('scope', 'scope', { unique: false }); store.createIndex('companyScope', 'companyScope', { unique: false }); };
    opening.onerror = () => reject(new Error('无法打开执行记录，本次不会提交更新'));
    opening.onblocked = () => reject(new Error('执行记录被其他页面占用，请关闭旧版插件页面后重试'));
    opening.onsuccess = () => {
      const db = opening.result; db.onversionchange = () => db.close();
      function write(batch) {
        if (batch.scope !== scope || !batch.id || !Array.isArray(batch.rows)) return Promise.reject(new Error('执行记录账号不一致'));
        return new Promise((done, fail) => { const tx = db.transaction('batches', 'readwrite'); tx.objectStore('batches').put(structuredClone({ ...batch, companyScope: lockScope })); tx.oncomplete = () => done(); tx.onabort = tx.onerror = () => fail(new Error('执行记录保存失败，本次不会继续提交')); });
      }
      function list() {
        return new Promise((done, fail) => { const tx = db.transaction('batches', 'readonly'), request = tx.objectStore('batches').index('scope').getAll(scope); let result; request.onsuccess = () => { result = request.result; }; tx.oncomplete = () => done(result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); tx.onabort = tx.onerror = () => fail(new Error('读取执行记录失败')); });
      }
      function pendingTargets() { return new Promise((done, fail) => { const tx = db.transaction('batches', 'readonly'), request = tx.objectStore('batches').index('companyScope').getAll(lockScope); let result; request.onsuccess = () => { result = pendingProductIds(request.result); }; tx.oncomplete = () => done(result); tx.onabort = tx.onerror = () => fail(new Error('无法核对本公司待核实批次')); }); }
      resolve({ scope, lockScope, write, list, pendingTargets, close: () => db.close() });
    };
  });
}
export function newBatch(scope, report, store, mode, intents, cryptoObject = crypto, now = () => new Date().toISOString()) {
  return {
    id: cryptoObject.randomUUID(), scope, createdAt: now(), updatedAt: now(), source: '亚马逊费用预估',
    reportDate: report.reportDate, importedAt: report.importedAt, filename: report.filename, fileHash: report.fileHash, measurementDate: null,
    encoding: report.encoding || null, headerPrefixRemoved: !!report.headerPrefixRemoved,
    store: { id: store.id, name: store.name, country: store.country }, mode, nativeTaskId: '', rows: structuredClone(intents)
  };
}
