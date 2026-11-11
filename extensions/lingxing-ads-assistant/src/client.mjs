import {country,clean,parseNewGroupRecommendations,parseExpandedRecommendations,AUTO_TYPES,channelInputs,selectedAutoTypes} from './model.mjs';
export const ORIGIN='https://gw.lingxingerp.com';
export const ENDPOINTS={profiles:'/pb-newad-web/v2/common/common_list/common_list/get_profile_list',permissions:'/pb-newad-web/v2/common/common_list/common_list/get_ad_rule',products:'/pb-newad-web/v2/ad_report/core/store/products',bids:'/pb-newad-web/v2/ad_report/core/api/handle',expanded:'/pb-newad-web/v2/ad_report/core/api/target_products_asin_recommendations'};
const HEADER_NAMES=new Set(['accept-language','ak-origin','auth-token','x-ak-company-id','x-ak-env-key','x-ak-uid','x-ak-zid','x-ak-version','x-ak-ad-page-name']);
// Observe only this page's ordinary ERP requests. Session headers stay in this closure;
// they are never exported, persisted or requested from an operator.
export function observeSession(win,onChange=()=>{}) {
  let current=null,epoch=0;const pending=new WeakMap();
  const proto=win.XMLHttpRequest.prototype,original={open:proto.open,set:proto.setRequestHeader,send:proto.send};
  const capture=(headers)=>{
    if(!headers['auth-token']||!headers['x-ak-company-id']) return;
    const changed=current&&['x-ak-company-id','x-ak-uid','x-ak-zid'].some(k=>current[k]!==headers[k]);
    current={...headers};if(changed)epoch++;onChange({ready:true,changed:!!changed,epoch});
  };
  proto.open=function(method,url,...rest){let ok=false;try{const u=new URL(url,win.location.href);ok=u.origin===ORIGIN&&u.pathname.startsWith('/pb-newad-web/')}catch{}pending.set(this,{ok,headers:{}});return original.open.call(this,method,url,...rest)};
  proto.setRequestHeader=function(k,v){const p=pending.get(this);if(p?.ok&&HEADER_NAMES.has(k.toLowerCase()))p.headers[k.toLowerCase()]=v;return original.set.call(this,k,v)};
  proto.send=function(...args){const p=pending.get(this);if(p?.ok)capture(p.headers);return original.send.apply(this,args)};
  return {get ready(){return !!current},get epoch(){return epoch},get identity(){return current?.['x-ak-company-id']&&current?.['x-ak-uid']?JSON.stringify(['x-ak-company-id','x-ak-uid','x-ak-zid'].map(k=>current[k]||'')):null},headers(){if(!current)throw new Error('请刷新领星广告页面，等待店铺数据加载后再试');return {...current,'Content-Type':'application/json','Accept':'application/json'}},dispose(){proto.open=original.open;proto.setRequestHeader=original.set;proto.send=original.send;current=null}};
}
export function assertReadOperation(operation,body) {
  if(!Object.hasOwn(ENDPOINTS,operation)) throw new Error('仅允许读取店铺、商品和建议竞价');
  if(operation==='bids'&&(body?.api_method!=='post_targetBidRecommendations'||body?.params?.recommendationType!=='BIDS_FOR_NEW_AD_GROUP'||body?.api_version!=='v3'||body?.sponsored_type!=='sp'))throw new Error('不允许调用创建、更新或已有广告组接口');
  if(operation==='bids') {
    const expressions=body.params.targetingExpressions;
    if(!Array.isArray(expressions)||!expressions.length||!(expressions.every(e=>AUTO_TYPES.includes(e.type))||expressions.every(e=>e.type==='KEYWORD_BROAD_MATCH')))throw new Error('自动和关键词必须分别读取对应广告组的建议价');
  }
  if(operation==='expanded'&&(body?.type?.length!==2||body.type[0]!=='asinExpandedFrom'||body.type[1]!=='asinSameAs'||body.version!==2))throw new Error('只允许原生商品推荐查询，计算仅采用扩展建议');
}
export function retryAfterMilliseconds(value,now=Date.now()){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const seconds=Number(value);
  if(Number.isFinite(seconds))return seconds>=0?Math.ceil(seconds*1000):null;
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):null;
}
export function isRateLimited(status,result){
  if(status===429)return true;
  const entries=[result,...(Array.isArray(result?.reasons)?result.reasons:[])];
  return entries.some(x=>{
    if(x?.code===429||x?.code==='429')return true;
    const message=typeof x==='string'?x:[x?.code,x?.msg,x?.message,x?.description].filter(Boolean).join(' ');
    return /throttl|too[ _-]*many[ _-]*requests|rate[ _-]*limit|限流|频繁|频率.{0,8}(过高|限制|超出)/i.test(message);
  });
}
export function createClient(session,{fetcher=fetch,timeoutMs=25000,onRequest=()=>{},now=()=>Date.now()}={}) {
  const cooldowns=new Map();
  const cooldownKey=profile=>`${session.epoch}:${typeof profile==='object'?profile.profile_id:profile}`;
  const cooldown=profile=>{const until=cooldowns.get(cooldownKey(profile))||0;return {until,remainingMs:Math.max(0,until-now())};};
  const rateError=until=>Object.assign(new Error(`接口返回限流，请等待${Math.max(1,Math.ceil((until-now())/1000))}秒后重试；本次不使用备用价`),{kind:'rate_limit',retryAt:until});
  async function read(operation,body,signal){
    assertReadOperation(operation,body);if(signal?.aborted)throw new DOMException('已停止','AbortError');
    const quotes=operation==='bids'||operation==='expanded';
    if(quotes&&cooldown(body.profile_id).remainingMs>0)throw rateError(cooldown(body.profile_id).until);
    const epoch=session.epoch;const controller=new AbortController();const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const expressionType=body?.params?.targetingExpressions?.[0]?.type;
      const targetKind=operation==='expanded'?'targets':operation==='bids'?(AUTO_TYPES.includes(expressionType)?'auto':'keywords'):undefined;
      onRequest({operation,targetKind});
      const get=operation==='profiles'||operation==='permissions';
      const response=await fetcher(ORIGIN+ENDPOINTS[operation],{method:get?'GET':'POST',headers:session.headers(),credentials:'include',body:get?undefined:JSON.stringify(body),signal:controller.signal});
      let result;
      if(response.ok||response.status===429){try{result=await response.json();}catch(error){if(response.ok)throw error;}}
      if(session.epoch!==epoch)throw new Error('领星登录账号已改变，请重新校验');
      if(quotes&&isRateLimited(response.status,result)){
        const until=now()+Math.max(1000,retryAfterMilliseconds(response.headers?.get?.('Retry-After'),now())??30000);
        cooldowns.set(cooldownKey(body.profile_id),until);throw rateError(until);
      }
      if(!response.ok)throw Object.assign(new Error(`读取失败（HTTP ${response.status}），请稍后重试`),{retryable:response.status>=500||response.status===408||response.status===425});
      if(result?.success!==true||result?.code!==1){
        const message=String(result?.msg||result?.message||result?.code||'返回异常').slice(0,150);
        throw Object.assign(new Error(`领星读取失败：${message}`),{retryable:!/登录.{0,8}(过期|失效)|token.{0,12}(expired|invalid)|无权限|access denied|unauthoriz/i.test(message)});
      }
      if(Array.isArray(result.reasons)&&result.reasons.length)throw new Error('领星建议查询包含失败项，不能使用备用价掩盖失败');
      return result;
    } catch(error) {if(error.name==='AbortError'&&!signal?.aborted)throw new Error('读取超时，请重试；本次不使用备用价');throw error}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
  }
  async function targetSuggestions(profile,asin,key,values,signal){
    if(!['auto','keywords','targets'].includes(key)||!Array.isArray(values)||!values.length)throw new Error('请选择需要读取建议价的目标');
    if(key==='targets'){
      const r=await read('expanded',{asins:[asin],profile_id:profile.profile_id,count:50,type:['asinExpandedFrom','asinSameAs'],version:2},signal);
      return parseExpandedRecommendations(r,values);
    }
    const expressions=values.map(value=>key==='auto'?{type:value}:{type:'KEYWORD_BROAD_MATCH',value});
    const r=await read('bids',{api_method:'post_targetBidRecommendations',profile_id:profile.profile_id,api_version:'v3',sponsored_type:'sp',params:{recommendationType:'BIDS_FOR_NEW_AD_GROUP',asins:[asin],targetingExpressions:expressions,bidding:{strategy:'LEGACY_FOR_SALES',adjustments:null}}},signal);
    return parseNewGroupRecommendations(r,expressions);
  }
  return {
    cooldown,
    targetSuggestions,
    async profiles(signal){const r=await read('profiles',undefined,signal);if(!Array.isArray(r.data))throw new Error('店铺列表结构变化');return r.data.map(p=>({alias:p.alias,profile_id:String(p.profile_id),country:country(p.country),real_status:p.real_status,type:p.type}));},
    async permissions(signal){const r=await read('permissions',undefined,signal);if(!Array.isArray(r.data)||!r.data.every(v=>typeof v==='string'))throw new Error('广告功能权限返回格式变化，请在领星核对后重试');return r.data;},
    async products(profile,msku,signal){
      const all=[];
      for(let page=1;page<=20;page++){
        const r=await read('products',{profile_id:profile.profile_id,search_value:msku,page,length:25,sku_status:[],is_all_store:0},signal);
        if(!Array.isArray(r.data))throw new Error('商品列表结构变化');
        if(r.region?.country&&country(r.region.country)!==profile.country)throw new Error('商品数据返回了其他站点，已停止');
        all.push(...r.data);
        if(r.data.length<25||(Number.isFinite(r.recordsFiltered)&&all.length>=r.recordsFiltered))return all;
      }
      throw new Error('搜索结果超过500条，请填写完整MSKU');
    },
    async suggestions(profile,record,signal){
      const result={auto:[],keywords:[],targets:[],errors:{},errorDetails:{}};
      for(const channel of channelInputs(record)){
        if(channel.status!=='pending')continue;
        try {
          const values=channel.key==='auto'?selectedAutoTypes(record):record[channel.key];
          result[channel.key]=await targetSuggestions(profile,record.asin,channel.key,values,signal);
        }catch(error){if(signal?.aborted||error.name==='AbortError')throw error;result.errors[channel.key]=error.message;result.errorDetails[channel.key]={retryable:error.retryable!==false};}
      }
      return result;
    }
  };
}
