import { getNativeContext, contextIdentity, onProductPage } from './native-context.mjs';
import { normalizeStores } from './identity.mjs';
import { exactId } from './json.mjs';
export const READ_ENDPOINTS = { stores: '/api/seller/getCountrySeller', listings: '/listing-api/api/product/showOnline', product: '/api/product/info' };
export function createERPClient(win, { context = () => getNativeContext(win), timeoutMs = 25000 } = {}) {
  const expected = contextIdentity(context());
  function assertContext() {
    if (!onProductPage(win) || contextIdentity(context()) !== expected) throw new Error('领星账号或页面已改变，本批已暂停，请重新核对');
  }
  async function read(operation, body, signal) {
    assertContext(); if (signal?.aborted) throw new Error('操作已停止');
    const component = context();
    if (!Object.hasOwn(READ_ENDPOINTS, operation)) throw new Error('不允许调用未确认的读取接口');
    const request = operation === 'listings' ? component.$gwPost(READ_ENDPOINTS[operation], { ...body }) : component.$get(READ_ENDPOINTS[operation], { ...body });
    let timer, abort;
    try {
      const result = await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('读取超时，请重试')), timeoutMs); abort = () => reject(new Error('操作已停止')); signal?.addEventListener('abort', abort, { once: true }); })]);
      assertContext(); if (signal?.aborted) throw new Error('操作已停止');
      if (Number(result?.code) !== 1) throw new Error('领星读取失败，请刷新页面后重试');
      return result;
    } catch (error) {
      if (!onProductPage(win) || contextIdentity(context()) !== expected) throw new Error('领星账号或页面已改变，本批已暂停');
      // Native transport owns credentials, signatures and response handling. Never log its error/config object.
      throw new Error(error instanceof Error ? error.message : '领星读取失败，请核对页面权限和登录状态');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  return {
    assertContext,
    async stores(signal) { return normalizeStores(await read('stores', {}, signal)); },
    async listings(store, mskus, signal) {
      exactId(store.id, '店铺编号');
      const unique = [...new Set(mskus.filter(Boolean))], all = [];
      for (let start = 0; start < unique.length; start += 50) {
        const search = unique.slice(start, start + 50);
        for (let offset = 0; offset < 5000; offset += 100) {
          const r = await read('listings', { offset, length: 100, search_field: 'msku', search_value: search, exact_search: 1, sids: store.id, status: '', is_pair: '', global_tag_ids: '' }, signal);
          if (!Array.isArray(r.data?.list) || !Number.isFinite(Number(r.data.total))) throw new Error('Listing 返回结构变化');
          if (r.data.list.some(x => String(x.store_id) !== store.id || !search.includes(x.msku))) throw new Error('Listing 返回了其他店铺或非精确匹配数据，请核对');
          all.push(...r.data.list);
          if (r.data.list.length < 100 || offset + r.data.list.length >= Number(r.data.total)) break;
          if (offset === 4900) throw new Error('Listing 候选过多，请核对 MSKU');
        }
      }
      return all;
    },
    async product(productId, signal) {
      const r = await read('product', { id: exactId(productId, '商品编号') }, signal);
      if (!r.info || String(r.info.id) !== String(productId)) throw new Error('商品详情编号不一致');
      return r.info;
    }
  };
}
