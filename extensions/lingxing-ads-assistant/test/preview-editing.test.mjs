import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,AUTO_TYPES,totals,validateProduct} from '../src/model.mjs';
import {initializePreview,addPreviewKeyword,removePreviewKeyword,selectPreviewAuto,applyPreviewQuotes,failPreviewQuotes,previewQuote,previewValues,finalPreviewPlans} from '../src/preview.mjs';
import {previewDocument,previewCsv} from '../src/workbook.mjs';
import {createClient} from '../src/client.mjs';

const profile={alias:'测试-CA',profile_id:'123',country:'CA'};
const product={asin:'B000000001',msku:'SKU-A',stock:20};
const batch='2026-11-10-16:00:00';
const quotes=r=>({auto:previewValues(r,'auto').map((_,i)=>({status:'available',lower:(i+1)/10})),keywords:r.keywords.map((_,i)=>({status:'available',lower:(i+2)/10})),targets:r.targets.map(()=>({status:'none'})),errors:{}});
function row(words='first word\nsecond word',seeds='B000000002\nB000000003\nB000000004'){
  const r=parseRows([['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],[profile.alias,product.msku,product.asin,words,seeds]])[0];
  initializePreview(r,profile,product,quotes(r),batch,'2026-11-10T08:00:00Z');return r;
}
const targets=(r,type)=>r.plan.campaigns.find(c=>c.type===type)?.groups[0].targets;

test('删词和新增后，预览与JSON/CSV使用相同最终词表和逐词竞价',()=>{
  const r=row();removePreviewKeyword(r,0);
  assert.deepEqual(targets(r,'BROAD').map(t=>[t.value,t.bid]),[['second word',.27]]);
  addPreviewKeyword(r,'new word');
  assert.equal(r.status,'partial');assert.equal(targets(r,'BROAD'),undefined);
  applyPreviewQuotes(r,'keywords',['new word'],[{status:'available',lower:.51}]);
  assert.deepEqual(targets(r,'BROAD').map(t=>[t.value,t.bid]),[['second word',.27],['new word',.45]]);
  const doc=previewDocument([r]),csv=previewCsv(finalPreviewPlans([r]));
  assert.equal(doc.selectionSource,'current-preview');assert.equal(doc.plans[0].previewEdited,true);
  assert.ok(!JSON.stringify(doc).includes('first word'));assert.ok(!csv.includes('first word'));assert.ok(csv.includes('new word'));
  assert.ok(r.plan.campaigns.every(c=>c.name.endsWith(batch)));
});
test('剔除最后一个关键词减少活动和预算，手动补词可恢复该活动',()=>{
  const r=row('one word');removePreviewKeyword(r,0);
  assert.equal(r.plan.channels[1].status,'skipped');assert.equal(totals(finalPreviewPlans([r])).CAD.dailyBudget,8);
  addPreviewKeyword(r,'replacement');applyPreviewQuotes(r,'keywords',['replacement'],[{status:'none'}]);
  assert.equal(targets(r,'BROAD')[0].bid,.4);assert.equal(totals(finalPreviewPlans([r])).CAD.dailyBudget,12);
});
test('手动关键词维持5词上限、重复和长度限制，拒绝时不改变预览',()=>{
  const r=row('one\ntwo\nthree\nfour\nfive');const original=JSON.stringify(r.plan);
  for(const word of ['six',' ONE ','','x'.repeat(81),'a\nb'])assert.throws(()=>addPreviewKeyword(r,word));
  assert.equal(JSON.stringify(r.plan),original);assert.equal(r.keywords.length,5);
  removePreviewKeyword(r,4);addPreviewKeyword(r,'space word');
  assert.throws(()=>addPreviewKeyword(r,'SPACE  WORD'),/已在/);
});
test('自动勾选不串用四类报价；未勾选目标从JSON和CSV移除',()=>{
  const r=row();selectPreviewAuto(r,'LOOSE_MATCH',false);selectPreviewAuto(r,'COMPLEMENTS',false);
  assert.deepEqual(targets(r,'AUTO').map(t=>[t.type,t.bid]),[['CLOSE_MATCH',.09],['SUBSTITUTES',.27]]);
  assert.ok(!previewCsv(finalPreviewPlans([r])).includes('LOOSE_MATCH'));
  assert.ok(!JSON.stringify(previewDocument([r])).includes('COMPLEMENTS'));
  selectPreviewAuto(r,'COMPLEMENTS',true);assert.equal(targets(r,'AUTO')[2].bid,.36);
});
test('全部取消自动且无手动目标时没有空活动，重新勾选可恢复',()=>{
  const r=row('','');for(const type of AUTO_TYPES)selectPreviewAuto(r,type,false);
  assert.equal(r.status,'skipped');assert.deepEqual(finalPreviewPlans([r]),[]);
  assert.equal(previewDocument([r]).excluded.length,1);assert.equal(previewDocument([r]).issues.length,0);
  selectPreviewAuto(r,'SUBSTITUTES',true);assert.equal(r.status,'ready');assert.equal(targets(r,'AUTO').length,1);
});
test('再次校验沿用当前词表和自动勾选，不从Excel恢复删除项',async()=>{
  const r=row();removePreviewKeyword(r,0);selectPreviewAuto(r,'LOOSE_MATCH',false);
  const calls=[];const client=createClient({epoch:0,headers:()=>({})},{fetcher:async(url,o)=>{
    const body=JSON.parse(o.body);calls.push(body);return{ok:true,json:async()=>({success:true,code:1,data:url.endsWith('/handle')?{bidRecommendations:[]}:[]})};
  }});
  const next=await client.suggestions(profile,r);initializePreview(r,profile,product,next,batch);
  assert.equal(calls[0].params.targetingExpressions.length,3);
  assert.deepEqual(calls[1].params.targetingExpressions.map(e=>e.value),['second word']);
  assert.deepEqual(targets(r,'BROAD').map(t=>t.value),['second word']);
  assert.ok(!targets(r,'AUTO').some(t=>t.type==='LOOSE_MATCH'));
});
test('缺失报价刷新只替换指定目标，更新时间且保持其他价格与编辑',()=>{
  const r=row();removePreviewKeyword(r,0);selectPreviewAuto(r,'COMPLEMENTS',false);
  const before=JSON.stringify(r.plan.campaigns.filter(c=>c.type!=='EXPANDED_ASIN'));
  applyPreviewQuotes(r,'targets',['B000000002'],[{status:'available',lower:.83}],'2026-11-10T08:10:00Z');
  assert.equal(targets(r,'EXPANDED_ASIN')[0].bid,.74);assert.equal(targets(r,'EXPANDED_ASIN')[1].bid,.4);
  assert.equal(JSON.stringify(r.plan.campaigns.filter(c=>c.type!=='EXPANDED_ASIN')),before);
  assert.ok(previewCsv(finalPreviewPlans([r])).includes('2026-11-10T08:10:00Z'));
});
test('刷新失败不能继续用旧备用价导出该渠道，重试成功恢复',()=>{
  const r=row();failPreviewQuotes(r,'targets',['B000000002'],'HTTP 503');
  assert.equal(r.status,'partial');assert.equal(targets(r,'EXPANDED_ASIN'),undefined);
  assert.match(previewDocument([r]).issues[0].channels[0].reason,/503/);
  assert.ok(!previewCsv(finalPreviewPlans([r])).includes('B000000002'));
  applyPreviewQuotes(r,'targets',['B000000002'],[{status:'none'}]);assert.equal(r.status,'ready');
  assert.equal(targets(r,'EXPANDED_ASIN')[0].bid,.4);
});
test('新增词查询失败后剔除可恢复原有效关键词，不损失其他渠道',()=>{
  const r=row();addPreviewKeyword(r,'bad request');failPreviewQuotes(r,'keywords',['bad request'],'请求失败');
  assert.deepEqual(r.plan.campaigns.map(c=>c.type),['AUTO','EXPANDED_ASIN']);
  removePreviewKeyword(r,2);assert.equal(r.status,'ready');assert.equal(targets(r,'BROAD').length,2);
});
test('失效目标回包不复活已删除词，异常区间不会部分覆盖旧数据',()=>{
  const r=row();removePreviewKeyword(r,0);
  assert.throws(()=>applyPreviewQuotes(r,'keywords',['first word'],[{status:'none'}]),/已经变化/);
  const before=JSON.stringify(r.quoteBook.targets);
  assert.throws(()=>applyPreviewQuotes(r,'targets',['B000000002','B000000003'],[{status:'none'},{status:'available',lower:NaN}]),/无效/);
  assert.equal(JSON.stringify(r.quoteBook.targets),before);
});
test('未通过商品校验不可编辑，低库存保持真实数量并允许预览',()=>{
  const r=row();r.previewValidated=false;assert.throws(()=>addPreviewKeyword(r,'word'),/先通过/);
  assert.throws(()=>selectPreviewAuto(r,'CLOSE_MATCH',false),/先通过/);
  assert.equal(validateProduct(r,profile,[{profile_id:'123',sku:'SKU-A',asin:'B000000001',sku_status:'1',afn_fulfillable_quantity:0}]).stock,0);
});
test('单目标重试按对应渠道读取，扩展不借用精准报价且没有写入调用',async()=>{
  const seen=[];const client=createClient({epoch:0,headers:()=>({})},{fetcher:async(url,o)=>{seen.push({url,body:JSON.parse(o.body)});return{ok:true,json:async()=>({success:true,code:1,data:url.endsWith('/handle')?{bidRecommendations:[]}:[]})};}});
  await client.targetSuggestions(profile,product.asin,'keywords',['new word']);
  await client.targetSuggestions(profile,product.asin,'auto',['COMPLEMENTS']);
  await client.targetSuggestions(profile,product.asin,'targets',['B000000002']);
  assert.deepEqual(seen[0].body.params.targetingExpressions,[{type:'KEYWORD_BROAD_MATCH',value:'new word'}]);
  assert.deepEqual(seen[1].body.params.targetingExpressions,[{type:'COMPLEMENTS'}]);
  assert.deepEqual(seen[2].body.type,['asinExpandedFrom','asinSameAs']);
  await assert.rejects(()=>client.targetSuggestions(profile,product.asin,'campaigns',['x']));
  await assert.rejects(()=>client.targetSuggestions(profile,product.asin,'auto',[]));assert.equal(seen.length,3);
});
