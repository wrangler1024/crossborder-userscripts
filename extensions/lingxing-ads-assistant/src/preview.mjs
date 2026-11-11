import {AUTO_TYPES,selectedAutoTypes,channelInputs,buildPlan,calculateBid,SITES,clean} from './model.mjs';

export const previewQuoteKey=(key,value)=>key==='keywords'?clean(value).replace(/\s+/g,' ').toLowerCase():value;
export function previewValues(record,key){
  if(key==='auto')return selectedAutoTypes(record);
  if(key==='keywords'||key==='targets')return [...record[key]];
  throw new Error('投放渠道无效');
}
export function previewQuote(record,key,value){return record.quoteBook?.[key]?.[previewQuoteKey(key,value)];}
export function requireEditablePreview(record){
  if(!record.previewValidated||!record.profile||!record.product||record.product.stock<10||record.issues?.length)throw new Error('请先通过商品与库存校验');
}
export function rebuildPreview(record){
  requireEditablePreview(record);
  const suggestions={};
  for(const key of ['auto','keywords','targets'])suggestions[key]=previewValues(record,key).map(value=>previewQuote(record,key,value)||{status:'error',message:'尚未读取建议竞价，请重新获取'});
  record.plan=buildPlan(record,record.profile,record.product,suggestions,record.batchTime,record.validatedAt);
  record.plan.previewEdited=!!record.previewEdited;
  record.plan.editedAt=record.editedAt||null;
  record.plan.selectionSource='current-preview';
  const blocked=record.plan.channels.some(c=>c.status==='blocked');
  record.status=record.plan.campaigns.length?(blocked?'partial':'ready'):(blocked?'blocked':'skipped');
  return record.plan;
}
export function initializePreview(record,profile,product,suggestions,batchTime,now=new Date().toISOString()){
  Object.assign(record,{profile,product,batchTime,validatedAt:now,previewValidated:true,error:'',quoteBook:{auto:Object.create(null),keywords:Object.create(null),targets:Object.create(null)}});
  for(const channel of channelInputs(record)){
    if(channel.status!=='pending')continue;
    const values=previewValues(record,channel.key),quotes=suggestions[channel.key];
    values.forEach((value,i)=>{
      const error=suggestions.errors?.[channel.key]||(!Array.isArray(quotes)||quotes.length!==values.length?'建议竞价与目标数量不一致':'');
      record.quoteBook[channel.key][previewQuoteKey(channel.key,value)]=error?{status:'error',message:error,retryable:suggestions.errorDetails?.[channel.key]?.retryable!==false,quotedAt:now}:{...quotes[i],quotedAt:now};
    });
  }
  return rebuildPreview(record);
}
function markPreviewEdit(record){record.previewEdited=true;record.editedAt=new Date().toISOString();}
export function addPreviewKeyword(record,value){
  requireEditablePreview(record);
  if(record.channelIssues?.keywords?.length)throw new Error('请先修正Excel中的关键词格式后重新导入');
  const word=clean(value);
  if(!word)throw new Error('请填写要添加的广泛关键词');
  if(/[\r\n\t]/.test(word))throw new Error('每次添加一个关键词，不要换行或粘贴多个单元格');
  if(word.length>80)throw new Error('关键词不能超过80个字符');
  if(record.keywords.some(v=>previewQuoteKey('keywords',v)===previewQuoteKey('keywords',word)))throw new Error('此关键词已在当前预览中');
  if(record.keywords.length>=5)throw new Error('首轮最多5个广泛关键词，请先剔除不需要的词');
  record.keywords.push(word);markPreviewEdit(record);rebuildPreview(record);return word;
}
export function removePreviewKeyword(record,index){
  requireEditablePreview(record);
  if(record.channelIssues?.keywords?.length)throw new Error('请先修正Excel中的关键词格式后重新导入');
  if(!Number.isInteger(index)||index<0||index>=record.keywords.length)throw new Error('关键词已变化，请重新选择');
  const [word]=record.keywords.splice(index,1);
  delete record.quoteBook.keywords[previewQuoteKey('keywords',word)];
  markPreviewEdit(record);return rebuildPreview(record);
}
export function selectPreviewAuto(record,type,checked){
  requireEditablePreview(record);
  if(!AUTO_TYPES.includes(type))throw new Error('自动投放类型无效');
  const chosen=new Set(selectedAutoTypes(record));checked?chosen.add(type):chosen.delete(type);
  record.autoTypes=AUTO_TYPES.filter(t=>chosen.has(t));markPreviewEdit(record);return rebuildPreview(record);
}
export function applyPreviewQuotes(record,key,values,quotes,now=new Date().toISOString()){
  requireEditablePreview(record);
  if(!Array.isArray(quotes)||quotes.length!==values.length)throw new Error('建议竞价与目标数量不一致');
  const current=new Set(previewValues(record,key).map(v=>previewQuoteKey(key,v)));
  if(values.some(v=>!current.has(previewQuoteKey(key,v))))throw new Error('预览目标已经变化，请重新获取');
  // Validate the entire response before replacing any prices.
  quotes.forEach(quote=>calculateBid(quote,SITES[record.profile.country].budget));
  values.forEach((value,i)=>{record.quoteBook[key][previewQuoteKey(key,value)]={...quotes[i],quotedAt:now};});
  return rebuildPreview(record);
}
export function failPreviewQuotes(record,key,values,message,now=new Date().toISOString()){
  requireEditablePreview(record);
  const detail=typeof message==='string'?{message,retryable:true}:{message:message.message,retryable:message.retryable!==false};
  for(const value of values)record.quoteBook[key][previewQuoteKey(key,value)]={status:'error',...detail,quotedAt:now};
  return rebuildPreview(record);
}
export function previewTargetBid(record,key,value){
  const quote=previewQuote(record,key,value);
  try{return {status:'ready',...calculateBid(quote,SITES[record.profile.country].budget)};}
  catch(error){return {status:'blocked',message:quote?.message||error.message,quotedAt:quote?.quotedAt};}
}
export function finalPreviewPlans(records){
  return records.filter(r=>r.plan&&['ready','partial'].includes(r.status)&&r.plan.campaigns.length).map(r=>r.plan);
}
