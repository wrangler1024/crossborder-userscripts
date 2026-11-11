import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import XLSX from '../vendor/xlsx.full.min.cjs';
import {installMockERP} from './fixtures/userscript-erp.mjs';
import {extensionBundle} from '../scripts/extension-bundle.mjs';
import {OPEN_ONCE_KEY} from '../src/navigation.mjs';

async function waitFor(check){for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('UI did not reach expected state');}
test('生成油猴包显示部分预览与1/1计数，12条异常分页定位不触发广告提交',async()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://ads.lingxing.com/amazon/adapter-test',runScripts:'outside-only',pretendToBeVisual:true});
  try{
    const w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});Object.assign(w,{unsafeWindow:w,TextEncoder,indexedDB:new IDBFactory(),structuredClone,GM_registerMenuCommand:()=>{}});Object.defineProperty(w.navigator,'locks',{value:{request:(_n,_o,fn)=>fn()}});
    const products=Array.from({length:13},(_,i)=>({sku:`SKU-VALIDATION-${i+1}`,asin:'B0'+String(1000+i).padStart(8,'0'),profile_id:'123',sku_status:'1',afn_fulfillable_quantity:20}));
    installMockERP(w,{products});for(const kind of ['runtime','user'])w.eval(await fs.readFile(new URL(`../../../scripts/lingxing-ads-assistant/lingxing-ads-assistant.${kind}.js`,import.meta.url),'utf8'));
    await waitFor(()=>w.document.getElementById('lingxing-ad-preview-assistant'));w.__adapterTest.session();const s=w.document.getElementById('lingxing-ad-preview-assistant').shadowRoot;
    await waitFor(()=>!s.querySelector('#backup-import').disabled);s.querySelector('.dock-handle').click();s.querySelector('#auto-retry').click();
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],...products.map((p,i)=>['测试-CA',p.sku,p.asin,i===12?'':'word',i===12?'':'B000000002\nB000000003'])]),'广告导入');
    const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});Object.defineProperty(s.querySelector('#file'),'files',{value:[{name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes}]});s.querySelector('#file').dispatchEvent(new w.Event('change'));
    await waitFor(()=>!s.querySelector('#run').disabled);s.querySelector('#run').click();await waitFor(()=>!s.querySelector('#run').disabled&&s.querySelector('#summary').textContent.includes('25/37活动'));
    const cards=s.querySelectorAll('.record');assert.equal(cards[0].querySelector('.record-status').textContent,'部分预览');assert.equal(cards[0].querySelector('.record-count').textContent,'可创建 2/3 活动');assert.equal(cards[12].querySelector('.record-count').textContent,'可创建 1/1 活动');assert.equal(cards[0].querySelector('.record-footer').textContent.includes('测试-CA'),false);
    assert.match(s.querySelector('#validation-summary').textContent,/12 个活动未生成/);s.querySelector('#validation-open').click();assert.equal(s.querySelector('.validation-overlay').hidden,false);assert.equal(s.querySelectorAll('.validation-table tbody tr').length,10);
    s.querySelector('#validation-next').click();assert.equal(s.querySelectorAll('.validation-table tbody tr').length,2);assert.match(s.querySelector('.validation-range').textContent,/11–12 \/ 12/);
    s.querySelector('.validation-locate').click();assert.equal(s.querySelector('.validation-overlay').hidden,true);assert.equal(s.querySelector('.record.selected').dataset.msku,'SKU-VALIDATION-11');assert.equal(s.querySelector('.campaign.validation-focus').dataset.channel,'targets');
    s.querySelector('#validation-open').click();assert.equal(s.querySelector('.validation-page').textContent,'2 / 2');s.querySelector('.validation-close').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(s.querySelector('.validation-overlay').hidden,true);assert.equal(Boolean(s.querySelector('.workspace').inert),false);assert.equal(w.__adapterTest.submissions.length,0);
  }finally{dom.window.close();}
});
for(const channel of ['extension','userscript'])test(`${channel}旧版跳转标记只打开一次助手，未触发校验或提交`,async()=>{
  const source=channel==='extension'?(await extensionBundle()).source:await fs.readFile(new URL('../../../scripts/lingxing-ads-assistant/lingxing-ads-assistant.runtime.js',import.meta.url),'utf8');
  const loader=channel==='userscript'?await fs.readFile(new URL('../../../scripts/lingxing-ads-assistant/lingxing-ads-assistant.user.js',import.meta.url),'utf8'):'';
  let marker=String(Date.now());
  for(const expectedOpen of [true,false]){
    const dom=new JSDOM('<!doctype html><body></body>',{url:'https://ads.lingxing.com/amazon/list-sp',runScripts:'outside-only',pretendToBeVisual:true});
    try{
      const w=dom.window;let reads=0;
      Object.assign(w,{unsafeWindow:w,TextEncoder,indexedDB:new IDBFactory(),structuredClone,GM_registerMenuCommand:()=>{},fetch:async()=>{reads++;throw new Error('Opening the panel must not fetch ERP data');}});
      Object.defineProperty(w.navigator,'locks',{value:{request:(_n,_o,fn)=>fn()}});
      if(marker)w.sessionStorage.setItem(OPEN_ONCE_KEY,marker);
      w.eval(source);if(loader)w.eval(loader);
      await waitFor(()=>w.document.getElementById('lingxing-ad-preview-assistant'));
      const shadow=w.document.getElementById('lingxing-ad-preview-assistant').shadowRoot;
      assert.equal(!shadow.querySelector('.backdrop').hidden,expectedOpen);
      assert.equal(shadow.querySelector('#run').disabled,true);
      assert.equal(shadow.querySelector('#create-ads').disabled,true);
      assert.equal(reads,0);marker=w.sessionStorage.getItem(OPEN_ONCE_KEY);assert.equal(marker,null);
    }finally{dom.window.close();}
  }
});
for(const stock of [20,0])test(`实际生成油猴包库存${stock}完成导入、预览调整、三活动确认、回读和刷新后防重`,async()=>{
  const source=await fs.readFile(new URL('../../../scripts/lingxing-ads-assistant/lingxing-ads-assistant.user.js',import.meta.url),'utf8');
  const runtime=await fs.readFile(new URL('../../../scripts/lingxing-ads-assistant/lingxing-ads-assistant.runtime.js',import.meta.url),'utf8');
  const db=new IDBFactory();let tail=Promise.resolve();
  const locks={request:(_name,_opts,fn)=>{const task=tail.then(fn);tail=task.catch(()=>{});return task;}};
  const open=()=>{
    const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://ads.lingxing.com/amazon/adapter-test',runScripts:'outside-only',pretendToBeVisual:true});
    const w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});Object.assign(w,{unsafeWindow:w,TextEncoder,indexedDB:db,structuredClone,GM_registerMenuCommand:()=>{},confirm:()=>true});Object.defineProperty(w.navigator,'locks',{value:locks});
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    installMockERP(w,{stock});w.eval(runtime);w.eval(source);return {dom,w};
  };
  const first=open();
  try{
    await waitFor(()=>first.w.document.getElementById('lingxing-ad-preview-assistant'));first.w.__adapterTest.session();
    const s=first.w.document.getElementById('lingxing-ad-preview-assistant').shadowRoot;
    await waitFor(()=>s.querySelector('#backup-import').disabled===false);
    s.querySelector('.dock-handle').click();s.querySelector('#auto-retry').click();
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],['测试-CA','SKU-ADAPTER-TEST','B000000001','rug pad\nrug tape','B000000002\nB000000003\nB000000004']]),'广告导入');
    const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});const file={name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes};
    Object.defineProperty(s.querySelector('#file'),'files',{value:[file]});s.querySelector('#file').dispatchEvent(new first.w.Event('change'));
    await waitFor(()=>!s.querySelector('#run').disabled);s.querySelector('#run').click();await waitFor(()=>s.querySelector('#summary').textContent.includes('已生成 3/3活动'));
    s.querySelector('.remove-keyword').click();
    const selected=s.querySelector('.campaign[data-channel=auto] input[type=checkbox]');selected.click();
    assert.equal(first.w.__adapterTest.submissions.length,0);
    s.querySelector('#create-ads').click();await waitFor(()=>s.querySelector('#confirm-create')&&!s.querySelector('#confirm-create').disabled);
    assert.equal(s.querySelector('#creation-state option[value=enabled]').disabled,stock<10);
    if(stock===0)assert.match(s.querySelector('.creation-table').textContent,/仅可暂停创建/);
    s.querySelector('#confirm-create').click();await waitFor(()=>s.querySelector('.creation-message').textContent.includes('已完成 3'));
    assert.equal(first.w.__adapterTest.submissions.length,3);
    const [a,k,t]=first.w.__adapterTest.submissions;
    assert.equal(a.groups[0].campaigns[0].state,'paused');assert.equal(a.groups[0].campaigns[0].ad_groups[0].targets.filter(x=>x.state==='enabled').length,3);
    assert.equal(k.groups[0].campaigns[0].ad_groups[0].keywords.length,1);assert.equal(t.groups[0].campaigns[0].ad_groups[0].targets.length,3);
    await waitFor(()=>s.querySelector('#storage-message').textContent.includes('已自动保存'));
    const second=open();try{
      await waitFor(()=>second.w.document.getElementById('lingxing-ad-preview-assistant'));second.w.__adapterTest.session();const restored=second.w.document.getElementById('lingxing-ad-preview-assistant').shadowRoot;
      await waitFor(()=>restored.querySelector('#summary').textContent.includes('已生成 3/3活动'));
      assert.equal(restored.querySelector('#auto-retry').checked,false);restored.querySelector('#create-ads').click();
      await waitFor(()=>restored.querySelector('.creation-summary')?.textContent.includes('3 条创建记录'));
      assert.equal(restored.querySelector('#confirm-create').disabled,true);assert.equal(second.w.__adapterTest.submissions.length,0);
    }finally{second.dom.window.close();}
  }finally{first.dom.window.close();}
});
test('混合库存批次默认全部暂停，取消低库存选择后才可启用，再选低库存时恢复暂停',async()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://ads.lingxing.com/amazon/adapter-test',runScripts:'outside-only',pretendToBeVisual:true});
  try{
    const w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});Object.assign(w,{unsafeWindow:w,TextEncoder,indexedDB:new IDBFactory(),structuredClone,GM_registerMenuCommand:()=>{}});
    Object.defineProperty(w.navigator,'locks',{value:{request:(_n,_o,fn)=>fn()}});
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
    installMockERP(w,{products:[{sku:'SKU-ZERO',asin:'B000000001',profile_id:'123',sku_status:'1',afn_fulfillable_quantity:0},{sku:'SKU-TEN',asin:'B000000010',profile_id:'123',sku_status:'1',afn_fulfillable_quantity:10}]});
    for(const kind of ['runtime','user'])w.eval(await fs.readFile(new URL(`../../../scripts/lingxing-ads-assistant/lingxing-ads-assistant.${kind}.js`,import.meta.url),'utf8'));
    await waitFor(()=>w.document.getElementById('lingxing-ad-preview-assistant'));w.__adapterTest.session();
    const s=w.document.getElementById('lingxing-ad-preview-assistant').shadowRoot;
    await waitFor(()=>!s.querySelector('#backup-import').disabled);s.querySelector('.dock-handle').click();s.querySelector('#auto-retry').click();
    const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['店铺','MSKU','ASIN','KEYWORDS','TARGET_ASIN'],['测试-CA','SKU-ZERO','B000000001','',''],['测试-CA','SKU-TEN','B000000010','','']]),'广告导入');
    const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
    Object.defineProperty(s.querySelector('#file'),'files',{value:[{name:'mixed.xlsx',size:bytes.length,arrayBuffer:async()=>bytes}]});s.querySelector('#file').dispatchEvent(new w.Event('change'));
    await waitFor(()=>!s.querySelector('#run').disabled);s.querySelector('#run').click();await waitFor(()=>s.querySelector('#summary').textContent.includes('已生成 2/2活动'));
    const warning=s.querySelector('.record[data-msku="SKU-ZERO"] .stock-warning');
    warning.dispatchEvent(new w.Event('pointerenter'));
    assert.equal(s.querySelector('#stock-tooltip').hidden,false);assert.equal(s.querySelector('#stock-tooltip').textContent,'可售库存不足，仅可暂停创建');
    warning.dispatchEvent(new w.Event('pointerleave'));assert.equal(s.querySelector('#stock-tooltip').hidden,true);
    s.querySelector('#create-ads').click();await waitFor(()=>s.querySelector('#confirm-create')&&!s.querySelector('#confirm-create').disabled);
    const mode=s.querySelector('#creation-state');assert.equal(mode.value,'paused');assert.equal(mode.querySelector('[value=enabled]').disabled,true);
    s.querySelector('.creation-table input[aria-label^="创建SKU-ZERO"]').click();assert.equal(mode.querySelector('[value=enabled]').disabled,false);
    mode.value='enabled';mode.dispatchEvent(new w.Event('change'));assert.equal(mode.value,'enabled');
    s.querySelector('.creation-table input[aria-label^="创建SKU-ZERO"]').click();assert.equal(mode.value,'paused');assert.equal(mode.querySelector('[value=enabled]').disabled,true);
    s.querySelector('#confirm-create').click();await waitFor(()=>s.querySelector('.creation-message').textContent.includes('已完成 2'));
    assert.equal(w.__adapterTest.submissions.length,2);assert.ok(w.__adapterTest.submissions.every(p=>p.groups[0].campaigns[0].state==='paused'));
  }finally{dom.window.close();}
});
