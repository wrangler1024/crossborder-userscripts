import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,AUTO_TYPES,totals,assertCreationStock} from '../src/model.mjs';
import {initializePreview,applyPreviewQuotes,failPreviewQuotes,removePreviewKeyword,addPreviewKeyword,finalPreviewPlans} from '../src/preview.mjs';
import {refreshGroupValues} from '../src/refresh.mjs';
import {createRetryQueue,retryNeed} from '../src/retry.mjs';
import {createClient} from '../src/client.mjs';

const profile={alias:'测试-CA',profile_id:'123',country:'CA'};
function record(msku='SKU-A',targets=''){
  const r=parseRows([['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],[profile.alias,msku,'B000000001','word',targets]])[0];
  initializePreview(r,profile,{msku,asin:r.asin,stock:20},{auto:AUTO_TYPES.map(()=>({status:'available',lower:.5})),keywords:[{status:'none'}],targets:r.targets.map(()=>({status:'none'}))},'batch');return r;
}
test('首次重试等待10秒，提前begin也不能越过时间限制',()=>{
  let clock=0;const r=record(),q=createRetryQueue({now:()=>clock});const [job]=q.sync([r]);
  assert.equal(q.summary([r]).waiting,1);assert.equal(q.next([r]),null);assert.equal(q.begin(job),false);
  clock=9999;assert.equal(q.next([r]),null);clock=10000;assert.equal(q.next([r]),job);assert.equal(q.begin(job),true);
});
for(const stock of [0,9,20])test(`库存${stock}成功但持续无建议价最多自动重试3次，按10/30/60秒退避`,()=>{
  let clock=0;const r=record(),q=createRetryQueue({now:()=>clock});r.product.stock=stock;q.sync([r]);
  for(const [attempt,time] of [[1,10000],[2,40000],[3,100000]]){
    clock=time-1;assert.equal(q.next([r]),null);clock=time;
    const job=q.next([r]);assert.ok(job);assert.ok(q.begin(job));assert.equal(job.attempts,attempt);
    applyPreviewQuotes(r,'keywords',refreshGroupValues(r,'keywords'),[{status:'none'}]);q.finish(job,[r]);
  }
  clock=999999;assert.equal(q.next([r]),null);assert.equal(q.summary([r]).exhausted,1);assert.equal(q.jobFor(r,'keywords').attempts,3);
});
test('同一时间仅允许一个自动请求，两次自动查询至少间隔3秒',()=>{
  let clock=0;const rows=[record('A'),record('B')],q=createRetryQueue({now:()=>clock});q.sync(rows);clock=10000;
  const first=q.next(rows);q.begin(first);assert.equal(q.next(rows),null);
  q.finish(first,rows);clock=12999;assert.equal(q.next(rows),null);clock=13000;
  assert.notEqual(q.next(rows).record,first.record);
});
test('就绪缺价与部分失败都入队，已到期的失败渠道优先',()=>{
  let clock=0;const missing=record('A'),failed=record('B');failPreviewQuotes(failed,'auto',['CLOSE_MATCH'],'HTTP 503');
  const q=createRetryQueue({now:()=>clock});q.sync([missing,failed]);clock=10000;
  const job=q.next([missing,failed]);assert.equal(job.record,failed);assert.equal(job.key,'auto');
});
test('限流等待延长实际执行时间，不占用其他账户的重试机会',()=>{
  let clock=0;const a=record('A'),b=record('B');b.profile={...profile,profile_id:'456'};
  const q=createRetryQueue({now:()=>clock}),rows=[a,b],cooldown=r=>r===a?60000:0;q.sync(rows);clock=10000;
  assert.equal(q.next(rows,cooldown).record,b);
  const aJob=q.sync(rows).find(j=>j.record===a);assert.equal(q.begin(aJob,cooldown),false);
  assert.equal(q.jobFor(a,'keywords',cooldown).dueAt,60000);
});
test('删除全部待重试关键词后取消该组，新增词只使用当前清单',()=>{
  let clock=0;const r=record(),q=createRetryQueue({now:()=>clock});q.sync([r]);
  removePreviewKeyword(r,0);clock=10000;assert.equal(q.next([r]),null);
  addPreviewKeyword(r,'replacement');q.sync([r]);clock=20000;
  const job=q.next([r]);assert.ok(job);assert.deepEqual(refreshGroupValues(job.record,job.key),['replacement']);
});
test('成功补齐建议后移出等待队列，不再重试或降低原有预览完整性',()=>{
  let clock=0;const r=record(),q=createRetryQueue({now:()=>clock});failPreviewQuotes(r,'keywords',['word'],'HTTP 503');
  assert.equal(r.status,'partial');q.sync([r]);clock=10000;const job=q.next([r]);q.begin(job);
  applyPreviewQuotes(r,'keywords',['word'],[{status:'available',lower:.2}]);q.finish(job,[r]);
  assert.equal(r.status,'ready');assert.equal(totals(finalPreviewPlans([r])).CAD.dailyBudget,8);
  clock=999999;assert.equal(q.next([r]),null);assert.equal(q.summary([r]).waiting,0);
});
test('重置会使旧任务回调失效，不能修改新一轮重试计数',()=>{
  let clock=0;const old=record('OLD'),fresh=record('NEW'),q=createRetryQueue({now:()=>clock});q.sync([old]);clock=10000;
  const oldJob=q.next([old]);q.begin(oldJob);q.reset();q.sync([fresh]);clock=20000;
  const freshJob=q.next([fresh]);q.begin(freshJob);q.finish(oldJob,[old]);
  assert.equal(q.summary([fresh]).running,1);assert.equal(freshJob.attempts,1);assert.equal(q.next([fresh]),null);
});
for(const stock of [0,1,9,10])test(`有效库存${stock}的三类建议价失败均可进入自动队列`,()=>{
  const r=record('SKU-LOW-STOCK','B000000002\nB000000003\nB000000004');r.product.stock=stock;
  for(const key of ['auto','keywords','targets']){
    failPreviewQuotes(r,key,refreshGroupValues(r,key),'亚马逊接口未完成此操作');
    assert.ok(retryNeed(r,key)?.failed>0);
  }
  const q=createRetryQueue({now:()=>0});
  assert.deepEqual(q.sync([r]).map(job=>job.key),['auto','keywords','targets']);
  assert.equal(q.summary([r]).waiting,3);
});
test('零库存自动补齐建议价后恢复三活动预览，仍只能暂停创建',()=>{
  let clock=0;const r=record('SKU-ZERO','B000000002\nB000000003\nB000000004');r.product.stock=0;
  for(const key of ['keywords','targets'])applyPreviewQuotes(r,key,refreshGroupValues(r,key),refreshGroupValues(r,key).map(()=>({status:'available',lower:.3})));
  failPreviewQuotes(r,'auto',refreshGroupValues(r,'auto'),'亚马逊接口未完成此操作');
  assert.equal(r.plan.campaigns.length,2);
  const q=createRetryQueue({now:()=>clock});q.sync([r]);clock=10000;
  const job=q.next([r]);assert.ok(job);assert.equal(job.key,'auto');assert.ok(q.begin(job));
  const values=refreshGroupValues(r,job.key);applyPreviewQuotes(r,job.key,values,values.map(()=>({status:'available',lower:.3})));q.finish(job,[r]);
  assert.equal(r.plan.campaigns.length,3);assert.equal(r.status,'ready');assert.equal(q.summary([r]).waiting,0);
  assert.equal(r.plan.effectiveParameters.creationState,'paused_only');assertCreationStock(r.product.stock,'paused');
  assert.throws(()=>assertCreationStock(r.product.stock,'enabled'),/仅可创建暂停/);
});
test('无效库存、身份、格式及明确不可重试错误不会进入自动队列',()=>{
  const invalidStock=[undefined,null,'','0',false,true,NaN,Infinity,-1,.5];
  for(const alter of [r=>{r.previewValidated=false;},r=>{r.profile=null;},r=>{r.product=null;},...invalidStock.map(stock=>r=>{r.product.stock=stock;}),r=>{r.issues=['MSKU错误'];},r=>{r.channelIssues.keywords=['重复'];},r=>failPreviewQuotes(r,'keywords',['word'],Object.assign(new Error('HTTP 403'),{retryable:false}))]){
    const r=record();alter(r);assert.equal(retryNeed(r,'keywords'),null);
    const q=createRetryQueue();assert.equal(q.summary([r]).waiting,0);
  }
});
test('HTTP429恢复期间不重复发网，也不把等待算作已尝试次数',async()=>{
  let clock=0,calls=0;const r=record(),q=createRetryQueue({now:()=>clock});
  const client=createClient({epoch:0,headers:()=>({})},{now:()=>clock,fetcher:async()=>{calls++;return calls===1?{ok:false,status:429,headers:{get:()=> '60'},json:async()=>({})}:{ok:true,status:200,json:async()=>({success:true,code:1,data:{bidRecommendations:[]}})};}});
  const cooldown=()=>client.cooldown(profile).until;q.sync([r]);clock=10000;
  let job=q.next([r],cooldown);q.begin(job,cooldown);
  try{await client.targetSuggestions(profile,r.asin,'keywords',['word']);}catch(e){failPreviewQuotes(r,'keywords',['word'],e);}q.finish(job,[r]);
  clock=40000;assert.equal(q.next([r],cooldown),null);assert.equal(calls,1);assert.equal(q.jobFor(r,'keywords').attempts,1);
  clock=70000;job=q.next([r],cooldown);assert.ok(q.begin(job,cooldown));
  applyPreviewQuotes(r,'keywords',['word'],await client.targetSuggestions(profile,r.asin,'keywords',['word']));q.finish(job,[r]);assert.equal(calls,2);
});
test('HTTP401/403与登录失效传递不可重试信息，普通上游错误仍可重试',async()=>{
  for(const [response,expected] of [[{ok:false,status:401},false],[{ok:false,status:403},false],[{ok:true,status:200,json:async()=>({success:false,code:8000,msg:'登录失效'})},false],[{ok:true,status:200,json:async()=>({success:false,code:0,msg:'亚马逊接口未完成此操作'})},true]]){
    const client=createClient({epoch:0,headers:()=>({})},{fetcher:async()=>response});const r=record();
    const suggestions=await client.suggestions(profile,r);initializePreview(r,profile,r.product,suggestions,'batch');
    assert.equal(!!retryNeed(r,'keywords'),expected);
  }
});
