import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {applicationBundle,bundleModule,moduleRoot} from './bundle.mjs';

const {version,entryCode,code,templateBase64}=await applicationBundle();
const out=path.resolve(moduleRoot,'../../scripts/lingxing-ads-assistant');
const base='https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant';
const adapters=await Promise.all(['extension/storage-service.mjs','extension/launcher-settings.mjs','userscript/storage.mjs','userscript/bootstrap.mjs'].map(name=>bundleModule(path.join(moduleRoot,name))));
// Keep the installer/editor small: CodeMirror otherwise renders the bundled
// spreadsheet tables as tens of thousands of nodes before the script even runs.
// Tampermonkey caches this versioned dependency and verifies its exact bytes.
const runtime=`// Generated shared runtime ${version}. Do not edit by hand.\nfunction startLingxingAdsAssistant(){'use strict';\nconst window=typeof unsafeWindow==='undefined'?globalThis.window:unsafeWindow;\n${entryCode}\nif(isLegacyAdsPage(window)){\n  const entry=mountLegacyEntry(window);\n  GM_registerMenuCommand('打开广告创建助手',entry.open);\n  return entry;\n}\nif(!isNewAdsPage(window))return;\nconst openOnStart=consumeAssistantOpen(window);\nconst document=window.document,Node=window.Node,URL=window.URL,Blob=window.Blob,AbortController=window.AbortController,DOMException=window.DOMException,fetch=window.fetch.bind(window);\n${code}\n${adapters.join('\n')}\nconst app=bootUserscript({XLSX,win:window,templateBase64:'${templateBase64}',registerMenu:GM_registerMenuCommand});\nif(openOnStart){if(app)app.open();else window.postMessage({type:'LX_ADS_LAUNCHER_CONTROL',action:'open'},window.location.origin); }\nreturn app;\n}\n`;
const runtimeHash=crypto.createHash('sha256').update(runtime).digest('hex');
const runtimeUrl=`https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/lingxing-ads-assistant-v${version}/scripts/lingxing-ads-assistant/lingxing-ads-assistant.runtime.js#sha256=${runtimeHash}`;
const header=`// ==UserScript==
// @name         领星广告创建助手
// @namespace    https://github.com/wrangler1024/crossborder-userscripts/lingxing-ads-assistant
// @version      ${version}
// @description  Excel导入、库存与建议价校验、三活动预览，确认后批量创建；本地保存与备份。
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/extensions/lingxing-ads-assistant
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @match        https://ads.lingxing.com/amazon/*
// @match        https://ads.lingxing.com/ad_report/*
// @run-at       document-start
// @sandbox      raw
// @noframes
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @require      ${runtimeUrl}
// @updateURL    ${base}.meta.js
// @downloadURL  ${base}.user.js
// ==/UserScript==`;
const output=`${header}\n\n// Small installation entry. The versioned runtime above is integrity-checked and cached by Tampermonkey.\n(function(){'use strict';\nif(typeof startLingxingAdsAssistant!=='function'){\n  console.error('广告助手程序未加载，请检查网络并在油猴中检查更新，然后刷新领星页面。');\n  return;\n}\nstartLingxingAdsAssistant();\n})();\n`;
new vm.Script(output,{filename:'lingxing-ads-assistant.user.js'});
new vm.Script(runtime,{filename:'lingxing-ads-assistant.runtime.js'});
const files={'lingxing-ads-assistant.user.js':output,'lingxing-ads-assistant.meta.js':header+'\n','lingxing-ads-assistant.runtime.js':runtime};
if(process.argv.includes('--check')){
  for(const [name,expected] of Object.entries(files)){const actual=await fs.readFile(path.join(out,name),'utf8').catch(()=>null);if(actual!==expected)throw new Error(`${name} is missing or stale; run build:userscript`);}
  console.log(`Userscript ${version}: generated files match source`);
}else{
  await fs.mkdir(out,{recursive:true});for(const [name,value] of Object.entries(files))await fs.writeFile(path.join(out,name),value);
  console.log(`Built userscript ${version}: installer ${Buffer.byteLength(output)} bytes, pinned runtime ${Buffer.byteLength(runtime)} bytes`);
}
