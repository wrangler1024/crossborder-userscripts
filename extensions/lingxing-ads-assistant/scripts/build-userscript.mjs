import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {applicationBundle,bundleModule,moduleRoot} from './bundle.mjs';

const {version,code,templateBase64}=await applicationBundle();
const out=path.resolve(moduleRoot,'../../scripts/lingxing-ads-assistant');
const base='https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-ads-assistant/lingxing-ads-assistant';
const header=`// ==UserScript==
// @name         领星广告创建助手
// @namespace    https://github.com/wrangler1024/crossborder-userscripts/lingxing-ads-assistant
// @version      ${version}
// @description  Excel导入、库存与建议价校验、三活动预览，确认后批量创建；本地保存与备份。
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/extensions/lingxing-ads-assistant
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @match        https://ads.lingxing.com/amazon/*
// @run-at       document-start
// @sandbox      raw
// @noframes
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @updateURL    ${base}.meta.js
// @downloadURL  ${base}.user.js
// ==/UserScript==`;
const adapters=await Promise.all(['extension/storage-service.mjs','extension/launcher-settings.mjs','userscript/storage.mjs','userscript/bootstrap.mjs'].map(name=>bundleModule(path.join(moduleRoot,name))));
const output=`${header}\n\n// Generated from the shared application source. Do not edit by hand.\n(function(){'use strict';\nconst window=typeof unsafeWindow==='undefined'?globalThis.window:unsafeWindow;\nif(window.top!==window.self)return;\nconst document=window.document,Node=window.Node,URL=window.URL,Blob=window.Blob,AbortController=window.AbortController,DOMException=window.DOMException,fetch=window.fetch.bind(window);\n${code}\n${adapters.join('\n')}\nbootUserscript({XLSX,win:window,templateBase64:'${templateBase64}',registerMenu:GM_registerMenuCommand});\n})();\n`;
new vm.Script(output,{filename:'lingxing-ads-assistant.user.js'});
const files={'lingxing-ads-assistant.user.js':output,'lingxing-ads-assistant.meta.js':header+'\n'};
if(process.argv.includes('--check')){
  for(const [name,expected] of Object.entries(files)){const actual=await fs.readFile(path.join(out,name),'utf8').catch(()=>null);if(actual!==expected)throw new Error(`${name} is missing or stale; run build:userscript`);}
  console.log(`Userscript ${version}: generated files match source`);
}else{
  await fs.mkdir(out,{recursive:true});for(const [name,value] of Object.entries(files))await fs.writeFile(path.join(out,name),value);
  console.log(`Built userscript ${version} (${Buffer.byteLength(output)} bytes)`);
}
