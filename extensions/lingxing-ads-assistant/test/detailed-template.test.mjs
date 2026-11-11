import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {DETAIL_HEADERS,DETAIL_PARAMETERS,detailDefaultRow} from '../src/template-spec.mjs';
import {parseRows,buildPlan,SITES} from '../src/model.mjs';
import {readWorkbook,readSheet} from '../src/workbook.mjs';
const XLSX=createRequire(import.meta.url)('../vendor/xlsx.full.min.cjs');
const targets='B000000002\nB000000003\nB000000004';
const row=()=>{const r=detailDefaultRow();r.splice(0,5,'测试-CA','SKU-A','B000000001','curtain brackets',targets);return r;};
const record=()=>parseRows([DETAIL_HEADERS,row()])[0];
const quotes=r=>({auto:Array.from({length:4},()=>({status:'available',lower:.8})),keywords:r.keywords.map(()=>({status:'none'})),targets:r.targets.map(()=>({status:'none'}))});
test('新版五个手填表头与旧SITE/TARGET_ASINS均可识别',()=>{
  assert.deepEqual(record().issues,[]);assert.equal(record().targets.length,3);
  const h=DETAIL_HEADERS.map(x=>x==='店铺'?'SITE':x==='TARGET_ASIN'?'TARGET_ASINS':x);
  assert.deepEqual(parseRows([h,row()])[0].issues,[]);
  assert.throws(()=>parseRows([[...DETAIL_HEADERS,'TARGET_ASINS'],[...row(),targets]]),/表头重复/);
});
test('预填默认参数的100个空行不被识别成商品',()=>{
  const r=row();r[3]='';r[4]='';
  assert.equal(parseRows([DETAIL_HEADERS,...Array.from({length:100},detailDefaultRow)]).length,0);
  const actual=parseRows([DETAIL_HEADERS,detailDefaultRow(),r,detailDefaultRow()]);
  assert.equal(actual.length,1);assert.equal(actual[0].row,3);assert.deepEqual(actual[0].issues,[]);
});
test('首轮详细参数缺省与留空都采用四站既定预算和竞价规则',()=>{
  for(const clear of [false,true])for(const [country,config] of Object.entries(SITES)){
    const data=row();if(clear)data.fill('',5);
    const r=parseRows([DETAIL_HEADERS,data])[0];assert.deepEqual(r.issues,[]);
    const plan=buildPlan(r,{alias:r.site,profile_id:'123',country},{msku:r.msku,asin:r.asin,stock:10},quotes(r),'2026-11-10-18:00:00');
    assert.equal(plan.campaigns.length,3);assert.ok(plan.campaigns.every(c=>c.budget===config.budget));
    assert.equal(plan.campaigns[0].groups[0].targets[0].bid,.72);
    assert.equal(plan.campaigns[1].groups[0].targets[0].bid,config.budget/10);
    assert.equal(plan.effectiveParameters.state,'仅预览');
  }
});
test('旧手填竞价、策略、启停和自定义后缀冲突时不静默覆盖',()=>{
  for(const [name,value] of [['AUTO_BID',2],['BROAD_BID',0],['ASIN_BID',.4],['STRATEGY','固定竞价'],['AUTO','NO'],['STATUS','启用'],['ASIN_SUFFIX','-asin'],['DAILY_BUDGET',99]]){
    const data=row();data[DETAIL_HEADERS.indexOf(name)]=value;
    const r=parseRows([DETAIL_HEADERS,data])[0];assert.ok(r.issues.some(s=>s.startsWith(name+'=')),name);
    assert.throws(()=>buildPlan(r,{country:'CA'}, {},quotes(r),'t'),/默认模型/);
  }
});
test('原表类目与精准保留列不会产生额外活动',()=>{
  for(const p of DETAIL_PARAMETERS.filter(p=>p.allowed.length===0)){
    const data=row();data[DETAIL_HEADERS.indexOf(p.name)]='old-value';
    assert.ok(parseRows([DETAIL_HEADERS,data])[0].issues.some(s=>s.includes(p.name)&&s.includes('留空')));
  }
});
test('详细参数公式和重复表头被识别，不能读缓存值放行',()=>{
  const col=DETAIL_HEADERS.indexOf('AUTO_BID');
  assert.match(parseRows([DETAIL_HEADERS,row()],{formulaCells:new Set([`1:${col}`])})[0].issues.join(' '),/AUTO_BID含公式/);
  assert.throws(()=>parseRows([[...DETAIL_HEADERS,'AUTO_BID'],[...row(),'自动计算']]),/表头重复/);
});
test('交付的真实Excel可导入，填前五列就生成完整三活动',()=>{
  const bytes=fs.readFileSync(new URL('../assets/广告创建详细参数模板.xlsx',import.meta.url));
  const book=readWorkbook(XLSX,bytes,'template.xlsx');
  assert.deepEqual(book.SheetNames,['广告导入','默认参数']);
  assert.deepEqual(readSheet(XLSX,book,'广告导入'),[]);
  XLSX.utils.sheet_add_aoa(book.Sheets['广告导入'],[row().slice(0,5)],{origin:'A2'});
  const [r]=readSheet(XLSX,book,'广告导入');assert.deepEqual(r.issues,[]);
  const p=buildPlan(r,{alias:r.site,profile_id:'123',country:'CA'},{msku:r.msku,asin:r.asin,stock:20},quotes(r),'t');
  assert.deepEqual(p.campaigns.map(c=>c.type),['AUTO','BROAD','EXPANDED_ASIN']);
});
