import {CIRCLE_DOCK_STYLE,createAssistantGlyph} from './navigation.mjs';
export const LAUNCHER_STYLE=CIRCLE_DOCK_STYLE+`
.ads-dock .dock-menu-toggle{flex:0 0 30px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:#c8c8ed;font-size:15px;line-height:1;letter-spacing:1px;cursor:pointer}.ads-dock .dock-menu-toggle:hover{background:#8580ed33;color:white}
.dock-menu{position:absolute;right:4px;top:52px;min-width:126px;padding:5px;border:1px solid #7775cd66;border-radius:10px;background:#25234a;box-shadow:0 8px 22px #211f4233}.ads-dock .dock-menu button{display:block;width:100%;padding:8px 10px;border:0;border-radius:6px;background:transparent;color:#f4f1ff;text-align:left;font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer}.ads-dock .dock-menu button:hover{background:#8076d433}
.launcher-toast{position:fixed;top:75px;left:50%;transform:translateX(-50%);z-index:2147483602;max-width:calc(100vw - 40px);padding:8px 14px;background:#28234feb;color:white;border:1px solid #b7a9f34d;border-radius:9px;box-shadow:0 5px 16px #34305b22;font-size:12px;pointer-events:none}
`;
export function mountEdgeLauncher({win,host,shadow,el,onOpen,transport}){
  let preferences={hidden:false,position:.5},panelOpen=false,sequence=0,latest='',drag=null,suppressClick=false,toastTimer;
  const request=(action,patch)=>{const id=latest='launcher-'+(++sequence);if(transport){Promise.resolve().then(()=>transport(action,patch)).then(value=>{if(id===latest)apply(value);},error=>notify(error.message||'入口设置未保存'));}else win.postMessage({type:'LX_ADS_LAUNCHER_REQUEST',id,action,preferences:patch},win.location.origin);};
  const toast=el('div',{class:'launcher-toast',role:'status',hidden:true});
  const notify=message=>{toast.textContent=message;toast.hidden=false;win.clearTimeout(toastTimer);toastTimer=win.setTimeout(()=>{toast.hidden=true},4500);};
  const bounds=()=>{const height=win.innerHeight;return {min:Math.min(100,Math.max(8,height*.15)),max:Math.max(8,height-150)};};
  const place=()=>{const {min,max}=bounds(),start=Math.min(min,max);dock.style.setProperty('--dock-top',`${start+preferences.position*Math.max(0,max-start)}px`);dock.hidden=panelOpen||preferences.hidden;};
  const setMenuOpen=value=>{menu.hidden=!value;dock.classList.toggle('menu-open',value);menuToggle.setAttribute('aria-expanded',String(value));};
  const open=()=>{setMenuOpen(false);suppressClick=false;onOpen();};
  const hide=()=>{setMenuOpen(false);preferences.hidden=true;place();request('write',{hidden:true});notify('侧边入口已隐藏，可从浏览器扩展按钮或油猴菜单打开助手');};
  const handle=el('button',{class:'dock-handle',type:'button','aria-label':'打开广告创建助手，可上下拖动调整位置',title:'点击打开助手；上下拖动或用方向键移动',onclick:()=>{if(suppressClick){suppressClick=false;return;}open();}},createAssistantGlyph(win.document));
  const hideButton=el('button',{type:'button',role:'menuitem',onclick:hide,'aria-label':'隐藏广告助手侧边入口'},'隐藏入口');
  const menu=el('div',{class:'dock-menu',id:'ads-dock-menu',role:'menu',hidden:true},hideButton);
  const menuToggle=el('button',{type:'button',class:'dock-menu-toggle','aria-label':'广告助手更多操作','aria-haspopup':'menu','aria-controls':'ads-dock-menu','aria-expanded':'false',onclick:()=>setMenuOpen(menu.hidden),onkeydown:e=>{if(e.key==='ArrowDown'){e.preventDefault();setMenuOpen(true);hideButton.focus();}}},el('span',{'aria-hidden':'true'},'···'));
  const dock=el('div',{class:'ads-dock','aria-label':'广告助手侧边入口'},handle,el('div',{class:'dock-actions'},el('button',{type:'button',class:'dock-open',onclick:open,'aria-label':'打开广告创建助手'},'广告助手'),menuToggle),menu);
  const dismissMenu=event=>{if(!event.composedPath().includes(dock))setMenuOpen(false);};
  dock.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();setMenuOpen(false);handle.focus();}});
  handle.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={id:event.pointerId,startY:event.clientY,top:dock.getBoundingClientRect().top,moved:false};handle.setPointerCapture(event.pointerId);});
  handle.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const dy=event.clientY-drag.startY;if(Math.abs(dy)>5)drag.moved=true;if(!drag.moved)return;event.preventDefault();dock.classList.add('dragging');const {min,max}=bounds(),start=Math.min(min,max),range=Math.max(0,max-start);preferences.position=range?Math.max(0,Math.min(1,(drag.top+dy-start)/range)):.5;place();});
  const endDrag=event=>{if(!drag||event.pointerId!==drag.id)return;const moved=drag.moved;drag=null;dock.classList.remove('dragging');suppressClick=moved&&event.type==='pointerup';if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);if(moved){handle.blur();request('write',{position:preferences.position});}};
  handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',endDrag);
  handle.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key))suppressClick=false;if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();preferences.position=event.key==='Home'?0:event.key==='End'?1:Math.max(0,Math.min(1,preferences.position+(event.key==='ArrowUp'?-.06:.06)));place();request('write',{position:preferences.position});});
  const apply=value=>{preferences={hidden:value?.hidden===true,position:typeof value?.position==='number'&&Number.isFinite(value.position)?Math.max(0,Math.min(1,value.position)):.5};place();};
  const receive=event=>{
    if(event.source!==win||event.origin!==win.location.origin)return;
    const data=event.data;
    if(data?.type==='LX_ADS_LAUNCHER_RESPONSE'&&data.id===latest){if(data.ok)apply(data.result);else notify(data.error||'入口设置未保存，下次刷新可能恢复');}
    if(data?.type==='LX_ADS_LAUNCHER_CONTROL'){latest='';if(data.action==='open')open();else if(data.action==='preferences')apply(data.preferences);}
  };
  host.setAttribute('data-edge-launcher','1');shadow.append(dock,toast);win.addEventListener('message',receive);win.addEventListener('resize',place);win.addEventListener('pointerdown',dismissMenu);place();request('read');
  return {open,show(){preferences.hidden=false;place();request('write',{hidden:false});},setPanelOpen(value){setMenuOpen(false);panelOpen=value;place();if(!value&&!preferences.hidden)handle.blur();},dispose(){win.clearTimeout(toastTimer);win.removeEventListener('message',receive);win.removeEventListener('resize',place);win.removeEventListener('pointerdown',dismissMenu);dock.remove();toast.remove();host.removeAttribute('data-edge-launcher');}};
}
