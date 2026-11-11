export const LAUNCHER_STYLE=`
.ads-dock{position:fixed;right:0;top:clamp(8px,var(--dock-top,50vh),max(8px,calc(100vh - 150px)));width:22px;height:60px;z-index:2147483600;transition:width .16s ease;display:flex;border:1px solid #a9bfd6;border-right:0;border-radius:9px 0 0 9px;background:#f6f9fd;color:#254866;box-shadow:0 2px 8px #14365d18;overflow:hidden}
.ads-dock:hover,.ads-dock:focus-within,.ads-dock.dragging{width:148px;box-shadow:0 3px 14px #14365d24}
.ads-dock .dock-handle{position:absolute;right:0;top:0;z-index:1;width:22px;height:100%;flex:none;border:0;border-radius:0;padding:6px 4px;background:#e5eef9;color:#285a92;writing-mode:vertical-rl;font-size:11px;line-height:14px;letter-spacing:2px;touch-action:none;user-select:none;cursor:grab}
.ads-dock.dragging .dock-handle{cursor:grabbing}.ads-dock button:focus-visible{outline:2px solid #1768d3;outline-offset:-3px}
.dock-actions{display:flex;flex:none;width:126px;margin-right:22px;opacity:0;pointer-events:none;flex-direction:column;justify-content:center;padding:5px 9px;gap:5px}.ads-dock:hover .dock-actions,.ads-dock:focus-within .dock-actions,.ads-dock.dragging .dock-actions{opacity:1;pointer-events:auto}.dock-actions strong{font-size:11px;font-weight:600;white-space:nowrap}.dock-controls{display:flex;gap:7px}.dock-controls button{padding:2px 8px;border-radius:5px;font-size:11px;line-height:18px;min-height:24px}
.launcher-toast{position:fixed;top:75px;left:50%;transform:translateX(-50%);z-index:2147483602;max-width:calc(100vw - 40px);padding:8px 14px;background:#17364feb;color:white;border-radius:7px;box-shadow:0 3px 12px #14365d22;font-size:12px;pointer-events:none}
@media(prefers-reduced-motion:reduce){.ads-dock{transition:none}}
`;
export function mountEdgeLauncher({win,host,shadow,el,onOpen,transport}){
  let preferences={hidden:false,position:.5},panelOpen=false,sequence=0,latest='',drag=null,suppressClick=false,toastTimer;
  const request=(action,patch)=>{const id=latest='launcher-'+(++sequence);if(transport){Promise.resolve().then(()=>transport(action,patch)).then(value=>{if(id===latest)apply(value);},error=>notify(error.message||'入口设置未保存'));}else win.postMessage({type:'LX_ADS_LAUNCHER_REQUEST',id,action,preferences:patch},win.location.origin);};
  const toast=el('div',{class:'launcher-toast',role:'status',hidden:true});
  const notify=message=>{toast.textContent=message;toast.hidden=false;win.clearTimeout(toastTimer);toastTimer=win.setTimeout(()=>{toast.hidden=true},4500);};
  const bounds=()=>{const height=win.innerHeight;return {min:Math.min(100,Math.max(8,height*.15)),max:Math.max(8,height-150)};};
  const place=()=>{const {min,max}=bounds(),start=Math.min(min,max);dock.style.setProperty('--dock-top',`${start+preferences.position*Math.max(0,max-start)}px`);dock.hidden=panelOpen||preferences.hidden;};
  const open=()=>{suppressClick=false;onOpen();};
  const hide=()=>{preferences.hidden=true;place();request('write',{hidden:true});notify('侧边入口已隐藏，可从浏览器扩展按钮打开助手');};
  const handle=el('button',{class:'dock-handle',type:'button','aria-label':'打开广告创建助手，可上下拖动调整位置',title:'点击打开助手；上下拖动或用方向键移动',onclick:()=>{if(suppressClick){suppressClick=false;return;}open();}},'广告');
  const dock=el('div',{class:'ads-dock','aria-label':'广告助手侧边入口'},handle,el('div',{class:'dock-actions'},el('strong',{},'广告创建助手'),el('div',{class:'dock-controls'},el('button',{type:'button',class:'primary',onclick:open},'打开'),el('button',{type:'button',onclick:hide,'aria-label':'隐藏广告助手侧边入口'},'隐藏'))));
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
  host.setAttribute('data-edge-launcher','1');shadow.append(dock,toast);win.addEventListener('message',receive);win.addEventListener('resize',place);place();request('read');
  return {open,show(){preferences.hidden=false;place();request('write',{hidden:false});},setPanelOpen(value){panelOpen=value;place();if(!value&&!preferences.hidden)handle.blur();},dispose(){win.clearTimeout(toastTimer);win.removeEventListener('message',receive);win.removeEventListener('resize',place);dock.remove();toast.remove();host.removeAttribute('data-edge-launcher');}};
}
