import {mountAssistant} from '../src/ui.mjs';
import {createUserscriptTransport} from './storage.mjs';

export function bootUserscript({XLSX,win,templateBase64,registerMenu}){
  if(win.top!==win.self||win.location.origin!=='https://ads.lingxing.com'||!win.location.pathname.startsWith('/amazon/'))return null;
  const transport=createUserscriptTransport({win});
  const app=mountAssistant(XLSX,win,templateBase64,{channel:'userscript',storageTransport:transport.request,launcherTransport:transport.preferences});
  const open=()=>{if(app)app.open();else win.postMessage({type:'LX_ADS_LAUNCHER_CONTROL',action:'open'},win.location.origin);};
  registerMenu('打开广告创建助手',open);
  registerMenu('显示广告助手侧边入口',()=>{if(app)app.showLauncher();else open();});
  registerMenu('检查广告助手更新',()=>win.open('https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant.user.js','_blank','noopener'));
  return app;
}
