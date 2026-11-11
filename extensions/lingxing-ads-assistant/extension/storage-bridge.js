// The isolated-world bridge handles local previews and execution records, never ERP requests.
if(window.top===window.self){
  window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==window||event.origin!==location.origin||data?.type!=='LX_ADS_DRAFT_REQUEST'||typeof data.id!=='string'||data.id.length>80||!['read','write','clear','execution_read','execution_claim','execution_update'].includes(data.action)||!/^[a-f0-9]{64}$/.test(data.scope||''))return;
    chrome.runtime.sendMessage({type:data.type,action:data.action,scope:data.scope,revision:data.revision,draft:data.draft,key:data.key,item:data.item,payload:data.payload,payloadHash:data.payloadHash,owner:data.owner,startedAt:data.startedAt,patch:data.patch},response=>{
      const error=chrome.runtime.lastError;
      window.postMessage({type:'LX_ADS_DRAFT_RESPONSE',id:data.id,...(error?{ok:false,error:'本地保存连接已更新，请重新加载领星页面'}:response)},location.origin);
    });
  });
}
