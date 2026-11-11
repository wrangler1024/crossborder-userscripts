import {AUTO_TYPES,SITES,MODEL_VERSION,MIN_ACTIVE_STOCK,validSellableStock,assertCreationStock,clean,resolveProfile,validateProduct} from './model.mjs';
import {finalPreviewPlans} from './preview.mjs';

export const EXECUTION_VERSION=1;
export const AUTO_EXPRESSIONS=Object.freeze({CLOSE_MATCH:'queryHighRelMatches',LOOSE_MATCH:'queryBroadRelMatches',SUBSTITUTES:'asinSubstituteRelated',COMPLEMENTS:'asinAccessoryRelated'});
// Native Lingxing SP seller form bounds inspected on 2026-11-10.
export const CREATE_LIMITS=Object.freeze({CA:{bid:[.02,1000],budget:[1,1000000]},AU:{bid:[.02,1410],budget:[1.4,1500000]},AE:{bid:[.1,3670],budget:[4,3700000]},UK:{bid:[.02,1000],budget:[1,1000000]}});
const executionClone=value=>JSON.parse(JSON.stringify(value));
const sameAmount=(a,b)=>Number.isFinite(Number(a))&&Math.abs(Number(a)-Number(b))<.000001;
const validEntityId=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value);
const validCreationText=value=>typeof value==='string'&&value===clean(value)&&!/[\u0000-\u001f\u007f]/.test(value);
// Creation accepts "1"/"2"; the native structure readback returns numeric 1/2.
const sameTargetingType=(actual,expected)=>['1','2'].includes(String(actual))&&String(actual)===String(expected);
export function executionKey(item){return JSON.stringify([String(item.profileId),item.campaign.name]);}
export function creationCandidates(records){
  return finalPreviewPlans(records).flatMap(p=>p.campaigns.map(c=>({model:MODEL_VERSION,profileId:p.profileId,shop:p.shop,country:p.country,currency:p.currency,msku:p.product.msku,asin:p.product.asin,parent:p.product.parent||'',stock:p.product.stock,campaign:executionClone(c)})));
}
export function validateCreationItem(item){
  const c=item?.campaign,config=SITES[item?.country],limits=CREATE_LIMITS[item?.country];
  if(!config||item.currency!==config.currency||!validEntityId(item.profileId)||!item.shop||!item.msku||!/^[A-Z0-9]{10}$/.test(item.asin||''))throw new Error('店铺、商品或站点信息不完整');
  // Older execution receipts have no stock snapshot; live stock is still required by preflight.
  if(item.stock!==undefined&&!validSellableStock(item.stock))throw new Error('未取得有效可售库存');
  if(item.model!==MODEL_VERSION||!['AUTO','BROAD','EXPANDED_ASIN'].includes(c?.type))throw new Error('创建模型或广告类型不符');
  if(!clean(c.name)||!validCreationText(c.name)||c.name.length>250||!Array.isArray(c.groups)||c.groups.length!==1)throw new Error('活动名称或广告组数量不符合预览模型');
  if(!sameAmount(c.budget,config.budget)||c.currency!==config.currency||c.bidding!=='动态竞价-只降低'||c.audienceAdjustment!==0||['top','rest','product'].some(k=>c.placements?.[k]!==0))throw new Error('预算、策略或加价已偏离确认模型');
  const g=c.groups[0];
  if(!clean(g.name)||!validCreationText(g.name)||g.name.length>250||!validCreationText(item.msku)||!sameAmount(g.defaultBid,config.budget/10)||g.products?.length!==1||g.products[0].msku!==item.msku||g.products[0].asin!==item.asin)throw new Error('广告组默认价或主推商品不一致');
  if(!Array.isArray(g.targets)||!g.targets.length)throw new Error('没有选用投放目标');
  if((c.type==='AUTO'&&g.targets.length>4)||(c.type==='BROAD'&&g.targets.length>5)||(c.type==='EXPANDED_ASIN'&&(g.targets.length<3||g.targets.length>5)))throw new Error('投放目标数量不符合首轮模型');
  const seen=new Set();
  for(const t of g.targets){
    if(t.state!=='enabled'||!Number.isFinite(t.bid)||t.bid<limits.bid[0]||t.bid>limits.bid[1]||!sameAmount(t.bid,Math.round(t.bid*100)/100))throw new Error(`目标竞价不在本站允许范围 ${limits.bid[0]}–${limits.bid[1]} ${config.currency}，请返回预览核对`);
    const valid=c.type==='AUTO'?AUTO_TYPES.includes(t.type)&&t.value==='':c.type==='BROAD'?t.type==='BROAD'&&validCreationText(t.value)&&t.value.length>0&&t.value.length<=80:t.type==='asinExpandedFrom'&&/^[A-Z0-9]{10}$/.test(t.value)&&t.value!==item.asin;
    if(!valid)throw new Error('投放类型或目标内容与预览模型不符');
    const key=c.type==='AUTO'?t.type:t.value.toLowerCase();if(seen.has(key))throw new Error('投放目标重复');seen.add(key);
  }
  return item;
}
export function buildCreationPayload(item,{state='paused',startDate}={}){
  validateCreationItem(item);
  const parsedDate=new Date(startDate+'T00:00:00Z');
  if(!['paused','enabled'].includes(state)||!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'')||!Number.isFinite(parsedDate.getTime())||parsedDate.toISOString().slice(0,10)!==startDate)throw new Error('请选择有效开始日期和创建状态');
  if(item.stock!==undefined)assertCreationStock(item.stock,state);
  const c=item.campaign,g=c.groups[0],auto=c.type==='AUTO',keyword=c.type==='BROAD';
  const targeting=auto?'1':'2',targetType=auto?'':keyword?'KEYWORD':'TARGET';
  const adjustments=[{predicate:'placementTop',percentage:0},{predicate:'placementRestOfSearch',percentage:0},{predicate:'placementProductPage',percentage:0}];
  const group={negative_keywords:[],keywords:[],negative_targets:[],targets:[],state:'enabled',sponsored_type:'sp',targeting_type:targeting,keyword_name:keyword?'关键词':'',target_type:targetType,match_type:auto?'':keyword?'BROAD':'ASIN',default_bid:String(g.defaultBid),custom_name:g.name};
  if(auto)group.targets=AUTO_TYPES.map(type=>{const selected=g.targets.find(t=>t.type===type);return {expression_type:'auto',state:selected?'enabled':'paused',sponsored_type:'sp',bid:String(selected?.bid??g.defaultBid),expression:[{type:AUTO_EXPRESSIONS[type]}]};});
  else if(keyword)group.keywords=g.targets.map(t=>({state:'enabled',sponsored_type:'sp',keyword_text:t.value,match_type:'BROAD',bid:String(t.bid)}));
  else group.targets=g.targets.map(t=>({state:'enabled',sponsored_type:'sp',bid:String(t.bid),expression:[{type:'asinExpandedFrom',value:t.value}]}));
  return {profile_id:item.profileId,portfolio_id:0,budget:String(c.budget),start_date:startDate,strategy:'legacyForSales',default_bid:String(g.defaultBid),build_type:2,ex_option:{type:0,option:[]},adjustments,keyword_match_type_list:['BROAD'],keyword_text_list:{},campaign_name_template:[{index:0,tag:'TAG_CUSTOM',value:c.name}],ad_group_name_template:[{index:0,tag:'TAG_CUSTOM',value:g.name}],groups:[{skus:[{state:'enabled',sku:item.msku,asin:item.asin,sponsored_types:['sp']}],campaigns:[{state,sponsored_type:'sp',campaign_negative_keywords:[],campaign_negative_targets:[],custom_name:c.name,keyword_name:group.keyword_name,target_type:targetType,match_type:'',targeting_type:targeting,strategy:'legacyForSales',budget:String(c.budget),ad_groups:[group],adjustments}]}]};
}
export async function executionFingerprint(payload,cryptoApi=globalThis.crypto){
  const bytes=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
export function parseSubmission(result){
  // A successful HTTP envelope only means that the group was accepted for background jobs.
  if(result?.code!==1||result.success===false)return {status:'unknown',message:clean(result?.msg||result?.message)||'ERP未确认受理结果，请检查后再处理'};
  if(!Array.isArray(result.data)||result.data.length!==1||String(result.data[0]?.index)!=='0')return {status:'unknown',message:'ERP受理回执格式未能确认，请检查创建结果'};
  const row=result.data[0];
  if(row.code!=='SUCCESS')return {status:'failed',message:clean(row.message||row.msg||row.code)||'ERP返回创建失败，请核对日志'};
  return {status:'submitted',accepted:true,message:'领星已受理，等待后台完成；请检查创建结果',groupUuid:typeof row.group_uuid==='string'?row.group_uuid:null,transactionUuid:typeof row.transaction_uuid==='string'?row.transaction_uuid:null};
}
export async function preflightCreation(items,services,{state='paused',signal,onProgress=()=>{},assertSession=()=>{}}={}){
  const rules=await services.permissions(signal);assertSession();
  const missing=[['new_ad/build/super/index','查看'],['new_ad/build/super/edit','编辑']].filter(([key])=>!rules.includes(key));
  if(missing.length)return items.map(item=>({key:executionKey(item),item,ok:false,message:`当前账号缺少超级结构${missing.map(([,label])=>label).join('、')}权限，请管理员在领星角色功能权限中开通后重新检查`}));
  const profiles=await services.profiles(signal);assertSession();
  const products=new Map(),parents=new Map(),results=[];
  for(const [index,item] of items.entries()){
    if(signal?.aborted)throw new DOMException('已停止检查','AbortError');assertSession();onProgress(index+1,items.length,item);
    let stock;
    try{
      validateCreationItem(item);
      const profile=resolveProfile({site:item.shop},profiles);
      if(profile.profile_id!==item.profileId||profile.country!==item.country||profile.type==='vendor')throw new Error('店铺标识或账号类型已变化，请重新校验商品');
      const key=JSON.stringify([item.profileId,item.msku,item.asin]);
      if(!products.has(key)){
        const record={msku:item.msku,asin:item.asin,parent:item.parent};
        const product=validateProduct(record,profile,await services.products(profile,item.msku,signal));
        const eligibility=await services.eligibility(item,signal),rows=eligibility?.data?.productResponseList;
        const matches=Array.isArray(rows)?rows.filter(p=>p.productDetails?.sku===item.msku&&p.productDetails?.asin===item.asin):[];
        if(matches.length!==1||matches[0].overallStatus!=='ELIGIBLE')throw new Error(matches[0]?.eligibilityStatusList?.map(e=>e.message).filter(Boolean).join('；')||'未能确认商品广告资格');
        products.set(key,product);
        if(product.parent){const parentKey=JSON.stringify([item.profileId,product.parent]);const prev=parents.get(parentKey);if(prev&&prev!==key)throw new Error('本批同父产品存在多个主推子体');parents.set(parentKey,key);}
      }
      stock=products.get(key).stock;assertCreationStock(stock,state);
      const existing=await services.findCampaigns(item,signal);assertSession();
      results.push({key:executionKey(item),ok:existing.length===0,item,stock,pausedOnly:stock<MIN_ACTIVE_STOCK,message:existing.length?'同名广告活动已存在，已阻止重复创建':stock<MIN_ACTIVE_STOCK?`可售库存${stock}，仅可创建暂停活动；到货后请在领星手动启用`:'库存、资格及名称检查通过',existingIds:existing.map(c=>c.campaign_id)});
    }catch(error){if(signal?.aborted||error.kind==='rate_limit')throw error;results.push({key:executionKey(item),ok:false,item,stock,message:error.message});}
  }
  // If two selected children share a parent, block both, not only the second one.
  for(const result of results){const p=products.get(JSON.stringify([result.item.profileId,result.item.msku,result.item.asin]));if(!p?.parent)continue;const siblings=[...products.entries()].filter(([key,value])=>JSON.parse(key)[0]===result.item.profileId&&value.parent===p.parent);if(siblings.length>1){result.ok=false;result.message='本批同父产品存在多个主推子体';}}
  return results;
}
function executionTargetKey(t){return t.keyword_text?`${String(t.match_type||'').toUpperCase()}:${t.keyword_text.toLowerCase()}`:(t.expression||[]).map(e=>`${e.type}:${e.value||''}`).join('|');}
export function inspectCreatedGroup(item,payload,group,logs){
  const c=group?.campaigns?.find(x=>x.custom_name===item.campaign.name);
  if(!c||String(group.profile_id)!==item.profileId)return {status:'unknown',message:'尚未找到对应创建结构'};
  const relevant=(logs||[]).filter(r=>r.campaign?.custom_name===item.campaign.name||(c.uuid&&String(r.campaign_uuid)===String(c.uuid)));
  if(relevant.some(r=>Number(r.status)===4||[...(r.children||[]),...(r.targets||[]),...(r.keywords||[]),...(r.product_ads||[])].some(t=>t.error||Number(t.status)===4)))return {status:'failed',message:'领星创建日志包含失败步骤，请打开领星日志核对'};
  const expected=payload.groups[0].campaigns[0],g=c.ad_groups?.find(x=>x.custom_name===expected.ad_groups[0].custom_name),eg=expected.ad_groups[0];
  const hasBase=validEntityId(c.campaign_id)&&validEntityId(g?.ad_group_id);
  const groupLogs=relevant.filter(r=>r.ad_group?.ad_group_id===g?.ad_group_id);
  const productLog=groupLogs.find(r=>r.create_methon==='createProductAds'&&Number(r.status)===1&&r.product_ads?.some(a=>a.sku===item.msku&&a.asin===item.asin&&validEntityId(a.ad_id)));
  const expectedTargets=[...eg.keywords,...eg.targets],actualTargets=[...(g?.keywords||[]),...(g?.targets||[])];
  const loggedTargets=groupLogs.filter(r=>Number(r.status)===1&&!String(r.create_methon).toLowerCase().includes('negative')).flatMap(r=>[...(r.keywords||[]),...(r.targets||[]),...(r.children||[])]);
  const allTargetsCreated=expectedTargets.every(t=>loggedTargets.some(a=>executionTargetKey(a)===executionTargetKey(t)&&validEntityId(t.keyword_text?a.keyword_id:a.target_id)));
  const pending=!hasBase||!productLog||!allTargetsCreated||!relevant.length||relevant.some(r=>Number(r.status)!==1)||Number(group.build_status)!==1;
  if(pending)return {status:'submitted',message:'领星后台仍在创建，稍后检查结果',campaignId:c.campaign_id||null,adGroupId:g?.ad_group_id||null};
  const mismatch=group.campaigns.length!==1||c.ad_groups.length!==1||group.skus?.length!==1||group.skus[0].sku!==item.msku||group.skus[0].asin!==item.asin||group.skus[0].state!=='enabled'||c.start_date!==payload.start_date||c.sponsored_type!=='sp'||!sameTargetingType(c.targeting_type,expected.targeting_type)||!sameTargetingType(g.targeting_type,eg.targeting_type)||g.match_type!==eg.match_type||!sameAmount(c.budget,expected.budget)||!sameAmount(g.default_bid,eg.default_bid)||c.strategy!=='legacyForSales'||c.state!==expected.state||g.state!=='enabled'||!Array.isArray(c.adjustments)||c.adjustments.some(a=>Number(a.percentage)!==0)||(c.shopper_cohort_bidding||[]).some(a=>Number(a.percentage)!==0)||actualTargets.length!==expectedTargets.length||expectedTargets.some(t=>{const matches=actualTargets.filter(a=>executionTargetKey(a)===executionTargetKey(t));return matches.length!==1||matches[0].state!==t.state||!sameAmount(matches[0].bid,t.bid);});
  if(mismatch)return {status:'review',message:'活动已生成，但配置回读与预览不同，请在领星核实',campaignId:c.campaign_id,adGroupId:g.ad_group_id};
  const ids=relevant.flatMap(r=>r.product_ads||[]).filter(a=>a.sku===item.msku&&a.asin===item.asin).map(a=>a.ad_id);
  return {status:'complete',message:expected.state==='paused'?'创建完成，活动已暂停':'创建完成，活动已启用',campaignId:c.campaign_id,adGroupId:g.ad_group_id,adIds:ids};
}
export async function runCreationBatch({entries,services,journal,confirmed=false,assertSession=()=>{},shouldStop=()=>false,onEntry=()=>{},owner,now=()=>new Date().toISOString()}){
  if(!confirmed)throw new Error('请先确认创建清单');
  const results=[];
  for(const entry of entries){
    if(shouldStop())break;assertSession();
    const claim=await journal.claim({...entry,key:executionKey(entry.item),owner,startedAt:now()});
    if(!claim.claimed){const result={...claim.entry,message:'本地已记录此名称的提交，跳过重复发送'};results.push(result);onEntry(result);continue;}
    let saved=claim.entry,stopForRateLimit=false;onEntry(saved);
    try{
      assertSession();
      // Recheck mutable inventory and eligibility immediately before this particular submission.
      const checks=await preflightCreation([entry.item],services,{state:entry.payload?.groups?.[0]?.campaigns?.[0]?.state||'invalid',assertSession});
      if(!checks[0].ok){saved=await journal.update(saved,{status:'not_sent',message:checks[0].message});results.push(saved);onEntry(saved);continue;}
      assertSession();
      if(shouldStop()){saved=await journal.update(saved,{status:'not_sent',message:'已停止，尚未提交'});results.push(saved);onEntry(saved);break;}
      saved=await journal.update(saved,{status:'submitting',message:'正在提交领星，请勿重复操作'});
      const response=await services.submit(entry.item,entry.payload,{confirmed:true});
      saved=await journal.update(saved,parseSubmission(response));
    }catch(error){
      stopForRateLimit=error.kind==='rate_limit';
      const status=saved.status==='submitting'?'unknown':'not_sent';
      try{saved=await journal.update(saved,{status,message:status==='unknown'?`提交结果待核实：${error.message}`:error.message});}catch{saved={...saved,status:'unknown',message:'提交后本地记录未能更新，请检查创建结果，勿重新提交'};}
    }
    results.push(saved);onEntry(saved);
    if(saved.status==='unknown'||stopForRateLimit||shouldStop())break;
  }
  return results;
}
