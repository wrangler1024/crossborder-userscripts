import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from '../vendor/xlsx.full.min.cjs';
import {parseRows,AUTO_TYPES} from '../src/model.mjs';
import {initializePreview,removePreviewKeyword,addPreviewKeyword,selectPreviewAuto,applyPreviewQuotes,failPreviewQuotes,finalPreviewPlans} from '../src/preview.mjs';
import {previewSnapshot,restorePreview,previewScope,createDraftStore} from '../src/persistence.mjs';
import {createStorageService} from '../extension/storage-service.mjs';
import {readSheet,previewDocument} from '../src/workbook.mjs';
import {observeSession} from '../src/client.mjs';

const grid=[['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],['测试-CA','SKU-1','B000000001','rug pad\nrug tape','B000000002\nB000000003\nB000000004']];
function fixture(){
  const r=parseRows(grid,{sheet:'广告导入'})[0],profile={alias:r.site,profile_id:'123',country:'CA',real_status:1};
  initializePreview(r,profile,{msku:r.msku,asin:r.asin,stock:20,title:'测试商品',image:'https://example.com/a.jpg'}, {auto:AUTO_TYPES.map(()=>({status:'available',lower:.25})),keywords:r.keywords.map(()=>({status:'available',lower:.3})),targets:r.targets.map(()=>({status:'none'}))},'2026-11-10-17:00:00','2026-11-10T09:00:00Z');
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(grid),'广告导入');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(grid),'第二页');
  return {records:[r],book,fileName:'测试.xlsx',sheet:'广告导入',batchTime:r.batchTime,active:0};
}
function memoryService(){
  const data={};let rev=0;
  const storage={get:async key=>structuredClone({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value))};
  return {data,storage,request:createStorageService(storage,{revision:()=>String(++rev),now:()=> '2026-11-10T10:00:00Z'})};
}
const scopeA='a'.repeat(64),scopeB='b'.repeat(64);

test('刷新恢复已导入工作表、建议价、活动名、关键词增删和自动勾选，导出逐项一致',()=>{
  const state=fixture(),r=state.records[0];
  removePreviewKeyword(r,0);addPreviewKeyword(r,'rug corner');applyPreviewQuotes(r,'keywords',r.keywords,r.keywords.map(()=>({status:'available',lower:.42})));
  selectPreviewAuto(r,'COMPLEMENTS',false);r.keywordDraft='未提交文字';
  const restored=restorePreview(JSON.parse(JSON.stringify(previewSnapshot(state))));
  assert.deepEqual(previewDocument(restored.records),previewDocument(state.records));
  assert.equal(restored.batchTime,state.batchTime);assert.equal(restored.fileName,'测试.xlsx');assert.equal(restored.records[0].keywordDraft,'未提交文字');
  assert.equal(restored.autoRetryEnabled,false);assert.deepEqual(readSheet(XLSX,restored.book,'第二页'),readSheet(XLSX,state.book,'第二页'));
});
test('部分预览和无建议价保持原状态，不把接口失败变成备用价',()=>{
  const state=fixture();failPreviewQuotes(state.records[0],'keywords',state.records[0].keywords,'HTTP 503');
  const restored=restorePreview(previewSnapshot(state));
  assert.equal(restored.records[0].status,'partial');assert.equal(finalPreviewPlans(restored.records)[0].campaigns.length,2);
  assert.equal(restored.records[0].quoteBook.keywords['rug pad'].status,'error');assert.equal(restored.records[0].quoteBook.targets.B000000002.status,'none');
});
test('保存只允许业务字段，去除会话、令牌、运行对象和原始ERP返回',()=>{
  const state=fixture();state.token='secret';state.controller={headers:{token:'secret'}};state.records[0].headers={token:'secret'};state.records[0].profile.token='secret';state.records[0].product.raw={token:'secret'};state.book.Props={Author:'secret'};state.book.Sheets['广告导入'].A1.l={Target:'secret'};
  const raw=JSON.stringify(previewSnapshot(state));assert.ok(!raw.includes('secret'));assert.ok(!raw.includes('controller'));assert.ok(!raw.includes('"plan"'));
});
test('校验中断的记录恢复为待校验，不自动重发请求',()=>{
  const state=fixture();Object.assign(state.records[0],{status:'checking',previewValidated:false,plan:null,product:null,profile:null});
  const restored=restorePreview(previewSnapshot(state));assert.equal(restored.records[0].status,'pending');assert.equal(restored.autoRetryEnabled,false);
});
test('损坏、版本不兼容和身份错配预览不恢复',()=>{
  for(const alter of [s=>s.schema=99,s=>s.model='old',s=>s.records=null,s=>s.records[0].product.msku='OTHER',s=>s.records[0].profile.alias='OTHER',s=>s.book=null]){
    const snapshot=previewSnapshot(fixture());alter(snapshot);assert.throws(()=>restorePreview(snapshot));
  }
});
test('空表、错误行和工作表公式也能保留，公式不能通过持久化绕过校验',()=>{
  const state=fixture();state.book.Sheets['第二页'].B2.f='1+1';state.records=[];
  const restored=restorePreview(previewSnapshot(state));assert.equal(restored.records.length,0);
  assert.ok(readSheet(XLSX,restored.book,'第二页')[0].issues.some(x=>x.includes('公式')));
});
test('本地隔离标识稳定，不受token刷新影响，缺少用户身份不降级为企业共享',async()=>{
  class XHR{open(){}setRequestHeader(){}send(){}}
  const s=observeSession({XMLHttpRequest:XHR,location:{href:'https://ads.lingxing.com/amazon/a'}});
  const capture=(user,token)=>{const x=new XHR();x.open('GET','https://gw.lingxingerp.com/pb-newad-web/a');for(const [k,v] of Object.entries({'auth-token':token,'x-ak-company-id':'company',...(user?{'x-ak-uid':user}:{})}))x.setRequestHeader(k,v);x.send();};
  capture('', 't1');assert.equal(s.identity,null);capture('u1','t1');const first=await previewScope(s.identity);capture('u1','t2');assert.equal(await previewScope(s.identity),first);capture('u2','t3');assert.notEqual(await previewScope(s.identity),first);assert.ok(!s.identity.includes('t3'));s.dispose();
});
test('不同账号分别保存；新实例直接加载保存快照',async()=>{
  const {request}=memoryService(),store=createDraftStore({request});await store.connect(scopeA);await store.save(previewSnapshot(fixture()));
  const other=createDraftStore({request});assert.equal(await other.connect(scopeB),null);
  const fresh=createDraftStore({request});const restored=restorePreview(await fresh.connect(scopeA));assert.equal(restored.records[0].msku,'SKU-1');
});
test('多页面过期写入被拒绝，不能覆盖较新的手动调整',async()=>{
  const {request}=memoryService(),a=createDraftStore({request}),statuses=[],b=createDraftStore({request,onStatus:s=>statuses.push(s)});
  await a.connect(scopeA);await b.connect(scopeA);const state=fixture();await a.save(previewSnapshot(state));
  state.records[0].keywordDraft='stale';await b.save(previewSnapshot(state));assert.equal(statuses.at(-1).phase,'error');assert.match(statuses.at(-1).error,/另一页面/);
  assert.notEqual((await request({action:'read',scope:scopeA})).draft.records[0].keywordDraft,'stale');
});
test('清除仅删除当前账号，旧页面不能复活草稿，自动保存暂停而显式保存可恢复',async()=>{
  const {request}=memoryService(),store=createDraftStore({request}),other=createDraftStore({request}),snapshot=previewSnapshot(fixture());
  await store.connect(scopeA);await store.save(snapshot);const old=await request({action:'read',scope:scopeA});
  await other.connect(scopeB);await other.save(snapshot);await store.clear();
  await assert.rejects(()=>request({action:'write',scope:scopeA,revision:old.revision,draft:snapshot}),/另一页面/);
  await store.save(snapshot);assert.equal((await request({action:'read',scope:scopeA})).draft,null);assert.ok((await request({action:'read',scope:scopeB})).draft);
  await store.save(snapshot,{explicit:true});assert.ok((await request({action:'read',scope:scopeA})).draft);
});
test('连续调整在在途保存结束后保存最新结果，不丢最后一次编辑',async()=>{
  const base=memoryService();let release;const gate=new Promise(r=>release=r),statuses=[];let writes=0;
  const store=createDraftStore({request:async req=>{if(req.action==='write'&&++writes===1)await gate;return base.request(req);},onStatus:s=>statuses.push(s)});
  await store.connect(scopeA);const state=fixture();const first=store.save(previewSnapshot(state));await Promise.resolve();
  state.records[0].keywordDraft='latest';store.save(previewSnapshot(state));release();await first;
  assert.equal((await base.request({action:'read',scope:scopeA})).draft.records[0].keywordDraft,'latest');assert.equal(statuses.at(-1).phase,'saved');
});
test('账号切换后旧加载/保存回调不影响新账号显示',async()=>{
  const base=memoryService();let release;const gate=new Promise(r=>release=r),statuses=[];
  const store=createDraftStore({request:async req=>{if(req.scope===scopeA)await gate;return base.request(req);},onStatus:s=>statuses.push(s)});
  const old=store.connect(scopeA);await store.connect(scopeB);release();assert.equal(await old,null);assert.equal(statuses.at(-1).phase,'empty');
});
test('容量错误不会显示已保存，之前的快照保持，显式重试可保存',async()=>{
  const base=memoryService();let fail=false;const statuses=[];
  const request=createStorageService({...base.storage,set:async data=>{if(fail)throw new Error('quota');return base.storage.set(data);}});
  const store=createDraftStore({request,onStatus:s=>statuses.push(s)});await store.connect(scopeA);const state=fixture();await store.save(previewSnapshot(state));
  fail=true;state.records[0].keywordDraft='new';await store.save(previewSnapshot(state));assert.equal(statuses.at(-1).phase,'error');assert.notEqual((await request({action:'read',scope:scopeA})).draft.records[0].keywordDraft,'new');
  fail=false;await store.save(previewSnapshot(state),{explicit:true});assert.equal(statuses.at(-1).phase,'saved');
});
test('存储服务拒绝任意key、任意动作和超大快照',async()=>{
  const {request}=memoryService();await assert.rejects(()=>request({action:'clearAll',scope:scopeA}));await assert.rejects(()=>request({action:'write',scope:'other-key'}));
  await assert.rejects(()=>request({action:'write',scope:scopeA,draft:{schema:1,text:'x'.repeat(4*1024*1024)}}),/容量/);
});
