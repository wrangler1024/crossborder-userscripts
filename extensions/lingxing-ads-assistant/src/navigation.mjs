// The legacy page only offers navigation. No ERP session or business storage is used.
export const ADS_ORIGIN='https://ads.lingxing.com';
export const NEW_ADS_PATH='/amazon/list-sp';
export const OPEN_ONCE_KEY='lx-ads-assistant-open-once-v1';
export const OPEN_ONCE_QUERY='lx_ads_open';
export const OPEN_ONCE_TTL=5*60*1000;
export const LEGACY_ENTRY_ID='lingxing-ads-legacy-entry';

export function isLegacyAdsPage(win){
  return win.top===win.self&&win.location.origin===ADS_ORIGIN&&win.location.pathname.startsWith('/ad_report/');
}
export function isNewAdsPage(win){
  return win.top===win.self&&win.location.origin===ADS_ORIGIN&&win.location.pathname.startsWith('/amazon/');
}
export function openNewAdsAssistant(win,now=Date.now()){
  if(!isLegacyAdsPage(win))return;
  let url=ADS_ORIGIN+NEW_ADS_PATH;
  try{win.sessionStorage.setItem(OPEN_ONCE_KEY,String(now));}
  catch{url+=`?${OPEN_ONCE_QUERY}=${now}`;}
  win.location.assign(url);
}
export function consumeAssistantOpen(win,now=Date.now()){
  if(!isNewAdsPage(win)||win.location.pathname!==NEW_ADS_PATH)return false;
  const fresh=value=>{const at=Number(value);return typeof value==='string'&&value.trim()!==''&&Number.isFinite(at)&&at>0&&now>=at&&now-at<=OPEN_ONCE_TTL;};
  let requested=false;
  try{
    const saved=win.sessionStorage.getItem(OPEN_ONCE_KEY);
    win.sessionStorage.removeItem(OPEN_ONCE_KEY);
    requested=fresh(saved);
  }catch{/* Storage may be disabled; the URL is a one-time fallback. */}
  const url=new win.URL(win.location.href);
  if(url.searchParams.has(OPEN_ONCE_QUERY)){
    const fromUrl=fresh(url.searchParams.get(OPEN_ONCE_QUERY));
    url.searchParams.delete(OPEN_ONCE_QUERY);
    try{win.history.replaceState(win.history.state,'',url.href);requested=requested||fromUrl;}
    catch{/* Never repeatedly auto-open a marker that cannot be consumed. */}
  }
  return requested;
}
export function mountLegacyEntry(win){
  if(!isLegacyAdsPage(win))return null;
  const doc=win.document;
  const open=()=>openNewAdsAssistant(win);
  const mount=()=>{
    if(!isLegacyAdsPage(win)||doc.getElementById(LEGACY_ENTRY_ID))return;
    const host=doc.createElement('div');host.id=LEGACY_ENTRY_ID;
    const shadow=host.attachShadow({mode:'open'}),style=doc.createElement('style');
    style.textContent=`:host{all:initial!important;position:fixed!important;right:18px!important;bottom:24px!important;z-index:2147483646!important;display:block!important}button{display:flex;align-items:center;gap:9px;border:1px solid #4c89e4;border-radius:10px;padding:12px 16px;background:#185cc9;color:white;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px #14375d30;cursor:pointer}button:hover{background:#124da9}button:focus-visible{outline:3px solid #82b6ff;outline-offset:3px}.arrow{font-size:18px}`;
    const button=doc.createElement('button');button.type='button';button.textContent='广告创建助手';button.title='前往新版广告页并打开助手';
    const arrow=doc.createElement('span');arrow.className='arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');button.append(arrow);
    button.addEventListener('click',open);shadow.append(style,button);doc.body.append(host);
  };
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return {open};
}
