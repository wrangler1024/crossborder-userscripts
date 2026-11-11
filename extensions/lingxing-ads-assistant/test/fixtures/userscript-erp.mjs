// Synthetic ERP for distribution-adapter acceptance. Never calls a live API.
export function installMockERP(win){
  const submissions=[],groups=[],logs=new Map();let quoteCalls=0;
  const ok=data=>({success:true,code:1,data});
  class MockXHR{open(){}setRequestHeader(){}send(){}}
  win.XMLHttpRequest=MockXHR;
  win.fetch=async(url,options={})=>{
    const path=new win.URL(String(url)).pathname,b=options.body?JSON.parse(options.body):{};
    let result;
    if(path.endsWith('/get_profile_list'))result=ok([{alias:'测试-CA',profile_id:'123',country:'CA',real_status:1,type:'seller'}]);
    else if(path.endsWith('/get_ad_rule'))result=ok(['new_ad/build/super/index','new_ad/build/super/edit']);
    else if(path.endsWith('/core/store/products'))result={...ok([{sku:'SKU-ADAPTER-TEST',asin:'B000000001',profile_id:'123',sku_status:'1',afn_fulfillable_quantity:20,title:'Synthetic product'}]),region:{country:'CA'}};
    else if(path.endsWith('/core/api/handle')){quoteCalls++;result=ok({bidRecommendations:[{theme:'CONVERSION_OPPORTUNITIES',bidRecommendationsForTargetingExpressions:b.params.targetingExpressions.map(e=>({targetingExpression:e,bidValues:[{suggestedBid:.3},{suggestedBid:.5},{suggestedBid:.7}]}))}]});}
    else if(path.endsWith('/target_products_asin_recommendations'))result=ok(['B000000002','B000000003','B000000004'].map(asin=>({asin,suggests:[{code:'SUCCESS',expression:[{type:'asinExpandedFrom',value:asin}],suggestedBid:{rangeStart:.2}}]})));
    else if(path.endsWith('/product_eligibility_list'))result=ok({productResponseList:[{overallStatus:'ELIGIBLE',productDetails:{sku:'SKU-ADAPTER-TEST',asin:'B000000001'},eligibilityStatusList:[]}]});
    else if(path.endsWith('/campaign/index/index'))result=ok(groups.flatMap(g=>g.campaigns).filter(c=>c.custom_name===b.name).map(c=>({name:c.custom_name,campaign_id:c.campaign_id})));
    else if(path.endsWith('/create/batch_create')){
      submissions.push(b);const n=submissions.length,c=JSON.parse(JSON.stringify(b.groups[0].campaigns[0])),g=c.ad_groups[0];
      c.campaign_id=String(100+n);c.uuid=String(200+n);c.profile_id='123';c.start_date=b.start_date;g.ad_group_id=String(300+n);
      c.targeting_type=Number(c.targeting_type);g.targeting_type=Number(g.targeting_type);
      const group={uuid:String(400+n),profile_id:'123',build_status:1,campaigns:[c],skus:b.groups[0].skus};groups.push(group);
      const auto=c.targeting_type===1,keyword=g.keywords.length>0;
      const events=['createCampaigns','createAdGroups','createProductAds',auto?'updateTargets':keyword?'createKeywords':'createTargets'].map(method=>({campaign_uuid:c.uuid,campaign:{custom_name:c.custom_name},ad_group:{ad_group_id:g.ad_group_id},status:1,create_methon:method,...(method==='createProductAds'?{product_ads:[{sku:'SKU-ADAPTER-TEST',asin:'B000000001',ad_id:String(500+n)}]}:{})}));
      if(keyword)events.at(-1).keywords=g.keywords.map((t,i)=>({...t,keyword_id:String(600+n*10+i)}));
      else events.at(-1)[auto?'children':'targets']=g.targets.map((t,i)=>({...t,target_id:String(600+n*10+i)}));
      logs.set(group.uuid,events);result=ok([{index:0,code:'SUCCESS',group_uuid:group.uuid}]);
    }else if(path.endsWith('/index/simple_list'))result=ok(groups);
    else if(path.endsWith('/index/full_list'))result=ok(groups.filter(g=>g.uuid===b.group_uuid));
    else if(path.endsWith('/log/list_v2'))result=ok(logs.get(b.group_uuid)||[]);
    else throw new Error('Unmocked request blocked: '+path);
    return {ok:true,status:200,headers:{get:()=>null},json:async()=>result};
  };
  win.__adapterTest={submissions,groups,get quoteCalls(){return quoteCalls;},session(){const x=new win.XMLHttpRequest();x.open('GET','https://gw.lingxingerp.com/pb-newad-web/test');x.setRequestHeader('auth-token','synthetic-not-a-credential');x.setRequestHeader('x-ak-company-id','adapter-test');x.setRequestHeader('x-ak-uid','adapter-test-user');x.send();}};
}
