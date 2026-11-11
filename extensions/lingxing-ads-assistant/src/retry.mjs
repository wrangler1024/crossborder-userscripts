import {previewValues,previewQuote} from './preview.mjs';

export const AUTO_RETRY_DELAYS=Object.freeze([10000,30000,60000]);
export const AUTO_RETRY_GAP=3000;
export function retryNeed(record,key){
  if(!record.previewValidated||!record.profile||!record.product||record.product.stock<10||record.issues?.length||record.channelIssues?.[key]?.length)return null;
  const values=previewValues(record,key);if(!values.length)return null;
  const quotes=values.map(value=>previewQuote(record,key,value));
  // A permanent error requires operator correction, even if other targets lack quotes.
  if(quotes.some(q=>q?.status==='error'&&q.retryable===false))return null;
  const failed=quotes.filter(q=>!q||q.status==='error').length,missing=quotes.filter(q=>q?.status==='none').length;
  return failed||missing?{failed,missing,priority:failed?0:1}:null;
}
export function createRetryQueue({now=()=>Date.now(),delays=AUTO_RETRY_DELAYS,gapMs=AUTO_RETRY_GAP}={}){
  let jobs=[],active=null,epoch=0,sequence=0,nextDispatchAt=0;
  function sync(records){
    const included=new Set(records);
    jobs=jobs.filter(job=>included.has(job.record));
    for(const record of records)for(const key of ['auto','keywords','targets']){
      const need=retryNeed(record,key);let job=jobs.find(j=>j.record===record&&j.key===key);
      if(!job&&need){job={record,key,attempts:0,dueAt:now()+delays[0],id:++sequence,epoch};jobs.push(job);}
      if(job){
        if(!job.need&&need&&job!==active&&job.attempts<delays.length)job.dueAt=now()+delays[job.attempts];
        job.need=need;job.status=job===active?'running':!need?'done':job.attempts>=delays.length?'exhausted':'waiting';
      }
    }
    return jobs;
  }
  function due(job,cooldownUntil){return Math.max(job.dueAt,nextDispatchAt,cooldownUntil(job.record,job.key)||0);}
  function candidates(records,cooldownUntil){sync(records);return jobs.filter(j=>j.status==='waiting').map(job=>({job,dueAt:due(job,cooldownUntil)}));}
  return {
    maxAttempts:delays.length,
    reset(){jobs=[];active=null;nextDispatchAt=0;epoch++;},
    sync,
    next(records,cooldownUntil=()=>0){
      if(active)return null;
      return candidates(records,cooldownUntil).filter(x=>x.dueAt<=now()).sort((a,b)=>a.job.need.priority-b.job.need.priority||a.dueAt-b.dueAt||a.job.id-b.job.id)[0]?.job||null;
    },
    begin(job,cooldownUntil=()=>0){
      if(active||job.epoch!==epoch||!jobs.includes(job)||job.status!=='waiting'||job.attempts>=delays.length||now()<due(job,cooldownUntil)||!retryNeed(job.record,job.key))return false;
      active=job;job.attempts++;job.status='running';return true;
    },
    finish(job,records){
      if(job!==active||job.epoch!==epoch)return;
      active=null;nextDispatchAt=now()+gapMs;
      job.dueAt=now()+(delays[job.attempts]??0);sync(records);
    },
    jobFor(record,key,cooldownUntil=()=>0){
      const job=jobs.find(j=>j.record===record&&j.key===key);
      return job?{status:job.status,attempts:job.attempts,maxAttempts:delays.length,dueAt:due(job,cooldownUntil)}:null;
    },
    summary(records,cooldownUntil=()=>0){
      const waiting=candidates(records,cooldownUntil);
      return {waiting:waiting.length,running:active?1:0,exhausted:jobs.filter(j=>j.status==='exhausted').length,attempts:jobs.reduce((n,j)=>n+j.attempts,0),nextAt:waiting.length?Math.min(...waiting.map(x=>x.dueAt)):null};
    }
  };
}
