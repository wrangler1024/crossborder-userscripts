import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { parseReportText } from '../src/parser.mjs';
import { openJournal } from '../src/journal.mjs';
import { createPlan, recordIntent } from '../src/planner.mjs';
export const XLSX = createRequire(import.meta.url)('../vendor/xlsx.full.min.cjs');
export const cryptoObject = webcrypto;
export const STORE = { id: '1001', name: '示例店铺 UK', country: 'GB' };
export const SCOPE = 'a'.repeat(64), COMPANY = 'c'.repeat(64);
export const HEADERS = ['sku', 'asin', 'fnsku', 'amazon-store', 'product-name', 'longest-side', 'median-side', 'shortest-side', 'unit-of-dimension', 'item-package-weight', 'unit-of-weight'];
export function reportRows(rows = [['AMZ-001', 'B0TEST0001', 'X0TEST0001', 'UK', '示例商品', '15', '10', '3', 'cm', '90.125', 'g']]) { return parseReportText([HEADERS, ...rows].map(r => r.join('\t')).join('\n'), { filename: 'FeePreview.txt', reportDate: '2026-11-01', importedAt: '2026-11-02T00:00:00Z', fileHash: '0'.repeat(64) }); }
export function listing(overrides = {}) { return { store_id: '1001', msku: 'AMZ-001', asin: 'B0TEST0001', fnsku: 'X0TEST0001', product_id: '2001', local_sku: 'LOCAL-001', is_pair: 1, ...overrides }; }
export function product(overrides = {}) {
  const spec = { spec_unit: 'SI', cg_product_net_weight: '70', cg_product_net_weight_unit: 'g', cg_product_length: '12', cg_product_width: '8', cg_product_height: '2', ps_id: '210752555712800001', spec_pack_list: [{ pps_id: '210752555712800003', is_default: 1, spec_title: '默认箱规', cg_package_length: '0.00', cg_package_width: '0.00', cg_package_height: '0.00', cg_package_spec_unit: 'cm', cg_product_gross_weight: '0.0000', cg_product_gross_weight_unit: 'g', cg_box_length: '50', cg_box_width: '40', cg_box_height: '30', cg_box_pcs: '20', cg_box_weight: '3.5' }] };
  return { id: '2001', sku: 'LOCAL-001', name: '示例商品', unit: '盒', spec_info: spec, ...overrides };
}
export function plan({ report = reportRows(), store = STORE, listings = [listing()], products = new Map([['2001', product()]]), options = {} } = {}) { return createPlan(report, store, listings, products, options); }
export function intent(options = {}) { return recordIntent(plan(options)[0]); }
export async function journal() { return openJournal(new IDBFactory(), SCOPE, COMPANY); }
export function memoryJournal() { const data = new Map(); return { scope: SCOPE, lockScope: COMPANY, async list() { return [...data.values()].map(v => structuredClone(v)); }, async write(batch) { data.set(batch.id, structuredClone(batch)); }, async pendingTargets() { const { pendingProductIds } = await import('../src/journal.mjs'); return pendingProductIds([...data.values()]); }, close() {} }; }
export function testClient(p = product(), listings = [listing()]) { return { p, assertContext() {}, async stores() { return [STORE]; }, async listings(_store, mskus) { return listings.filter(l => mskus.includes(l.msku)); }, async product(id) { if (id !== '2001') throw new Error('not found'); return structuredClone(this.p); } }; }
export function testWindow() { return { navigator: { locks: { request: async (_name, _options, callback) => callback({}) } }, setTimeout, clearTimeout }; }
export function setPackage(p, values) { const box = p.spec_info.spec_pack_list[0]; [box.cg_package_length, box.cg_package_width, box.cg_package_height, box.cg_product_gross_weight] = values; box.cg_package_spec_unit = 'cm'; box.cg_product_gross_weight_unit = 'g'; }
