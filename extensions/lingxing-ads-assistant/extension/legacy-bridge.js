// This bridge only opens the new page; it cannot access preview or creation records.
if(entry){
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||message?.type!=='LX_ADS_LAUNCHER_CONTROL')return;
    if(message.action==='open'){respond({ok:true});entry.open();}
    else if(message.action==='preferences')respond({ok:false,error:'旧版页面保留跳转入口；显示设置在新版广告页生效'});
  });
}
