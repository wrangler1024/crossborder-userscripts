import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {APP_VERSION} from '../src/model.mjs';
import {applicationBundle} from '../scripts/bundle.mjs';

const dir=new URL('../../../scripts/lingxing-ads-assistant/',import.meta.url);
test('安装入口保持小体积且不含长行，程序锁定版本并校验完整性',async()=>{
  const [entry,meta,runtime]=await Promise.all(['user','meta','runtime'].map(s=>fs.readFile(new URL(`lingxing-ads-assistant.${s}.js`,dir),'utf8')));
  assert.ok(Buffer.byteLength(entry)<4096,'Installer must not inline the Excel library or application');
  assert.ok(Math.max(...entry.split('\n').map(x=>x.length))<512,'Long lines regress the script-manager editor');
  assert.ok(entry.startsWith(meta.trimEnd()));
  const urls=[...entry.matchAll(/^\/\/ @require\s+(\S+)$/gm)].map(m=>m[1]);assert.equal(urls.length,1);
  const sha=crypto.createHash('sha256').update(runtime).digest('hex');
  assert.equal(urls[0],`https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/lingxing-ads-assistant-v${APP_VERSION}/scripts/lingxing-ads-assistant/lingxing-ads-assistant.runtime.js#sha256=${sha}`);
  assert.ok(!entry.includes('@connect'));
  assert.deepEqual([...entry.matchAll(/^\/\/ @match\s+(\S+)$/gm)].map(m=>m[1]),['https://ads.lingxing.com/amazon/*','https://ads.lingxing.com/ad_report/*']);
  const {code,templateBase64}=await applicationBundle();assert.ok(runtime.includes(code));assert.ok(runtime.includes(templateBase64));
});
test('缺失依赖不尝试无校验加载；安装页入口不运行广告代码',async()=>{
  const entry=await fs.readFile(new URL('lingxing-ads-assistant.user.js',dir),'utf8'),errors=[];
  const context={console:{error:message=>errors.push(message)}};
  vm.runInNewContext(entry,context);assert.equal(errors.length,1);assert.match(errors[0],/未加载/);
  let starts=0;vm.runInNewContext(entry,{startLingxingAdsAssistant:()=>starts++});assert.equal(starts,1);
});
