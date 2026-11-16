import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const root = path.resolve(import.meta.dirname, '..');
export const VENDOR_HASH = 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41';
export async function libraryBundle() {
  const names = (await fs.readdir(path.join(root, 'src'))).filter(name => name.endsWith('.mjs')).sort();
  const factories = await Promise.all(names.map(async name => {
    let code = await fs.readFile(path.join(root, 'src', name), 'utf8');
    const exported = [...code.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+([\w$]+)/gm)].map(m => m[1]);
    code = code.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?\s*$/gm, (_, imports, dependency) => 'const {' + imports.replace(/\s+as\s+/g, ':') + '} = __require(' + JSON.stringify(dependency) + ');').replace(/^export /gm, '');
    if (/^import\s|^export\s/m.test(code)) throw new Error('Unsupported module syntax in ' + name);
    return JSON.stringify(name) + ':(__exports,__require)=>{\n' + code + '\nObject.assign(__exports,{' + exported.join(',') + '});\n}';
  }));
  return 'const __modules={' + factories.join(',\n') + '};const __cache={};function __require(name){if(__cache[name])return __cache[name];if(!__modules[name])throw new Error("Unknown package module");const value={};__cache[name]=value;__modules[name](value,__require);return value;}\n';
}
export async function applicationBundle(channel) {
  const vendor = await fs.readFile(path.join(root, 'vendor/xlsx.full.min.cjs'), 'utf8');
  if (crypto.createHash('sha256').update(vendor).digest('hex') !== VENDOR_HASH) throw new Error('Spreadsheet parser integrity mismatch');
  return '(()=>{"use strict";const XLSX=(()=>{const module={exports:{}},exports=module.exports;\n' + vendor + '\nreturn module.exports;})();\n' + await libraryBundle() + '\n__require("runtime.mjs").startPackageAssistant(window,{XLSX,channel:' + JSON.stringify(channel) + '});})();\n';
}
export function extensionManifest(version) {
  return { manifest_version: 3, name: 'FBA 包装数据维护助手', version, description: '导入亚马逊费用预估报告，自动读取已有商品配对关系，维护领星默认箱规的包装尺寸和单品毛重。', minimum_chrome_version: '111', permissions: ['activeTab'], action: { default_popup: 'popup.html', default_title: 'FBA 包装数据维护助手' }, content_scripts: [{ matches: ['https://erp.lingxing.com/erp/*'], js: ['content.js'], run_at: 'document_idle', world: 'MAIN' }, { matches: ['https://erp.lingxing.com/erp/*'], js: ['bridge.js'], run_at: 'document_idle', world: 'ISOLATED' }] };
}
export async function userscriptBundle(version) {
  const metadata = '// ==UserScript==\n// @name         FBA 包装数据维护助手\n// @namespace    crossborder-userscripts/lingxing-package-data-assistant\n// @version      ' + version + '\n// @description  从费用预估报告自动匹配领星已有配对关系，核对后维护包装尺寸和单品毛重\n// @match        https://erp.lingxing.com/erp/*\n// @run-at       document-idle\n// @grant        none\n// ==/UserScript==\n';
  const license = await fs.readFile(path.join(root, 'vendor/LICENSE-SheetJS.txt'), 'utf8');
  return metadata + await applicationBundle('userscript') + '\n/* Third-party license (SheetJS)\n' + license.replaceAll('*/', '* /') + '\n*/\n';
}
