import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReadOperation,createClient,ENDPOINTS,observeSession} from '../src/client.mjs';
const session={epoch:0,headers:()=>({'Content-Type':'application/json'})};
test('请求白名单拒绝写入和非原生推荐参数',()=>{assert.throws(()=>assertReadOperation('createCampaign',{}));assert.throws(()=>assertReadOperation('bids',{api_method:'post_campaigns'}));assert.throws(()=>assertReadOperation('expanded',{version:2,type:['asinSameAs']}));assert.throws(()=>assertReadOperation('expanded',{version:2,type:['asinExpandedFrom']}));assert.doesNotThrow(()=>assertReadOperation('expanded',{version:2,type:['asinExpandedFrom','asinSameAs']}));});
test('HTTP错误和业务失败不是空数据',async()=>{for(const response of [{ok:false,status:403},{ok:true,json:async()=>({success:false,code:8000,msg:'登录失效'})},{ok:true,json:async()=>({success:true,code:1,data:{}})}]){const c=createClient(session,{fetcher:async()=>response});await assert.rejects(()=>c.profiles());}});
test('商品分页直到读完，不能仅以第一页判不存在',async()=>{const requests=[];const c=createClient(session,{fetcher:async(url,opts)=>{const p=JSON.parse(opts.body);requests.push(p);return {ok:true,json:async()=>({success:true,code:1,recordsFiltered:26,data:Array.from({length:p.page===1?25:1},()=>({sku:'S'})),region:{country:'CA'}})}}});assert.equal((await c.products({profile_id:'123',country:'CA'},'S')).length,26);assert.deepEqual(requests.map(x=>x.page),[1,2]);});
test('接口返回其他站点停止',async()=>{const c=createClient(session,{fetcher:async()=>({ok:true,json:async()=>({success:true,code:1,data:[],region:{country:'UK'}})})});await assert.rejects(()=>c.products({profile_id:'1',country:'CA'},'S'),/其他站点/);});
test('请求过程中会话变化不得展示旧账号结果',async()=>{const s={...session};const c=createClient(s,{fetcher:async()=>{s.epoch++;return {ok:true,json:async()=>({success:true,code:1,data:[]})}}});await assert.rejects(()=>c.profiles(),/账号已改变/);});
test('取消读取传递abort，不产生后续请求',async()=>{let calls=0;const ctl=new AbortController();ctl.abort();const c=createClient(session,{fetcher:async()=>{calls++}});await assert.rejects(()=>c.profiles(ctl.signal),{name:'AbortError'});assert.equal(calls,0);});
test('功能权限只从原生GET读取，缺少或畸形权限数据不能视为已授权',async()=>{
  let request;const c=createClient(session,{fetcher:async(url,opts)=>{request={url,opts};return {ok:true,json:async()=>({success:true,code:1,data:['new_ad/sp/ad/create']})};}});
  assert.deepEqual(await c.permissions(),['new_ad/sp/ad/create']);assert.ok(request.url.endsWith('/get_ad_rule'));assert.equal(request.opts.method,'GET');assert.equal(request.opts.body,undefined);
  for(const data of [null,{},[1]]){const bad=createClient(session,{fetcher:async()=>({ok:true,json:async()=>({success:true,code:1,data})})});await assert.rejects(()=>bad.permissions(),/权限返回格式/);}
});
test('新广告组建议按自动、BROAD、扩展分别查询，类型不混合',async()=>{const seen=[];const c=createClient(session,{fetcher:async(url,opts)=>{const b=JSON.parse(opts.body);seen.push(b);return {ok:true,json:async()=>({success:true,code:1,data:url.endsWith('/handle')?{bidRecommendations:[]}:[]})}}});const r=await c.suggestions({profile_id:'123'},{asin:'B000000001',keywords:['a','b'],targets:['B000000002','B000000003','B000000004']});assert.equal(seen.length,3);assert.ok(seen[0].params.targetingExpressions.every(x=>!x.type.startsWith('KEYWORD')));assert.ok(seen[1].params.targetingExpressions.every(x=>x.type==='KEYWORD_BROAD_MATCH'));assert.deepEqual(seen[2].type,['asinExpandedFrom','asinSameAs']);assert.deepEqual([r.auto.length,r.keywords.length,r.targets.length],[4,2,3]);});
test('会话观察仅捕获正确网关，不持久化或暴露凭据',()=>{class XHR{open(){}setRequestHeader(){}send(){}}const changes=[];const s=observeSession({XMLHttpRequest:XHR,location:{href:'https://ads.lingxing.com/amazon/super-create'}},e=>changes.push(e));const request=(url,company)=>{const x=new XHR();x.open('POST',url);x.setRequestHeader('auth-token','fixture-session');x.setRequestHeader('x-ak-company-id',company);x.send();};request('https://example.org/pb-newad-web/test','1');assert.equal(s.ready,false);request('https://gw.lingxingerp.com/pb-newad-web/test','1');assert.equal(s.ready,true);request('https://gw.lingxingerp.com/pb-newad-web/test','2');assert.equal(s.epoch,1);assert.ok(changes.every(x=>!JSON.stringify(x).includes('fixture-session')));s.dispose();assert.equal(s.ready,false);});

test('原生商品推荐请求取得扩展报价，精准报价不能替代扩展报价',async()=>{
  const c=createClient(session,{fetcher:async(url,opts)=>{
    const b=JSON.parse(opts.body);
    if(!url.endsWith('/handle'))assert.deepEqual(b.type,['asinExpandedFrom','asinSameAs']);
    const source=[{asin:'B000000002',suggests:[
      {code:'SUCCESS',expression:[{type:'asinSameAs',value:'B000000002'}],suggestedBid:{rangeStart:.99}},
      {code:'SUCCESS',expression:[{type:'asinExpandedFrom',value:'B000000002'}],suggestedBid:{rangeStart:.18}}
    ]}];
    return {ok:true,json:async()=>({success:true,code:1,data:url.endsWith('/handle')?{bidRecommendations:[]}:source})};
  }});
  const result=await c.suggestions({profile_id:'123'},{asin:'B000000001',keywords:['curtain holders'],targets:['B000000002','B000000003','B000000004']});
  assert.equal(result.targets[0].status,'available');
  assert.equal(result.targets[0].lower,.18);
  assert.equal(result.targets[1].status,'none');
});
