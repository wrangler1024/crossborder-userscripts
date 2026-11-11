import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {APP_VERSION} from '../src/model.mjs';
import {DETAIL_TEMPLATE_FILENAME} from '../src/template-spec.mjs';

export const moduleRoot=path.resolve(import.meta.dirname,'..');
export const applicationFiles=['template-spec.mjs','model.mjs','client.mjs','preview.mjs','refresh.mjs','retry.mjs','workbook.mjs','persistence.mjs','execution.mjs','execution-client.mjs','execution-ui.mjs','launcher.mjs','runtime.mjs','backup.mjs','theme.mjs','validation.mjs','validation-ui.mjs','ui.mjs'];
export async function bundleModule(file){return (await fs.readFile(file,'utf8')).replace(/^import .*?;\n/gm,'').replace(/^export /gm,'');}
export async function applicationBundle(){
  const vendor=await fs.readFile(path.join(moduleRoot,'vendor/xlsx.full.min.cjs'),'utf8');
  if(crypto.createHash('sha256').update(vendor).digest('hex')!=='cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41')throw new Error('Unexpected SheetJS vendor hash');
  const pkg=JSON.parse(await fs.readFile(path.join(moduleRoot,'package.json'),'utf8'));
  if(pkg.version!==APP_VERSION)throw new Error('Package and application versions must match');
  const templateBytes=await fs.readFile(path.join(moduleRoot,'assets',DETAIL_TEMPLATE_FILENAME));
  const modules=await Promise.all(applicationFiles.map(name=>bundleModule(path.join(moduleRoot,'src',name))));
  const code=`const XLSX=(()=>{const module={exports:{}};const exports=module.exports;\n${vendor}\nreturn module.exports;})();\n`+modules.join('\n');
  const entryCode=await bundleModule(path.join(moduleRoot,'src/navigation.mjs'));
  return {version:APP_VERSION,entryCode,code,templateBytes,templateBase64:templateBytes.toString('base64')};
}
