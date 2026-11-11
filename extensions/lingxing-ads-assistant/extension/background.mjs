import {createStorageService} from './storage-service.mjs';
import {createLauncherSettings} from './launcher-settings.mjs';
const storage=createStorageService(chrome.storage.local);
const launcherSettings=createLauncherSettings(chrome.storage.local);
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='LX_ADS_LAUNCHER_PREFS'&&sender.id===chrome.runtime.id&&(sender.url===chrome.runtime.getURL('popup.html')||(sender.frameId===0&&/^https:\/\/ads\.lingxing\.com\/amazon\//.test(sender.url||'')))){
    launcherSettings(message).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.type!=='LX_ADS_DRAFT_REQUEST'||sender.id!==chrome.runtime.id||sender.frameId!==0||!/^https:\/\/ads\.lingxing\.com\/amazon\//.test(sender.url||''))return;
  storage(message).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message}));
  return true;
});
