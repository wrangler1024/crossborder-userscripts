import test from 'node:test';
import assert from 'node:assert/strict';
import { matchListing, normalizeStores } from '../src/identity.mjs';
import { createPlan, recordIntent } from '../src/planner.mjs';
import { updateWorkbook, UPDATE_COLUMNS, csvText } from '../src/workbook.mjs';
import { XLSX, STORE, reportRows, product, listing, plan } from './fixtures.mjs';
test('store list takes the native seller sid and country mapping, excluding concept stores', () => {
  const stores = normalizeStores({ code: 1, sellers: [{ sid: '1001', seller_simple_name: 'Example', country_id: 4, country: '英国', is_concept: 0 }, { sid: '1002', seller_simple_name: 'virtual', country_id: 4, is_concept: 1 }], markets: [{ country_id: 4, code: 'UK' }] }); assert.deepEqual(stores, [{ id: '1001', name: 'Example', country: 'GB', countryName: '英国' }]);
});
test('MSKU maps through the selected store Listing; local SKU may be entirely different', () => {
  const record = plan()[0]; assert.equal(record.localSku, 'LOCAL-001'); assert.equal(record.sources[0].msku, 'AMZ-001'); assert.equal(record.status.key, 'ready'); assert.equal(record.box.id, '210752555712800003');
  const binding = matchListing(reportRows().rows[0], STORE, [listing({ store_id: '9999', product_id: '9999' }), listing()]); assert.equal(binding.productId, '2001');
});
test('the ERP primary image is preferred and unsafe or missing URLs cannot become a preview image', () => {
  const p = product({ pic_url: 'https://images.example.test/fallback.jpg', picture_list: [{ is_primary: 0, pic_url: 'https://images.example.test/secondary.jpg' }, { is_primary: 1, pic_url: 'https://images.example.test/primary.jpg' }] });
  assert.equal(plan({ products: new Map([['2001', p]]) })[0].product.imageUrl, 'https://images.example.test/primary.jpg');
  p.picture_list = [{ is_primary: 1, pic_url: 'javascript:alert(1)' }];
  assert.equal(plan({ products: new Map([['2001', p]]) })[0].product.imageUrl, 'https://images.example.test/fallback.jpg');
  for (const url of ['', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://user:password@images.example.test/private.jpg']) {
    p.pic_url = url; assert.equal(plan({ products: new Map([['2001', p]]) })[0].product.imageUrl, '');
  }
});
test('unpaired listings and ambiguous or mismatched identities cannot fall back to text matching', () => {
  for (const l of [listing({ is_pair: 2, product_id: '0', local_sku: '' }), listing({ asin: 'B0TEST9999' }), listing({ fnsku: 'X0TEST9999' })]) assert.equal(plan({ listings: [l] })[0].status.key, 'issue');
  assert.equal(plan({ listings: [listing(), listing()] })[0].status.key, 'issue');
  assert.equal(plan({ listings: [listing({ store_id: '9999' })] })[0].status.key, 'issue');
});
test('other sites are skipped while unknown sites, different local products and invalid rows remain issues', () => {
  const other = plan({ store: { ...STORE, country: 'US' } })[0]; assert.equal(other.status.key, 'skipped'); assert.equal(other.status.kind, 'other_market'); assert.match(other.status.text, /GB.*US.*已跳过/); assert.throws(() => recordIntent(other), /仅可执行/);
  assert.equal(plan({ report: reportRows([['AMZ-001', 'B0TEST0001', '', 'UNKNOWN', '', '15', '10', '3', 'cm', '90', 'g']]) })[0].status.kind, 'market');
  assert.equal(plan({ products: new Map([['2001', product({ sku: 'WRONG' })]]) })[0].status.key, 'issue');
  assert.equal(plan({ report: reportRows([['AMZ-001', 'B0TEST0001', '', 'UK', '', '15', '10', '3', 'cm', '', 'g']]) })[0].status.key, 'issue');
});
test('fill requires all four old fields empty; overwrite never auto-selects or blends partial values', () => {
  const p = product(); p.spec_info.spec_pack_list[0].cg_package_length = '8';
  assert.equal(plan({ products: new Map([['2001', p]]), options: { mode: 'fill' } })[0].status.kind, 'existing');
  const overwrite = plan({ products: new Map([['2001', p]]), options: { mode: 'overwrite' } })[0]; assert.equal(overwrite.status.key, 'ready'); assert.deepEqual(recordIntent(overwrite).values, ['15.00', '10.00', '3.00', '90.1250']);
});
test('equal data skip while report weight below ERP net weight remains actionable without changing net weight', () => {
  const p = product(); Object.assign(p.spec_info.spec_pack_list[0], { cg_package_length: '15', cg_package_width: '10', cg_package_height: '3', cg_product_gross_weight: '90.125' }); assert.equal(plan({ products: new Map([['2001', p]]) })[0].status.key, 'same');
  const low = product(); low.spec_info.cg_product_net_weight = '90.13'; const record = plan({ products: new Map([['2001', low]]) })[0]; assert.equal(record.status.key, 'ready'); assert.equal(recordIntent(record).values[3], '90.1250'); assert.equal(low.spec_info.cg_product_net_weight, '90.13');
});
test('stock units and unrelated net-weight formats do not participate in packaging eligibility', () => {
  for (const unit of ['', '0', 0, null]) {
    const p = product({ unit }); p.spec_info.cg_product_net_weight = 'unverified'; p.spec_info.cg_product_net_weight_unit = '';
    const record = plan({ products: new Map([['2001', p]]) })[0];
    assert.equal(record.status.key, 'ready'); assert.equal(recordIntent(record).values[3], '90.1250');
    assert.equal(recordIntent(record).protectedInfo.cg_product_net_weight, 'unverified');
  }
});
test('known foreign rows skip before local validation and never access a product or join the local source group', () => {
  const report = reportRows([['AMZ-001', 'B0TEST0001', 'X0TEST0001', 'UK', '', '15', '10', '3', 'cm', '90', 'g'], ['AMZ-001', 'bad', '', 'US', '', 'bad', '', '', 'bad', '', 'bad']]);
  const records = createPlan(report, STORE, [listing()], new Map([['2001', product()]]));
  assert.equal(records[0].sources.length, 1); assert.equal(records[0].status.key, 'ready');
  assert.equal(records[1].status.key, 'skipped'); assert.equal(records[1].product, undefined);
});
test('multiple MSKUs for one local product deduplicate, conflicting complete sets require an explicit source', () => {
  const report = reportRows([['AMZ-001', 'B0TEST0001', 'X0TEST0001', 'UK', '', '15', '10', '3', 'cm', '90.125', 'g'], ['AMZ-002', 'B0TEST0002', 'X0TEST0002', 'UK', '', '16', '10', '3', 'cm', '95', 'g']]);
  const listings = [listing(), listing({ msku: 'AMZ-002', asin: 'B0TEST0002', fnsku: 'X0TEST0002' })], products = new Map([['2001', product()]]);
  const records = createPlan(report, STORE, listings, products); assert.equal(records.length, 1); assert.equal(records[0].status.kind, 'conflict');
  const chosen = createPlan(report, STORE, listings, products, { decisions: { '2001': { sourceKey: 'line-3' } } }); assert.equal(chosen[0].status.key, 'ready'); assert.equal(chosen[0].values[0], '16.00'); assert.equal(recordIntent(chosen[0]).bindings.length, 2);
  report.rows[1].values = [...report.rows[0].values]; assert.equal(createPlan(report, STORE, listings, products)[0].status.key, 'ready');
});
test('multiple boxes require explicit default-box confirmation; nondefault or ambiguous defaults cannot be targeted', () => {
  const p = product(); p.spec_info.spec_pack_list.push({ ...p.spec_info.spec_pack_list[0], pps_id: '210752555712800005', is_default: 0, spec_title: '另一箱规' });
  assert.equal(plan({ products: new Map([['2001', p]]) })[0].status.kind, 'box');
  const options = { decisions: { '2001': { boxId: '210752555712800003' } } }; assert.equal(plan({ products: new Map([['2001', p]]), options })[0].status.key, 'ready');
  options.decisions['2001'].boxId = '210752555712800005'; assert.equal(plan({ products: new Map([['2001', p]]), options })[0].status.kind, 'box');
  p.spec_info.spec_pack_list[1].is_default = 1; assert.equal(plan({ products: new Map([['2001', p]]), options })[0].status.kind, 'box');
});
test('unknown prior results and incompatible unit modes cannot enter execution', () => {
  assert.equal(plan({ options: { pending: new Set(['2001']), mode: 'overwrite' } })[0].status.kind, 'unknown');
  const p = product(); p.spec_info.spec_unit = 'IMPERIAL'; assert.equal(plan({ products: new Map([['2001', p]]) })[0].status.kind, 'unit');
});
test('native workbook has exactly seven verified columns, no extra sheets, numeric-SKU conversion or formulas', () => {
  const row = recordIntent(plan()[0]); row.localSku = '=LOCAL-001';
  const book = XLSX.read(updateWorkbook(XLSX, [row]), { type: 'array' }); assert.deepEqual(book.SheetNames, ['产品']);
  const data = XLSX.utils.sheet_to_json(book.Sheets['产品'], { header: 1 }); assert.deepEqual(data[0], UPDATE_COLUMNS); assert.equal(data[1][0], '=LOCAL-001'); assert.equal(book.Sheets['产品'].A2.t, 's'); assert.equal(book.Sheets['产品'].A2.f, undefined); assert.equal(data[1][1], 90.125); assert.equal(data.length, 2); assert.deepEqual(Object.keys(book.Custprops || {}), []);
  assert.throws(() => updateWorkbook(XLSX, [row, row]), /重复/);
});
test('CSV exports quote safely and neutralize spreadsheet formulas in merchant/local SKU strings', () => { assert.match(csvText([['=BAD', 'a"b', '1.2']]), /"'=BAD","a""b","1.2"/); });
