import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,channelInputs,buildPlan,totals} from '../src/model.mjs';
import {createClient} from '../src/client.mjs';
import {previewDocument,previewCsv} from '../src/workbook.mjs';
const header=['店铺','主推MSKU','主推ASIN','广泛关键词','扩展ASIN'];
const seeds='B000000002\nB000000003\nB000000004';
const record=(words='',targets='')=>parseRows([header,['测试-CA','SKU-A','B000000001',words,targets]])[0];
const profile={alias:'测试-CA',profile_id:'123',country:'CA'};
const product={asin:'B000000001',msku:'SKU-A',stock:20};
const quotes=r=>({auto:Array.from({length:4},()=>({status:'none'})),keywords:r.keywords.map(()=>({status:'none'})),targets:r.targets.map(()=>({status:'none'})),errors:{}});
const plan=(r,q=quotes(r))=>buildPlan(r,profile,product,q,'2026-11-10-16:00:00');
test('两种手动输入留空只生成自动，预算按一个活动计',()=>{
  const r=record(' \n','');assert.deepEqual(r.issues,[]);
  const p=plan(r);assert.deepEqual(p.campaigns.map(c=>c.type),['AUTO']);
  assert.deepEqual(p.channels.map(c=>c.status),['ready','skipped','skipped']);
  assert.equal(p.campaigns[0].groups[0].targets.length,4);
  assert.deepEqual(totals([p]),{CAD:{products:1,campaigns:1,dailyBudget:4}});
});
test('单独补词、单独补ASIN与全部填写分别生成2、2、3活动',()=>{
  for(const [words,targets,types] of [
    ['curtain brackets','',['AUTO','BROAD']],
    ['',seeds,['AUTO','EXPANDED_ASIN']],
    ['curtain brackets',seeds,['AUTO','BROAD','EXPANDED_ASIN']]
  ]){const p=plan(record(words,targets));assert.deepEqual(p.campaigns.map(c=>c.type),types);assert.equal(totals([p]).CAD.dailyBudget,types.length*4);}
});
test('有错的手动渠道单独阻止，不能当作留空，也不影响有效渠道',()=>{
  const r=record('word\nWORD','B000000002');
  assert.deepEqual(r.issues,[]);
  const p=plan(r);assert.equal(p.campaigns.length,1);
  assert.deepEqual(p.channels.map(c=>c.status),['ready','blocked','blocked']);
  assert.match(p.channels[1].reason,/重复/);assert.match(p.channels[2].reason,/3–5/);
});
test('主推MSKU缺失仍然阻止整行，不从ASIN猜测商品身份',()=>{
  const r=parseRows([header,['测试-CA','','B000000001','','']])[0];
  assert.match(r.issues.join('；'),/主推MSKU不能为空/);assert.throws(()=>plan(r),/主推MSKU不能为空/);
});
test('手动列含公式只阻止对应渠道，不能将公式缓存值按正常目标读取',()=>{
  const r=parseRows([header,['测试-CA','SKU-A','B000000001','brackets',seeds]],{formulaCells:new Set(['1:3'])})[0];
  assert.deepEqual(channelInputs(r).map(c=>c.status),['pending','blocked','pending']);
  assert.deepEqual(plan(r).campaigns.map(c=>c.type),['AUTO','EXPANDED_ASIN']);
});
test('仅自动时不查询关键词与商品池；渠道有错时不请求该渠道',async()=>{
  for(const r of [record(),record('one\nONE','bad')]){
    const calls=[];const client=createClient({epoch:0,headers:()=>({})},{fetcher:async(url,o)=>{calls.push({url,body:JSON.parse(o.body)});return {ok:true,json:async()=>({code:1,success:true,data:{bidRecommendations:[]}})};}});
    const q=await client.suggestions(profile,r);
    assert.equal(calls.length,1);assert.equal(calls[0].body.params.targetingExpressions[0].type,'CLOSE_MATCH');
    assert.equal(q.keywords.length,0);assert.equal(q.targets.length,0);assert.equal(plan(r,q).campaigns.length,1);
  }
});
test('关键词查询失败保留自动和商品预览，不给失败渠道套备用价',async()=>{
  const r=record('brackets',seeds),calls=[];
  const client=createClient({epoch:0,headers:()=>({})},{fetcher:async(url,o)=>{
    const body=JSON.parse(o.body);calls.push(body);
    if(body.params?.targetingExpressions[0].type==='KEYWORD_BROAD_MATCH')return {ok:false,status:503};
    return {ok:true,json:async()=>({success:true,code:1,data:url.endsWith('/handle')?{bidRecommendations:[]}:[]})};
  }});
  const q=await client.suggestions(profile,r),p=plan(r,q);
  assert.equal(calls.length,3);assert.match(q.errors.keywords,/HTTP 503/);
  assert.deepEqual(p.campaigns.map(c=>c.type),['AUTO','EXPANDED_ASIN']);
  assert.equal(p.channels[1].status,'blocked');
  const exported=previewDocument([{...r,plan:p,status:'partial'}]);
  assert.equal(exported.plans.length,1);assert.match(exported.issues[0].channels[0].reason,/HTTP 503/);
  assert.ok(!previewCsv(exported.plans).includes('手动-关键词'));
});
