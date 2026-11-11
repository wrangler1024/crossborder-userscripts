import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import XLSX from '../vendor/xlsx.full.min.cjs';
import {createUserscriptTransport} from '../userscript/storage.mjs';
import {claimAssistantRuntime} from '../src/runtime.mjs';
import {validateBackup,BACKUP_KIND} from '../src/backup.mjs';
import {parseRows,AUTO_TYPES,MODEL_VERSION} from '../src/model.mjs';
import {initializePreview} from '../src/preview.mjs';
import {previewSnapshot,restorePreview} from '../src/persistence.mjs';
import {creationCandidates,buildCreationPayload,executionFingerprint,executionKey} from '../src/execution.mjs';
import {createStorageService} from '../extension/storage-service.mjs';

const scope='a'.repeat(64);
function fixture(){
  const grid=[['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],['测试-CA','SKU-A','B000000001','rug pad\nrug tape','B000000002\nB000000003\nB000000004']];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(grid),'广告导入');
  const r=parseRows(grid,{sheet:'广告导入'})[0],profile={alias:r.site,profile_id:'123',country:'CA'};
  initializePreview(r,profile,{asin:r.asin,msku:r.msku,stock:20},{auto:AUTO_TYPES.map(()=>({status:'none'})),keywords:r.keywords.map(()=>({status:'none'})),targets:r.targets.map(()=>({status:'none'}))},'2026-11-11-12:00:00');
  return {records:[r],book,sheet:'广告导入',fileName:'test.xlsx',batchTime:r.batchTime,active:0};
}
async function entry(status='complete'){
  const item=creationCandidates(fixture().records)[0],payload=buildCreationPayload(item,{state:'paused',startDate:'2026-11-11'});
  return {key:executionKey(item),item,payload,payloadHash:await executionFingerprint(payload),owner:'test',revision:'old',status,accepted:true,campaignId:'101',adGroupId:'102'};
}
async function portable(status='complete'){return {kind:BACKUP_KIND,schema:1,model:MODEL_VERSION,scope,draft:previewSnapshot(fixture()),entries:[await entry(status)]};}
function environment(){
  let tail=Promise.resolve();const locks={request:(_name,_options,run)=>{const current=tail.then(run);tail=current.catch(()=>{});return current;}};
  const win={indexedDB:new IDBFactory(),navigator:{locks},setTimeout,clearTimeout};
  return {win,open:()=>createUserscriptTransport({win})};
}
test('两种发行版在同一页面只认领一次，释放后才可重新启动',()=>{
  const win={document:{getElementById:()=>null}};const release=claimAssistantRuntime(win,'extension');
  assert.equal(typeof release,'function');assert.equal(claimAssistantRuntime(win,'userscript'),null);release();assert.ok(claimAssistantRuntime(win,'userscript'));
  assert.equal(claimAssistantRuntime({document:{getElementById:()=>({})}},'userscript'),null);
});
test('油猴跨实例存储可恢复预览，账号隔离且旧版本不能覆盖新保存',async()=>{
  const env=environment(),a=env.open(),b=env.open(),draft=previewSnapshot(fixture());
  const saved=await a.request({action:'write',scope,revision:null,draft});
  assert.deepEqual((await b.request({action:'read',scope})).draft,structuredClone(draft));
  assert.equal(await b.request({action:'read',scope:'b'.repeat(64)}),null);
  await assert.rejects(b.request({action:'write',scope,revision:null,draft}),/另一页面/);
  await b.request({action:'clear',scope,revision:saved.revision});assert.equal((await a.request({action:'read',scope})).draft,null);
});
test('油猴两个独立页面争用同一创建记录，最多一个进入提交；重开后不可再认领',async()=>{
  const env=environment(),a=env.open(),b=env.open(),value=await entry();
  const claims=await Promise.all([a,b].map((api,i)=>api.request({action:'execution_claim',scope,...value,owner:String(i)})));
  const updates=await Promise.allSettled(claims.map((c,i)=>[a,b][i].request({action:'execution_update',scope,key:c.entry.key,revision:c.entry.revision,patch:{status:'submitting'}})));
  assert.equal(updates.filter(r=>r.status==='fulfilled').length,1);
  const repeat=await env.open().request({action:'execution_claim',scope,...value});assert.equal(repeat.claimed,false);assert.equal(repeat.entry.status,'submitting');
});
test('油猴缺少跨页面锁或数据库失败时不会降级为无保护的存储',async()=>{
  const noLock=createUserscriptTransport({win:{setTimeout,clearTimeout},locks:null,indexedDB:new IDBFactory()});
  await assert.rejects(noLock.request({action:'read',scope}),/防重保护/);
  const env=environment(),broken=createUserscriptTransport({win:env.win,indexedDB:{open(){throw new Error('blocked storage');}}});
  await assert.rejects(broken.request({action:'execution_claim',scope,...await entry()}),/blocked storage/);
});
test('油猴入口设置跨页面恢复，设置写入不影响预览或创建记录',async()=>{
  const env=environment(),a=env.open(),b=env.open();await a.request({action:'write',scope,revision:null,draft:previewSnapshot(fixture())});
  await Promise.all([a.preferences('write',{hidden:true}),b.preferences('write',{position:.8})]);
  assert.deepEqual(await env.open().preferences('read'),{hidden:true,position:.8});assert.ok((await b.request({action:'read',scope})).draft);
});
test('备份恢复保留预览与创建内容，剔除未列入白名单的信息，未完成记录不重新发送',async()=>{
  const value=await portable('checking');value.secret='remove';value.entries[0].item.headers={token:'remove'};value.draft.records[0].headers={token:'remove'};
  const clean=await validateBackup(value,scope);assert.ok(!JSON.stringify(clean).includes('remove'));assert.equal(clean.entries[0].status,'unknown');
  assert.deepEqual(creationCandidates(restorePreview(clean.draft).records).map(x=>x.campaign),creationCandidates(restorePreview(value.draft).records).map(x=>x.campaign));
  for(const status of ['submitting','not_sent'])assert.equal((await validateBackup(await portable(status),scope)).entries[0].status,'unknown');
});
test('备份错误账号、损坏负载、哈希和重复创建记录全部拒绝',async()=>{
  for(const mutate of [v=>v.scope='b'.repeat(64),v=>v.entries[0].payload.budget='400',v=>v.entries[0].payloadHash='0'.repeat(64),v=>v.entries.push(v.entries[0]),v=>v.entries[0].status='retry']){
    const value=await portable();mutate(value);await assert.rejects(validateBackup(value,scope));
  }
});
test('Chrome重排保存对象键后仍可迁移，数组顺序和字段内容仍严格核对',async()=>{
  const value=await portable();
  const reordered=v=>Array.isArray(v)?v.map(reordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,reordered(v[k])])):v;
  assert.equal((await validateBackup(reordered(value),scope)).entries[0].payloadHash,value.entries[0].payloadHash);
  const altered=reordered(value);altered.entries[0].payload.groups[0].campaigns[0].ad_groups[0].targets.reverse();
  await assert.rejects(validateBackup(altered,scope),/校验失败/);
});
test('跨发行版导入备份后已提交名称仍被阻止，新预览和创建记录同时可读',async()=>{
  const env=environment(),target=env.open(),backup=await validateBackup(await portable(),scope);
  await target.request({action:'backup_import',scope,revision:null,backup});
  const restored=await target.request({action:'backup_export',scope});assert.equal(restored.entries.length,1);assert.equal(restored.entries[0].status,'complete');assert.deepEqual(restored.draft,structuredClone(backup.draft));
  assert.equal((await target.request({action:'execution_claim',scope,...await entry()})).claimed,false);
});
test('导入备份不降低已有创建状态，同名不同负载或旧预览版本不部分覆盖',async()=>{
  const env=environment(),api=env.open(),complete=await validateBackup(await portable(),scope);
  await api.request({action:'backup_import',scope,revision:null,backup:complete});const before=await api.request({action:'backup_export',scope});
  const unknown=await validateBackup(await portable('not_sent'),scope);
  await api.request({action:'backup_import',scope,revision:before.revision,backup:unknown});assert.equal((await api.request({action:'execution_read',scope})).entries[0].status,'complete');
  const current=await api.request({action:'backup_export',scope});
  await assert.rejects(api.request({action:'backup_import',scope,revision:before.revision,backup:unknown}),/另一页面/);
  const conflict=structuredClone(unknown);conflict.entries[0].payloadHash='f'.repeat(64);
  await assert.rejects(api.request({action:'backup_import',scope,revision:current.revision,backup:conflict}),/不同/);
  assert.deepEqual(await api.request({action:'backup_export',scope}),current);
});
test('备份预览保存失败时已恢复的防重记录仍然保留',async()=>{
  const data={};const request=createStorageService({get:async key=>({[key]:data[key]}),set:async values=>{if(Object.keys(values).some(k=>k.startsWith('ads-preview')))throw new Error('disk full');Object.assign(data,values);}});
  await assert.rejects(request({action:'backup_import',scope,revision:null,backup:await validateBackup(await portable(),scope)}),/disk full/);
  assert.equal((await request({action:'execution_read',scope})).entries[0].status,'complete');
});
