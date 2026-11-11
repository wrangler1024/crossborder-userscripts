import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,AUTO_TYPES} from '../src/model.mjs';
import {initializePreview,removePreviewKeyword,selectPreviewAuto} from '../src/preview.mjs';
import {creationCandidates,executionKey,buildCreationPayload,executionFingerprint,parseSubmission,validateCreationItem,preflightCreation,inspectCreatedGroup,runCreationBatch} from '../src/execution.mjs';
import {createExecutionClient,createExecutionJournal} from '../src/execution-client.mjs';
import {createStorageService} from '../extension/storage-service.mjs';

const profile={alias:'测试-CA',profile_id:'123',country:'CA',real_status:1,type:'seller'};
function sample(){
  const r=parseRows([['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],[profile.alias,'SKU-A','B000000001','rug pad\nrug tape','B000000002\nB000000003\nB000000004']])[0];
  initializePreview(r,profile,{asin:r.asin,msku:r.msku,stock:20,parent:''},{auto:AUTO_TYPES.map(()=>({status:'available',lower:.3})),keywords:r.keywords.map(()=>({status:'available',lower:.2})),targets:r.targets.map(()=>({status:'none'}))},'2026-11-10-18:00:00');return r;
}
const candidates=()=>creationCandidates([sample()]);
const payload=item=>buildCreationPayload(item,{state:'paused',startDate:'2026-11-10'});
async function prepared(items=candidates()){return Promise.all(items.map(async item=>{const p=payload(item);return {item,payload:p,payloadHash:await executionFingerprint(p)};}));}
function store(){
  const data={};let revision=0;
  const storage={get:async key=>structuredClone({[key]:data[key]}),set:async values=>Object.assign(data,structuredClone(values))};
  const request=createStorageService(storage,{revision:()=>String(++revision)});
  return {data,request,journal:createExecutionJournal(request,'a'.repeat(64))};
}
function services(){return {permissions:async()=>['new_ad/build/super/index','new_ad/build/super/edit'],profiles:async()=>[profile],products:async(p,msku)=>[{sku:msku,asin:'B000000001',profile_id:p.profile_id,sku_status:'1',afn_fulfillable_quantity:20}],eligibility:async item=>({data:{productResponseList:[{overallStatus:'ELIGIBLE',productDetails:{sku:item.msku,asin:item.asin},eligibilityStatusList:[]}]}}),findCampaigns:async()=>[],submit:async()=>({success:true,code:1,data:[{index:0,code:'SUCCESS'}]})};}
function created(item){
  const p=payload(item),c=structuredClone(p.groups[0].campaigns[0]);c.campaign_id='11';c.uuid='101';c.profile_id=item.profileId;c.ad_groups[0].ad_group_id='12';
  c.start_date=p.start_date;
  c.targeting_type=Number(c.targeting_type);c.ad_groups[0].targeting_type=Number(c.ad_groups[0].targeting_type);
  const group={uuid:'100',profile_id:item.profileId,build_status:1,campaigns:[c],skus:p.groups[0].skus};
  const logs=['createCampaigns','createAdGroups','createProductAds',item.campaign.type==='AUTO'?'updateTargets':item.campaign.type==='BROAD'?'createKeywords':'createTargets'].map(method=>({campaign_uuid:'101',campaign:{custom_name:c.custom_name},ad_group:{ad_group_id:'12'},status:1,create_methon:method,...(method==='createProductAds'?{product_ads:[{sku:item.msku,asin:item.asin,ad_id:'13'}]}:{})}));
  const targetLog=logs.at(-1),g=c.ad_groups[0];
  if(item.campaign.type==='BROAD')targetLog.keywords=g.keywords.map((t,i)=>({...structuredClone(t),keyword_id:String(20+i)}));
  else targetLog[item.campaign.type==='AUTO'?'children':'targets']=g.targets.map((t,i)=>({...structuredClone(t),target_id:String(20+i)}));
  return {p,group,logs};
}

test('三活动仅使用当前预览，剔除词和取消自动类型正确传递；未选自动类型明确暂停',()=>{
  const r=sample();removePreviewKeyword(r,0);selectPreviewAuto(r,'COMPLEMENTS',false);const items=creationCandidates([r]);
  const a=payload(items[0]),k=payload(items[1]),t=payload(items[2]);
  assert.deepEqual(k.groups[0].campaigns[0].ad_groups[0].keywords.map(x=>[x.keyword_text,x.match_type,x.bid]),[['rug tape','BROAD','0.18']]);
  assert.equal(a.groups[0].campaigns[0].state,'paused');assert.equal(a.groups[0].campaigns[0].ad_groups[0].state,'enabled');
  assert.equal(a.groups[0].campaigns[0].ad_groups[0].targets.length,4);
  assert.equal(a.groups[0].campaigns[0].ad_groups[0].targets.find(x=>x.expression[0].type==='asinAccessoryRelated').state,'paused');
  assert.ok(t.groups[0].campaigns[0].ad_groups[0].targets.every(x=>x.expression[0].type==='asinExpandedFrom'&&x.bid==='0.4'));
  assert.equal(t.groups[0].skus[0].sku,r.msku);assert.equal(t.groups[0].campaigns[0].custom_name,items[2].campaign.name);
});
test('确认清单是不可变副本；后续预览变化不能改动待提交内容',()=>{
  const r=sample(),items=creationCandidates([r]),before=payload(items[1]);removePreviewKeyword(r,0);assert.deepEqual(payload(items[1]),before);
});
test('默认暂停，仅显式选择启用才发enabled，日期必须有效',()=>{
  const item=candidates()[0];assert.equal(buildCreationPayload(item,{startDate:'2026-11-10'}).groups[0].campaigns[0].state,'paused');
  assert.equal(buildCreationPayload(item,{state:'enabled',startDate:'2026-11-10'}).groups[0].campaigns[0].state,'enabled');
  for(const startDate of ['', '2026-02-30','garbage'])assert.throws(()=>buildCreationPayload(item,{startDate}));
  assert.throws(()=>buildCreationPayload(item,{startDate:'2026-11-10',state:'archived'}));
});
test('拒绝任意预算、提价、不同商品、低于平台底价和不符模型的投放',()=>{
  for(const change of [x=>x.campaign.budget=40,x=>x.campaign.bidding='固定竞价',x=>x.campaign.placements.top=100,x=>x.campaign.groups[0].products[0].asin='B000000099',x=>x.campaign.groups[0].targets[0].bid=.01,x=>x.campaign.groups[0].targets[0].bid=.123,x=>x.campaign.groups[0].targets[0].type='EXACT',x=>x.profileId='unknown']){
    const item=candidates()[0];change(item);assert.throws(()=>validateCreationItem(item));
  }
});
test('低库存只可暂停创建，直接启用按实时库存拦截旧预览',async()=>{
  const item=candidates()[0],s=services();for(const stock of [0,1,9,10]){s.products=async()=>[{sku:item.msku,asin:item.asin,profile_id:item.profileId,sku_status:'1',afn_fulfillable_quantity:stock}];const paused=await preflightCreation([item],s);assert.equal(paused[0].ok,true);assert.equal(paused[0].pausedOnly,stock<10);const enabled=await preflightCreation([item],s,{state:'enabled'});assert.equal(enabled[0].ok,stock>=10);}
});
test('零库存三渠道预览均可构造暂停负载，不能构造启用负载',()=>{
  const r=sample();r.product.stock=0;
  const items=creationCandidates([r]);assert.equal(items.length,3);
  for(const item of items){assert.equal(item.stock,0);assert.equal(payload(item).groups[0].campaigns[0].state,'paused');assert.throws(()=>buildCreationPayload(item,{state:'enabled',startDate:'2026-11-10'}),/仅可创建暂停/);}
});
test('提交前库存降为0时，暂停批次可提交，启用批次不能提交',async()=>{
  for(const state of ['paused','enabled']){
    const entries=await Promise.all(candidates().map(async item=>{const p=buildCreationPayload(item,{state,startDate:'2026-11-10'});return {item,payload:p,payloadHash:await executionFingerprint(p)};}));
    const {journal}=store(),s=services();let writes=0;
    s.products=async(p,msku)=>[{sku:msku,asin:'B000000001',profile_id:p.profile_id,sku_status:'1',afn_fulfillable_quantity:0}];
    s.submit=async(_item,payload)=>{writes++;assert.equal(payload.groups[0].campaigns[0].state,'paused');return {code:1,data:[{index:0,code:'SUCCESS'}]};};
    await runCreationBatch({entries,services:s,journal,confirmed:true,owner:'stock-test'});
    assert.equal(writes,state==='paused'?3:0);assert.ok((await journal.read()).every(e=>e.status===(state==='paused'?'submitted':'not_sent')));
  }
});
test('零库存仍严格检查商品资格、Listing状态和有效库存；缺失快照的历史记录也不能启用低库存',async()=>{
  const item=candidates()[0];delete item.stock;
  // Existing enabled receipts remain readable and verifiable, without being a new execution authorization.
  assert.equal(buildCreationPayload(item,{state:'enabled',startDate:'2026-11-10'}).groups[0].campaigns[0].state,'enabled');
  for(const state of ['paused','enabled'])for(const invalid of ['eligibility','listing','unknown']){
    const s=services();s.products=async()=>[{sku:item.msku,asin:item.asin,profile_id:item.profileId,sku_status:invalid==='listing'?'0':'1',afn_fulfillable_quantity:invalid==='unknown'?null:0}];
    if(invalid==='eligibility')s.eligibility=async()=>({data:{productResponseList:[{productDetails:{sku:item.msku,asin:item.asin},overallStatus:'INELIGIBLE',eligibilityStatusList:[{message:'产品不符合广告资格'}]}]}});
    assert.equal((await preflightCreation([item],s,{state}))[0].ok,false);
  }
  const s=services();s.products=async()=>[{sku:item.msku,asin:item.asin,profile_id:item.profileId,sku_status:'1',afn_fulfillable_quantity:0}];
  assert.equal((await preflightCreation([item],s,{state:'enabled'}))[0].ok,false);
});
test('有普通SP创建权限但缺少超级结构权限时，不放行批量创建',async()=>{
  const s=services();let productCalls=0;s.products=async()=>{productCalls++;return [];};
  for(const rules of [['new_ad/sp/ad/create'],['new_ad/build/super/index'],['new_ad/build/super/edit']]){
    s.permissions=async()=>rules;const results=await preflightCreation(candidates(),s);assert.ok(results.every(r=>!r.ok&&r.message.includes('超级结构')));
  }
  assert.equal(productCalls,0);
});
test('提交前权限被撤回时保留未提交状态，不向领星发写请求',async()=>{
  const s=services(),entries=await prepared(),{journal}=store();let writes=0;
  assert.ok((await preflightCreation(candidates(),s)).every(r=>r.ok));s.permissions=async()=>[];s.submit=async()=>{writes++;};
  await runCreationBatch({entries,services:s,journal,confirmed:true,owner:'one'});assert.equal(writes,0);assert.ok((await journal.read()).every(r=>r.status==='not_sent'&&r.message.includes('超级结构')));
});
test('广告资格缺失、错误商品资格、授权异常、同名活动分别拦截',async()=>{
  for(const change of [s=>s.eligibility=async()=>({data:{productResponseList:[]}}),s=>s.eligibility=async()=>({data:{productResponseList:[{overallStatus:'ELIGIBLE',productDetails:{sku:'OTHER',asin:'B000000001'}}]}}),s=>s.profiles=async()=>[{...profile,real_status:0}],s=>s.findCampaigns=async()=>[{campaign_id:'999'}]]){
    const s=services();change(s);const result=await preflightCreation([candidates()[0]],s);assert.equal(result[0].ok,false);
  }
});
test('同父多子体的两个商品都被拦截，同一商品三个渠道不会互相拦截',async()=>{
  const items=candidates(),s=services();s.products=async(p,msku)=>[{sku:msku,asin:msku==='SKU-A'?'B000000001':'B000000099',profile_id:p.profile_id,sku_status:'1',afn_fulfillable_quantity:20,parent_asin:'PARENT'}];
  assert.ok((await preflightCreation(items,s)).every(r=>r.ok));
  const b=structuredClone(items[0]);b.msku='SKU-B';b.asin='B000000099';b.campaign.name='SKU-B-auto';b.campaign.groups[0].products=[{msku:b.msku,asin:b.asin}];
  assert.ok((await preflightCreation([items[0],b],s)).every(r=>!r.ok));
});
test('受理回执不等于完成；缺少分组结果或索引不匹配保持未知',()=>{
  assert.equal(parseSubmission({code:1,success:true,data:[{index:0,code:'SUCCESS'}]}).status,'submitted');
  assert.equal(parseSubmission({code:1,data:[{index:0,code:'FAILED',message:'名称重复'}]}).status,'failed');
  for(const data of [[],{},[{index:1,code:'SUCCESS'}]])assert.equal(parseSubmission({code:1,data}).status,'unknown');
});
test('创建必须确认；确认后依次提交并记录，重复点击不再发送',async()=>{
  const entries=await prepared(),{journal}=store(),s=services();let calls=0;s.submit=async()=>{calls++;return {code:1,data:[{index:0,code:'SUCCESS'}]};};
  await assert.rejects(()=>runCreationBatch({entries,services:s,journal,owner:'one'}),/确认/);assert.equal(calls,0);
  await runCreationBatch({entries,services:s,journal,owner:'one',confirmed:true});assert.equal(calls,3);
  assert.ok((await journal.read()).every(e=>e.status==='submitted'&&e.accepted));
  await runCreationBatch({entries,services:s,journal,owner:'two',confirmed:true});assert.equal(calls,3);
});
test('实际提交前库存再次下降，不发送创建且记录可继续的未提交状态',async()=>{
  const entries=await prepared(),{journal}=store(),s=services();let calls=0;s.submit=async()=>{calls++;};s.products=async()=>[];
  await runCreationBatch({entries,services:s,journal,owner:'one',confirmed:true});assert.equal(calls,0);assert.ok((await journal.read()).every(e=>e.status==='not_sent'));
});
test('先持久化提交标记，再发送；超时结果未知会停止后续活动且永不自动重发',async()=>{
  const entries=await prepared(),{journal}=store(),s=services();let calls=0;
  s.submit=async()=>{calls++;assert.equal((await journal.read())[0].status,'submitting');throw new Error('timeout');};
  await runCreationBatch({entries,services:s,journal,owner:'one',confirmed:true});assert.equal(calls,1);const first=(await journal.read())[0];assert.equal(first.status,'unknown');
  await runCreationBatch({entries:[entries[0]],services:s,journal,owner:'two',confirmed:true});assert.equal(calls,1);
  await assert.rejects(()=>journal.update(first,{status:'not_sent',message:'reset'}),/不能重新发送/);
});
test('保存提交标记失败不会向领星发写请求',async()=>{
  const entries=await prepared(),s=services();let calls=0;s.submit=async()=>{calls++;};
  const journal={claim:async()=>{throw new Error('存储失败');}};
  await assert.rejects(()=>runCreationBatch({entries,services:s,journal,owner:'one',confirmed:true}),/存储/);assert.equal(calls,0);
});
test('停止只阻止后续提交，已发送请求仍记录回执',async()=>{
  const entries=await prepared(),{journal}=store(),s=services();let stop=false,calls=0;s.submit=async()=>{calls++;stop=true;return {code:1,data:[{index:0,code:'SUCCESS'}]};};
  await runCreationBatch({entries,services:s,journal,owner:'one',confirmed:true,shouldStop:()=>stop});assert.equal(calls,1);assert.equal((await journal.read())[0].status,'submitted');
});
test('两个标签页提交同一任务，原子记录和版本检查只允许一个请求',async()=>{
  const [entry]=await prepared(),{journal}=store(),s=services();let calls=0;s.submit=async()=>{calls++;return {code:1,data:[{index:0,code:'SUCCESS'}]};};
  await Promise.allSettled(['one','two'].map(owner=>runCreationBatch({entries:[entry],services:s,journal,owner,confirmed:true})));assert.equal(calls,1);
});
test('清除预览保留创建记录；新浏览器页面仍识别已提交的名称',async()=>{
  const {request,journal}=store(),[entry]=await prepared();await runCreationBatch({entries:[entry],services:services(),journal,owner:'one',confirmed:true});
  await request({action:'clear',scope:'a'.repeat(64),revision:null});const fresh=createExecutionJournal(request,'a'.repeat(64));assert.equal((await fresh.read())[0].status,'submitted');
});
test('只在活动、组、商品、全部目标及配置都核对成功时显示完成',()=>{
  for(const item of candidates()){const {p,group,logs}=created(item);assert.equal(inspectCreatedGroup(item,p,group,logs).status,'complete');}
  const item=candidates()[0];for(const change of [g=>g.campaigns[0].budget='8',g=>g.campaigns[0].ad_groups[0].targets.pop(),g=>g.campaigns[0].ad_groups[0].targets[0].state='paused',g=>g.campaigns[0].state='enabled']){const {p,group,logs}=created(item);change(group);assert.equal(inspectCreatedGroup(item,p,group,logs).status,'review');}
});
test('日志失败、商品广告尚未生成及后台未结束均不误报成功',()=>{
  const item=candidates()[0];let x=created(item);x.logs[0].status=4;assert.equal(inspectCreatedGroup(item,x.p,x.group,x.logs).status,'failed');
  x=created(item);x.logs=x.logs.filter(r=>r.create_methon!=='createProductAds');assert.equal(inspectCreatedGroup(item,x.p,x.group,x.logs).status,'submitted');
  x=created(item);x.group.build_status=0;assert.equal(inspectCreatedGroup(item,x.p,x.group,x.logs).status,'submitted');
});
test('原生数字与字符串广告类型等价，三渠道均可正确核对完成',()=>{
  for(const item of candidates())for(const type of [Number,String]){
    const {p,group,logs}=created(item),c=group.campaigns[0];c.targeting_type=type(c.targeting_type);c.ad_groups[0].targeting_type=type(c.ad_groups[0].targeting_type);
    assert.equal(inspectCreatedGroup(item,p,group,logs).status,'complete');
  }
});
test('类型归一化不放过自动手动互换、缺失或无效广告类型',()=>{
  for(const item of candidates())for(const level of ['campaign','group'])for(const value of [item.campaign.type==='AUTO'?2:1,null,undefined,0,true,'01']){
    const {p,group,logs}=created(item),c=group.campaigns[0];(level==='campaign'?c:c.ad_groups[0]).targeting_type=value;
    assert.equal(inspectCreatedGroup(item,p,group,logs).status,'review');
  }
});
test('缺少投放目标ID或目标日志、错误广告组的商品日志都不误报完成',()=>{
  for(const item of candidates()){
    const x=created(item);x.logs.pop();assert.equal(inspectCreatedGroup(item,x.p,x.group,x.logs).status,'submitted');
    const y=created(item),log=y.logs.at(-1);for(const t of log.keywords||log.targets||log.children){delete t.target_id;delete t.keyword_id;}assert.equal(inspectCreatedGroup(item,y.p,y.group,y.logs).status,'submitted');
    const z=created(item);z.logs.find(r=>r.create_methon==='createProductAds').ad_group.ad_group_id='999';assert.equal(inspectCreatedGroup(item,z.p,z.group,z.logs).status,'submitted');
  }
});
test('回读关键词匹配方式、开始日期、商品数量不符时标明待核对',()=>{
  for(const change of [x=>x.group.campaigns[0].ad_groups[0].keywords[0].match_type='EXACT',x=>x.group.campaigns[0].start_date='2026-12-01',x=>x.group.skus.push({...x.group.skus[0],sku:'OTHER'})]){
    const item=candidates()[1],x=created(item);change(x);assert.equal(inspectCreatedGroup(item,x.p,x.group,x.logs).status,'review');
  }
});
test('名称及关键词中的控制字符不可提交',()=>{
  for(const change of [x=>x.campaign.name+='\u0000',x=>x.campaign.groups[0].name+='\nBAD',x=>x.campaign.groups[0].targets[0].value='rug\tpad']){
    const item=candidates()[1];change(item);assert.throws(()=>validateCreationItem(item));
  }
});
test('已提交记录不能通过checking或submitting倒退后重新获得提交资格',async()=>{
  const {journal}=store(),[entry]=await prepared();await runCreationBatch({entries:[entry],services:services(),journal,owner:'one',confirmed:true});const saved=(await journal.read())[0];
  for(const status of ['checking','submitting','not_sent'])await assert.rejects(()=>journal.update(saved,{status}),/不能重新发送/);
});
test('原生提交适配拒绝未确认、篡改负载或会话切换',async()=>{
  const session={identity:'account',epoch:0,ready:true,headers:()=>({})};let calls=0;const client=createExecutionClient(session,services(),{fetcher:async()=>{calls++;return {ok:true,json:async()=>({code:1,data:[{index:0,code:'SUCCESS'}]})};}}),item=candidates()[0],p=payload(item);
  await assert.rejects(()=>client.submit(item,p),/确认/);p.budget='99';await assert.rejects(()=>client.submit(item,p,{confirmed:true}),/偏离/);assert.equal(calls,0);
  session.identity='other';await assert.rejects(()=>client.submit(item,payload(item),{confirmed:true}),/账号/);assert.equal(calls,0);
});
test('原生写请求仅指向已核实的批量创建端点，提交原始预览竞价',async()=>{
  let request;const session={identity:'account',epoch:0,ready:true,headers:()=>({})},client=createExecutionClient(session,services(),{fetcher:async(url,opts)=>{request={url,body:JSON.parse(opts.body)};return {ok:true,json:async()=>({code:1,data:[{index:0,code:'SUCCESS'}]})};}});
  const item=candidates()[1],p=payload(item);await client.submit(item,p,{confirmed:true});assert.ok(request.url.endsWith('/build/super/create/batch_create'));assert.deepEqual(request.body,p);
});
test('未拿到成功受理回执时，同名结构不会被当成本任务自动接管',async()=>{
  const item=candidates()[0],{group,logs}=created(item);const entry={item,payload:payload(item),status:'unknown'};
  const session={identity:'account',epoch:0,ready:true,headers:()=>({})},client=createExecutionClient(session,services(),{fetcher:async(url)=>({ok:true,json:async()=>({code:1,recordsFiltered:1,data:url.includes('list_v2')?logs:[group]})})});
  assert.equal((await client.check(entry)).status,'review');entry.accepted=true;assert.equal((await client.check(entry)).status,'complete');
});
test('创建检查遵守Retry-After，限流期间不再请求且不重发已发送创建',async()=>{
  let now=100000,calls=0;const session={identity:'account',epoch:0,ready:true,headers:()=>({})};
  const client=createExecutionClient(session,services(),{now:()=>new Date(now),fetcher:async()=>{calls++;return {ok:false,status:429,headers:{get:()=> '8'},json:async()=>({code:429})};}}),item=candidates()[0];
  await assert.rejects(()=>client.eligibility(item),/等待8秒/);await assert.rejects(()=>client.eligibility(item),/限流/);assert.equal(calls,1);
  now+=8000;await assert.rejects(()=>client.eligibility(item),/限流/);assert.equal(calls,2);
  const {journal}=store(),entries=await prepared(),s=services();let writes=0;s.submit=async()=>{writes++;throw Object.assign(new Error('限流'),{kind:'rate_limit'});};
  await runCreationBatch({entries,services:s,journal,confirmed:true,owner:'one'});assert.equal(writes,1);assert.equal((await journal.read())[0].status,'unknown');
});
