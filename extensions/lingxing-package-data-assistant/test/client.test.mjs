import test from 'node:test';
import assert from 'node:assert/strict';
import { createERPClient } from '../src/client.mjs';
import { STORE, listing, product } from './fixtures.mjs';
function fixture() {
  const win = { location: { hostname: 'erp.lingxing.com', pathname: '/erp/productManage' } }, info = { uid: '1', zid: '2' }, cookies = { company: '3' }, calls = [];
  const context = { $store: { state: { myInfo: info } }, $cookies: { get: () => cookies.company }, async $get(path, params) { calls.push({ path, params }); return path.endsWith('/info') ? { code: 1, info: product() } : { code: 1, sellers: [], markets: [] }; }, async $gwPost(path, params) { calls.push({ path, params }); return { code: 1, data: { list: [listing()], total: 1 } }; } };
  return { win, context, info, cookies, calls, client: createERPClient(win, { context: () => context, timeoutMs: 20 }) };
}
test('client uses only confirmed native read operations and exact store/MSKU parameters', async () => {
  const f = fixture(); const list = await f.client.listings(STORE, ['AMZ-001', 'AMZ-001']); assert.equal(list.length, 1); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, '/listing-api/api/product/showOnline'); assert.equal(f.calls[0].params.sids, '1001'); assert.equal(f.calls[0].params.exact_search, 1); assert.deepEqual(f.calls[0].params.search_value, ['AMZ-001']);
  await f.client.product('2001'); assert.equal(f.calls[1].path, '/api/product/info'); assert.deepEqual(f.calls[1].params, { id: '2001' });
});
test('wrong-store or nonexact server search results fail closed', async () => {
  const f = fixture(); f.context.$gwPost = async () => ({ code: 1, data: { list: [listing({ store_id: '9999' })], total: 1 } }); await assert.rejects(f.client.listings(STORE, ['AMZ-001']), /其他店铺/);
  f.context.$gwPost = async () => ({ code: 1, data: { list: [listing({ msku: 'AMZ-001-extra' })], total: 1 } }); await assert.rejects(f.client.listings(STORE, ['AMZ-001']), /精确匹配/);
});
test('account and route changes before or after a read invalidate the batch', async () => {
  const f = fixture(); f.context.$get = async () => { f.cookies.company = 'another'; return { code: 1, info: product() }; }; await assert.rejects(f.client.product('2001'), /账号或页面/);
  const other = fixture(); other.win.location.pathname = '/erp/listing'; await assert.rejects(other.client.product('2001'), /账号或页面/); assert.equal(other.calls.length, 0);
});
test('read timeout returns a plain message without exposing native transport errors or tokens', async () => {
  const f = fixture(); f.context.$get = async () => new Promise(() => {}); await assert.rejects(f.client.product('2001'), /读取超时/);
  f.context.$get = async () => { throw { config: { headers: { 'auth-token': 'not-for-logs' } }, msg: 'raw backend' }; };
  await assert.rejects(f.client.product('2001'), error => !error.message.includes('not-for-logs') && !error.message.includes('raw backend'));
});
