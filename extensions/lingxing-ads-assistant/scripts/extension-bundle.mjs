import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {APP_VERSION} from '../src/model.mjs';
import {applicationBundle,moduleRoot as root} from './bundle.mjs';

export async function extensionBundle(){
const {entryCode,code,templateBytes,templateBase64}=await applicationBundle();
const source=`/* 领星广告创建助手 ${APP_VERSION} · Chrome扩展 · 预览确认后创建 */\n(function(){'use strict';\n${entryCode}\nif(!isNewAdsPage(window))return;\nconst openOnStart=consumeAssistantOpen(window);\n${code}\nconst app=mountAssistant(XLSX,window,'${templateBase64}');\nif(openOnStart){if(app)app.open();else window.postMessage({type:'LX_ADS_LAUNCHER_CONTROL',action:'open'},window.location.origin);}\n})();\n`;
const legacySource=`(function(){'use strict';\n${entryCode}\nconst entry=mountLegacyEntry(window);\n${await fs.readFile(path.join(root,'extension/legacy-bridge.js'),'utf8')}\n})();\n`;
new vm.Script(source,{filename:'content.js'});
new vm.Script(legacySource,{filename:'legacy-entry.js'});
const manifest={manifest_version:3,name:'领星广告创建助手',version:APP_VERSION,description:'导入Excel、校验与调整预览，确认后批量创建广告，本地保存预览及执行记录。',minimum_chrome_version:'111',permissions:['storage'],background:{service_worker:'background.mjs',type:'module'},action:{default_title:'领星广告创建助手',default_popup:'popup.html'},content_scripts:[{matches:['https://ads.lingxing.com/ad_report/*'],js:['legacy-entry.js'],run_at:'document_start',world:'ISOLATED',all_frames:false},{matches:['https://ads.lingxing.com/amazon/*'],js:['storage-bridge.js','launcher-bridge.js'],run_at:'document_start',world:'ISOLATED',all_frames:false},{matches:['https://ads.lingxing.com/amazon/*'],js:['content.js'],run_at:'document_start',world:'MAIN',all_frames:false}]};
return {source,legacySource,manifest,templateBytes};
}
