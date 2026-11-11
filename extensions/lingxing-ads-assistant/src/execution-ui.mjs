import {creationCandidates,executionKey,buildCreationPayload,preflightCreation,executionFingerprint,runCreationBatch} from './execution.mjs';
import {createExecutionClient,createExecutionJournal} from './execution-client.mjs';
import {previewScope} from './persistence.mjs';
import {MIN_ACTIVE_STOCK,validSellableStock} from './model.mjs';

export function openExecutionDialog({shadow,records,session,reader,transport,onBusy=()=>{}}){
  const create=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')node.className=v;else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(v!==undefined&&v!==false)node.setAttribute(k,String(v));}for(const child of children.flat())if(child!==undefined&&child!==null)node.append(child instanceof Node?child:document.createTextNode(String(child)));return node;};
  const candidates=creationCandidates(records),currentKeys=new Set(candidates.map(executionKey)),services=createExecutionClient(session,reader);
  let journal,entries=[],checks=[],selected=new Set(),selectionInitialized=false,busy=false,submitting=false,stopRequested=false,closed=false,pollTimer=null,pollCount=0;
  const readController=new AbortController(),owner=crypto.randomUUID();
  const states={checking:'提交前复核',submitting:'提交中',not_sent:'尚未提交',submitted:'后台创建中',unknown:'结果待核实',failed:'创建失败',review:'待人工核对',complete:'已完成'};
  const date=new Date(),pad=n=>String(n).padStart(2,'0');
  const startDate=create('input',{type:'date',id:'creation-date',value:`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`,onchange:()=>render()});
  const mode=create('select',{id:'creation-state',onchange:()=>render()},create('option',{value:'paused'},'暂停'),create('option',{value:'enabled'},'启用'));
  const message=create('p',{class:'creation-message',role:'status'},'正在加载创建记录…'),summary=create('div',{class:'creation-summary'}),modeHint=create('p',{class:'muted'}),body=create('tbody');
  const closeButton=create('button',{onclick:()=>close()},'返回预览');
  const checkButton=create('button',{onclick:()=>void check()},'重新检查');
  const resultButton=create('button',{onclick:()=>void checkResults()},'检查创建结果');
  const exportButton=create('button',{onclick:()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),entries},null,2)],{type:'application/json'}));const link=create('a',{href:url,download:'广告创建记录.json'});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}},'导出创建记录');
  const stopButton=create('button',{hidden:true,onclick:()=>{stopRequested=true;message.textContent='等待当前提交返回后停止，后续活动不会再提交。';render();}},'停止后续提交');
  const submitButton=create('button',{class:'primary',id:'confirm-create',onclick:()=>void submit()},'确认创建');
  const dialog=create('dialog',{class:'execution-dialog','aria-label':'批量创建广告'},
    create('div',{class:'creation-heading'},create('h2',{},'批量创建广告'),closeButton),
    create('p',{class:'muted'},'以当前预览的商品、目标和竞价创建；失败或未选用的渠道不纳入本次清单。'),
    create('div',{class:'creation-options'},create('label',{},'创建后状态 ',mode),create('label',{},'开始日期（站点当地日期） ',startDate)),modeHint,summary,message,
    create('div',{class:'creation-table'},create('table',{},create('thead',{},create('tr',{},['选择','商品 / 店铺','广告活动 / 投放目标','日预算','检查与结果'].map(s=>create('th',{},s)))),body)),
    create('div',{class:'creation-actions'},checkButton,resultButton,exportButton,stopButton,submitButton));
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(submitting){stopRequested=true;message.textContent='等待当前提交返回后停止。';render();}else close();});
  shadow.append(dialog);dialog.showModal();
  function close(){if(submitting){stopRequested=true;return;}closed=true;readController.abort();clearTimeout(pollTimer);dialog.close();dialog.remove();onBusy(false);}
  function lock(value){busy=value;message.classList.toggle('is-busy',value);message.setAttribute('aria-busy',String(value));if(!closed)onBusy(value);render();}
  function displayed(){return [...candidates,...entries.filter(e=>!currentKeys.has(e.key)).map(e=>e.item)];}
  function findEntry(key){return entries.find(e=>e.key===key);}
  function record(entry){const i=entries.findIndex(e=>e.key===entry.key);if(i<0)entries.push(entry);else entries[i]=entry;render();}
  function selectable(item){const key=executionKey(item),entry=findEntry(key);return currentKeys.has(key)&&checks.find(c=>c.key===key)?.ok&&(!entry||['not_sent','checking'].includes(entry.status));}
  function chosen(){return candidates.filter(item=>selected.has(executionKey(item))&&selectable(item));}
  function pausedOnly(item){const check=checks.find(c=>c.key===executionKey(item));return !validSellableStock(check?.stock)||check.stock<MIN_ACTIVE_STOCK||(item.stock!==undefined&&item.stock<MIN_ACTIVE_STOCK);}
  function render(){
    if(closed)return;
    const list=chosen(),sums={};for(const item of list)sums[item.currency]=(sums[item.currency]||0)+item.campaign.budget;
    const lowStock=list.filter(pausedOnly).length;
    mode.querySelector('option[value="enabled"]').disabled=!!lowStock;
    if(lowStock)mode.value='paused';
    summary.textContent=`本次选择 ${list.length} 个活动${Object.keys(sums).length?' · '+Object.entries(sums).map(([currency,sum])=>`${currency} ${sum.toFixed(2)}/日`).join('；'):''} · 本机已有 ${entries.length} 条创建记录`;
    modeHint.textContent=lowStock?`已选${lowStock}个低库存活动，本批仅可创建暂停活动。到货并确认可售库存至少${MIN_ACTIVE_STOCK}件后，由运营在领星手动启用。`:mode.value==='paused'?'活动创建为暂停状态，后续可在领星手动启用。自动广告未勾选的定位类型也会明确暂停。':'活动创建后可开始投放，整批完成前也可能产生广告消耗。提交前逐个复核可售库存至少10件。';
    mode.disabled=startDate.disabled=busy;closeButton.disabled=submitting;checkButton.disabled=busy;resultButton.disabled=busy||!entries.some(e=>!['not_sent','checking','complete'].includes(e.status));exportButton.disabled=!entries.length;
    submitButton.disabled=busy||!list.length||!startDate.value;submitButton.textContent=`确认创建${mode.value==='enabled'?'并启用':''} ${list.length} 个${mode.value==='paused'?'暂停':''}活动`;
    stopButton.hidden=!submitting;stopButton.disabled=stopRequested;
    body.replaceChildren(...displayed().map(item=>{
      const key=executionKey(item),entry=findEntry(key),check=checks.find(c=>c.key===key),eligible=selectable(item),status=entry?states[entry.status]:check?check.ok?pausedOnly(item)?'仅可暂停创建':'可创建':'未通过':'待检查';
      const checkbox=create('input',{type:'checkbox',checked:selected.has(key)&&eligible,disabled:busy||!eligible,'aria-label':`创建${item.campaign.name}`,onchange:e=>{e.target.checked?selected.add(key):selected.delete(key);render();}});
      const targetCount=item.campaign.groups[0].targets.length,label={AUTO:'自动',BROAD:'广泛关键词',EXPANDED_ASIN:'扩展ASIN'}[item.campaign.type];
      return create('tr',{},create('td',{},checkbox),create('td',{},create('b',{},item.msku),create('small',{},item.shop)),create('td',{},create('div',{class:'creation-name'},item.campaign.name),create('small',{},`${label} · ${targetCount}个选用目标 · ${item.asin}`)),create('td',{},`${item.currency} ${item.campaign.budget.toFixed(2)}`),create('td',{},create('b',{class:entry?.status==='complete'?'ready':check&&!check.ok?'blocked':''},status),create('small',{},entry?.message||check?.message||''),entry?.campaignId?create('small',{},`活动ID ${entry.campaignId}`):null));
    }));
  }
  async function check(){
    if(busy||!journal||closed)return;lock(true);clearTimeout(pollTimer);
    try{
      entries=await journal.read();
      const toCheck=candidates.filter(item=>{const e=findEntry(executionKey(item));return !e||['not_sent','checking'].includes(e.status);});
      const previous=selected;checks=await preflightCreation(toCheck,services,{signal:readController.signal,assertSession:services.assertSession,onProgress:(i,total,item)=>{message.textContent=`正在检查 ${i}/${total}：${item.msku}`;}});
      selected=new Set(checks.filter(c=>c.ok&&(!selectionInitialized||previous.has(c.key))).map(c=>c.key));selectionInitialized=true;
      const blocked=checks.filter(c=>!c.ok).length;
      message.textContent=`检查完成：${checks.length-blocked}个活动可创建${blocked?`，${blocked}个未通过`:''}。请核对清单、状态和日期后确认。`;
    }catch(error){message.textContent=error.message;checks=[];selected.clear();}
    finally{lock(false);}
  }
  async function checkResults(automatic=false){
    if(busy||!journal||closed)return;lock(true);clearTimeout(pollTimer);
    try{
      entries=await journal.read();
      const errors=[];
      for(const entry of [...entries]){
        if(['not_sent','checking','complete'].includes(entry.status))continue;
        if(entry.status==='submitting'&&Date.now()-Date.parse(entry.updatedAt)<75000)continue;
        services.assertSession();message.textContent=`检查创建结果：${entry.item.msku} · ${entry.item.campaign.name}`;
        try{record(await journal.update(entry,await services.check(entry,readController.signal)));}
        catch(error){if(readController.signal.aborted)throw error;errors.push(`${entry.item.msku}：${error.message}`);if(error.kind==='rate_limit')break;}
      }
      message.textContent=`已完成 ${entries.filter(e=>e.status==='complete').length} 个；后台处理中 ${entries.filter(e=>['submitted','submitting'].includes(e.status)).length} 个；需核对 ${entries.filter(e=>['failed','review','unknown'].includes(e.status)).length} 个。${errors.length?` ${errors.length}项查询未完成：${errors[0]}`:''}`;
    }catch(error){message.textContent=error.message;}
    finally{lock(false);if(!closed&&automatic&&++pollCount<12&&entries.some(e=>e.status==='submitted'))pollTimer=setTimeout(()=>void checkResults(true),10000);}
  }
  async function submit(){
    if(busy||!journal||closed)return;
    const list=chosen();if(!list.length)return;
    lock(true);submitting=true;stopRequested=false;clearTimeout(pollTimer);render();
    try{
      services.assertSession();
      const prepared=[];for(const item of list){const payload=buildCreationPayload(item,{state:mode.value,startDate:startDate.value});prepared.push({item,payload,payloadHash:await executionFingerprint(payload)});}
      await runCreationBatch({entries:prepared,services,journal,confirmed:true,assertSession:services.assertSession,shouldStop:()=>stopRequested||closed,owner,onEntry:entry=>{record(entry);if(!closed)message.textContent=`${entry.item.msku}：${entry.message}`;}});
      message.textContent=stopRequested?'后续提交已停止；已受理的领星任务继续在后台处理。':'本次提交结束，正在核对领星创建结果。';
    }catch(error){message.textContent=error.message;}
    finally{submitting=false;lock(false);if(!closed&&entries.some(e=>e.status==='submitted')){pollCount=0;void checkResults(true);}}
  }
  void (async()=>{lock(true);try{services.assertSession();journal=createExecutionJournal(transport,await previewScope(session.identity));entries=await journal.read();}catch(error){message.textContent=error.message;}finally{lock(false);if(journal&&!closed)void check();}})();
  return ()=>{stopRequested=true;closed=true;readController.abort();clearTimeout(pollTimer);dialog.close();dialog.remove();};
}

export const EXECUTION_STYLE=`.execution-dialog{width:min(1120px,calc(100vw - 36px));max-height:calc(100vh - 40px);padding:20px;border:1px solid #c6d5e2;border-radius:12px;background:#fff;color:#183042;box-shadow:0 20px 60px #10253666}.execution-dialog::backdrop{background:#102536aa}.creation-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.creation-heading h2{font-size:20px;margin:0}.creation-options{display:flex;gap:22px;flex-wrap:wrap;margin:14px 0 8px}.creation-options label{font-size:12px}.creation-options select,.creation-options input{padding:6px 9px;border:1px solid #c5d4df;border-radius:6px;background:white;color:#183042}.creation-summary{padding:9px 12px;background:#edf4ff;font-size:13px;font-weight:600;border-radius:6px}.creation-message{margin:9px 0;font-size:12px;color:#416482;min-height:20px}.creation-message.is-busy{display:flex;align-items:center;gap:8px;color:#185cc9}.creation-message.is-busy:before{content:"";flex-shrink:0;width:15px;height:15px;border:2px solid #c7def6;border-top-color:#185cc9;border-radius:50%;animation:ads-spin .85s linear infinite}@media(prefers-reduced-motion:reduce){.creation-message.is-busy:before{animation:none}}.creation-table{max-height:50vh;overflow:auto}.creation-table table{width:100%;table-layout:fixed}.creation-table th:first-child,.creation-table td:first-child{width:42px;min-width:0}.creation-table th:nth-child(2){width:18%}.creation-table th:nth-child(3){width:34%}.creation-table th:nth-child(4){width:100px}.creation-table small{display:block;margin-top:3px;font-size:10px;color:#637b8d;overflow-wrap:anywhere}.creation-table td{padding:8px;line-height:1.4;vertical-align:top}.creation-table input{accent-color:#185cc9}.creation-name{overflow-wrap:anywhere;font-size:11px}.creation-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding-top:14px;border-top:1px solid #dce5eb;margin-top:10px}.creation-actions button{font-size:12px;padding:7px 10px}`;
