import {DETAIL_PARAMETERS} from './template-spec.mjs';
export const MODEL_VERSION = 'sop-20261110-preview-v4';
export const APP_VERSION = '0.9.0';
export const SITES = Object.freeze({CA:{currency:'CAD',budget:4},AU:{currency:'AUD',budget:4},AE:{currency:'AED',budget:10},UK:{currency:'GBP',budget:2}});
export const AUTO_TYPES = ['CLOSE_MATCH','LOOSE_MATCH','SUBSTITUTES','COMPLEMENTS'];
export const AUTO_LABELS = ['紧密匹配','宽泛匹配','同类商品','关联商品'];
export const HEADERS = ['店铺','主推MSKU','主推ASIN','广泛关键词','扩展ASIN'];
const ALIASES = {site:['店铺','店铺名称','SITE'],msku:['主推MSKU','MSKU'],asin:['主推ASIN','ASIN'],keywords:['广泛关键词','KEYWORDS'],targets:['扩展ASIN','TARGET_ASIN','TARGET_ASINS'],parent:['父产品标识','父ASIN','PARENT_ASIN']};
export const clean = value => String(value ?? '').trim();
export const country = value => clean(value).toUpperCase()==='GB' ? 'UK' : clean(value).toUpperCase();
export function lines(value) { return clean(value).split(/\r?\n/).map(clean).filter(Boolean); }
export function timestamp(date = new Date()) { const p=n=>String(n).padStart(2,'0');return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}-${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`; }
export function parseRows(matrix, {sheet='Sheet1', formulaCells=new Set(), limit=500}={}) {
  const headIndex=matrix.findIndex(r=>r.some(v=>clean(v)));
  if(headIndex<0) throw new Error('工作表为空');
  const header=matrix[headIndex].map(v=>clean(v).toUpperCase());
  const cols={};
  for(const [key,names] of Object.entries(ALIASES)) {
    const found=header.flatMap((v,i)=>names.map(n=>n.toUpperCase()).includes(v)?[i]:[]);
    if(found.length>1) throw new Error(`表头重复：${names[0]}`);
    cols[key]=found[0]??-1;
    if(key!=='parent' && cols[key]<0) throw new Error(`缺少表头：${names[0]}（请保留五个核心表头，或下载详细模板）`);
  }
  const parameterCols=DETAIL_PARAMETERS.map(p=>{
    const indices=header.flatMap((v,i)=>v===p.name?[i]:[]);
    if(indices.length>1)throw new Error(`表头重复：${p.name}`);
    return {...p,index:indices[0]??-1};
  });
  const records=[];
  for(let index=headIndex+1;index<matrix.length;index++) {
    const row=matrix[index];
    // Pre-filled default parameter rows are not products until an input is added.
    const inputColumns=['site','msku','asin','keywords','targets','parent'].map(k=>cols[k]).filter(c=>c>=0);
    if(!row||!inputColumns.some(c=>clean(row[c])||formulaCells.has(`${index}:${c}`)))continue;
    if(records.length>=limit) throw new Error(`每次最多读取${limit}款，请分批导入`);
    const data={sheet,row:index+1,issues:[],channelIssues:{keywords:[],targets:[]},warnings:[]};
    for(const [key,col] of Object.entries(cols)) data[key]=col<0?'':clean(row[col]);
    for(const [key,col] of Object.entries(cols)) if(col>=0&&formulaCells.has(`${index}:${col}`)) (data.channelIssues[key]||data.issues).push(`${ALIASES[key][0]}含公式，请粘贴为值`);
    if(!data.site) data.issues.push('店铺不能为空');
    if(!data.msku) data.issues.push('主推MSKU不能为空，请填写实际主推子体MSKU');
    else if(/[\r\n\t]/.test(data.msku)) data.issues.push('每行只填写一个主推MSKU');
    data.asin=data.asin.toUpperCase();
    if(!/^[A-Z0-9]{10}$/.test(data.asin)) data.issues.push('主推ASIN应为10位字母数字');
    data.keywords=lines(data.keywords);data.targets=lines(data.targets).map(v=>v.toUpperCase());
    if(data.keywords.length>5) data.channelIssues.keywords.push('广泛关键词应为1–5个，一行一个；留空则跳过');
    if(data.targets.length&&(data.targets.length<3||data.targets.length>5)) data.channelIssues.targets.push('扩展ASIN应为3–5个，一行一个；留空则跳过');
    if(data.keywords.some(v=>v.length>80)) data.channelIssues.keywords.push('关键词过长，请核对是否粘贴了整段标题');
    if(new Set(data.keywords.map(v=>v.toLocaleLowerCase())).size!==data.keywords.length) data.channelIssues.keywords.push('关键词重复，请去重');
    if(data.targets.some(v=>!/^[A-Z0-9]{10}$/.test(v))) data.channelIssues.targets.push('竞品ASIN格式错误');
    if(new Set(data.targets).size!==data.targets.length) data.channelIssues.targets.push('扩展ASIN重复，请去重');
    if(data.targets.includes(data.asin)) data.channelIssues.targets.push('扩展清单包含主推商品自身');
    data.parameters={};
    for(const p of parameterCols){
      if(p.index<0)continue;
      const value=clean(row[p.index]);data.parameters[p.name]=value;
      if(formulaCells.has(`${index}:${p.index}`)){data.issues.push(`${p.name}含公式，请恢复默认值或留空`);continue;}
      if(!value)continue;
      if(!p.allowed.some(v=>v.toUpperCase()===value.toUpperCase()))data.issues.push(p.allowed.length?`${p.name}=${value}与首轮默认模型不符，请填写“${p.value}”或留空`:`${p.name}是类目或精准活动保留列，本轮请留空`);
    }
    records.push(data);
  }
  const groups=new Map();
  for(const r of records) for(const [field,value] of [['msku',r.msku],['asin',r.asin],['parent',r.parent]]) {
    if(!value) continue;const key=JSON.stringify([r.site,field,value]);
    if(!groups.has(key)) groups.set(key,[]);groups.get(key).push(r);
  }
  for(const [key,rs] of groups) if(rs.length>1) {
    const field=JSON.parse(key)[1];for(const r of rs) r.issues.push(`同店铺${field==='parent'?'父产品':field.toUpperCase()}重复，行号：${rs.map(x=>x.row).join('、')}`);
  }
  return records;
}
export function selectedAutoTypes(record) {
  const selected=record.autoTypes??AUTO_TYPES;
  if(!Array.isArray(selected)||selected.some(type=>!AUTO_TYPES.includes(type))||new Set(selected).size!==selected.length)throw new Error('自动投放选择无效');
  return AUTO_TYPES.filter(type=>selected.includes(type));
}
export function channelInputs(record) {
  return [
    {key:'auto',type:'AUTO',label:'自动广告',count:selectedAutoTypes(record).length},
    {key:'keywords',type:'BROAD',label:'广泛关键词',count:record.keywords.length},
    {key:'targets',type:'EXPANDED_ASIN',label:'扩展ASIN',count:record.targets.length}
  ].map(c=>{const issues=record.channelIssues?.[c.key]||[];return {...c,status:issues.length?'blocked':c.count?'pending':'skipped',reason:issues.length?issues.join('；'):c.count?'':c.key==='auto'?'未勾选自动投放，跳过对应活动':`未填写${c.label}，跳过对应活动`};});
}
export function resolveProfile(record, profiles) {
  const exact=profiles.filter(p=>clean(p.alias)===record.site);
  if(exact.length!==1) throw new Error(exact.length?'店铺名称不唯一，请核对':'当前广告账户中找不到此店铺，请从店铺清单复制完整名称');
  const p=exact[0];if(!SITES[country(p.country)]) throw new Error(`当前模型不支持${p.country}站`);
  if(p.real_status!==undefined&&Number(p.real_status)!==1) throw new Error('店铺广告授权状态异常');
  if(!/^\d+$/.test(String(p.profile_id))) throw new Error('店铺标识缺失');
  return {...p,profile_id:String(p.profile_id),country:country(p.country)};
}
export function flattenProducts(items, parent='') {
  return items.flatMap(p=>[ {...p,parent_asin:p.parent_asin||p.parentAsin||parent}, ...flattenProducts(Array.isArray(p.variants)?p.variants:[],p.asin||parent) ]);
}
export function validateProduct(record, profile, products) {
  const matches=flattenProducts(products).filter(p=>clean(p.sku)===record.msku);
  if(matches.length!==1) throw new Error(matches.length?'同MSKU找到多个商品记录，请核对':'当前账号可见商品中未找到完全匹配的MSKU，请核对店铺、MSKU及ERP Listing数据权限');
  const p=matches[0];
  if(String(p.profile_id)!==profile.profile_id) throw new Error('商品所属店铺与所选店铺不一致');
  if(clean(p.asin).toUpperCase()!==record.asin) throw new Error(`MSKU对应ASIN为${p.asin}，与表格不符`);
  if(String(p.sku_status)!=='1') throw new Error('商品不是在售状态，或接口未返回可识别状态');
  const raw=p.afn_fulfillable_quantity;
  if(raw===null||raw===undefined||raw===''||!Number.isFinite(Number(raw))||Number(raw)<0) throw new Error('未取得有效可售库存');
  const stock=Number(raw);
  if(Array.isArray(p.variants)&&p.variants.length) throw new Error('选中的是包含变体的分组，请改填具体主推子体');
  if(record.parent&&p.parent_asin&&record.parent!==p.parent_asin) throw new Error('填写的父产品与ERP父子关系不一致');
  const product={asin:p.asin,msku:p.sku,title:clean(p.title),image:clean(p.img),stock,status:'在售',parent:clean(p.parent_asin),stockSource:'领星广告选品页可售库存（FBA）',eligibility:'未核实',existingAds:typeof p.is_ad==='boolean'?p.is_ad:null};
  if(stock<10) throw Object.assign(new Error(`当前可售库存${stock}，不足10`),{product});
  return product;
}
export function calculateBid(suggestion, budget) {
  if(!suggestion||suggestion.status==='error') throw new Error(suggestion?.message||'建议竞价读取失败');
  if(suggestion.status!=='none'&&suggestion.status!=='available') throw new Error('建议竞价状态不可识别');
  if(suggestion.status==='available'&&(!(suggestion.lower>0)||!Number.isFinite(suggestion.lower))) throw new Error('建议下限无效');
  const fallback=suggestion.status==='none';const lower=fallback?null:suggestion.lower;
  const raw=fallback?budget/10:Number((lower*0.9).toFixed(8));
  const bid=fallback?budget/10:Math.floor(lower*90+1e-8)/100;
  if(!(bid>0)) throw new Error('计算结果低于两位小数精度，请人工核对平台最低竞价');
  return {lower,raw,bid,fallback,source:suggestion.source||'',note:suggestion.note||'',quotedAt:suggestion.quotedAt||null,rule:fallback?'日预算÷10':'建议下限×90%（向下保留两位）'};
}
export function expressionKey(e) { return `${e.type}:${clean(e.value).toLowerCase()}`; }
export function parseNewGroupRecommendations(response, requested) {
  const list=response?.data?.bidRecommendations;
  if(!Array.isArray(list)) throw new Error('建议竞价响应结构变化，已停止本款计算');
  const matches=list.filter(x=>x.theme==='CONVERSION_OPPORTUNITIES');
  if(list.length&&!matches.length) throw new Error('未返回转化主题的建议竞价');
  const rows=matches.flatMap(x=>{
    if(!Array.isArray(x.bidRecommendationsForTargetingExpressions)) throw new Error('建议竞价明细缺失');
    return x.bidRecommendationsForTargetingExpressions;
  });
  return requested.map(e=>{
    const found=rows.filter(x=>expressionKey(x.targetingExpression||{})===expressionKey(e));
    if(found.length>1) throw new Error('建议竞价存在重复响应，无法确定下限');
    if(!found.length) return {status:'none',source:'新广告组建议',note:'成功查询，未返回本目标的有效区间'};
    const values=found[0].bidValues;if(!Array.isArray(values)) throw new Error('建议区间结构异常');
    if(values.length===0) return {status:'none',source:'新广告组建议',note:'返回空建议区间'};
    if(values.length!==3) throw new Error('建议区间不是下限／建议／上限三值，请人工核对');
    const nums=values.map(x=>x.suggestedBid);
    if(nums.every(x=>x===null||x===0)) return {status:'none',source:'新广告组建议',note:'返回空或零建议区间'};
    if(nums.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<=0)||nums[0]>nums[1]||nums[1]>nums[2]) throw new Error('建议区间异常，不能按无建议价处理');
    return {status:'available',lower:nums[0],source:'新广告组建议',note:''};
  });
}
export function parseExpandedRecommendations(response, targets) {
  if(!Array.isArray(response?.data)) throw new Error('扩展商品建议响应结构变化');
  return targets.map(asin=>{
    const matches=response.data.filter(x=>x.asin===asin);
    if(matches.length>1) throw new Error('扩展商品建议记录重复');
    const item=matches[0];
    if(!item) return {status:'none',source:'新商品扩展推荐池',note:'当前推荐池未返回此ASIN的扩展区间，使用备用价；不代表全平台没有建议'};
    if(!Array.isArray(item.suggests)) throw new Error('扩展商品建议明细缺失');
    const suggestions=item.suggests.filter(s=>Array.isArray(s.expression)&&s.expression.length===1&&s.expression[0].type==='asinExpandedFrom'&&s.expression[0].value===asin);
    if(suggestions.length>1) throw new Error('扩展商品建议区间不唯一');
    if(!suggestions.length) return {status:'none',source:'新商品扩展推荐池',note:'未返回本ASIN的扩展区间，不借用精准建议价'};
    const s=suggestions[0];if(s.code!=='SUCCESS') throw new Error(`扩展建议返回异常：${s.code||'未知'}`);
    const lower=s.suggestedBid?.rangeStart;
    if(lower===0||lower===null) return {status:'none',source:'新商品扩展推荐池',note:'扩展区间下限为空或零'};
    if(typeof lower!=='number'||!Number.isFinite(lower)||lower<=0) throw new Error('扩展建议下限格式异常');
    return {status:'available',lower,source:'新商品扩展推荐池',note:''};
  });
}
export function buildPlan(record, profile, product, suggestions, batchTime, fetchedAt=new Date().toISOString()) {
  const config=SITES[profile.country];if(!config) throw new Error('不支持的站点');
  if(record.issues?.length) throw new Error(record.issues.join('；'));
  const makeTarget=(type,value,label,s)=>({type,value,label,state:'enabled',...calculateBid(s,config.budget)});
  const campaigns=[],channels=[];
  for(const input of channelInputs(record)) {
    const channel={...input};channels.push(channel);
    if(channel.status!=='pending')continue;
    try {
      if(suggestions.errors?.[channel.key])throw new Error(suggestions.errors[channel.key]);
      const quotes=suggestions[channel.key];
      if(!Array.isArray(quotes)||quotes.length!==channel.count)throw new Error('建议竞价与目标数量不一致');
      let suffix,group,targets;
      if(channel.key==='auto'){suffix=group='自动';targets=selectedAutoTypes(record).map((type,i)=>makeTarget(type,'',AUTO_LABELS[AUTO_TYPES.indexOf(type)],quotes[i]));}
      else if(channel.key==='keywords'){suffix='手动-关键词';group='手动-关键词-BROAD';targets=record.keywords.map((value,i)=>makeTarget('BROAD',value,value,quotes[i]));}
      else {suffix='手动-商品投放';group='手动-商品投放-ASIN';targets=record.targets.map((value,i)=>makeTarget('asinExpandedFrom',value,value+' · 扩展',quotes[i]));}
      const name=`${record.msku}-${suffix}-${batchTime}`,groupName=`${record.msku}-${group}-${batchTime}`;
      if(name.length>250||groupName.length>250)throw new Error('生成的活动/组名称超过250字符');
      campaigns.push({type:channel.type,name,budget:config.budget,currency:config.currency,bidding:'动态竞价-只降低',placements:{top:0,rest:0,product:0},audienceAdjustment:0,groups:[{name:groupName,defaultBid:config.budget/10,products:[{msku:record.msku,asin:record.asin}],targets}]});
      channel.status='ready';channel.reason='';
    }catch(error){channel.status='blocked';channel.reason=error.message;}
  }
  return {model:MODEL_VERSION,previewOnly:true,sheet:record.sheet,row:record.row,shop:profile.alias,profileId:profile.profile_id,country:profile.country,currency:config.currency,product,campaigns,channels,effectiveParameters:{mode:'首轮默认模型',dailyBudget:config.budget,defaultBid:config.budget/10,minStock:10,bidRule:'建议下限×90%；无有效区间时日预算÷10',state:'仅预览'},fetchedAt,batchTime,warnings:[...record.warnings,'创建前将重新核对库存、广告资格和同名活动',...(!product.parent?['接口未返回父子关系，请核对同父只选一个主推子体']:[])]};
}
export function totals(plans) {
  const sum={};for(const p of plans) {const s=sum[p.currency]??={products:0,campaigns:0,dailyBudget:0};s.products++;s.campaigns+=p.campaigns.length;s.dailyBudget+=p.campaigns.reduce((n,c)=>n+c.budget,0);}return sum;
}
