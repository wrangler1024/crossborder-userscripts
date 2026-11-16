export function findNativeComponent(win, name) {
  const roots = [win.document.getElementById('app')?.__vue__, ...[...win.document.querySelectorAll('.import-root')].map(e => e.__vue__)].filter(Boolean);
  const seen = new Set();
  while (roots.length && seen.size < 12000) {
    const component = roots.shift();
    if (!component || seen.has(component)) continue;
    seen.add(component);
    if (component.$options?.name === name && !component._isDestroyed && !component._inactive) return component;
    roots.push(...(component.$children || []));
    if (component.$parent) roots.push(component.$parent);
  }
  return null;
}
export function getNativeContext(win) {
  const component = findNativeComponent(win, 'ProductManageSku');
  if (!component || !component.$store || typeof component.$get !== 'function' || typeof component.$gwPost !== 'function') throw new Error('请在已登录的领星“产品管理”页面打开插件，等待列表加载完成');
  return component;
}
export function contextIdentity(component) {
  const info = component.$store?.state?.myInfo;
  const company = component.$cookies?.get?.('company_id');
  if (!info?.uid || !info?.zid || !company) throw new Error('领星会话尚未就绪，请刷新页面');
  return JSON.stringify([String(company), String(info.uid), String(info.zid)]);
}
export function onProductPage(win) { return win.location.hostname === 'erp.lingxing.com' && /^\/erp\/productManage\/?$/.test(win.location.pathname); }
export async function accountScope(component, cryptoObject = crypto) {
  const bytes = new TextEncoder().encode(contextIdentity(component));
  const hash = await cryptoObject.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function companyScope(component, cryptoObject = crypto) {
  contextIdentity(component);
  const hash = await cryptoObject.subtle.digest('SHA-256', new TextEncoder().encode('package-company:' + String(component.$cookies.get('company_id'))));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
