import {ORIGIN,isRateLimited,retryAfterMilliseconds} from './client.mjs';
import {buildCreationPayload,inspectCreatedGroup,executionKey} from './execution.mjs';

export const EXECUTION_PATHS=Object.freeze({eligibility:'/pb-newad-web/v2/build/super/index/product_eligibility_list',campaigns:'/pb-newad-web/v2/ad_report/campaign/index/index',structures:'/pb-newad-web/v2/build/super/index/simple_list',structureDetail:'/pb-newad-web/v2/build/super/index/full_list',logs:'/pb-newad-web/v2/build/super/log/list_v2',submit:'/pb-newad-web/v2/build/super/create/batch_create'});
export function createExecutionClient(session,reader,{fetcher=fetch,timeoutMs=60000,now=()=>new Date()}={}){
  const identity=session.identity,epoch=session.epoch;
  let retryAt=0;
  const rateError=()=>Object.assign(new Error(`领星接口限流，请等待${Math.max(1,Math.ceil((retryAt-now().getTime())/1000))}秒后重新检查；已发送的创建请求请先检查结果`),{kind:'rate_limit',retryAt});
  const assertSession=()=>{if(!identity||!session.ready||session.identity!==identity||session.epoch!==epoch)throw new Error('领星账号已改变，请关闭创建窗口后重新检查');};
  async function request(operation,body,signal){
    if(!Object.hasOwn(EXECUTION_PATHS,operation))throw new Error('不支持此广告操作');
    assertSession();if(signal?.aborted)throw new DOMException('已停止','AbortError');
    if(retryAt>now().getTime())throw rateError();
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),timeoutMs),abort=()=>ctl.abort();signal?.addEventListener('abort',abort,{once:true});
    try{
      const response=await fetcher(ORIGIN+EXECUTION_PATHS[operation],{method:'POST',headers:session.headers(),credentials:'include',body:JSON.stringify(body),signal:ctl.signal});
      let data;
      if(response.ok||response.status===429){try{data=await response.json();}catch(error){if(response.ok)throw error;}}
      assertSession();
      if(isRateLimited(response.status,data)||(Array.isArray(data?.data)&&data.data.some(r=>isRateLimited(0,r)))){retryAt=now().getTime()+Math.max(1000,retryAfterMilliseconds(response.headers?.get?.('Retry-After'),now().getTime())??30000);throw rateError();}
      if(!response.ok)throw new Error(`领星请求失败（HTTP ${response.status}）`);
      if(operation!=='submit'&&(data.code!==1||data.success===false))throw new Error(String(data.msg||data.message||'领星查询失败').slice(0,300));
      return data;
    }catch(error){if(error.name==='AbortError'&&!signal?.aborted)throw new Error('领星请求超时');throw error;}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function paged(operation,body,signal){
    const result=[];
    for(let page=1;page<=50;page++){
      const data=await request(operation,{...body,page,length:50},signal);
      if(!Array.isArray(data.data))throw new Error('领星列表格式变化，已停止');result.push(...data.data);
      if((Number.isFinite(data.recordsFiltered)&&page*50>=data.recordsFiltered)||data.data.length<50)return result;
    }
    throw new Error('查询结果过多，无法确认完整清单');
  }
  const date=()=>{const d=now(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
  return {
    assertSession,
    permissions:signal=>reader.permissions(signal),
    profiles:signal=>reader.profiles(signal),products:(profile,msku,signal)=>reader.products(profile,msku,signal),
    eligibility:(item,signal)=>request('eligibility',{profile_id:item.profileId,sponsored_type:'sp',skus:[{sku:item.msku,asin:item.asin}]},signal),
    async findCampaigns(item,signal){const day=date();const rows=await paged('campaigns',{profile_id:item.profileId,report_date:`${day} - ${day}`,name:item.campaign.name,search_type:'campaign_name',only_over_budget:0,sort_field:'spends',sort_type:'desc'},signal);return rows.filter(c=>c.campaign_id&&String(c.name).trim().toLowerCase()===item.campaign.name.toLowerCase());},
    async submit(item,payload,{confirmed=false}={}){
      if(!confirmed)throw new Error('尚未确认创建广告');
      const expected=buildCreationPayload(item,{state:payload.groups?.[0]?.campaigns?.[0]?.state,startDate:payload.start_date});
      if(JSON.stringify(expected)!==JSON.stringify(payload))throw new Error('提交内容已偏离当前确认清单');
      return request('submit',payload);
    },
    async check(entry,signal){
      assertSession();
      const item=entry.item;
      const groups=await paged('structures',{profile_id:item.profileId,search_type:1,search_text:item.msku},signal);
      const matching=[];
      for(const group of groups){
        if(String(group.profile_id)!==item.profileId||!group.skus?.some(p=>p.sku===item.msku&&p.asin===item.asin)||typeof group.uuid!=='string')continue;
        if(entry.groupUuid&&entry.groupUuid!==group.uuid)continue;
        const detail=await request('structureDetail',{profile_id:item.profileId,group_uuid:group.uuid,page:1,length:25},signal);
        if(!Array.isArray(detail.data))throw new Error('领星结构返回格式变化');
        for(const full of detail.data)if(full.uuid===group.uuid&&full.campaigns?.some(c=>c.custom_name===item.campaign.name))matching.push(full);
      }
      if(!matching.length)return {status:entry.status==='submitted'?'submitted':'unknown',message:'尚未查到对应结构；保留提交记录，不重复发送'};
      if(matching.length!==1)return {status:'review',message:'查到多个同名结构，请在领星核实归属'};
      const group=matching[0],logs=await paged('logs',{group_uuid:group.uuid},signal);
      const result=inspectCreatedGroup(item,entry.payload,group,logs);
      if(entry.accepted!==true)return {status:'review',message:'查到同名结构，但原提交回执不明，请在领星核实归属',groupUuid:group.uuid,transactionUuid:group.transaction_uuid};
      return {...result,groupUuid:group.uuid,transactionUuid:group.transaction_uuid};
    }
  };
}
export function createExecutionJournal(request,scope){
  return {
    async read(){const result=await request({action:'execution_read',scope});return result.entries||[];},
    claim(entry){return request({action:'execution_claim',scope,...entry,key:executionKey(entry.item)});},
    update(entry,patch){return request({action:'execution_update',scope,key:entry.key,revision:entry.revision,patch});}
  };
}
