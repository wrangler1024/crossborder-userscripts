import { createPackageApp, fileDigest } from '../src/app.mjs';
import { mountPackageUI } from '../src/ui.mjs';
import { openJournal } from '../src/journal.mjs';
const products = new Map(), listings = [], report = [];
const names = ['抽屉分隔收纳盒 4 件套', '桌面理线收纳夹 6 件套', '折叠收纳袋 3 件套', '透明标签夹 20 件装', '宠物项圈 4 件装', '硅胶杯垫 8 件套', '硅胶杯垫另一 MSKU', '细纤维清洁布 5 条装', '缝隙清洁刷 3 件套'];
function makeProduct(n, values = [0, 0, 0, 0], net = 70) {
  return { id: String(2000 + n), sku: 'LOCAL-' + String(n).padStart(3, '0'), name: names[n - 1], unit: '盒', spec_info: { spec_unit: 'SI', cg_product_net_weight: String(net), cg_product_net_weight_unit: 'g', cg_product_length: '12', cg_product_width: '8', cg_product_height: '2', ps_id: '2107525557128000' + n, spec_pack_list: [{ pps_id: '2107525557128001' + n, spec_title: '默认箱规', is_default: 1, cg_package_length: String(values[0]), cg_package_width: String(values[1]), cg_package_height: String(values[2]), cg_package_spec_unit: 'cm', cg_product_gross_weight: String(values[3]), cg_product_gross_weight_unit: 'g', cg_box_pcs: '20', cg_box_length: '50', cg_box_width: '40', cg_box_height: '30', cg_box_weight: '4.5' }] } };
}
const specs = [[14.8, 12.6, 4.8, 186.42], [12.4, 9.1, 2.3, 105], [15.8, 12.2, 3.2, 105], [10, 9, 2, 80], [15, 12, 2.2, 74.98], [18, 12, 3, 160], [19, 13, 4, 170], [18.6, 14.2, 3.2, 132], [24.8, 8.4, 3.8, 98.6]];
for (let n = 1; n <= 9; n++) {
  const local = n === 7 ? 6 : n, msku = 'AMZ-' + String(n).padStart(3, '0'), asin = 'B0TEST' + String(n).padStart(4, '0'), fnsku = 'X0TEST' + String(n).padStart(4, '0');
  listings.push({ store_id: '1001', msku, asin, fnsku, is_pair: n === 4 ? 2 : 1, product_id: n === 4 ? '0' : String(2000 + local), local_sku: n === 4 ? '' : 'LOCAL-' + String(local).padStart(3, '0') });
  report.push([msku, asin, fnsku, 'UK', names[n - 1], ...specs[n - 1].slice(0, 3), 'cm', specs[n - 1][3], 'g']);
  if (n !== 4 && n !== 7) products.set(String(2000 + n), makeProduct(n, n === 3 ? [16, 12, 3, 100] : n === 8 ? specs[7] : undefined, n === 1 ? 170 : n === 2 ? 80 : n === 5 ? 75 : n === 6 ? 140 : 70));
}
const multi = products.get('2009'); multi.spec_info.spec_pack_list.push({ ...multi.spec_info.spec_pack_list[0], pps_id: '210752555712800999', spec_title: '袋装', is_default: 0 });
const stores = [{ id: '1001', name: '示例店铺-UK（合成数据）', country: 'GB' }];
const client = { assertContext() {}, async stores() { return stores; }, async listings(store, mskus) { return structuredClone(listings.filter(l => l.store_id === store.id && mskus.includes(l.msku))); }, async product(id) { return structuredClone(products.get(id)); } };
function apply(row) { const p = products.get(row.productId), b = p.spec_info.spec_pack_list.find(b => b.pps_id === row.boxId); [b.cg_package_length, b.cg_package_width, b.cg_package_height, b.cg_product_gross_weight] = row.values; }
const importer = { submissions: 0, async prepare() { return {}; }, submit(_handle, bytes) { this.submissions++; const b = window.XLSX.read(bytes, { type: 'array' }), rows = window.XLSX.utils.sheet_to_json(b.Sheets['产品'], { header: 1 }).slice(1); for (const row of rows.slice(0, -1)) { const p = [...products.values()].find(p => p.sku === row[0]); const box = p.spec_info.spec_pack_list[0]; [box.cg_package_length, box.cg_package_width, box.cg_package_height, box.cg_product_gross_weight] = [row[3], row[4], row[5], row[1]].map(String); } }, status() { return { phase: 'complete', taskId: 'TEST-IMPORT-001' }; }, cancel() {} };
const scope = await fileDigest(new TextEncoder().encode(crypto.randomUUID()));
const journal = await openJournal(indexedDB, scope, scope);
const app = createPackageApp(window, { XLSX: window.XLSX, client, journal, importer });
const ui = mountPackageUI(window, app); ui.open(); await app.initialize();
const headers = ['sku', 'asin', 'fnsku', 'amazon-store', 'product-name', 'longest-side', 'median-side', 'shortest-side', 'unit-of-dimension', 'item-package-weight', 'unit-of-weight'];
window.packageHarness = { app, ui, importer, completePending() { for (const row of app.state.currentBatch?.rows || []) if (row.status !== 'success') apply(row); }, reportText: [headers, ...report].map(r => r.join('\t')).join('\n') };
