import {previewValues,previewQuote,requireEditablePreview} from './preview.mjs';

export function refreshGroupValues(record,key){
  requireEditablePreview(record);
  if(record.channelIssues?.[key]?.length)throw new Error('请先修正该渠道的输入格式');
  return previewValues(record,key);
}
export function quoteHealth(record){
  const health={available:0,missing:0,failed:0,total:0};
  if(!record.previewValidated)return health;
  for(const key of ['auto','keywords','targets']){
    if(record.channelIssues?.[key]?.length)continue;
    for(const value of previewValues(record,key)){
      const quote=previewQuote(record,key,value);health.total++;
      if(quote?.status==='available')health.available++;
      else if(quote?.status==='none')health.missing++;
      else health.failed++;
    }
  }
  return health;
}
export function productImageUrl(value){
  try{const u=new URL(value);return u.protocol==='https:'&&/(?:\.|-)amazon\.(?:com|cn)$/.test(u.hostname)?u.href:'';}catch{return '';}
}
