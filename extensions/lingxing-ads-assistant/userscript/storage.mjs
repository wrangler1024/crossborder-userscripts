import {createStorageService} from '../extension/storage-service.mjs';
import {createLauncherSettings} from '../extension/launcher-settings.mjs';

export const USERSCRIPT_DB='lingxing-ads-assistant-v1';
export const USERSCRIPT_LOCK='lingxing-ads-assistant-storage-v1';

// Every request is serialized across tabs by Web Locks. IndexedDB reads are fresh;
// GM_getValue's per-tab cache is deliberately not used for creation claims.
export function createUserscriptTransport({win,indexedDB=win.indexedDB,locks=win.navigator?.locks}={}){
  let database;
  function open(){
    if(database)return database;
    database=new Promise((resolve,reject)=>{
      if(!indexedDB){reject(new Error('当前浏览器不支持本地存储，无法保存预览或创建广告'));return;}
      const request=indexedDB.open(USERSCRIPT_DB,1);let stopped=false;
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records');};
      request.onerror=()=>reject(new Error('本地数据库无法打开，请检查浏览器站点存储设置'));
      request.onblocked=()=>{stopped=true;reject(new Error('本地数据库升级被其他页面占用，请关闭旧领星页后重试'));};
      request.onsuccess=()=>{const db=request.result;if(stopped){db.close();return;}db.onversionchange=()=>{db.close();database=null;};resolve(db);};
    }).catch(error=>{database=null;throw error;});
    return database;
  }
  const storage={
    async get(key){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('records','readonly'),request=tx.objectStore('records').get(key);let value;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve({[key]:value});tx.onabort=tx.onerror=()=>reject(new Error('本地数据读取失败'));});},
    async set(values){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');try{const records=tx.objectStore('records');for(const [key,value] of Object.entries(values))records.put(value,key);}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('本地数据保存失败，未继续创建广告'));});}
  };
  const service=createStorageService(storage),preferences=createLauncherSettings(storage);
  async function locked(run){
    if(!locks?.request)throw new Error('当前浏览器不支持跨页面防重保护，请更新Chrome后重试');
    const controller=new AbortController(),timer=win.setTimeout(()=>controller.abort(),7000);
    try{return await locks.request(USERSCRIPT_LOCK,{mode:'exclusive',signal:controller.signal},()=>{win.clearTimeout(timer);return run();});}
    catch(error){if(error.name==='AbortError')throw new Error('其他页面正在保存，请稍后重试');throw error;}
    finally{win.clearTimeout(timer);}
  }
  return {request:request=>locked(()=>service(request)),preferences:(action,patch)=>locked(()=>preferences({action,preferences:patch}))};
}
