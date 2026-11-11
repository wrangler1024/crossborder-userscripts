import {SITES,MODEL_VERSION,APP_VERSION,resolveProfile,validateProduct,timestamp,totals,clean,channelInputs,AUTO_TYPES,AUTO_LABELS,selectedAutoTypes} from './model.mjs';
import {observeSession,createClient} from './client.mjs';
import {initializePreview,finalPreviewPlans,previewValues,previewQuote,previewTargetBid,addPreviewKeyword,removePreviewKeyword,selectPreviewAuto,applyPreviewQuotes,failPreviewQuotes} from './preview.mjs';
import {refreshGroupValues,quoteHealth,productImageUrl} from './refresh.mjs';
import {createRetryQueue} from './retry.mjs';
import {previewSnapshot,restorePreview,previewScope,extensionDraftTransport,createDraftStore} from './persistence.mjs';
import {openExecutionDialog,EXECUTION_STYLE} from './execution-ui.mjs';
import {readWorkbook,readSheet,templateWorkbook,previewCsv,previewDocument} from './workbook.mjs';
import {DETAIL_TEMPLATE_FILENAME} from './template-spec.mjs';
import {mountEdgeLauncher,LAUNCHER_STYLE} from './launcher.mjs';
export function mountAssistant(XLSX,win=window,templateBase64='') {
  const state={records:[],book:null,profiles:[],fileName:'',sheet:'',batchTime:'',active:0,running:false,controller:null,generation:0,open:false,autoRetryEnabled:true,local:{phase:'waiting'},localLoading:false,restored:false,notice:'商品信息必填；关键词和扩展ASIN留空时，只预览自动广告。'};
  const retryQueue=createRetryQueue();
  let host,shadow,ticker,storeIdentity=null,storageGeneration=0,disposeExecution,entry;
  const storageTransport=extensionDraftTransport(win);
  const draftStore=createDraftStore({request:storageTransport,onStatus:status=>{state.local=status;updatePersistence();}});
  const session=observeSession(win,({changed})=>{
    if(changed){state.generation++;state.controller?.abort();disposeExecution?.();disposeExecution=null;state.creating=false;retryQueue.reset();draftStore.disconnect();storeIdentity=null;storageGeneration++;state.records=[];state.book=null;state.fileName='';state.sheet='';state.profiles=[];state.running=false;state.refresh=null;state.activity=null;state.restored=false;state.localLoading=false;state.local={phase:'waiting'};state.notice='领星账号已切换，正在检查对应的本地预览。';}
    if(shadow){if(changed)render();else renderStatus();}
    void syncStoredPreview();
  });
  const client=createClient(session,{onRequest:({operation,targetKind})=>{
    if(!state.running)return;
    const stage=operation==='profiles'?'读取店铺列表':operation==='products'?'核对商品与库存':({auto:'获取自动投放建议价',keywords:'获取关键词建议价',targets:'获取扩展ASIN建议价'})[targetKind]||'读取广告数据';
    if(state.activity){state.activity.stage=stage;state.activity.requestStartedAt=Date.now();}
    updateActivity();
  }});
  const el=(tag,attrs={},...children)=>{const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(k==='text')n.textContent=v;else if(v!==undefined&&v!==false)n.setAttribute(k,String(v));}for(const c of children.flat())if(c!==null&&c!==undefined)n.append(c instanceof Node?c:document.createTextNode(String(c)));return n};
  const plans=()=>finalPreviewPlans(state.records);
  function openCreation(){
    if(state.running||state.creating||state.localLoading||!session.identity)return;
    const generation=state.generation;disposeExecution?.();
    disposeExecution=openExecutionDialog({shadow,records:state.records,session,reader:client,transport:storageTransport,onBusy:value=>{if(state.generation===generation){state.creating=value;updateControls();}}});
  }
  const money=(value,currency)=>`${currency} ${Number(value).toFixed(2)}`;
  function updatePersistence(){
    if(!shadow)return;
    const local=state.local,node=shadow.querySelector('#storage-message');
    const time=local.savedAt?new Date(local.savedAt).toLocaleString():'';
    const label=({waiting:'等待识别账号后自动保存',loading:'正在读取本地预览…',empty:'导入后自动保存到本机',saving:'正在保存到本机…',saved:`${state.restored?'已恢复本地预览':'已自动保存'} · ${time}`,cleared:'本地预览已清除，自动保存已暂停；点击“保存预览”可重新开启',error:`保存未完成：${local.error}`})[local.phase]||'';
    if(node.textContent!==label)node.textContent=label;
    node.classList.toggle('save-error',local.phase==='error');
    const busy=state.running||state.creating||state.localLoading||local.phase==='loading';
    shadow.querySelector('#save-preview').disabled=busy||!state.book||!storeIdentity;
    shadow.querySelector('#clear-preview').disabled=busy||!local.hasDraft;
    const source=shadow.querySelector('#saved-file');source.hidden=!state.fileName||!!shadow.querySelector('#file').files?.length;
    source.textContent=state.fileName?`已恢复文件：${state.fileName}`:'';
  }
  function persistPreview(explicit=false){
    if(!state.book||!storeIdentity||state.localLoading)return Promise.resolve();
    try{return draftStore.save(previewSnapshot(state),{explicit});}
    catch(error){state.local={...state.local,phase:'error',error:error.message};updatePersistence();return Promise.resolve();}
  }
  async function syncStoredPreview(){
    const identity=session.identity;if(!identity||identity===storeIdentity)return;
    storeIdentity=identity;const generation=++storageGeneration;state.localLoading=true;updateControls();
    try{
      const scope=await previewScope(identity,win.crypto);if(generation!==storageGeneration)return;
      const snapshot=await draftStore.connect(scope);if(generation!==storageGeneration)return;
      state.localLoading=false;
      if(snapshot&&!state.book){
        try{Object.assign(state,restorePreview(snapshot));state.restored=true;state.notice='已恢复本地预览，可继续调整或导出。库存与建议价为上次读取结果；自动重试已暂停，可按需开启。';}
        catch(error){state.notice=error.message;}
        render();
      }else{updateControls();if(state.book)void persistPreview();}
    }catch(error){if(generation===storageGeneration){state.localLoading=false;state.local={phase:'error',error:error.message};updateControls();}}
  }
  function download(data,type,filename){const u=URL.createObjectURL(new Blob([data],{type}));const a=el('a',{href:u,download:filename});a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
  function cancel({disableAuto=true}={}){state.generation++;state.controller?.abort();retryQueue.reset();if(disableAuto)state.autoRetryEnabled=false;state.running=false;state.refresh=null;state.activity=null;state.notice='已停止读取和本轮自动重试，当前预览保留。';for(const r of state.records)if(r.status==='checking')r.status='pending';render();void persistPreview();}
  function selectSheet(name){
    cancel({disableAuto:false});state.sheet=name;state.restored=false;try{state.records=readSheet(XLSX,state.book,name).map(r=>({...r,status:r.issues.length?'blocked':'pending'}));state.active=0;state.batchTime=timestamp();state.notice=`已读取「${name}」${state.records.length}款。${state.book.SheetNames.length>1?'文件有多个工作表，请分别选择检查；不自动合并。':''}`;}catch(e){state.records=[];state.notice=e.message;}render();void persistPreview(true);
  }
  async function importFile(file){
    if(!file)return;cancel({disableAuto:false});const generation=state.generation;state.records=[];state.book=null;state.notice='正在读取Excel…';render();
    try{const bytes=await file.arrayBuffer();if(generation!==state.generation)return;state.book=readWorkbook(XLSX,bytes,file.name);state.fileName=file.name;selectSheet(state.book.SheetNames[0]);}catch(e){if(generation!==state.generation)return;state.notice='导入失败：'+(e.name==='NotFoundError'?'无法读取此文件，请重新选择可访问的本地Excel副本。':e.message);render();}
  }
  async function loadProfiles(){state.profiles=await client.profiles();return state.profiles;}
  async function run(){
    if(state.running||state.creating||state.localLoading||!state.records.length)return;
    state.restored=false;
    const wait=state.records.map(r=>r.profile?client.cooldown(r.profile).remainingMs:0).reduce((a,b)=>Math.max(a,b),0);
    if(wait>0){state.notice=`接口限流保护中，请等待${Math.ceil(wait/1000)}秒后重新校验。`;updateControls();return;}
    retryQueue.reset();const generation=++state.generation;state.running=true;state.refresh=null;state.activity={startedAt:Date.now(),stage:'读取店铺列表'};state.controller=new AbortController();const signal=state.controller.signal;state.notice='正在读取店铺…';
    for(const r of state.records){r.plan=null;r.product=null;r.previewValidated=false;r.profile=null;r.quoteBook=null;r.error='';r.status=r.issues.length?'blocked':'pending';}render();
    try{
      state.profiles=await client.profiles(signal);if(generation!==state.generation)return;
      const parents=new Map();
      for(const [i,r] of state.records.entries()){
        if(signal.aborted||generation!==state.generation)break;
        r.plan=null;r.product=null;r.error='';if(r.issues.length){r.status='blocked';continue;}
        state.active=i;r.status='checking';state.notice=`正在校验 ${i+1}/${state.records.length}：${r.msku}`;render();
        try{
          const profile=resolveProfile(r,state.profiles);
          const products=await client.products(profile,r.msku,signal);
          if(generation!==state.generation)return;
          r.product=validateProduct(r,profile,products);
          if(r.product.parent){const key=`${profile.profile_id}:${r.product.parent}`;if(parents.has(key)){const prior=parents.get(key);prior.plan=null;prior.previewValidated=false;prior.status='blocked';prior.error='ERP识别到本批同父多个主推子体';throw new Error('ERP识别到本批同父多个主推子体')}parents.set(key,r)}
          const suggestions=await client.suggestions(profile,r,signal);if(generation!==state.generation)return;
          initializePreview(r,profile,r.product,suggestions,state.batchTime);
        }catch(e){if(signal.aborted||generation!==state.generation)return;r.status='blocked';r.error=e.message;if(e.product)r.product=e.product;}
        render();void persistPreview();
      }
      const partial=state.records.filter(r=>r.status==='partial').length;
      state.notice=`校验结束：${plans().length}款可预览${partial?`（其中${partial}款有渠道待处理）`:''}，${state.records.filter(r=>r.status==='blocked').length}款未通过。未选用的渠道已跳过，保留当前预览调整。`;
    }catch(e){if(generation===state.generation)state.notice=e.message;}
    finally{if(generation===state.generation){state.running=false;render();void persistPreview();}}
  }
  function refreshWait(r,key){
    const limit=r?.profile?client.cooldown(r.profile).remainingMs:0;
    const local=Math.max(0,(r?.refreshNotBefore?.[key]||0)-Date.now());
    return {seconds:Math.ceil(Math.max(limit,local)/1000),limited:limit>0};
  }
  const retryCooldownUntil=(r,key)=>Math.max(client.cooldown(r.profile).until,r.refreshNotBefore?.[key]||0);
  function toggleAutomaticRetry(enabled){
    state.autoRetryEnabled=enabled;retryQueue.reset();
    if(!enabled&&state.refresh?.automatic){cancel();return;}
    state.notice=enabled?'已开启新一轮自动重试：失败或缺价的组最多重试3次。':'已关闭自动重试，当前预览保留。';
    updateControls();
  }
  function isPreviewBeingEdited(){return shadow?.activeElement?.id==='keyword-input'||!!shadow?.querySelector('dialog[open]');}
  function tickAutomaticRetry(){
    if(!state.open||!state.autoRetryEnabled||state.running||state.creating||!shadow||isPreviewBeingEdited())return;
    const job=retryQueue.next(state.records,retryCooldownUntil);
    if(job)void refreshQuotes(job.record,job.key,job);
  }
  function updateRetryStatus(){
    const box=shadow.querySelector('#retry-status'),text=shadow.querySelector('#retry-message'),clock=shadow.querySelector('#retry-countdown');
    shadow.querySelector('#auto-retry').checked=state.autoRetryEnabled;
    if(!state.autoRetryEnabled){box.hidden=true;box.dataset.phase='idle';return;}
    if(state.running&&!state.refresh?.automatic){box.hidden=true;box.dataset.phase='idle';return;}
    const summary=retryQueue.summary(state.records,retryCooldownUntil);
    box.hidden=!summary.waiting&&!summary.running&&!summary.exhausted&&!summary.attempts;
    let message,phase='done',badge='✓',seconds=0;
    if(state.refresh?.automatic){
      phase='running';badge=`${state.refresh.attempt}/${retryQueue.maxAttempts}`;
      message=`自动重试中：${state.refresh.record.msku} · ${state.refresh.key==='auto'?'自动':state.refresh.key==='keywords'?'关键词':'商品投放'} · 第${state.refresh.attempt}/${retryQueue.maxAttempts}次`;
    }
    else if(summary.waiting){
      seconds=Math.max(0,Math.ceil((summary.nextAt-Date.now())/1000));
      const paused=state.running||isPreviewBeingEdited();phase=paused?'paused':'waiting';
      badge=paused?'暂停':seconds===0?'即将':seconds<100?`${seconds}s`:`${Math.ceil(seconds/60)}m`;
      message=`自动重试待处理 ${summary.waiting} 组 · ${state.running?'等待当前读取完成':isPreviewBeingEdited()?'编辑期间暂缓':`下一次约 ${seconds} 秒后`} · 每组最多${retryQueue.maxAttempts}次`;
    }else{phase=summary.exhausted?'exhausted':'done';badge=summary.exhausted?'!':'✓';message=summary.exhausted?`自动重试已结束：${summary.exhausted}组达到${retryQueue.maxAttempts}次上限，仍缺失的建议价请人工核对。`:`本轮自动重试已结束，共执行${summary.attempts}次查询。`;}
    box.dataset.phase=box.hidden?'idle':phase;box.classList.toggle('retry-soon',phase==='waiting'&&seconds<=3);
    if(clock.textContent!==badge)clock.textContent=badge;
    if(text.textContent!==message)text.textContent=message;
  }
  async function refreshQuotes(r,key,automaticJob=null){
    if(state.running||state.creating)return;
    let values;try{values=refreshGroupValues(r,key);}catch(e){state.notice=e.message;updateControls();return;}
    if(!values.length)return;
    const wait=refreshWait(r,key);
    if(wait.seconds){state.notice=wait.limited?`接口限流保护中，请等待${wait.seconds}秒后手动重试。`:`刚刚查询过本组，请等待${wait.seconds}秒后再试。`;updateControls();return;}
    if(automaticJob&&!retryQueue.begin(automaticJob,retryCooldownUntil))return;
    const generation=++state.generation;state.running=true;state.controller=new AbortController();const signal=state.controller.signal;
    state.refresh={record:r,key,automatic:!!automaticJob,attempt:automaticJob?.attempts};state.activity={startedAt:Date.now(),stage:'准备获取本组建议价'};state.notice=`${automaticJob?`自动重试第${automaticJob.attempts}/${retryQueue.maxAttempts}次：`:'正在重新获取 '}${r.msku} 本组全部${values.length}个目标的建议价…`;updateControls();
    try{
      const quotes=await client.targetSuggestions(r.profile,r.asin,key,values,signal);
      if(signal.aborted||generation!==state.generation)return;
      applyPreviewQuotes(r,key,values,quotes);
      const missing=quotes.filter(q=>q.status==='none').length;
      state.notice=`本组${values.length}个目标已更新：已获取${quotes.length-missing}个，未返回${missing}个。${missing?'未返回项使用本币备用价。':''}预览调整已保留。`;
    }catch(error){
      if(signal.aborted||generation!==state.generation)return;
      failPreviewQuotes(r,key,values,error);
      state.notice=`建议价获取失败：${error.message.replace(/[。；;]+$/,'')}。本组暂不纳入活动清单，请稍后重试。`;
    }finally{if(generation===state.generation){r.refreshNotBefore??={};r.refreshNotBefore[key]=Date.now()+3000;state.running=false;state.refresh=null;if(automaticJob)retryQueue.finish(automaticJob,state.records);renderQuoteUpdate(r,key);void persistPreview();}}
  }
  function addKeyword(r){
    if(state.running||state.creating)return;
    try{addPreviewKeyword(r,r.keywordDraft);r.keywordDraft='';r.editError='';render();void persistPreview();void refreshQuotes(r,'keywords');}
    catch(error){r.editError=error.message;render();}
  }
  function removeKeyword(r,index){
    if(state.running||state.creating)return;
    try{removePreviewKeyword(r,index);r.editError='';state.notice='关键词已从当前预览剔除，活动数、预算和导出清单已同步。';}
    catch(error){r.editError=error.message;}render();void persistPreview();
  }
  function toggleAuto(r,type,checked){
    if(state.running||state.creating)return;
    try{
      selectPreviewAuto(r,type,checked);r.editError='';state.notice='自动投放选择已更新；只把勾选目标纳入活动清单。';
      if(checked&&(!previewQuote(r,'auto',type)||previewQuote(r,'auto',type).status==='error')){render();void persistPreview();void refreshQuotes(r,'auto');return;}
    }catch(error){r.editError=error.message;}render();void persistPreview();
  }
  function renderStatus(){if(!shadow)return;const n=shadow.querySelector('#session');if(n)n.textContent=session.ready?'领星会话已就绪':'请等待领星加载；未就绪时刷新页面';}
  function table(headers,rows){return el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},headers.map(h=>el('th',{},h)))),el('tbody',{},rows.map(row=>el('tr',{},row.map(c=>el('td',{},c)))))))}
  function updateSummary(){
    const sum=totals(plans());shadow.querySelector('#summary').replaceChildren(el('span',{},`已导入 ${state.records.length} 款`),el('span',{},`可预览 ${plans().length} 款`),...Object.entries(sum).map(([currency,s])=>el('span',{},`${s.campaigns}活动 · ${money(s.dailyBudget,currency)}/日`)));
  }
  function updateActivity(){
    if(!shadow)return;
    const notice=shadow.querySelector('#notice'),message=shadow.querySelector('#notice-message'),meta=shadow.querySelector('#activity-meta');
    const retry=shadow.querySelector('#retry-status'),retryMeta=shadow.querySelector('#retry-meta');
    const usingRetry=!retry.hidden,noticeBusy=state.running&&!usingRetry;
    notice.hidden=usingRetry;
    if(message.textContent!==state.notice)message.textContent=state.notice;
    notice.classList.toggle('busy',noticeBusy);notice.setAttribute('aria-busy',String(noticeBusy));
    shadow.querySelector('.activity-spinner').hidden=!noticeBusy;
    shadow.querySelector('.activity-track').hidden=!noticeBusy;meta.hidden=!noticeBusy;
    let detail=state.notice;
    if(state.running){
      const elapsed=Math.max(0,Math.floor((Date.now()-(state.activity?.startedAt||Date.now()))/1000));
      const completed=state.records.filter(r=>['ready','partial','blocked','skipped'].includes(r.status)).length;
      const progress=state.refresh?`本组${previewValues(state.refresh.record,state.refresh.key).length}个目标`:`已处理 ${completed}/${state.records.length} 款`;
      const slow=Date.now()-(state.activity?.requestStartedAt||Date.now())>=8000?' · 仍在等待领星响应，可随时停止':'';
      detail=`${state.activity?.stage||'正在读取数据'} · ${progress} · 已用时 ${elapsed} 秒${slow}`;
      if(meta.textContent!==detail)meta.textContent=detail;
    }
    retryMeta.hidden=!usingRetry||!detail;
    retryMeta.setAttribute('aria-live',state.running?'off':'polite');
    if(usingRetry&&retryMeta.textContent!==detail)retryMeta.textContent=detail;
    for(const card of shadow.querySelectorAll('.record')){
      const r=state.records[Number(card.dataset.recordIndex)];
      card.classList.toggle('is-loading',!!(state.running&&r&&(r.status==='checking'||state.refresh?.record===r)));
    }
  }
  function updateControls(){
    if(!shadow)return;
    updateRetryStatus();updateActivity();updatePersistence();
    shadow.querySelector('#run').disabled=state.running||state.creating||state.localLoading||!state.records.length;
    shadow.querySelector('#cancel').hidden=!state.running||!!state.refresh?.automatic;
    shadow.querySelector('#file').disabled=state.running||state.creating||state.localLoading;shadow.querySelector('#sheets').disabled=state.running||state.creating||state.localLoading;
    for(const id of ['json','csv'])shadow.querySelector('#'+id).disabled=!plans().length||state.running||state.creating;
    shadow.querySelector('#create-ads').disabled=state.running||state.creating||state.localLoading||!session.identity;
    shadow.querySelector('#create-ads').textContent=plans().length?'创建广告':'创建记录';
    const r=state.records[state.active];
    for(const section of shadow.querySelectorAll('.campaign')){
      const key=section.dataset.channel,wait=refreshWait(r,key),busy=state.running&&state.refresh?.record===r&&state.refresh?.key===key;
      const retry=state.autoRetryEnabled?retryQueue.jobFor(r,key,retryCooldownUntil):null;
      for(const button of section.querySelectorAll('.refresh-quote')){
        button.disabled=state.running||state.creating||wait.seconds>0;
        const text=busy?'刷新中':wait.seconds?`${wait.seconds}s`:button.dataset.idleText;
        if(button.textContent!==text)button.textContent=text;
      }
      for(const control of section.querySelectorAll('.remove-keyword,.add-keyword,[data-auto-type],#keyword-input'))control.disabled=state.running||state.creating||control.dataset.staticDisabled==='true'||(control.classList.contains('add-keyword')&&wait.seconds>0);
      const hint=section.querySelector('.refresh-wait');
      const message=busy?`${state.refresh?.automatic?`自动重试第${state.refresh.attempt}/${retryQueue.maxAttempts}次，`:'正在'}查询本组全部${previewValues(r,key).length}个目标…`:wait.limited?`接口限流保护：等待${wait.seconds}秒后${state.autoRetryEnabled?'按队列自动重试':'手动重试'}。`:retry?.status==='waiting'?`已安排自动重试第${retry.attempts+1}/${retry.maxAttempts}次，约${Math.max(0,Math.ceil((retry.dueAt-Date.now())/1000))}秒后执行。`:retry?.status==='exhausted'?`已自动重试${retry.attempts}次，仍缺失的建议价请人工核对。`:wait.seconds?`防止重复查询，${wait.seconds}秒后可再次刷新。`:'';
      if(hint){hint.hidden=!message;if(hint.textContent!==message)hint.textContent=message;}
    }
  }
  const statusText=r=>({pending:'待校验',checking:'读取中',ready:'可预览',partial:'部分预览',blocked:'待处理',skipped:'已跳过'})[r.status];
  function updateQuoteFlag(node,r){
    const h=quoteHealth(r),count=h.missing+h.failed;
    node.hidden=!count;node.textContent=count?`建议价待获取 ${count}`:'';
    node.title=`未返回下限 ${h.missing} 个；读取失败或尚未读取 ${h.failed} 个。仅统计当前选用目标。`;
  }
  function channelSummary(r){
    const t=table(['渠道','状态','说明'],(r.plan?.channels||channelInputs(r)).map(c=>[c.label,({ready:'可预览',pending:'待校验',skipped:'已跳过',blocked:'待处理'})[c.status],c.reason||(c.status==='ready'?'已生成活动预览':'通过商品及库存检查后读取建议价')]));
    t.classList.add('channel-summary');return t;
  }
  function renderQuoteUpdate(r,key){
    updateSummary();
    const index=state.records.indexOf(r),card=shadow.querySelector(`.record[data-record-index="${index}"]`);
    if(card){const status=card.querySelector('.record-status');status.className='record-status '+r.status;status.textContent=statusText(r);updateQuoteFlag(card.querySelector('.quote-flag'),r);}
    if(state.records[state.active]===r){
      const detail=shadow.querySelector('#detail'),old=detail.querySelector(`[data-channel="${key}"]`),top=detail.getBoundingClientRect().top;
      const anchor=[...(old?.querySelectorAll('tbody tr')||[])].find(row=>row.getBoundingClientRect().bottom>top)||old;
      const anchorValue=anchor?.dataset.quoteValue,before=anchor?.getBoundingClientRect().top,scrollTop=detail.scrollTop;
      const fresh=renderChannel(r,key);old?.replaceWith(fresh);
      detail.querySelector('.channel-summary')?.replaceWith(channelSummary(r));
      const p=r.plan;detail.querySelector('.meta')?.replaceChildren(el('span',{},`${p.campaigns.length}个活动 / ${p.campaigns.length}个组 / 1个主推商品`),el('span',{},`本款计划日预算 ${money(p.campaigns.reduce((n,c)=>n+c.budget,0),p.currency)}`));
      const next=anchorValue?[...fresh.querySelectorAll('tbody tr')].find(row=>row.dataset.quoteValue===anchorValue):fresh;
      detail.scrollTop=scrollTop;if(next&&before!==undefined)detail.scrollTop+=next.getBoundingClientRect().top-before;
    }
    updateControls();
  }
  function openProductImage(r){
    const src=productImageUrl(r.product?.image);if(!src)return;
    const prior=shadow.activeElement;
    const dialog=el('dialog',{class:'image-preview','aria-label':'商品图片预览'},el('button',{class:'image-close',onclick:()=>dialog.close(),'aria-label':'关闭商品图片'},'关闭'),el('img',{src,alt:r.product.title||r.msku,referrerpolicy:'no-referrer'}),el('p',{},r.msku));
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{dialog.remove();prior?.focus({preventScroll:true});},{once:true});
    shadow.append(dialog);dialog.showModal();
  }
  function renderChannel(r,key){
    const type={auto:'AUTO',keywords:'BROAD',targets:'EXPANDED_ASIN'}[key];
    const config=SITES[r.profile.country],c=r.plan.campaigns.find(c=>c.type===type),g=c?.groups[0];
    const chosen=previewValues(r,key),values=key==='auto'?AUTO_TYPES:chosen;
    const inputErrors=r.channelIssues?.[key]?.length;
    const label={auto:`自动 · 已选 ${chosen.length}/4 类`,keywords:`关键词 · 广泛 ${chosen.length}/5`,targets:'商品 · 仅扩展'}[key];
    const number={auto:'01',keywords:'02',targets:'03'}[key];
    const section=el('section',{class:'campaign','data-channel':key},el('div',{class:'campaign-heading'},el('h3',{},el('span',{class:'campaign-number'},number),el('span',{},label)),el('span',{class:'budget'},c?`日预算 ${money(c.budget,c.currency)}`:'未纳入活动预算')));
    if(g)section.append(el('dl',{class:'names'},el('dt',{},'活动'),el('dd',{},c.name),el('dt',{},'广告组'),el('dd',{},g.name)));
    else section.append(el('p',{class:'muted'},r.plan.channels.find(c=>c.key===key)?.reason||'当前没有可用投放目标'));
    section.append(el('p',{class:'muted'},`组默认价 ${money(config.budget/10,config.currency)} · 动态竞价只降低 · 广告位加价0%`));
    section.append(el('div',{class:'refresh-wait','aria-live':'polite',hidden:true}));
    const headers=[...(key==='auto'?['投放']:[]),'投放目标','建议下限','原始计算','预览竞价','依据',...(key==='keywords'?['操作']:[])];
    const rows=values.map((value,index)=>{
      const selected=key!=='auto'||chosen.includes(value),bid=previewTargetBid(r,key,value),ready=selected&&bid.status==='ready';
      const label=key==='auto'?AUTO_LABELS[AUTO_TYPES.indexOf(value)]:key==='targets'?value+' · 扩展':value;
      const lower=el('div',{class:'quote-lower'},el('span',{class:'quote-lower-value'},!selected?'未选用':ready?(bid.lower===null?'未返回':money(bid.lower,config.currency)):'待获取'));
      if(selected&&!inputErrors)lower.append(el('button',{class:'refresh-quote','data-target':value,'data-idle-text':'刷新',disabled:state.running,title:`刷新本商品本组全部${chosen.length}个目标，包括已有建议价的目标`,'aria-label':`刷新${label}所在组的建议价`,onclick:()=>refreshQuotes(r,key)},'刷新'));
      const explanation=ready?(bid.note||bid.source):bid.message;
      const sourceLine=el('div',{class:'quote-source-line'},el('span',{class:ready?(bid.fallback?'pill fallback':'pill'):'pill quote-error'},ready?(bid.fallback?'备用价':'下限×90%'):'待处理'));
      if(selected&&bid.quotedAt)sourceLine.append(el('time',{class:'quote-time',datetime:bid.quotedAt,title:`建议价获取时间：${new Date(bid.quotedAt).toLocaleString()}`},new Date(bid.quotedAt).toLocaleTimeString()));
      const source=selected?el('div',{class:'quote-source'},sourceLine,el('small',{class:'source',title:explanation},explanation)):el('small',{class:'muted'},'不纳入本次活动');
      const cells=[el('span',{class:selected?'':'unselected'},label),lower,ready?String(bid.raw):'—',ready?el('b',{class:selected?'':'unselected'},money(bid.bid,config.currency)):'—',source];
      if(key==='auto')cells.unshift(el('label',{class:'auto-choice'},el('input',{type:'checkbox',checked:selected,disabled:state.running,'data-auto-type':value,'aria-label':`投放${label}`,onchange:e=>toggleAuto(r,value,e.target.checked)}),el('small',{},selected?'选用':'未选')));
      if(key==='keywords')cells.push(el('button',{class:'remove-keyword','data-keyword-index':index,'data-static-disabled':!!inputErrors,disabled:state.running||!!inputErrors,'aria-label':`剔除关键词 ${value}`,onclick:()=>removeKeyword(r,index)},'剔除'));
      return cells;
    });
    if(rows.length){const t=table(headers,rows);t.classList.add('target-table');[...t.querySelectorAll('tbody tr')].forEach((row,i)=>{row.dataset.quoteValue=values[i];});section.append(t);}
    if(key==='keywords'){
      section.append(el('form',{class:'keyword-editor',onsubmit:e=>{e.preventDefault();addKeyword(r);}},el('input',{id:'keyword-input',type:'text',value:r.keywordDraft||'',maxlength:80,placeholder:'输入一个广泛关键词','aria-label':'新增广泛关键词','data-static-disabled':!!inputErrors,disabled:state.running||!!inputErrors,oninput:e=>{r.keywordDraft=e.target.value;void persistPreview();}}),el('button',{class:'add-keyword',type:'submit','data-static-disabled':!!inputErrors,disabled:state.running||!!inputErrors},'添加并获取建议价')));
      section.append(el('small',{class:'muted'},'最多5个；全部剔除时不生成关键词活动。新增词取得建议价后纳入预览。'));
      if(r.editError)section.append(el('p',{class:'edit-error',role:'alert'},r.editError));
    }
    if(key==='auto')section.append(el('small',{class:'muted'},'只生成勾选的自动投放目标；全部取消时不生成自动活动。'));
    return section;
  }
  function renderDetail(){
    const container=shadow.querySelector('#detail');container.replaceChildren();const r=state.records[state.active];
    if(!r){container.append(el('div',{class:'empty'},el('h2',{},'先做自动，按需补充手动渠道'),el('p',{},'店铺、主推MSKU和主推ASIN必填。只填商品信息，预览一个自动活动；填写有效关键词或扩展ASIN，再增加对应活动。'),table(['站点','单活动预算','默认／备用价'],Object.entries(SITES).map(([c,v])=>[c,money(v.budget,v.currency),money(v.budget/10,v.currency)])),el('p',{class:'muted'},'详细模板前五列手填，其余保留默认。广泛词选填1–5个，扩展ASIN选填3–5个；单元格内每行一个。留空跳过；错误单独提示，不自动删掉错误内容凑数。')));return;}
    container.append(el('div',{class:'detail-heading'},el('div',{},el('div',{class:'eyebrow'},`${r.site} · ${r.sheet} 第${r.row}行`),el('h2',{},r.msku),el('p',{class:'muted'},r.asin))));
    const errors=[...r.issues,...(r.error?[r.error]:[])];if(errors.length)container.append(el('div',{class:'message error'},el('b',{},'待处理'),el('ul',{},errors.map(s=>el('li',{},s)))));
    if(r.product){const p=r.product;const product=el('div',{class:'product'},el('div',{},el('b',{title:p.title},p.title),el('p',{},`在售 · 校验时可售库存 ${p.stock} 件`),el('small',{class:'muted'},p.stockSource)));try{const u=new URL(p.image);if(u.protocol==='https:'&&/(?:\.|-)amazon\.(?:com|cn)$/.test(u.hostname))product.prepend(el('img',{src:u.href,alt:'商品图片',referrerpolicy:'no-referrer'}));}catch{}container.append(product);}
    container.append(channelSummary(r));
    if(!r.plan){if(r.status!=='blocked')container.append(el('p',{class:'muted'},r.status==='checking'?'正在读取商品、库存和建议区间…':'点击「校验并生成预览」读取当前领星数据。'));return;}
    const p=r.plan;container.append(el('div',{class:'meta'},el('span',{},`${p.campaigns.length}个活动 / ${p.campaigns.length}个组 / 1个主推商品`),el('span',{},`本款计划日预算 ${money(p.campaigns.reduce((n,c)=>n+c.budget,0),p.currency)}`)));
    container.append(el('p',{class:'preview-authority'},'当前预览清单作为导出及后续创建的依据；再次校验会保留本页增删和勾选。'));
    for(const key of ['auto','keywords',...(r.targets.length?['targets']:[])])container.append(renderChannel(r,key));
    container.append(el('div',{class:'message notice'},el('b',{},'创建前仍需核对'),el('ul',{},p.warnings.map(s=>el('li',{},s))),el('p',{},'金额按当前界面精度向下保留两位；创建前检查本站竞价范围，执行记录中查看提交与创建结果。'),el('small',{},`数据读取时间：${new Date(p.fetchedAt).toLocaleString()}；活动名时间固定为本次导入批次。`)));
  }
  function render(){
    if(!shadow)return;const scrollTop=shadow.querySelector('#detail').scrollTop;renderStatus();
    updateSummary();
    const selector=shadow.querySelector('#sheets');selector.replaceChildren();if(state.book)for(const name of state.book.SheetNames)selector.append(el('option',{value:name},name));
    if(state.sheet)selector.value=state.sheet;selector.hidden=!state.book;
    const list=shadow.querySelector('#records');list.replaceChildren();
    for(const [i,r] of state.records.entries()){
      const flag=el('span',{class:'quote-flag'});updateQuoteFlag(flag,r);
      const card=el('button',{class:'record '+(state.active===i?'selected':''),'data-msku':r.msku,'data-record-index':i,onclick:()=>{state.active=i;render();shadow.querySelector('#detail').scrollTop=0;void persistPreview();}},el('div',{class:'record-main'},el('span',{class:'record-image-slot'}),el('div',{class:'record-text'},el('b',{title:r.msku},r.msku||`第${r.row}行`),el('div',{class:'record-state-line'},el('span',{class:'record-status '+r.status},statusText(r)),flag))),el('div',{class:'record-footer'},el('small',{class:'record-shop',title:r.site},r.site||'店铺未填'),el('small',{class:'record-stock '+(r.product?.stock<10?'low-stock':''),title:'领星广告选品页FBA可售库存'},`可售库存 ${r.product?.stock??'—'}`)));
      const src=productImageUrl(r.product?.image),shell=el('div',{class:'record-shell'},card);
      const fallback=el('span',{class:'image-fallback',hidden:!!src},'暂无图片');
      const thumb=el('button',{class:'record-image',disabled:!src,'aria-label':`预览商品图片 ${r.msku}`,title:src?'点击放大商品图片':'尚未取得商品图片',onclick:()=>openProductImage(r)},fallback);
      if(src)thumb.append(el('img',{src,alt:r.product.title||r.msku,referrerpolicy:'no-referrer',onerror:e=>{e.currentTarget.hidden=true;fallback.hidden=false;thumb.disabled=true;}}));
      shell.append(thumb);list.append(shell);
    }
    renderDetail();shadow.querySelector('#detail').scrollTop=scrollTop;updateControls();
  }
  const style=`:host{all:initial;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#183042}*{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer;border:1px solid #cbd7df;border-radius:8px;background:white;color:#183042;padding:8px 13px}button:hover{background:#f0f5f8}button:disabled{opacity:.45;cursor:default}.primary{background:#185cc9;border-color:#185cc9;color:#fff}.primary:hover{background:#124da9}.backdrop{position:fixed;inset:0;background:#10253660;z-index:2147483601;display:grid;place-items:center}.panel{background:#f7f9fc;border:1px solid #d8e1e8;border-radius:14px;width:min(1240px,calc(100vw - 36px));height:min(880px,calc(100vh - 36px));box-shadow:0 20px 70px #05213c44;display:flex;flex-direction:column;overflow:hidden}header{padding:18px 24px;background:#142e47;color:white;display:flex;justify-content:space-between;align-items:center}h1,h2,h3,p{margin:0 0 8px}h1{font-size:20px;letter-spacing:.4px}h2{font-size:21px;word-break:break-all}h3{font-size:16px}header small{color:#bed0e2}header button{background:transparent;color:white;border-color:#66829b}.toolbar{padding:14px 20px;display:flex;gap:9px;align-items:center;flex-wrap:wrap;background:white}.toolbar select{max-width:160px;padding:8px;border:1px solid #cbd7df;border-radius:8px}.upload{border:1px dashed #83a3c5;border-radius:8px;padding:8px 12px;background:#f3f7fc;cursor:pointer}.upload input{max-width:220px}.status-line{padding:0 22px 12px;background:white;color:#557080;font-size:12px}#notice{padding:9px 22px;background:#ebf2fa;color:#294d75;min-height:40px}#summary{padding:12px 22px;display:flex;gap:16px;flex-wrap:wrap;border-bottom:1px solid #dce5eb;font-weight:600}.workspace{display:grid;grid-template-columns:248px 1fr;min-height:0;flex:1}aside{overflow:auto;padding:14px;border-right:1px solid #dce5eb;background:#f2f6fa}.record{width:100%;display:block;text-align:left;margin-bottom:9px;background:white;padding:12px;overflow:hidden}.record b,.record small{display:block;word-break:break-all}.record small{color:#607583;margin-top:5px}.record.selected{border-color:#2c6dc8;box-shadow:inset 3px 0 #2c6dc8}.record-status{font-size:11px;float:right;margin-left:5px}.ready{color:#16725d}.partial{color:#9a660e}.blocked{color:#b3403a}.checking{color:#185cc9}main{padding:22px;overflow:auto;min-width:0;background:white}.empty{max-width:700px;margin:35px auto}.empty p{color:#617787;margin-bottom:25px}.eyebrow{font-size:12px;color:#607583;margin-bottom:6px}.product{padding:14px;background:#f3f7fa;border-radius:10px;display:flex;gap:16px;margin-bottom:16px}.product img{width:68px;height:68px;object-fit:contain;flex-shrink:0;background:white;border-radius:6px}.muted{color:#6a7e8d;font-size:12px}.meta{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#547086;margin:15px 0}.campaign{border:1px solid #dce5eb;border-radius:10px;margin:18px 0;padding:16px}.campaign-heading{display:flex;justify-content:space-between;gap:12px}.budget{font-weight:600;color:#185cc9;white-space:nowrap}.names{display:grid;grid-template-columns:48px 1fr;gap:4px 10px;font-size:12px;margin:10px 0;color:#4c6575}.names dt{color:#748996}.names dd{margin:0;overflow-wrap:anywhere}.table-wrap{overflow:auto;margin-top:12px}table{border-collapse:collapse;width:100%;text-align:left;font-size:12px}th{background:#f0f5f8;color:#526c7d;font-weight:600;padding:9px}td{padding:11px 9px;border-bottom:1px solid #e8edf2;vertical-align:top;overflow-wrap:anywhere}td:first-child{min-width:130px}th:nth-child(2),td:nth-child(2){min-width:88px}.source{display:block;color:#6a7e8d;max-width:240px;margin-top:4px;line-height:1.5}.pill{display:inline-block;border-radius:4px;background:#e8f3ef;color:#21684e;padding:1px 6px;white-space:nowrap}.fallback{background:#fff2da;color:#8e5a12}.message{padding:13px 16px;border-radius:8px;margin:15px 0;font-size:12px}.message ul{padding-left:20px;margin:8px 0}.error{background:#fff0ee;border:1px solid #f1c2bc;color:#a43930}.notice{background:#f5f7fa;color:#5d7281}.notice p{margin:8px 0}footer{padding:9px 22px;border-top:1px solid #e0e7ee;display:flex;justify-content:space-between;font-size:11px;color:#718697}footer a{color:#30649c} [hidden]{display:none!important}@media(max-width:800px){.workspace{grid-template-columns:175px 1fr}.toolbar{padding:10px;gap:6px}.panel{width:calc(100vw - 12px);height:calc(100vh - 12px)}main{padding:12px}header{padding:12px}.campaign-heading{display:block}.budget{font-size:12px}}`;
  const editorStyle=`.record-footer{display:flex;justify-content:space-between;align-items:flex-end;gap:6px;clear:both}.record-footer .record-shop{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.record-footer .record-stock{flex-shrink:0;white-space:nowrap;font-size:11px;color:#326449}.record-footer .low-stock{color:#b3403a}.preview-authority{padding:9px 12px;border-left:3px solid #3e7bcc;background:#f0f5fc;font-size:12px;color:#365b84}.refresh-quote{display:block;padding:3px 6px;margin-top:5px;font-size:11px;color:#185cc9}.quote-error{color:#a43930;background:#fff0ee}.quote-time{display:block;color:#82919c;font-size:10px;margin-top:4px}.auto-choice{display:flex;align-items:center;gap:5px;white-space:nowrap}.auto-choice input{accent-color:#185cc9;width:16px;height:16px}.auto-choice small{font-size:10px}.unselected{color:#8998a4}.campaign[data-channel=auto] th:first-child,.campaign[data-channel=auto] td:first-child{min-width:66px;width:66px}.remove-keyword{font-size:12px;padding:5px 8px;color:#a43930;white-space:nowrap}.keyword-editor{display:flex;gap:8px;margin:14px 0 8px}.keyword-editor input{min-width:0;flex:1;padding:9px 10px;border:1px solid #bacbd9;border-radius:7px;color:#183042;background:white}.keyword-editor button{flex-shrink:0}.edit-error{font-size:12px;color:#a43930;margin-top:8px}.skipped{color:#71818b}@media(max-width:800px){.record-footer{flex-wrap:wrap}.record-footer .record-stock{margin-left:auto}.keyword-editor{flex-wrap:wrap}.keyword-editor input{flex-basis:100%}.campaign{padding:12px}}`;
  function mount(){
    if(document.getElementById('lingxing-ad-preview-assistant'))return;
    host=el('div',{id:'lingxing-ad-preview-assistant'});document.documentElement.append(host);shadow=host.attachShadow({mode:'open'});
    const backdrop=el('div',{class:'backdrop',hidden:true});
    const close=()=>{state.open=false;backdrop.hidden=true;entry.setPanelOpen(false);};
    const open=()=>{if(state.open)return;state.open=true;backdrop.hidden=false;entry.setPanelOpen(true);render();};
    const file=el('input',{id:'file',type:'file',accept:'.xlsx',onclick:e=>{e.target.value=''},onchange:e=>importFile(e.target.files[0])});
    const sheet=el('select',{id:'sheets',hidden:true,onchange:e=>selectSheet(e.target.value),'aria-label':'选择工作表'});
    const panel=el('section',{class:'panel',role:'dialog','aria-modal':'true','aria-label':'领星广告创建助手'},
      el('header',{},el('div',{},el('h1',{},'领星广告创建助手'),el('small',{},'Excel导入 · 校验与预览 · 批量创建')),el('button',{onclick:close,'aria-label':'收起预览'},'收起')),
      el('div',{class:'toolbar'},el('label',{class:'upload'},file),sheet,
        el('button',{onclick:()=>download(templateBase64?Uint8Array.from(win.atob(templateBase64),c=>c.charCodeAt(0)):XLSX.write(templateWorkbook(XLSX),{type:'array',bookType:'xlsx',compression:true}),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',DETAIL_TEMPLATE_FILENAME)},'下载详细模板'),
        el('button',{id:'run',class:'primary',onclick:run},'校验并生成预览'),el('button',{id:'cancel',onclick:()=>cancel(),hidden:true},'停止'),
        el('label',{class:'auto-retry-switch',title:'校验后自动重试失败或缺少建议价的组，每组最多3次'},el('input',{id:'auto-retry',type:'checkbox',checked:true,onchange:e=>toggleAutomaticRetry(e.target.checked)}),'自动重试建议价'),
        el('button',{id:'json',onclick:()=>download(JSON.stringify(previewDocument(state.records),null,2),'application/json','广告创建预览.json')},'导出JSON'),
        el('button',{id:'create-ads',class:'primary',onclick:openCreation},'创建广告'),
        el('button',{id:'csv',onclick:()=>download(previewCsv(plans()),'text/csv;charset=utf-8','广告竞价明细.csv')},'导出明细')),
      el('div',{class:'status-line'},el('span',{id:'session'}),' · 确认后批量创建；导出和创建均以当前预览为准。',el('span',{id:'saved-file',class:'saved-file',hidden:true}),el('div',{class:'draft-status'},el('span',{id:'storage-message',role:'status'}),el('button',{id:'save-preview',onclick:()=>persistPreview(true)},'保存预览'),el('button',{id:'clear-preview',onclick:()=>draftStore.clear()},'清除本地预览'))),
      el('div',{id:'notice','aria-busy':'false'},el('span',{class:'activity-spinner','aria-hidden':'true',hidden:true}),el('div',{class:'notice-copy'},el('div',{id:'notice-message',role:'status','aria-live':'polite'}),el('div',{id:'activity-meta','aria-live':'off',hidden:true})),el('div',{class:'activity-track',hidden:true,'aria-hidden':'true'},el('span',{class:'activity-sweep'}))),
      el('div',{id:'retry-status','data-phase':'idle',hidden:true},el('span',{class:'retry-visual','aria-hidden':'true'},el('span',{class:'retry-orbit'}),el('span',{id:'retry-countdown'})),el('div',{class:'retry-copy'},el('div',{id:'retry-message','aria-live':'off'}),el('div',{id:'retry-meta',role:'status','aria-live':'off',hidden:true})),el('button',{id:'stop-retry',onclick:()=>toggleAutomaticRetry(false)},'停止重试'),el('span',{class:'retry-flow','aria-hidden':'true'})),el('div',{id:'summary'}),
      el('div',{class:'workspace'},el('aside',{},el('div',{class:'muted'},'商品清单'),el('div',{id:'records'})),el('main',{id:'detail'})),
      el('footer',{},el('span',{},'版本 '+APP_VERSION+' · '+MODEL_VERSION),el('a',{href:'https://github.com/wrangler1024/crossborder-userscripts/blob/main/extensions/lingxing-ads-assistant/README.md',target:'_blank',rel:'noopener noreferrer'},'查看使用说明')));
    const refreshStyle=`.record-shell{position:relative}.record-main{display:flex;gap:9px;align-items:flex-start;min-height:46px}.record-image-slot{width:42px;height:42px;flex-shrink:0}.record-text{min-width:0;flex:1}.record .record-text b{font-size:12px;line-height:1.4;font-weight:600;overflow-wrap:anywhere}.record .record-status{float:none;display:block;margin:4px 0 0;font-size:10px}.record-image{position:absolute;top:12px;left:12px;width:42px;height:42px;padding:2px;display:grid;place-items:center;background:#fff;border:1px solid #e1e8ee;border-radius:6px;overflow:hidden}.record-image img{width:100%;height:100%;object-fit:contain}.record-image:disabled{opacity:1;background:#f2f5f8}.image-fallback{font-size:9px;line-height:1.3;color:#82919b}.record .quote-flag{display:inline-block;margin-top:7px;padding:2px 6px;border-radius:4px;background:#fff2da;color:#8e5a12;font-size:11px;line-height:1.4}.record-footer{margin-top:4px}.refresh-wait{min-height:22px;font-size:11px;line-height:1.4;padding-top:4px;color:#8e5a12}.refresh-quote{min-width:76px}.image-preview{border:1px solid #cbd7df;border-radius:12px;padding:16px;max-width:calc(100vw - 36px);background:white;color:#183042;box-shadow:0 18px 60px #10253666}.image-preview::backdrop{background:#102536aa}.image-preview img{display:block;width:min(360px,72vw);height:min(360px,60vh);object-fit:contain;margin:10px 0;background:white}.image-preview p{margin:8px 0 0;font-size:12px;overflow-wrap:anywhere}.image-close{display:block;margin-left:auto}.record{padding:9px 10px;margin-bottom:8px}.record-main{min-height:36px;gap:8px}.record-image-slot{width:36px;height:36px}.record-image{top:9px;left:10px;width:36px;height:36px}.record-state-line{display:flex;align-items:center;gap:4px;margin-top:3px;white-space:nowrap}.record .record-state-line .record-status{margin:0;line-height:1.4}.record .record-state-line .quote-flag{margin:0;padding:1px 4px;font-size:10px;line-height:1.4}.record-footer{margin-top:3px}.record-footer .record-shop{font-size:11px}`;
    const activityStyle=`#notice{position:relative;overflow:hidden}#notice.busy{display:flex;align-items:center;gap:12px;min-height:70px;padding-top:12px;padding-bottom:15px;background:#eaf3ff}.notice-copy{min-width:0;flex:1}#notice-message{overflow-wrap:anywhere}#notice.busy #notice-message{font-weight:600;color:#174b89}#activity-meta{margin-top:4px;font-size:11px;line-height:1.6;color:#547594}.activity-spinner{display:block;width:26px;height:26px;flex-shrink:0;border:3px solid #bdd5f3;border-top-color:#1768d3;border-right-color:#1768d3;border-radius:50%}.busy .activity-spinner{animation:ads-spin .85s linear infinite}.activity-track{position:absolute;bottom:0;left:0;right:0;height:4px;background:#d9e9fc;overflow:hidden}.activity-sweep{display:block;width:32%;height:100%;background:linear-gradient(90deg,transparent,#2582ee,#1768d3,transparent)}.busy .activity-sweep{animation:ads-sweep 1.8s ease-in-out infinite}.record.is-loading{border-color:#3988e7;background:#edf5ff;animation:ads-card-pulse 1.8s ease-in-out infinite}.record.is-loading .record-status:before{content:'';display:inline-block;width:9px;height:9px;vertical-align:-1px;margin-right:4px;border:2px solid #bed6f1;border-top-color:#1768d3;border-radius:50%;animation:ads-spin .85s linear infinite}@keyframes ads-spin{to{transform:rotate(360deg)}}@keyframes ads-sweep{from{transform:translateX(-110%)}to{transform:translateX(420%)}}@keyframes ads-card-pulse{0%,100%{box-shadow:inset 3px 0 #2c6dc8,0 0 0 0 #73aaf23b}50%{box-shadow:inset 3px 0 #2c6dc8,0 0 0 3px #73aaf22b}}@media(prefers-reduced-motion:reduce){.busy .activity-spinner,.busy .activity-sweep,.record.is-loading,.record.is-loading .record-status:before{animation:none}.busy .activity-sweep{width:100%;transform:none}}`;
    const retryStyle=`.auto-retry-switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#466581;white-space:nowrap}.auto-retry-switch input{width:16px;height:16px;accent-color:#185cc9}#retry-status{position:relative;overflow:hidden;display:flex;align-items:center;gap:12px;min-height:58px;padding:9px 22px;border-left:4px solid #7293b6;border-bottom:1px solid #e1eaf3;background:#f3f7fc;color:#426184;font-size:13px}.retry-copy{flex:1;min-width:0;overflow-wrap:anywhere}#retry-message{font-weight:600;line-height:1.65}#retry-meta{margin-top:3px;font-size:11px;line-height:1.6}#retry-status button{padding:5px 10px;font-size:11px;white-space:nowrap}.retry-visual{position:relative;display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;border-radius:50%;background:white;color:inherit}.retry-orbit{position:absolute;inset:0;border:3px solid currentColor;border-radius:50%;opacity:.25}#retry-countdown{position:relative;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}.retry-flow{display:none;position:absolute;bottom:0;left:0;height:3px;width:32%;background:linear-gradient(90deg,transparent,currentColor,transparent)}#retry-status[data-phase=waiting]{background:#fff5df;border-left-color:#e49b20;color:#935b08}#retry-status[data-phase=waiting] .retry-visual{animation:retry-count-pulse 1.6s ease-in-out infinite}#retry-status[data-phase=waiting] .retry-flow{display:block;animation:ads-sweep 2.2s linear infinite}#retry-status[data-phase=waiting].retry-soon .retry-visual{animation-duration:.85s}#retry-status[data-phase=running]{background:#e8f2ff;border-left-color:#2476d8;color:#195aa7}#retry-status[data-phase=running] .retry-orbit{border-color:#b7d4f4;border-top-color:#2476d8;border-right-color:#2476d8;opacity:1;animation:ads-spin .85s linear infinite}#retry-status[data-phase=running] .retry-flow{display:block;animation:ads-sweep 1.45s ease-in-out infinite}#retry-status[data-phase=paused]{background:#f2f4f7;color:#627486}#retry-status[data-phase=done]{background:#edf7f2;border-left-color:#33856a;color:#286e57}#retry-status[data-phase=exhausted]{background:#fff5e9;border-left-color:#c88b36;color:#88612b}@keyframes retry-count-pulse{0%,100%{box-shadow:0 0 0 0 #e6a52830;transform:scale(1)}50%{box-shadow:0 0 0 5px #e6a5281c;transform:scale(1.06)}}@media(prefers-reduced-motion:reduce){#retry-status .retry-visual,#retry-status .retry-orbit,#retry-status .retry-flow{animation:none!important}#retry-status .retry-flow{transform:none;width:100%}}`;
    const draftStyle=`.draft-status{display:flex;align-items:center;gap:10px;margin-top:6px;min-height:28px}.draft-status #storage-message{flex:1;min-width:0;font-size:11px}.draft-status button{padding:4px 9px;font-size:11px;white-space:nowrap}.save-error{color:#a43930}.saved-file{display:inline-block;margin-left:14px;overflow-wrap:anywhere;font-size:11px}`;
    const compactStyle=`header{padding:14px 22px}.toolbar{padding:10px 18px}.status-line{padding-bottom:9px}#summary{padding:8px 22px}main{padding:14px 18px}.detail-heading h2{font-size:18px;margin-bottom:3px}.detail-heading p,.eyebrow{margin-bottom:4px}.product{padding:9px 12px;gap:12px;margin-bottom:9px}.product img{width:52px;height:52px}.product b{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.4}.product p{margin-bottom:2px;font-size:12px}.channel-summary{margin-top:8px}.channel-summary th,.channel-summary td{padding:5px 8px;line-height:1.4}.meta{margin:8px 0;gap:12px}.preview-authority{margin:7px 0;padding:6px 10px;font-size:11px}.campaign{margin:10px 0;padding:11px 12px}.campaign-heading{align-items:center;gap:10px}.campaign-heading h3{display:flex;align-items:center;gap:7px;margin:0;font-size:14px}.campaign-number{display:inline-grid;place-items:center;flex-shrink:0;min-width:24px;height:24px;border-radius:6px;background:#e9f1ff;color:#185cc9;font-size:12px;font-variant-numeric:tabular-nums}.campaign-heading .budget{font-size:12px}.names{margin:6px 0;gap:2px 8px;font-size:11px;line-height:1.4}.campaign>p{margin:3px 0}.target-table{margin-top:7px}.target-table table{line-height:1.4}.target-table th{padding:6px 8px;white-space:nowrap}.target-table td{padding:6px 8px;vertical-align:middle;line-height:1.4}.target-table td:first-child{min-width:140px}.campaign[data-channel=auto] th:first-child,.campaign[data-channel=auto] td:first-child{min-width:54px;width:54px}.quote-lower{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}.quote-lower-value{white-space:nowrap}.quote-lower .refresh-quote{display:inline-flex;align-items:center;justify-content:center;min-width:38px;min-height:24px;margin:0;padding:2px 5px;line-height:1.4;font-size:11px;border-radius:5px}.quote-source{min-width:145px;max-width:210px}.quote-source-line{display:flex;align-items:center;gap:6px;white-space:nowrap}.quote-source .pill{font-size:11px;line-height:1.4;padding:1px 5px}.quote-source .quote-time{display:inline;margin:0;font-size:10px;line-height:1.4;color:#718596}.quote-source .source{display:block;margin-top:2px;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:1.4}.remove-keyword{padding:3px 6px;font-size:11px;line-height:1.4;min-height:24px}.refresh-wait{min-height:0;padding-top:3px;line-height:1.4}.keyword-editor{margin:8px 0 4px;gap:6px}.keyword-editor input{padding:6px 8px;font-size:12px}.keyword-editor button{padding:5px 9px;font-size:12px}.campaign>small{font-size:10px;line-height:1.4}.campaign .edit-error{margin:5px 0}.message{margin:10px 0;padding:9px 12px}@media(max-width:800px){main{padding:10px}.campaign-heading{display:flex;flex-wrap:wrap}.campaign{padding:9px}.quote-source,.quote-source .source{max-width:170px}.quote-lower{gap:4px}.target-table th,.target-table td{padding-left:6px;padding-right:6px}}`;
    backdrop.append(panel);shadow.append(el('style',{text:style+editorStyle+refreshStyle+activityStyle+retryStyle+draftStyle+compactStyle+EXECUTION_STYLE+LAUNCHER_STYLE}),backdrop);
    entry=mountEdgeLauncher({win,host,shadow,el,onOpen:open});render();
    ticker=win.setInterval(()=>{if(state.open){updateControls();tickAutomaticRetry();}},1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  return {dispose(){state.controller?.abort();disposeExecution?.();entry?.dispose();retryQueue.reset();win.clearInterval(ticker);session.dispose();host?.remove();}};
}
