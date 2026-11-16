import { exactId } from './json.mjs';
const MARKETS = {
  US: ['us', '美国', 'amazon.com'], CA: ['ca', '加拿大', 'amazon.ca'], MX: ['mx', '墨西哥', 'amazon.com.mx'],
  GB: ['gb', 'uk', '英国', 'amazon.co.uk'], DE: ['de', '德国', 'amazon.de'], FR: ['fr', '法国', 'amazon.fr'],
  IT: ['it', '意大利', 'amazon.it'], ES: ['es', '西班牙', 'amazon.es'], NL: ['nl', '荷兰', 'amazon.nl'],
  PL: ['pl', '波兰', 'amazon.pl'], SE: ['se', '瑞典', 'amazon.se'], BE: ['be', '比利时', 'amazon.com.be'],
  AU: ['au', '澳大利亚', '澳洲', 'amazon.com.au'], JP: ['jp', '日本', 'amazon.co.jp'], AE: ['ae', '阿联酋', 'amazon.ae'],
  SA: ['sa', '沙特阿拉伯', '沙特', 'amazon.sa'], SG: ['sg', '新加坡', 'amazon.sg'], IN: ['in', '印度', 'amazon.in'],
  BR: ['br', '巴西', 'amazon.com.br'], TR: ['tr', '土耳其', 'amazon.com.tr'], IE: ['ie', '爱尔兰', 'amazon.ie']
};
export function marketCode(value) {
  const text = String(value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return Object.entries(MARKETS).find(([, values]) => values.includes(text))?.[0] || null;
}
export function normalizeStores(response) {
  if (Number(response?.code) !== 1 || !Array.isArray(response.sellers)) throw new Error('店铺列表结构变化，请刷新领星后重试');
  const markets = Array.isArray(response.markets) ? response.markets : [];
  return response.sellers.filter(s => !Number(s.is_concept)).map(s => {
    const id = exactId(s.sid, '店铺编号');
    const market = markets.find(m => String(m.country_id) === String(s.country_id));
    return { id, name: String(s.seller_simple_name || ''), country: marketCode(market?.code) || marketCode(s.country), countryName: String(s.country || '') };
  }).filter(s => s.name && s.country);
}
export function matchListing(row, store, listings) {
  const matches = listings.filter(x => String(x.store_id) === store.id && x.msku === row.msku);
  if (matches.length !== 1) throw Object.assign(new Error(matches.length ? '同店铺 MSKU 返回多个候选，请核对 Listing' : '在所选店铺中未找到该 MSKU'), { reason: 'identity' });
  const listing = matches[0];
  if (listing.asin !== row.asin || (row.fnsku && listing.fnsku !== row.fnsku)) throw Object.assign(new Error('ASIN / FNSKU 与领星 Listing 不一致'), { reason: 'identity' });
  if (Number(listing.is_pair) !== 1 || !listing.local_sku || !listing.product_id || String(listing.product_id) === '0') throw Object.assign(new Error('未配对本地商品，请在领星完成配对后重新匹配'), { reason: 'unpaired' });
  return { storeId: store.id, msku: row.msku, asin: row.asin, fnsku: row.fnsku, productId: exactId(listing.product_id, '本地商品编号'), localSku: String(listing.local_sku) };
}
export function validateReportMarket(row, store) {
  if (!row.market) return;
  const code = marketCode(row.market);
  if (!code) throw Object.assign(new Error('无法识别报表站点：' + row.market), { reason: 'market' });
  if (code !== store.country) throw Object.assign(new Error('报表站点 ' + code + ' 与当前店铺 ' + store.country + ' 不一致，本行已跳过'), { reason: 'other_market' });
}
export function sameBinding(a, b) {
  return ['storeId', 'msku', 'asin', 'fnsku', 'productId', 'localSku'].every(k => a[k] === b[k]);
}
