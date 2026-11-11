import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createLauncherSettings,LAUNCHER_SETTINGS_KEY} from '../extension/launcher-settings.mjs';
import {JSDOM} from 'jsdom';
import {mountEdgeLauncher} from '../src/launcher.mjs';

test('圆形入口菜单不误开助手，隐藏可恢复，拖动后不误点击且键盘可移动',async()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://ads.lingxing.com/amazon/list-sp',pretendToBeVisual:true});
  const win=dom.window,host=win.document.createElement('div');win.document.body.append(host);const shadow=host.attachShadow({mode:'open'});
  const el=(tag,attrs={},...children)=>{const n=win.document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else if(v!==false)n.setAttribute(k,String(v));}for(const c of children.flat())n.append(c instanceof win.Node?c:String(c));return n;};
  const writes=[];let prefs={hidden:false,position:.5},opens=0;
  const app=mountEdgeLauncher({win,host,shadow,el,onOpen:()=>opens++,transport:async(action,patch)=>{if(action==='write'){writes.push(patch);prefs={...prefs,...patch};}return prefs;}});
  const settle=()=>new Promise(r=>setTimeout(r,0));
  try{
    await settle();const dock=shadow.querySelector('.ads-dock'),handle=shadow.querySelector('.dock-handle'),toggle=shadow.querySelector('.dock-menu-toggle'),menu=shadow.querySelector('.dock-menu');
    assert.ok(handle.querySelector('svg'));
    toggle.click();assert.equal(menu.hidden,false);assert.equal(opens,0);
    toggle.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert.equal(shadow.activeElement,menu.querySelector('button'));
    menu.dispatchEvent(new win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(menu.hidden,true);assert.equal(shadow.activeElement,handle);
    toggle.click();win.document.body.dispatchEvent(new win.MouseEvent('pointerdown',{bubbles:true}));assert.equal(menu.hidden,true);
    toggle.click();menu.querySelector('button').click();await settle();assert.equal(dock.hidden,true);assert.equal(opens,0);assert.equal(prefs.hidden,true);
    app.show();await settle();assert.equal(dock.hidden,false);
    let captured=false;handle.setPointerCapture=()=>captured=true;handle.hasPointerCapture=()=>captured;handle.releasePointerCapture=()=>captured=false;
    const pointer=(type,y)=>{const e=new win.MouseEvent(type,{bubbles:true,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:1});handle.dispatchEvent(e);};
    pointer('pointerdown',150);pointer('pointermove',350);pointer('pointerup',350);handle.click();await settle();assert.equal(opens,0);assert.ok(writes.some(v=>'position'in v));
    handle.click();assert.equal(opens,1);
    handle.dispatchEvent(new win.KeyboardEvent('keydown',{key:'End',bubbles:true}));await settle();assert.equal(prefs.position,1);
    app.setPanelOpen(true);assert.equal(dock.hidden,true);app.setPanelOpen(false);assert.equal(dock.hidden,false);
    shadow.querySelector('.dock-open').click();assert.equal(opens,2);
  }finally{app.dispose();dom.window.close();}
});

test('入口位置和隐藏状态并发保存互不覆盖，也不触碰业务预览和创建记录',async()=>{
  const data={'ads-preview-v1:existing':{draft:'keep'},'ads-execution-v1:existing':{entries:'keep'}};
  const service=createLauncherSettings({get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)});
  assert.deepEqual(await service({action:'read'}),{hidden:false,position:.5});
  await Promise.all([service({action:'write',preferences:{hidden:true}}),service({action:'write',preferences:{position:.8}})]);
  assert.deepEqual(await service({action:'read'}),{hidden:true,position:.8});
  assert.deepEqual(data['ads-preview-v1:existing'],{draft:'keep'});assert.deepEqual(data['ads-execution-v1:existing'],{entries:'keep'});
  assert.deepEqual(Object.keys(data).sort(),['ads-execution-v1:existing',LAUNCHER_SETTINGS_KEY,'ads-preview-v1:existing'].sort());
});
test('异常入口偏好不能写入任意字段，越界位置被约束，损坏旧值可恢复',async()=>{
  const data={[LAUNCHER_SETTINGS_KEY]:{hidden:'yes',position:'far'}};
  const service=createLauncherSettings({get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)});
  assert.deepEqual(await service({action:'read'}),{hidden:false,position:.5});
  for(const preferences of [{hidden:1},{position:NaN},{draft:'overwrite'}])await assert.rejects(service({action:'write',preferences}),/格式/);
  assert.deepEqual(await service({action:'write',preferences:{position:9}}),{hidden:false,position:1});
});
test('入口桥只接受同页偏好请求，扩展打开命令不会产生ERP请求',async()=>{
  const calls=[],posted=[];let incoming,runtimeListener;const win={addEventListener:(_,fn)=>incoming=fn,postMessage:v=>posted.push(v)};win.top=win.self=win;
  const chrome={runtime:{id:'own',lastError:null,sendMessage:(m,cb)=>{calls.push(m);cb({ok:true,result:{hidden:false,position:.5}})},onMessage:{addListener:fn=>runtimeListener=fn}}};
  const origin='https://ads.lingxing.com';
  vm.runInNewContext(await fs.readFile(new URL('../extension/launcher-bridge.js',import.meta.url),'utf8'),{window:win,location:{origin},chrome,document:{getElementById:()=>({hasAttribute:()=>true})}});
  const message={type:'LX_ADS_LAUNCHER_REQUEST',id:'one',action:'read'};
  incoming({source:{},origin,data:message});incoming({source:win,origin:'https://elsewhere.test',data:message});incoming({source:win,origin,data:{...message,action:'submit'}});assert.equal(calls.length,0);
  incoming({source:win,origin,data:message});assert.equal(calls.length,1);assert.equal(calls[0].type,'LX_ADS_LAUNCHER_PREFS');
  let result;runtimeListener({type:'LX_ADS_LAUNCHER_CONTROL',action:'open'},{id:'other'},r=>result=r);assert.equal(result,undefined);
  runtimeListener({type:'LX_ADS_LAUNCHER_CONTROL',action:'open'},{id:'own'},r=>result=r);assert.equal(result.ok,true);assert.equal(posted.at(-1).action,'open');assert.equal(calls.length,1);
});
test('后台入口偏好接口拒绝其他来源和iframe，允许自身弹窗及领星主页面',async()=>{
  let listener,calls=0;const chrome={runtime:{id:'own',getURL:p=>'chrome-extension://own/'+p,onMessage:{addListener:fn=>listener=fn}},storage:{local:{setAccessLevel:async()=>{}}}};
  const source=(await fs.readFile(new URL('../extension/background.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source,{chrome,createStorageService:()=>()=>{throw new Error('不应访问业务记录')},createLauncherSettings:()=>async()=>{calls++;return {hidden:true,position:.5}}});
  const message={type:'LX_ADS_LAUNCHER_PREFS',action:'write',preferences:{hidden:true}};
  for(const sender of [{id:'other',url:'chrome-extension://own/popup.html'},{id:'own',url:'https://example.com',frameId:0},{id:'own',url:'https://ads.lingxing.com/amazon/list-sp',frameId:1}])assert.equal(listener(message,sender,()=>{}),undefined);
  for(const sender of [{id:'own',url:'chrome-extension://own/popup.html'},{id:'own',url:'https://ads.lingxing.com/amazon/list-sp',frameId:0}])await new Promise(resolve=>assert.equal(listener(message,sender,r=>{assert.equal(r.ok,true);resolve()}),true));
  assert.equal(calls,2);
});
async function popupFixture({fail=false}={}){
  const elements=Object.fromEntries(['open-assistant','show-entry','popup-status'].map(id=>[id,{disabled:true,checked:false,textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn}}]));
  const commands=[];let closed=false;
  vm.runInNewContext(await fs.readFile(new URL('../extension/popup.js',import.meta.url),'utf8'),{document:{getElementById:id=>elements[id]},window:{close:()=>closed=true},chrome:{runtime:{sendMessage:async()=>({ok:true,result:{hidden:true,position:.2}})},tabs:{query:async()=>[{id:42}],sendMessage:async(id,message)=>{commands.push({id,...message});if(fail)throw new Error('no receiver');return {ok:true}}}}});
  await Promise.resolve();await Promise.resolve();return {elements,commands,isClosed:()=>closed};
}
test('隐藏侧边入口后弹窗仍能只打开当前页助手，不发创建命令',async()=>{
  const f=await popupFixture();assert.equal(f.elements['show-entry'].checked,false);
  await f.elements['open-assistant'].events.click();assert.equal(f.isClosed(),true);assert.equal(f.commands.length,1);assert.equal(f.commands[0].id,42);assert.equal(f.commands[0].action,'open');
});
test('当前页未加载插件时弹窗提示刷新，保留领星入口而不假报成功',async()=>{
  const f=await popupFixture({fail:true});await f.elements['open-assistant'].events.click();assert.equal(f.isClosed(),false);assert.match(f.elements['popup-status'].textContent,/刷新/);assert.equal(f.elements['open-assistant'].disabled,false);
});
