import {MODEL_VERSION,AUTO_TYPES} from './model.mjs';
import {DETAIL_PARAMETERS} from './template-spec.mjs';
import {rebuildPreview,previewQuoteKey} from './preview.mjs';

export const DRAFT_SCHEMA=1;
const draftPick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const draftStrings=value=>Array.isArray(value)?value.map(String):[];
function savedRecord(record){
  const r=draftPick(record,['sheet','row','site','msku','asin','parent','status','error','batchTime','validatedAt','previewValidated','previewEdited','editedAt','keywordDraft']);
  for(const key of ['issues','warnings','keywords','targets'])r[key]=draftStrings(record[key]);
  r.channelIssues={keywords:draftStrings(record.channelIssues?.keywords),targets:draftStrings(record.channelIssues?.targets)};
  if(record.autoTypes)r.autoTypes=draftStrings(record.autoTypes);
  r.parameters=draftPick(record.parameters,DETAIL_PARAMETERS.map(p=>p.name));
  if(record.profile)r.profile=draftPick(record.profile,['alias','profile_id','country','real_status']);
  if(record.product)r.product=draftPick(record.product,['asin','msku','title','image','stock','status','parent','stockSource','eligibility','existingAds']);
  if(record.quoteBook){
    r.quoteBook={};
    for(const key of ['auto','keywords','targets']){
      r.quoteBook[key]=Object.create(null);
      for(const value of key==='auto'?AUTO_TYPES:r[key]){
        const id=previewQuoteKey(key,value),quote=record.quoteBook[key]?.[id];
        if(quote)r.quoteBook[key][id]=draftPick(quote,['status','lower','source','note','message','retryable','quotedAt']);
      }
    }
  }
  // A page reload never resumes an in-flight network operation.
  if(r.status==='checking')r.status='pending';
  return r;
}
function savedWorkbook(book){
  if(!book)return null;
  const out={SheetNames:[...book.SheetNames],Sheets:Object.create(null)};
  for(const name of out.SheetNames){
    const sheet=book.Sheets[name],copy=Object.create(null);
    for(const [address,cell] of Object.entries(sheet||{})){
      if(address==='!ref'||address==='!fullref')copy[address]=String(cell);
      else if(/^[A-Z]+[1-9]\d*$/.test(address))copy[address]=draftPick(cell,['t','v','w','f']);
    }
    out.Sheets[name]=copy;
  }
  return out;
}
export function previewSnapshot(state){
  return {schema:DRAFT_SCHEMA,model:MODEL_VERSION,fileName:state.fileName||'',sheet:state.sheet||state.records[0]?.sheet||'',batchTime:state.batchTime||'',active:state.active||0,book:savedWorkbook(state.book),records:state.records.map(savedRecord)};
}
export function restorePreview(snapshot){
  if(snapshot?.schema!==DRAFT_SCHEMA||snapshot.model!==MODEL_VERSION)throw new Error('本地预览版本不兼容，请重新导入校验');
  if(!Array.isArray(snapshot.records)||snapshot.records.length>500||!snapshot.book?.SheetNames?.length||!snapshot.book.SheetNames.every(n=>typeof n==='string'&&snapshot.book.Sheets?.[n]))throw new Error('本地预览内容不完整，请重新导入');
  const records=snapshot.records.map(value=>{
    if(!value||!['sheet','site','msku','asin'].every(k=>typeof value[k]==='string')||!Array.isArray(value.keywords)||!Array.isArray(value.targets))throw new Error('本地商品数据损坏，请重新导入');
    const r=savedRecord(value);
    if(r.previewValidated){
      if(r.product?.msku!==r.msku||r.product?.asin!==r.asin||!/^\d+$/.test(r.profile?.profile_id||'')||r.profile?.alias!==r.site||!r.validatedAt||!r.batchTime)throw new Error('本地商品校验信息不一致，请重新校验');
      rebuildPreview(r);
    }else{r.plan=null;r.status=r.issues.length||r.error?'blocked':'pending';}
    return r;
  });
  return {records,book:savedWorkbook(snapshot.book),fileName:String(snapshot.fileName||''),sheet:String(snapshot.sheet||records[0]?.sheet||snapshot.book.SheetNames[0]),batchTime:String(snapshot.batchTime||''),active:Math.max(0,Math.min(Number.isInteger(snapshot.active)?snapshot.active:0,records.length-1)),autoRetryEnabled:false};
}
export async function previewScope(identity,cryptoApi=globalThis.crypto){
  if(!identity)return null;
  const bytes=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode('lingxing-preview-v1:'+identity));
  return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export function extensionDraftTransport(win=window){
  const pending=new Map();
  win.addEventListener('message',event=>{
    if(event.source!==win||event.origin!==win.location.origin||event.data?.type!=='LX_ADS_DRAFT_RESPONSE')return;
    const item=pending.get(event.data.id);if(!item)return;
    clearTimeout(item.timer);pending.delete(event.data.id);
    if(event.data.ok)item.resolve(event.data.result);else item.reject(new Error(event.data.error||'本地保存失败'));
  });
  return request=>new Promise((resolve,reject)=>{
    const id=win.crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('本地保存未响应，请重新加载扩展并刷新页面'));},8000);
    pending.set(id,{resolve,reject,timer});win.postMessage({type:'LX_ADS_DRAFT_REQUEST',id,...request},win.location.origin);
  });
}
export function createDraftStore({request,onStatus=()=>{}}){
  let current=null;
  const notify=(ctx,phase,error='')=>{ctx.phase=phase;ctx.error=error;if(ctx===current)onStatus({phase,error,savedAt:ctx.savedAt,hasDraft:ctx.hasDraft,suspended:ctx.suspended});};
  async function drain(ctx){
    try{
      while(ctx.pending){
        const draft=ctx.pending;ctx.pending=null;
        const result=await request({action:'write',scope:ctx.scope,revision:ctx.revision,draft});
        ctx.revision=result.revision;ctx.savedAt=result.savedAt;ctx.hasDraft=true;ctx.last=JSON.stringify(draft);
      }
      notify(ctx,'saved');
    }catch(e){ctx.pending=null;ctx.suspended=true;notify(ctx,'error',e.message);}
    finally{ctx.flushing=null;}
  }
  return {
    async connect(scope){
      const ctx={scope,revision:null,savedAt:null,hasDraft:false,suspended:false,pending:null,flushing:null,last:null};current=ctx;notify(ctx,'loading');
      try{const result=await request({action:'read',scope});if(ctx!==current)return null;
        Object.assign(ctx,{revision:result?.revision||null,savedAt:result?.savedAt||null,hasDraft:!!result?.draft,last:result?.draft?JSON.stringify(result.draft):null});
        notify(ctx,ctx.hasDraft?'saved':'empty');return result?.draft||null;
      }catch(e){if(ctx===current){ctx.suspended=true;notify(ctx,'error',e.message);}return null;}
    },
    disconnect(){current=null;},
    save(draft,{explicit=false}={}){
      const ctx=current;if(!ctx||ctx.phase==='loading'||(ctx.suspended&&!explicit))return Promise.resolve();
      if(explicit)ctx.suspended=false;
      if(!ctx.pending&&!ctx.flushing&&JSON.stringify(draft)===ctx.last){notify(ctx,'saved');return Promise.resolve();}
      ctx.pending=draft;notify(ctx,'saving');return ctx.flushing??(ctx.flushing=Promise.resolve().then(()=>drain(ctx)));
    },
    async clear(){
      const ctx=current;if(!ctx)return;
      ctx.suspended=true;ctx.pending=null;if(ctx.flushing)await ctx.flushing;if(ctx!==current)return;
      try{const result=await request({action:'clear',scope:ctx.scope,revision:ctx.revision});
        Object.assign(ctx,{revision:result.revision,savedAt:null,hasDraft:false,last:null});notify(ctx,'cleared');
      }catch(e){notify(ctx,'error',e.message);}
    }
  };
}
