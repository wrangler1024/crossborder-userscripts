import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {extensionBundle} from '../scripts/extension-bundle.mjs';
import {JSDOM} from 'jsdom';
import {ADS_ORIGIN,NEW_ADS_PATH,OPEN_ONCE_KEY,OPEN_ONCE_QUERY,OPEN_ONCE_TTL,LEGACY_ENTRY_ID,isLegacyAdsPage,openNewAdsAssistant,consumeAssistantOpen,mountLegacyEntry} from '../src/navigation.mjs';

const now=Date.now(),destination=ADS_ORIGIN+NEW_ADS_PATH;
function environment(path='/ad_report/profile/campaign/index?seller_id=private&msku=private'){
  const dom=new JSDOM('<!doctype html><body></body>',{url:ADS_ORIGIN+path});
  const navigations=[];
  const win={document:dom.window.document,URL,sessionStorage:dom.window.sessionStorage,history:dom.window.history,location:{...new URL(dom.window.location.href),origin:ADS_ORIGIN,pathname:path.split('?')[0],href:dom.window.location.href,assign:url=>navigations.push(url)}};
  win.top=win.self=win;
  return {dom,win,navigations,ready:()=>dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'))};
}
test('旧页仅挂一个入口，点击后固定跳新版，不携带店铺与商品查询参数',()=>{
  const f=environment();
  try{
    mountLegacyEntry(f.win);mountLegacyEntry(f.win);f.ready();
    assert.equal(f.navigations.length,0);
    assert.equal(f.win.document.querySelectorAll('#'+LEGACY_ENTRY_ID).length,1);
    f.win.document.getElementById(LEGACY_ENTRY_ID).shadowRoot.querySelector('button').click();
    assert.deepEqual(f.navigations,[destination]);assert.ok(f.win.sessionStorage.getItem(OPEN_ONCE_KEY));
    f.win.location.pathname=NEW_ADS_PATH;f.win.location.href=destination;
    assert.equal(consumeAssistantOpen(f.win),true);assert.equal(consumeAssistantOpen(f.win),false);
  }finally{f.dom.window.close();}
});
test('自动打开请求限同站点主页面，只在新版SP页面消费，普通访问不弹出',()=>{
  const f=environment();
  try{
    openNewAdsAssistant(f.win,now);
    assert.equal(consumeAssistantOpen(f.win,now),false);
    f.win.location.pathname='/amazon/dashboard';assert.equal(consumeAssistantOpen(f.win,now),false);
    f.win.location.pathname=NEW_ADS_PATH;f.win.location.href=destination;
    const frame={...f.win,top:{}};assert.equal(consumeAssistantOpen(frame,now),false);assert.equal(isLegacyAdsPage(frame),false);
    assert.equal(consumeAssistantOpen(f.win,now),true);
    assert.equal(consumeAssistantOpen(f.win,now),false);
    f.win.location.origin='https://example.test';assert.equal(consumeAssistantOpen(f.win,now),false);
    assert.equal(mountLegacyEntry(f.win),null);
  }finally{f.dom.window.close();}
});
test('过期、未来与损坏的打开请求被消费但不会弹出',()=>{
  const f=environment(NEW_ADS_PATH);
  try{
    for(const value of [String(now-OPEN_ONCE_TTL-1),String(now+1),'broken','','Infinity','0']){
      f.win.sessionStorage.setItem(OPEN_ONCE_KEY,value);
      assert.equal(consumeAssistantOpen(f.win,now),false,value);assert.equal(f.win.sessionStorage.getItem(OPEN_ONCE_KEY),null);
    }
  }finally{f.dom.window.close();}
});
test('存储被禁用时使用带时效的URL回退，并在打开前移除标记，保留其他路由信息',()=>{
  const f=environment();
  try{
    Object.defineProperty(f.win,'sessionStorage',{get(){throw new Error('blocked');}});
    openNewAdsAssistant(f.win,now);
    assert.deepEqual(f.navigations,[`${destination}?${OPEN_ONCE_QUERY}=${now}`]);
    f.dom.reconfigure({url:`${f.navigations[0]}&tab=campaign#list`});
    f.win.location=f.dom.window.location;
    assert.equal(consumeAssistantOpen(f.win,now),true);
    assert.equal(f.win.location.href,destination+'?tab=campaign#list');assert.equal(consumeAssistantOpen(f.win,now),false);
    f.dom.reconfigure({url:`${destination}?${OPEN_ONCE_QUERY}=${now-OPEN_ONCE_TTL-1}`});
    assert.equal(consumeAssistantOpen(f.win,now),false);assert.equal(f.win.location.href,destination);
  }finally{f.dom.window.close();}
});
test('无法移除一次性标记时不自动打开，避免每次刷新都弹出',()=>{
  const f=environment(NEW_ADS_PATH+`?${OPEN_ONCE_QUERY}=${now}`);
  try{
    f.win.sessionStorage.setItem(OPEN_ONCE_KEY,String(now));
    f.win.sessionStorage={getItem:()=>String(now),removeItem(){throw new Error('blocked');}};
    f.win.history={replaceState(){throw new Error('blocked');}};
    assert.equal(consumeAssistantOpen(f.win,now),false);
  }finally{f.dom.window.close();}
});
test('生成油猴在旧页不初始化Excel、会话、数据库或广告请求；菜单与按钮都跳新版',async()=>{
  const f=environment(),menus=[];
  try{
    for(const key of ['fetch','XMLHttpRequest','indexedDB','navigator'])Object.defineProperty(f.win,key,{get(){assert.fail(`Legacy entry touched ${key}`);}});
    const dir=new URL('../../../scripts/lingxing-ads-assistant/',import.meta.url);
    const context=vm.createContext({unsafeWindow:f.win,GM_registerMenuCommand:(name,fn)=>menus.push({name,fn})});
    vm.runInContext(await fs.readFile(new URL('lingxing-ads-assistant.runtime.js',dir),'utf8'),context);
    vm.runInContext(await fs.readFile(new URL('lingxing-ads-assistant.user.js',dir),'utf8'),context);
    f.ready();assert.equal(f.win.document.getElementById('lingxing-ad-preview-assistant'),null);
    assert.equal(f.navigations.length,0);assert.equal(menus.length,1);menus[0].fn();assert.equal(f.navigations[0],destination);
  }finally{f.dom.window.close();}
});
test('原生旧页脚本轻量且不挂业务桥，弹窗只允许自身打开消息；两渠道共用一个可见入口',async()=>{
  const f=environment();
  try{
    const {manifest,legacySource:source}=await extensionBundle();
    const old=manifest.content_scripts.filter(c=>c.matches.includes(ADS_ORIGIN+'/ad_report/*'));
    assert.equal(old.length,1);assert.deepEqual(old[0].js,['legacy-entry.js']);assert.equal(old[0].all_frames,false);
    assert.deepEqual(manifest.permissions,['storage']);
    assert.ok(Buffer.byteLength(source)<10000);
    let listener;const chrome={runtime:{id:'own',onMessage:{addListener:fn=>listener=fn}}};
    vm.runInNewContext(source,{window:f.win,chrome});mountLegacyEntry(f.win);f.ready();
    assert.equal(f.win.document.querySelectorAll('#'+LEGACY_ENTRY_ID).length,1);
    const message={type:'LX_ADS_LAUNCHER_CONTROL',action:'open'};let result;
    listener(message,{id:'other'},r=>result=r);assert.equal(result,undefined);assert.equal(f.navigations.length,0);
    listener(message,{id:'own'},r=>result=r);assert.equal(result.ok,true);assert.deepEqual(f.navigations,[destination]);
  }finally{f.dom.window.close();}
});
