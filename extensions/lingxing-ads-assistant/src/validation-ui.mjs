export function mountValidationDrawer({panel,el,onLocate}){
  let overview={failures:[],failedProducts:0},page=0,opened=false,signature='',returnFocus;
  const inertBefore=new Map(),root=panel.getRootNode(),pageSize=10;
  const count=el('strong'),products=el('small');
  const openButton=el('button',{id:'validation-open',type:'button','aria-expanded':'false','aria-controls':'validation-drawer',onclick:()=>open()},'查看明细');
  const summary=el('section',{id:'validation-summary',hidden:true,'aria-label':'未生成活动汇总'},el('span',{class:'validation-alert','aria-hidden':'true'},'!'),el('div',{class:'validation-summary-copy'},count,products),openButton);
  const title=el('h2',{id:'validation-title'},'未生成活动明细'),total=el('span',{class:'validation-count'}),involved=el('p',{class:'validation-involved'});
  const closeButton=el('button',{type:'button',class:'validation-close','aria-label':'关闭活动明细',onclick:()=>close()},'×');
  const tbody=el('tbody'),empty=el('div',{class:'validation-empty',hidden:true},'当前没有未生成活动。');
  const table=el('table',{class:'validation-table'},el('colgroup',{},...[24,16,14,35,11].map(width=>el('col',{style:`width:${width}%` }))),el('thead',{},el('tr',{},['MSKU','广告类型','Excel 位置','未生成原因','操作'].map(label=>el('th',{scope:'col'},label)))),tbody);
  const scroll=el('div',{class:'validation-scroll'},table,empty),range=el('span',{class:'validation-range','aria-live':'polite'}),pageText=el('span',{class:'validation-page'});
  const prev=el('button',{type:'button',id:'validation-prev',onclick:()=>turn(-1)},'上一页'),next=el('button',{type:'button',id:'validation-next',onclick:()=>turn(1)},'下一页');
  const drawer=el('section',{id:'validation-drawer',class:'validation-drawer',role:'dialog','aria-modal':'true','aria-labelledby':'validation-title'},
    el('div',{class:'validation-heading'},el('div',{class:'validation-title-row'},title,total,closeButton),involved),scroll,
    el('div',{class:'validation-footer'},range,el('div',{class:'validation-pagination'},prev,pageText,next),el('button',{type:'button',class:'primary',onclick:()=>close()},'返回预览')));
  const overlay=el('div',{class:'validation-overlay',hidden:true},el('button',{class:'validation-scrim',type:'button','aria-label':'关闭活动明细返回预览',onclick:()=>close()}),drawer);
  panel.querySelector('#summary').after(summary);panel.append(overlay);
  function setInert(value){
    if(value){for(const child of panel.children){if(child===overlay)continue;inertBefore.set(child,child.inert);child.inert=true;}}
    else{for(const [child,prior] of inertBefore)child.inert=prior;inertBefore.clear();}
  }
  function open(){if(opened||!overview.failures.length)return;returnFocus=root.activeElement;opened=true;overlay.hidden=false;openButton.setAttribute('aria-expanded','true');setInert(true);render();closeButton.focus({preventScroll:true});}
  function close({restoreFocus=true}={}){if(!opened)return;opened=false;overlay.hidden=true;openButton.setAttribute('aria-expanded','false');setInert(false);if(restoreFocus)(returnFocus?.isConnected&&!returnFocus.closest('[hidden]')?returnFocus:panel.querySelector('#run'))?.focus({preventScroll:true});}
  function turn(step){page+=step;render();scroll.scrollTop=0;}
  function render(){
    const rows=overview.failures,pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.max(0,Math.min(page,pages-1));
    total.textContent=String(rows.length);involved.textContent=`涉及 ${overview.failedProducts} 款商品`;table.hidden=!rows.length;empty.hidden=!!rows.length;
    range.textContent=rows.length?`${page*pageSize+1}–${Math.min((page+1)*pageSize,rows.length)} / ${rows.length} 条 · 每页 ${pageSize} 条`:'0 条';pageText.textContent=`${page+1} / ${pages}`;prev.disabled=page===0;next.disabled=page===pages-1;
    const visible=rows.slice(page*pageSize,(page+1)*pageSize),key=JSON.stringify(visible);
    if(key===signature)return;signature=key;
    const top=scroll.scrollTop,focused=root.activeElement?.dataset?.validationId;
    tbody.replaceChildren(...visible.map(item=>el('tr',{},
      el('td',{class:'validation-msku'},item.msku||'MSKU未填'),el('td',{},item.label),
      el('td',{class:'validation-location'},`第 ${item.row} 行`,el('small',{},item.sheet)),el('td',{class:'validation-reason'},item.reason),
      el('td',{},el('button',{type:'button',class:'validation-locate','data-validation-id':item.id,'aria-label':`定位${item.msku||'未填MSKU'}第${item.row}行${item.label}`,onclick:()=>{close({restoreFocus:false});onLocate(item);}},'定位')))));
    scroll.scrollTop=top;
    if(focused&&opened){const target=[...tbody.querySelectorAll('button')].find(button=>button.dataset.validationId===focused);(target||closeButton).focus({preventScroll:true});}
  }
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(event.key!=='Tab')return;
    const buttons=[...drawer.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1),active=root.activeElement;
    if(event.shiftKey&&active===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
  });
  return {
    update(value){overview=value;summary.hidden=!value.failures.length;count.textContent=`${value.failures.length} 个活动未生成`;products.textContent=`涉及 ${value.failedProducts} 款商品`;if(opened)render();},
    close,reset(){close({restoreFocus:false});page=0;signature='';scroll.scrollTop=0;},isOpen:()=>opened,
    dispose(){close({restoreFocus:false});summary.remove();overlay.remove();}
  };
}

export const VALIDATION_DRAWER_STYLE=`
.panel{position:relative}.panel>header,.panel>.toolbar,.panel>.status-line,.panel>#notice,.panel>#retry-status,.panel>#summary,.panel>footer{flex-shrink:0}
.record-footer .record-count{min-width:0;white-space:nowrap;font-size:11px;color:#776b8c;font-variant-numeric:tabular-nums}
#validation-summary{display:flex;align-items:center;gap:10px;flex-shrink:0;margin:8px 18px;padding:8px 11px;border:1px solid #efdbb9;border-radius:7px;background:#fff8eb;color:#98601d;font-size:12px}
.validation-alert{display:grid;place-items:center;flex:0 0 16px;height:16px;border:1px solid #bd833a;border-radius:50%;font-size:11px}
.validation-summary-copy{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;min-width:0}.validation-summary-copy strong{font-size:12px}.validation-summary-copy small{font-size:11px;color:#8b7b65}
#validation-open{margin-left:auto;flex-shrink:0;white-space:nowrap;font-size:11px;padding:5px 8px;color:#8f5e20;border-color:#e8d2b0;background:#fffdfa}
.validation-overlay{position:absolute;inset:0;z-index:5;display:flex;justify-content:flex-end;overflow:hidden}
.panel .validation-scrim{position:absolute;inset:0;border:0;border-radius:0;padding:0;background:#28213f55}
.validation-drawer{position:relative;width:min(820px,calc(100% - 72px));height:100%;min-height:0;display:flex;flex-direction:column;background:#fff;color:#302842;border-left:1px solid #d9cfe8;box-shadow:-12px 0 32px #281e3826}
.validation-heading{padding:17px 18px 13px;border-bottom:1px solid #e5dfef;flex-shrink:0;background:#fff}.validation-title-row{display:flex;align-items:center;gap:8px}.validation-title-row h2{margin:0;font-size:17px;word-break:normal}.validation-count{padding:1px 7px;border-radius:4px;background:#eee7fa;color:#7954ba;font-size:12px;font-variant-numeric:tabular-nums}
.panel .validation-close{margin-left:auto;width:28px;height:28px;padding:0;font-size:20px;line-height:1;background:#fff;color:#81738e;border-color:#e5deed}.validation-involved{margin:7px 0 0;font-size:11px;color:#8c8097}
.validation-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:#c9bbdf #f8f5fc}
.validation-table{table-layout:fixed;border-collapse:separate;border-spacing:0;width:100%;font-size:12px}.validation-table th{position:sticky;top:0;z-index:1;background:#f5f1fb;padding:8px 11px;color:#7a6f88;font-size:11px;border-bottom:1px solid #e9e1f1;font-weight:500;white-space:nowrap}
.validation-table td{padding:8px 11px;border-bottom:1px solid #eee8f4;vertical-align:top;line-height:1.5;overflow-wrap:anywhere;background:#fff}.validation-table td:first-child,.validation-table th:first-child,.validation-table td:nth-child(2),.validation-table th:nth-child(2){min-width:0}
.validation-msku{font-size:11px;font-weight:600}.validation-location{font-size:11px;color:#857a90;font-variant-numeric:tabular-nums}.validation-location small{display:block;font-size:11px;margin-top:3px;overflow-wrap:anywhere}.validation-reason{color:#b0443c}
.panel .validation-locate{padding:4px 7px;white-space:nowrap;font-size:11px;color:#7651b8;border-color:#dfd2ef;background:#fbf9ff}.validation-empty{padding:28px 18px;color:#7b6f86;font-size:12px}
.validation-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:11px 16px;flex-shrink:0;border-top:1px solid #e6deef;background:#fff}.validation-range{font-size:11px;color:#84768f;font-variant-numeric:tabular-nums}.validation-pagination{display:flex;align-items:center;gap:8px}.validation-pagination button,.validation-footer>button{padding:6px 9px;font-size:11px;white-space:nowrap}.validation-page{font-size:12px;color:#7d698e;font-variant-numeric:tabular-nums}.campaign.validation-focus{border-color:#ba7b63;box-shadow:0 0 0 2px #e5b3a355}
@media(max-width:700px){.validation-drawer{width:100%;border-left:0}#validation-summary{margin:6px 10px}.validation-summary-copy small{display:none}.validation-table{display:block;table-layout:auto}.validation-table colgroup,.validation-table thead{display:none}.validation-table tbody{display:block;width:100%}.validation-table tr{display:grid;grid-template-columns:minmax(0,1fr) 82px;gap:4px 8px;padding:10px 13px;border-bottom:1px solid #e9e1ef}.validation-table td{display:block;min-width:0;padding:0;border:0}.validation-table td:first-child{grid-column:1;grid-row:1}.validation-table td:nth-child(2){grid-column:1;grid-row:2;font-size:11px;color:#8c7d95}.validation-table td:nth-child(3){grid-column:2;grid-row:1/3;text-align:right}.validation-table td:nth-child(4){grid-column:1;grid-row:3}.validation-table td:nth-child(5){grid-column:2;grid-row:3;text-align:right;align-self:center}.validation-range{flex-basis:100%}.validation-footer{padding:9px 12px}}
`;
