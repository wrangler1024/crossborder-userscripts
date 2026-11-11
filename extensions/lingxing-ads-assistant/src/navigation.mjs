// The legacy page only offers navigation. No ERP session or business storage is used.
export const ADS_ORIGIN='https://ads.lingxing.com';
export const NEW_ADS_PATH='/amazon/list-sp';
export const OPEN_ONCE_KEY='lx-ads-assistant-open-once-v1';
export const OPEN_ONCE_QUERY='lx_ads_open';
export const OPEN_ONCE_TTL=5*60*1000;
export const LEGACY_ENTRY_ID='lingxing-ads-legacy-entry';
// Shared by the lightweight legacy entry and the full assistant.
export const CIRCLE_DOCK_STYLE=`
.ads-dock{position:fixed;right:0;top:clamp(8px,var(--dock-top,50vh),max(8px,calc(100vh - 150px)));width:46px;height:46px;z-index:2147483600;transition:width .2s cubic-bezier(.2,.7,.2,1);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#f6f4ff}
.ads-dock:hover,.ads-dock:focus-within,.ads-dock.dragging,.ads-dock.menu-open{width:190px}
.ads-dock .dock-handle{position:absolute;right:0;top:0;z-index:2;display:grid;place-items:center;box-sizing:border-box;width:46px;height:46px;padding:10px;border:2px solid transparent;border-radius:50%;background:linear-gradient(145deg,#283774,#25144e) padding-box,linear-gradient(145deg,#39cdf9,#6572ff 48%,#ac4df0) border-box;color:white;box-shadow:-3px 5px 16px #4541a52b,0 0 8px #8559ec20;cursor:pointer;touch-action:none;user-select:none}
.ads-dock .dock-handle:hover{background:linear-gradient(145deg,#35458d,#352064) padding-box,linear-gradient(145deg,#67dcff,#7c83ff 48%,#c174f7) border-box}.ads-dock.dragging .dock-handle{cursor:grabbing}
.assistant-glyph{display:block;width:24px;height:24px;flex-shrink:0;pointer-events:none}
.dock-actions{position:absolute;left:0;top:6px;box-sizing:border-box;display:flex;align-items:center;width:calc(100% - 23px);height:34px;padding-right:23px;border:1px solid #7775cd55;border-radius:22px 0 0 22px;background:linear-gradient(110deg,#202d59,#2b2156);box-shadow:-4px 5px 16px #25215720;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .16s ease;overflow:hidden}
.ads-dock:hover .dock-actions,.ads-dock:focus-within .dock-actions,.ads-dock.dragging .dock-actions,.ads-dock.menu-open .dock-actions{opacity:1;visibility:visible;pointer-events:auto}
.ads-dock .dock-open{display:flex;align-items:center;justify-content:center;flex:1;min-width:0;height:100%;padding:0 10px 0 17px;border:0;border-radius:22px 0 0 22px;background:transparent;color:#f5f3ff;font:inherit;font-weight:600;white-space:nowrap;cursor:pointer}
.ads-dock .dock-open:hover{background:#8580ed24}.ads-dock button:focus-visible{outline:2px solid #aa9fff;outline-offset:-3px}
.ads-dock[hidden],.dock-menu[hidden]{display:none!important}
@media(prefers-reduced-motion:reduce){.ads-dock,.dock-actions{transition:none}}
`;
export function createAssistantGlyph(doc){
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg'),path=doc.createElementNS(ns,'path');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round',class:'assistant-glyph','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
  path.setAttribute('d','M9 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M4 9v11l6-6 4 3 5-8m-5 0h5v5');svg.append(path);return svg;
}

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
    style.textContent=':host{all:initial}'+CIRCLE_DOCK_STYLE;
    const dock=doc.createElement('div');dock.className='ads-dock';
    const button=doc.createElement('button');button.type='button';button.className='dock-handle';button.title='前往新版广告页并打开助手';button.setAttribute('aria-label','打开广告创建助手');button.append(createAssistantGlyph(doc));
    const actions=doc.createElement('div');actions.className='dock-actions';
    const label=doc.createElement('button');label.type='button';label.className='dock-open';label.textContent='广告助手';label.addEventListener('click',open);actions.append(label);
    button.addEventListener('click',open);dock.append(button,actions);shadow.append(style,dock);doc.body.append(host);
  };
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return {open};
}
