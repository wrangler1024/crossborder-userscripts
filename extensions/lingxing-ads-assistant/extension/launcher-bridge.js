// Only UI preferences and opening the panel cross this bridge. No advertising action.
if(window.top===window.self){
  const post=data=>window.postMessage(data,location.origin);
  window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==window||event.origin!==location.origin||data?.type!=='LX_ADS_LAUNCHER_REQUEST'||!['read','write'].includes(data.action)||typeof data.id!=='string'||data.id.length>80)return;
    chrome.runtime.sendMessage({type:'LX_ADS_LAUNCHER_PREFS',action:data.action,preferences:data.preferences},response=>{
      const error=chrome.runtime.lastError;
      post({type:'LX_ADS_LAUNCHER_RESPONSE',id:data.id,...(error?{ok:false,error:'入口设置未保存，请刷新领星页面后重试'}:response)});
    });
  });
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||message?.type!=='LX_ADS_LAUNCHER_CONTROL'||!['open','preferences'].includes(message.action))return;
    if(!document.getElementById('lingxing-ad-preview-assistant')?.hasAttribute('data-edge-launcher')){respond({ok:false,error:'请刷新领星广告页面，再打开助手'});return;}
    post({type:'LX_ADS_LAUNCHER_CONTROL',action:message.action,preferences:message.preferences});
    respond({ok:true});
  });
}
