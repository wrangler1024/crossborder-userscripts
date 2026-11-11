import {channelInputs,clean} from './model.mjs';
import {finalPreviewPlans} from './preview.mjs';

const VALIDATION_TYPES={auto:'AUTO',keywords:'BROAD',targets:'EXPANDED_ASIN'};
const VALIDATION_LABELS={auto:'自动广告',keywords:'广泛关键词',targets:'商品扩展投放'};

function repeatedPreviewValues(values,normalize){
  const counts=new Map();
  for(const value of values||[]){const key=normalize(value);counts.set(key,{value,count:(counts.get(key)?.count||0)+1});}
  return [...counts.values()].filter(item=>item.count>1).map(item=>`${item.value}（${item.count}次）`).slice(0,5).join('、');
}
export function previewAvailability(record){
  const inputs=channelInputs(record),selected=inputs.filter(c=>c.status!=='skipped');
  const plan=finalPreviewPlans([record])[0];
  const generated=selected.filter(input=>plan?.campaigns.some(c=>c.type===VALIDATION_TYPES[input.key]));
  const globalReason=[...(record.issues||[]),record.error].filter(Boolean).join('；');
  const failures=selected.filter(input=>!generated.includes(input)).flatMap(input=>{
    const planned=record.plan?.channels?.find(c=>c.key===input.key);
    let reason=globalReason||(input.status==='blocked'?input.reason:'')||(planned?.status==='blocked'?planned.reason:'');
    if(!reason)return [];
    if(input.key==='targets'&&record.channelIssues?.targets?.some(s=>s.includes('重复'))){
      const repeated=repeatedPreviewValues(record.targets,v=>clean(v).toUpperCase());
      if(repeated)reason+=`；重复项：${repeated}`;
    }
    if(input.key==='keywords'&&record.channelIssues?.keywords?.some(s=>s.includes('重复'))){
      const repeated=repeatedPreviewValues(record.keywords,v=>clean(v).toLocaleLowerCase());
      if(repeated)reason+=`；重复项：${repeated}`;
    }
    return [{channel:input.key,label:VALIDATION_LABELS[input.key],reason}];
  });
  const status=generated.length?(failures.length?'partial':'ready'):record.status;
  return {requested:selected.length,generated:generated.length,failures,status};
}
export function validationOverview(records){
  const overview={requested:0,generated:0,complete:0,partial:0,failedProducts:0,failures:[]};
  records.forEach((record,index)=>{
    const value=previewAvailability(record);overview.requested+=value.requested;overview.generated+=value.generated;
    if(value.generated&&value.generated===value.requested)overview.complete++;
    else if(value.generated&&value.failures.length)overview.partial++;
    if(value.failures.length)overview.failedProducts++;
    overview.failures.push(...value.failures.map(failure=>({...failure,id:`${index}:${failure.channel}`,index,msku:record.msku,sheet:record.sheet,row:record.row})));
  });
  return overview;
}
