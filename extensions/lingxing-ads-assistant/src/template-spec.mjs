export const DETAIL_INPUT_HEADERS=['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'];
export const DETAIL_PARAMETERS=[
  {name:'STRATEGY',value:'仅降低',allowed:['仅降低','动态竞价-只降低','LEGACY_FOR_SALES'],note:'动态竞价只降低'},
  {name:'AUTO',value:'YES',allowed:['YES','TRUE','1','是'],note:'自动广告四类全部开启'},
  {name:'DAILY_BUDGET',value:'按站点',allowed:['按站点','默认'],note:'CA 4 CAD，AU 4 AUD，AE 10 AED，UK 2 GBP，每活动'},
  {name:'DEFAULT_BID',value:'预算÷10',allowed:['预算÷10','日预算÷10','默认'],note:'广告组默认价为日预算÷10'},
  {name:'AUTO_BID',value:'自动计算',allowed:['自动计算','默认'],note:'每种自动定位分别取建议下限×90%；无区间用日预算÷10'},
  {name:'BROAD_BID',value:'自动计算',allowed:['自动计算','默认'],note:'每个广泛词分别计算；KEYWORDS留空时跳过活动'},
  {name:'ASIN_BID',value:'自动计算',allowed:['自动计算','默认'],note:'每个扩展ASIN分别计算；TARGET_ASIN留空时跳过活动'},
  {name:'AUTO_SUFFIX',value:'默认',allowed:['默认'],note:'活动名：MSKU-自动-创建时间'},
  {name:'BROAD_SUFFIX',value:'默认',allowed:['默认'],note:'活动名：MSKU-手动-关键词-创建时间'},
  {name:'ASIN_SUFFIX',value:'默认',allowed:['默认'],note:'活动名：MSKU-手动-商品投放-创建时间'},
  {name:'STATUS',value:'仅预览',allowed:['仅预览','预览','PREVIEW'],note:'不提交真实广告，未设定真实活动启停状态'},
  {name:'NODE_ID',value:'',allowed:[],note:'原表类目字段保留，本轮留空'},
  {name:'NODE_NAME',value:'',allowed:[],note:'原表类目字段保留，本轮留空'},
  {name:'CAT_SUFFIX',value:'',allowed:[],note:'本轮不创建类目活动，留空'},
  {name:'CAT_BID',value:'',allowed:[],note:'本轮不创建类目活动，留空'},
  {name:'KEYWORDS_EXACT',value:'',allowed:[],note:'本轮不创建精准关键词活动，留空'},
  {name:'EXACT_SUFFIX',value:'',allowed:[],note:'本轮不创建精准关键词活动，留空'},
  {name:'EXACT_BID',value:'',allowed:[],note:'本轮不创建精准关键词活动，留空'}
];
export const DETAIL_HEADERS=[...DETAIL_INPUT_HEADERS,...DETAIL_PARAMETERS.map(p=>p.name)];
export const DETAIL_TEMPLATE_FILENAME='广告创建详细参数模板.xlsx';
export function detailDefaultRow(){return [...DETAIL_INPUT_HEADERS.map(()=>''),...DETAIL_PARAMETERS.map(p=>p.value)];}
