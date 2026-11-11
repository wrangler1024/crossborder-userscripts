import {MODEL_VERSION} from './model.mjs';
import {previewSnapshot,restorePreview} from './persistence.mjs';
import {validateCreationItem,buildCreationPayload,executionFingerprint,executionKey} from './execution.mjs';

export const BACKUP_KIND='lingxing-ads-assistant-backup';
export const MAX_BACKUP_BYTES=12*1024*1024;
const backupPick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
// Chrome storage can reorder object keys. Compare data, then verify the original
// fingerprint using the canonical payload produced by the shared builder.
const backupCanonical=value=>Array.isArray(value)?value.map(backupCanonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,backupCanonical(value[key])])):value;
export async function validateBackup(value,scope,cryptoApi=globalThis.crypto){
  if(value?.kind!==BACKUP_KIND||value.schema!==1||value.scope!==scope||!/^[a-f0-9]{64}$/.test(scope||''))throw new Error('备份不属于当前领星账号，或文件格式不正确');
  if(value.model!==MODEL_VERSION||!Array.isArray(value.entries)||value.entries.length>5000)throw new Error('备份版本或创建记录格式不兼容');
  if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_BACKUP_BYTES)throw new Error('备份文件过大，请保留原文件并联系管理员');
  const draft=value.draft?previewSnapshot(restorePreview(value.draft)):null;
  const entries=[],seen=new Set();
  for(const saved of value.entries){
    const item=backupPick(saved.item,['model','profileId','shop','country','currency','msku','asin','parent']);
    const c=saved.item?.campaign,g=c?.groups?.[0];
    if(!g||!Array.isArray(g.targets))throw new Error('备份中的活动结构不完整');
    item.campaign={...backupPick(c,['type','name','budget','currency','bidding','audienceAdjustment']),placements:backupPick(c.placements,['top','rest','product']),groups:[{...backupPick(g,['name','defaultBid']),products:(g.products||[]).map(p=>backupPick(p,['msku','asin'])),targets:g.targets.map(t=>backupPick(t,['type','value','bid','state']))}]};
    validateCreationItem(item);
    const payload=buildCreationPayload(item,{state:saved.payload?.groups?.[0]?.campaigns?.[0]?.state,startDate:saved.payload?.start_date});
    if(JSON.stringify(backupCanonical(payload))!==JSON.stringify(backupCanonical(saved.payload))||await executionFingerprint(payload,cryptoApi)!==saved.payloadHash||saved.key!==executionKey(item)||seen.has(saved.key))throw new Error('备份中的创建记录校验失败');
    if(!['checking','submitting','not_sent','submitted','unknown','failed','review','complete'].includes(saved.status))throw new Error('备份中的创建状态无效');
    seen.add(saved.key);
    const entry={...backupPick(saved,['key','payloadHash','startedAt','updatedAt','campaignId','adGroupId','groupUuid','transactionUuid','adIds']),item,payload,status:['checking','submitting','not_sent'].includes(saved.status)?'unknown':saved.status,message:'从本地备份恢复，请检查创建结果',accepted:saved.accepted===true};
    entries.push(entry);
  }
  return {kind:BACKUP_KIND,schema:1,model:MODEL_VERSION,scope,draft,entries,exportedAt:typeof value.exportedAt==='string'?value.exportedAt:''};
}
