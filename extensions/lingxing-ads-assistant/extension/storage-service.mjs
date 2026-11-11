export function createStorageService(storage,{revision=()=>crypto.randomUUID(),now=()=>new Date().toISOString()}={}){
  let queue=Promise.resolve();
  async function backup(request){
    const previewKey='ads-preview-v1:'+request.scope,executionKey='ads-execution-v1:'+request.scope;
    const previous=(await storage.get(previewKey))[previewKey]||null;
    const saved=(await storage.get(executionKey))[executionKey]||{entries:{}};
    if(request.action==='backup_export')return {draft:previous?.draft||null,entries:Object.values(saved.entries),revision:previous?.revision||null};
    const value=request.backup;
    if(value?.kind!=='lingxing-ads-assistant-backup'||value.schema!==1||value.scope!==request.scope||!Array.isArray(value.entries)||value.entries.length>5000||(value.draft&&value.draft.schema!==1))throw new Error('本地备份格式无效');
    if((previous?.revision||null)!==(request.revision||null))throw new Error('另一页面已更新预览，请重新导入备份');
    const entries={...saved.entries};
    for(const source of value.entries){
      if(typeof source.key!=='string'||source.key.length>600||JSON.stringify([String(source.item?.profileId),source.item?.campaign?.name])!==source.key||!/^[a-f0-9]{64}$/.test(source.payloadHash||'')||!source.payload||!['submitted','unknown','failed','review','complete'].includes(source.status))throw new Error('备份创建记录格式无效');
      const prior=entries[source.key];
      if(prior&&prior.payloadHash!==source.payloadHash)throw new Error('本地已有同名但内容不同的创建记录，未导入');
      // Import never makes a previously submitted/unknown entry eligible to send again.
      if(prior&&!['checking','not_sent'].includes(prior.status))continue;
      entries[source.key]={...source,owner:'backup-import',revision:revision(),updatedAt:now()};
    }
    const execution={entries},preview={draft:value.draft||null,revision:revision(),savedAt:value.draft?now():null};
    if([execution,preview].some(v=>new TextEncoder().encode(JSON.stringify(v)).length>4*1024*1024))throw new Error('备份超过本地保存容量');
    // Save conservative creation claims first. If the next write fails, no claim is lost.
    await storage.set({[executionKey]:execution});
    await storage.set({[previewKey]:preview});
    return {entries:Object.keys(entries).length,savedAt:preview.savedAt};
  }
  async function execution(request){
    const key='ads-execution-v1:'+request.scope;
    const saved=(await storage.get(key))[key]||{entries:{}};
    if(request.action==='execution_read')return {entries:Object.values(saved.entries)};
    if(typeof request.key!=='string'||request.key.length>600)throw new Error('创建记录标识无效');
    const prior=saved.entries[request.key];
    let entry;
    if(request.action==='execution_claim'){
      if(prior&&!['not_sent','checking'].includes(prior.status))return {claimed:false,entry:prior};
      if(!request.item||JSON.stringify([String(request.item.profileId),request.item.campaign?.name])!==request.key||!/^[a-f0-9]{64}$/.test(request.payloadHash||'')||typeof request.owner!=='string'||!request.payload)throw new Error('创建记录不完整');
      entry={key:request.key,item:request.item,payload:request.payload,payloadHash:request.payloadHash,owner:request.owner,startedAt:request.startedAt||now(),updatedAt:now(),status:'checking',message:'准备提交，正在复核',revision:revision()};
    }else if(request.action==='execution_update'){
      if(!prior||prior.revision!==request.revision)throw new Error('创建记录已被另一页面更新，请检查最新结果');
      const states=['checking','submitting','not_sent','submitted','unknown','failed','review','complete'];
      if(!states.includes(request.patch?.status))throw new Error('创建记录状态无效');
      // Once a request may have been sent, it can never become eligible for a new submit.
      if(!['checking','not_sent'].includes(prior.status)&&['checking','not_sent','submitting'].includes(request.patch.status))throw new Error('此活动可能已经提交，不能重新发送');
      if(request.patch.status==='submitting'&&prior.status!=='checking')throw new Error('此活动尚未完成提交前复核');
      const patch={status:request.patch.status,message:String(request.patch.message||'').slice(0,1200)};
      if(request.patch.accepted===true&&prior.status==='submitting'&&patch.status==='submitted')patch.accepted=true;
      for(const field of ['campaignId','adGroupId','groupUuid','transactionUuid'])if(typeof request.patch[field]==='string')patch[field]=request.patch[field];
      if(Array.isArray(request.patch.adIds)&&request.patch.adIds.every(v=>typeof v==='string'))patch.adIds=request.patch.adIds.slice(0,20);
      entry={...prior,...patch,updatedAt:now(),revision:revision()};
    }else throw new Error('不支持的创建记录操作');
    const next={entries:{...saved.entries,[request.key]:entry}};
    if(new TextEncoder().encode(JSON.stringify(next)).length>4*1024*1024)throw new Error('本地创建记录空间不足，未继续提交');
    try{await storage.set({[key]:next});}catch{throw new Error('创建记录无法保存，已停止继续提交');}
    return request.action==='execution_claim'?{claimed:true,entry}:entry;
  }
  return request=>{
    const run=async()=>{
      if(!/^[a-f0-9]{64}$/.test(request.scope||''))throw new Error('本地预览请求无效');
      if(['backup_export','backup_import'].includes(request.action))return backup(request);
      if(['execution_read','execution_claim','execution_update'].includes(request.action))return execution(request);
      if(!['read','write','clear'].includes(request.action))throw new Error('本地预览请求无效');
      const key='ads-preview-v1:'+request.scope;
      const previous=(await storage.get(key))[key]||null;
      if(request.action==='read')return previous;
      if((previous?.revision||null)!==(request.revision||null))throw new Error('另一页面已更新本地预览，请先导出本页调整，再刷新加载最新版本');
      if(request.action==='write'&&(request.draft?.schema!==1||new TextEncoder().encode(JSON.stringify(request.draft)).length>4*1024*1024))throw new Error('预览超过本地保存容量，请拆分表格或导出保留');
      // Keep a tombstone on clear so a stale tab cannot silently recreate deleted data.
      const result={revision:revision(),savedAt:request.action==='write'?now():null,draft:request.action==='write'?request.draft:null};
      try{await storage.set({[key]:result});}catch{throw new Error('本地存储空间不足或写入失败，请先导出保留，再重试保存');}
      return {revision:result.revision,savedAt:result.savedAt};
    };
    const task=queue.then(run);queue=task.catch(()=>{});return task;
  };
}
