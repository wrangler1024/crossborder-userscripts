import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,AUTO_TYPES} from '../src/model.mjs';
import {initializePreview,failPreviewQuotes,applyPreviewQuotes,selectPreviewAuto,removePreviewKeyword} from '../src/preview.mjs';
import {previewAvailability,validationOverview} from '../src/validation.mjs';
import {previewSnapshot,restorePreview} from '../src/persistence.mjs';
const header=['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'];
const profile={alias:'测试-CA',profile_id:'123',country:'CA'};
function row(words='word',targets='B000000002\nB000000003\nB000000004'){
  const r=parseRows([header,[profile.alias,'SKU-TEST','B000000001',words,targets]],{sheet:'广告导入'})[0];
  initializePreview(r,profile,{msku:r.msku,asin:r.asin,stock:20},{auto:AUTO_TYPES.map(()=>({status:'none'})),keywords:r.keywords.map(()=>({status:'none'})),targets:r.targets.map(()=>({status:'none'}))},'batch');return r;
}
test('无建议区间使用备用价，三活动均可预览，不计为未生成',()=>{
  const r=row(),s=previewAvailability(r);assert.equal(s.requested,3);assert.equal(s.generated,3);assert.equal(s.status,'ready');assert.deepEqual(s.failures,[]);
});
test('重复ASIN与数量不足各缺少商品活动，汇总与28款82活动一致',()=>{
  const records=Array.from({length:28},()=>row());records[12]=row('word','B000000002\nB000000003\nB000000003');records[15]=row('word','B000000002\nB000000003');
  records.forEach((r,i)=>{r.row=i+2;r.msku=`SKU-${i+1}`;});
  const s=validationOverview(records);assert.equal(s.generated,82);assert.equal(s.requested,84);assert.equal(s.complete,26);assert.equal(s.partial,2);assert.equal(s.failedProducts,2);
  assert.deepEqual(s.failures.map(f=>[f.row,f.label,f.sheet]),[[14,'商品扩展投放','广告导入'],[17,'商品扩展投放','广告导入']]);
  assert.match(s.failures[0].reason,/B000000003（2次）/);assert.match(s.failures[1].reason,/3–5/);
});
test('手动留空、删完关键词与取消自动不计入分母，也不产生异常',()=>{
  const onlyAuto=row('','');assert.equal(previewAvailability(onlyAuto).requested,1);assert.equal(previewAvailability(onlyAuto).generated,1);
  const r=row();removePreviewKeyword(r,0);for(const type of AUTO_TYPES)selectPreviewAuto(r,type,false);
  assert.equal(previewAvailability(r).requested,1);assert.equal(previewAvailability(r).generated,1);assert.deepEqual(previewAvailability(r).failures,[]);
});
test('读取失败降低可创建数，重试成功即时移除异常；旧预览恢复后口径一致',()=>{
  const r=row();failPreviewQuotes(r,'keywords',['word'],'HTTP 503');assert.equal(previewAvailability(r).generated,2);assert.equal(previewAvailability(r).status,'partial');
  const state={records:[r],book:{SheetNames:['广告导入'],Sheets:{广告导入:{'!ref':'A1:E2'}}},sheet:'广告导入',batchTime:'batch'};
  const restored=restorePreview(previewSnapshot(state));assert.deepEqual(validationOverview(restored.records),validationOverview([r]));
  applyPreviewQuotes(r,'keywords',['word'],[{status:'available',lower:.3}]);assert.equal(previewAvailability(r).generated,3);assert.equal(validationOverview([r]).failures.length,0);
});
test('尚未校验不冒充校验失败；商品身份失败列出所有原计划渠道',()=>{
  const r=parseRows([header,[profile.alias,'SKU-TEST','B000000001','word','B000000002\nB000000003\nB000000004']])[0];r.status='pending';
  assert.equal(previewAvailability(r).generated,0);assert.equal(previewAvailability(r).requested,3);assert.deepEqual(previewAvailability(r).failures,[]);
  r.status='blocked';r.error='当前账号找不到商品';const result=validationOverview([r]);assert.equal(result.failures.length,3);assert.equal(result.failedProducts,1);assert.ok(result.failures.every(f=>f.reason===r.error));
});
