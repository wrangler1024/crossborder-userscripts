import { exactId } from './json.mjs';
import { convertValue, samePackage, emptyPackage } from './units.mjs';
import { matchListing, validateReportMarket } from './identity.mjs';
export const EDITABLE_KEYS = ['cg_package_length', 'cg_package_width', 'cg_package_height', 'cg_product_gross_weight', 'cg_package_spec_unit', 'cg_product_gross_weight_unit'];
function productImageURL(info) {
  const pictures = Array.isArray(info.picture_list) ? info.picture_list : [];
  const primary = pictures.find(p => Number(p?.is_primary) === 1);
  for (const value of [primary?.pic_url, primary?.pic_url_txt, info.pic_url, ...pictures.flatMap(p => [p?.pic_url, p?.pic_url_txt])]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch {}
  }
  return '';
}
export function readProduct(info, binding) {
  if (!info || exactId(info.id, '商品编号') !== binding.productId || info.sku !== binding.localSku) throw new Error('本地商品资料与 Listing 配对关系不一致');
  const spec = info.spec_info;
  if (!spec || !Array.isArray(spec.spec_pack_list)) throw new Error('商品规格结构变化，请在领星核对');
  const packs = spec.spec_pack_list.map(p => {
    const raw = [p.cg_package_length, p.cg_package_width, p.cg_package_height, p.cg_product_gross_weight].map(v => String(v ?? ''));
    const units = [String(p.cg_package_spec_unit || ''), String(p.cg_product_gross_weight_unit || '')];
    const old = raw.map((value, i) => !value || /^0+(?:\.0+)?$/.test(value) ? i === 3 ? '0.0000' : '0.00' : convertValue(value, units[i === 3 ? 1 : 0], i === 3 ? 'weight' : 'length', i === 3 ? 4 : 2));
    return { id: exactId(p.pps_id, '箱规编号'), title: String(p.spec_title || '未命名箱规'), isDefault: Number(p.is_default) === 1, raw, units, old };
  });
  const netRaw = String(spec.cg_product_net_weight || '0');
  const protectedInfo = { ...spec, spec_pack_list: spec.spec_pack_list.map(p => { const copy = { ...p }; for (const key of EDITABLE_KEYS) delete copy[key]; return copy; }) };
  return { id: binding.productId, localSku: binding.localSku, title: String(info.name || info.product_name || binding.localSku), imageUrl: productImageURL(info), unit: String(info.unit || ''), mode: String(spec.spec_unit || ''), packs, netRaw, netUnit: String(spec.cg_product_net_weight_unit || ''), protectedInfo, fullSpec: spec };
}
export function protectedProduct(product, boxId) {
  return { ...product.fullSpec, spec_pack_list: product.fullSpec.spec_pack_list.map(p => {
    const copy = { ...p };
    if (String(p.pps_id) === boxId) for (const key of EDITABLE_KEYS) delete copy[key];
    return copy;
  }) };
}
export function chooseRecordStatus(record, mode = 'overwrite', pending = new Set()) {
  if (record.kind === 'other_market') return { key: 'skipped', kind: 'other_market', text: record.error };
  if (record.error) return { key: 'issue', kind: record.kind || 'invalid', text: record.error };
  if (pending.has(record.productId)) return { key: 'issue', kind: 'unknown', text: '结果待核实，请先检查执行记录' };
  if (record.conflict && !record.chosenSource) return { key: 'issue', kind: 'conflict', text: '同一本地商品存在不同来源数据' };
  if (!record.box) return { key: 'issue', kind: 'box', text: '请确认默认箱规和销售包装' };
  if (record.product.mode !== 'SI' || !record.box.units.every(u => /^(cm|mm|m|g|kg)$/.test(u))) return { key: 'issue', kind: 'unit', text: '当前规格单位模式不兼容，需在领星核对' };
  if (samePackage(record.box.old, record.values)) return { key: 'same', kind: 'same', text: '四项数值一致' };
  if (mode === 'fill' && !emptyPackage(record.box.raw)) return { key: 'issue', kind: 'existing', text: '已有包装值，切换“按报告更新”后核对' };
  return { key: 'ready', kind: emptyPackage(record.box.raw) ? 'fill' : 'update', text: emptyPackage(record.box.raw) ? '可补全' : '可更新' };
}
export function createPlan(report, store, listings, products, { mode = 'overwrite', decisions = {}, pending = new Set() } = {}) {
  const records = [], grouped = new Map();
  for (const row of report.rows) {
    try {
      validateReportMarket(row, store);
      if (row.errors.length) throw new Error(row.errors.join('；'));
      const binding = matchListing(row, store, listings);
      const raw = products.get(binding.productId);
      if (raw instanceof Error) throw raw;
      const product = readProduct(raw, binding);
      const current = grouped.get(binding.productId);
      if (current) {
        if (current.localSku !== binding.localSku) throw new Error('同一商品编号返回不同本地 SKU');
        current.sources.push({ ...row, binding });
      } else {
        const record = { id: 'product-' + product.id, productId: product.id, localSku: product.localSku, title: product.title, product, sources: [{ ...row, binding }], values: row.values };
        grouped.set(product.id, record); records.push(record);
      }
    } catch (error) { records.push({ id: row.key, title: row.title || row.msku || '无效报表行', localSku: '', sources: [row], error: error.message, kind: error.reason || 'invalid', values: row.values }); }
  }
  for (const record of records) {
    if (!record.error) {
      const decision = decisions[record.productId] || {};
      record.conflict = record.sources.some(s => !samePackage(s.values, record.sources[0].values));
      const chosen = record.sources.find(s => s.key === decision.sourceKey);
      record.chosenSource = !!chosen;
      record.source = chosen || record.sources[0]; record.values = record.source.values;
      const defaults = record.product.packs.filter(p => p.isDefault);
      // The verified minimal native template only updates the default box specification.
      record.box = record.product.packs.length === 1 && defaults.length === 1 ? defaults[0] : defaults.length === 1 && decision.boxId === defaults[0].id ? defaults[0] : null;
      record.targetKey = record.box ? record.productId + ':' + record.box.id : null;
    }
    record.status = chooseRecordStatus(record, mode, pending);
  }
  return records;
}
export function recordIntent(record) {
  if (!record.box || record.status.key !== 'ready') throw new Error('仅可执行已核对的可更新商品');
  return {
    id: record.id, productId: record.productId, localSku: record.localSku, title: record.title,
    boxId: record.box.id, boxTitle: record.box.title, old: [...record.box.old], rawOld: [...record.box.raw], oldUnits: [...record.box.units],
    chosenSourceKey: record.source.key, chosenSourceLine: record.source.line,
    values: [...record.values], bindings: record.sources.map(s => ({ ...s.binding })),
    sources: record.sources.map(s => ({ line: s.line, msku: s.msku, asin: s.asin, fnsku: s.fnsku, raw: s.raw, dimensionUnit: s.dimensionUnit, weightUnit: s.weightUnit })),
    protectedInfo: protectedProduct(record.product, record.box.id), status: 'prepared', message: ''
  };
}
