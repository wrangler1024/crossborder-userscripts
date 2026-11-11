import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient,isRateLimited,retryAfterMilliseconds} from '../src/client.mjs';
import {parseRows,AUTO_TYPES} from '../src/model.mjs';
import {initializePreview,applyPreviewQuotes,selectPreviewAuto,removePreviewKeyword,failPreviewQuotes} from '../src/preview.mjs';
import {refreshGroupValues,quoteHealth,productImageUrl} from '../src/refresh.mjs';

const profile={alias:'测试-CA',profile_id:'123',country:'CA'},asin='B000000001';
const session=()=>({epoch:0,headers:()=>({})});
const success=(data)=>({ok:true,status:200,json:async()=>({success:true,code:1,data})});
function record(){
  const r=parseRows([['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],['测试-CA','S',asin,'first\nsecond','B000000002\nB000000003\nB000000004']])[0];
  initializePreview(r,profile,{msku:'S',asin,stock:20},{auto:AUTO_TYPES.map(()=>({status:'available',lower:.5})),keywords:[{status:'available',lower:.3},{status:'none'}],targets:[{status:'available',lower:.4},{status:'none'},{status:'none'}]},'batch','2026-11-10T08:00:00Z');
  return r;
}
test('Retry-After兼容秒数和HTTP日期，缺省不猜测平台固定限额',()=>{
  const now=Date.parse('2026-11-10T08:00:00Z');
  assert.equal(retryAfterMilliseconds('2.5',now),2500);
  assert.equal(retryAfterMilliseconds('Tue, 10 Nov 2026 08:00:12 GMT',now),12000);
  assert.equal(retryAfterMilliseconds(null,now),null);assert.equal(retryAfterMilliseconds('bad',now),null);
  assert.equal(retryAfterMilliseconds('-1',now),null);
});
test('HTTP429按Retry-After保护同账户，等待期不发请求，到期可手动重试',async()=>{
  let clock=100000,calls=0;const s=session();
  const client=createClient(s,{now:()=>clock,fetcher:async()=>{calls++;return calls===1?{ok:false,status:429,headers:{get:()=> '5'},json:async()=>({message:'Too Many Requests'})}:success({bidRecommendations:[]});}});
  const request=()=>client.targetSuggestions(profile,asin,'auto',['CLOSE_MATCH']);
  await assert.rejects(request,e=>e.kind==='rate_limit'&&e.retryAt===105000&&/等待5秒/.test(e.message));
  assert.equal(client.cooldown(profile).remainingMs,5000);
  await assert.rejects(request,/限流/);assert.equal(calls,1);
  await client.targetSuggestions({...profile,profile_id:'456'},asin,'auto',['CLOSE_MATCH']);assert.equal(calls,2);
  clock=105001;assert.equal((await request())[0].status,'none');assert.equal(calls,3);
});
test('HTTP200的明确限流业务错误与失败项都触发保护，默认等待30秒',async()=>{
  for(const body of [{success:false,code:0,msg:'请求过于频繁，请稍后再试'},{success:true,code:1,data:[],reasons:[{code:'THROTTLED',message:'rate limit exceeded'}]}]){
    const client=createClient(session(),{now:()=>0,fetcher:async()=>({ok:true,status:200,json:async()=>body})});
    await assert.rejects(()=>client.targetSuggestions(profile,asin,'targets',['B000000002']),e=>e.kind==='rate_limit'&&e.retryAt===30000);
  }
});
test('普通失败和成功无结果都不伪装成限流',async()=>{
  assert.equal(isRateLimited(200,{code:0,msg:'亚马逊接口未完成此操作，请稍候重试。'}),false);
  assert.equal(isRateLimited(503,{message:'Service unavailable'}),false);
  const client=createClient(session(),{fetcher:async()=>({ok:true,status:200,json:async()=>({success:false,code:0,msg:'亚马逊接口未完成此操作，请稍候重试。'})})});
  await assert.rejects(()=>client.targetSuggestions(profile,asin,'auto',['CLOSE_MATCH']),e=>!e.kind&&/未完成/.test(e.message));
  assert.equal(client.cooldown(profile).remainingMs,0);
  const empty=createClient(session(),{fetcher:async()=>success([])});
  assert.equal((await empty.targetSuggestions(profile,asin,'targets',['B000000002']))[0].status,'none');
});
test('会话切换不把旧账户的等待期应用到新账户',async()=>{
  const s=session();let calls=0;const client=createClient(s,{now:()=>0,fetcher:async()=>{calls++;return calls===1?{ok:false,status:429,json:async()=>({})}:success({bidRecommendations:[]});}});
  await assert.rejects(()=>client.targetSuggestions(profile,asin,'auto',['CLOSE_MATCH']));
  s.epoch++;assert.equal(client.cooldown(profile).remainingMs,0);
  await client.targetSuggestions(profile,asin,'auto',['CLOSE_MATCH']);assert.equal(calls,2);
});
test('任一ASIN刷新取全组并仅请求一次，已有报价也同步更新',async()=>{
  const r=record(),values=refreshGroupValues(r,'targets');let calls=0;
  assert.deepEqual(values,r.targets);
  const client=createClient(session(),{fetcher:async()=>{calls++;return success([{asin:values[0],suggests:[{code:'SUCCESS',expression:[{type:'asinExpandedFrom',value:values[0]}],suggestedBid:{rangeStart:.83}}]},{asin:values[1],suggests:[{code:'SUCCESS',expression:[{type:'asinExpandedFrom',value:values[1]}],suggestedBid:{rangeStart:.2}}]}]);}});
  applyPreviewQuotes(r,'targets',values,await client.targetSuggestions(profile,asin,'targets',values),'2026-11-10T09:00:00Z');
  const targets=r.plan.campaigns[2].groups[0].targets;
  assert.equal(calls,1);assert.deepEqual(targets.map(t=>t.bid),[.74,.18,.4]);
  assert.ok(targets.every(t=>t.quotedAt==='2026-11-10T09:00:00Z'));
});
test('关键词刷新包含已有报价的当前词表，自动只刷新勾选项',()=>{
  const r=record();assert.deepEqual(refreshGroupValues(r,'keywords'),['first','second']);
  removePreviewKeyword(r,0);assert.deepEqual(refreshGroupValues(r,'keywords'),['second']);
  selectPreviewAuto(r,'COMPLEMENTS',false);assert.deepEqual(refreshGroupValues(r,'auto'),AUTO_TYPES.slice(0,3));
});
test('卡片缺价标识区分未返回与失败，排除剔除词和未勾选目标',()=>{
  const r=record();assert.deepEqual(quoteHealth(r),{available:6,missing:3,failed:0,total:9});
  failPreviewQuotes(r,'auto',['COMPLEMENTS'],'失败');assert.equal(quoteHealth(r).failed,1);
  selectPreviewAuto(r,'COMPLEMENTS',false);removePreviewKeyword(r,1);
  assert.deepEqual(quoteHealth(r),{available:5,missing:2,failed:0,total:7});
  r.previewValidated=false;assert.deepEqual(quoteHealth(r),{available:0,missing:0,failed:0,total:0});
});
test('商品图片仅接受ERP使用的HTTPS亚马逊图片域名',()=>{
  assert.ok(productImageUrl('https://images-cn.ssl-images-amazon.cn/images/I/image.jpg'));
  assert.ok(productImageUrl('https://m.media-amazon.com/images/I/image.jpg'));
  for(const value of ['javascript:alert(1)','http://m.media-amazon.com/x','https://amazon.com.evil.test/x',''])assert.equal(productImageUrl(value),'');
});
