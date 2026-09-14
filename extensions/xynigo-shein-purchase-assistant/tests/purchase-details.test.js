"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(
  path.join(__dirname, "../src/purchase-details.js"),
  "utf8",
);
const tick = () => new Promise((r) => setTimeout(r, 0));
function setup(
  handler,
  health = { ok: true, features: { purchaseDetailsV1: true } },
) {
  const dom = new JSDOM(
    '<aside id="root"><div class="xpa-connection"></div><div class="xpa-body"><div class="xpa-selected"></div><section class="xpa-recipient" hidden></section></div><footer class="xpa-footer"></footer></aside>',
    {
      url: "https://www.shein.com.mx/user/orders/detail/DEMO-ORDER-001",
      runScripts: "outside-only",
    },
  );
  const w = dom.window;
  w.eval(source);
  let task = { taskKey: "PT1-" + "a".repeat(64) };
  const calls = [];
  const send = async (m) => {
    calls.push(m);
    if (m.type === "EXECUTOR_HEALTH") return health;
    return handler(m);
  };
  const root = w.document.getElementById("root");
  const controller = w.XynigoPurchaseDetails.mount(
    root,
    send,
    () => task,
    () => {},
  );
  const q = (k) => root.querySelector('[data-pd="' + k + '"]');
  return {
    dom,
    w,
    root,
    q,
    calls,
    controller,
    setTask: (t) => {
      task = t;
      controller.taskChanged();
    },
  };
}
const capture = {
  ok: true,
  captureId: "demo-capture",
  order: { orderNo: "DEMO-ORDER-001", amount: "110.02", currency: "MXN" },
  image: "demo",
  target: { targetLabel: "演示协作表", sheetName: "采购执行", rowCount: 3 },
};
async function read(x) {
  x.q("env").value = "123";
  x.q("read").click();
  await tick();
  await tick();
}
function confirm(x) {
  x.q("confirm").checked = true;
  x.q("confirm").dispatchEvent(new x.w.Event("change"));
}

test("reads evidence, requires explicit confirmation, blocks repeat submit", async () => {
  const x = setup((m) =>
    m.action === "read"
      ? capture
      : { ok: true, state: "complete", message: "已回传" },
  );
  try {
    await read(x);
    assert.equal(x.q("money").textContent, "110.02 MXN");
    assert(x.q("submit").disabled);
    confirm(x);
    x.q("submit").click();
    x.q("submit").click();
    await tick();
    assert.equal(x.calls.filter((m) => m.action === "submit").length, 1);
    assert(x.q("submit").disabled);
  } finally {
    x.dom.window.close();
  }
});
test("task change discards evidence and confirmation", async () => {
  const x = setup(() => capture);
  try {
    await read(x);
    confirm(x);
    x.setTask({ taskKey: "PT1-" + "b".repeat(64) });
    assert(x.q("fields").hidden);
    assert(x.q("submit").disabled);
    assert.equal(x.q("image").getAttribute("src"), null);
  } finally {
    x.dom.window.close();
  }
});
test("ambiguous response offers status instead of blind retry", async () => {
  const x = setup((m) =>
    m.action === "read" ? capture : { ok: false, code: "executor_unreachable" },
  );
  try {
    await read(x);
    confirm(x);
    x.q("submit").click();
    await tick();
    assert(x.q("submit").disabled);
    assert(!x.q("status").hidden);
    x.q("status").click();
    await tick();
    assert.equal(x.calls.at(-1).action, "status");
  } finally {
    x.dom.window.close();
  }
});
test("partial result only enables image retry", async () => {
  const x = setup((m) =>
    m.action === "read"
      ? capture
      : { ok: true, state: "image_failed", message: "截图待补传" },
  );
  try {
    await read(x);
    confirm(x);
    x.q("submit").click();
    await tick();
    assert(!x.q("retry").hidden);
    x.q("retry").click();
    await tick();
    assert.equal(x.calls.at(-1).action, "retry-image");
  } finally {
    x.dom.window.close();
  }
});
test("older executors cannot write evidence", async () => {
  const x = setup(
    () => {
      throw Error("unexpected");
    },
    { ok: true, features: {} },
  );
  try {
    await read(x);
    assert(x.q("submit").disabled);
    assert.equal(
      x.calls.filter((m) => m.type === "PURCHASE_DETAILS").length,
      0,
    );
    assert.match(x.q("message").textContent, /升级/);
  } finally {
    x.dom.window.close();
  }
});

test("pending read shows dynamic progress and clears it after completion", async () => {
  let resolve;
  const x=setup(()=>new Promise(r=>{resolve=r;}));
  try {
    await read(x);
    assert.equal(x.q('progress').hidden,false);
    assert.match(x.q('progress-title').textContent,/读取订单/);
    assert.match(x.q('elapsed').textContent,/0 秒/);
    assert(x.q('read').disabled);
    resolve(capture); await tick();
    assert.equal(x.q('progress').hidden,true);
    assert.equal(x.q('read').disabled,false);
  } finally {x.dom.window.close();}
});

test("rejected submit clears progress and offers status without replay", async () => {
  const x=setup(m=>m.action==='read'?capture:Promise.reject(Error('lost')));
  try {
    await read(x);confirm(x);x.q('submit').click();await tick();
    assert(x.q('progress').hidden);
    assert(!x.q('status').hidden);
    assert(x.q('submit').disabled);
    assert.match(x.q('message').textContent,/查询/);
  } finally {x.dom.window.close();}
});

test('fill defaults to none each read and forwards only the selected preset',async()=>{
 const x=setup(m=>m.action==='read'?{...capture,features:{fillColorV1:true}}:{ok:true,state:'complete'});
 try{
  await read(x);
  const inputs=()=>Array.from(x.q('colors').querySelectorAll('input'));
  assert.equal(inputs().length,8);assert.equal(inputs().find(i=>i.checked).value,'');
  inputs().find(i=>i.value==='#E2F0D9').checked=true;
  confirm(x);x.q('submit').click();await tick();
  assert.equal(x.calls.find(m=>m.action==='submit').fillColor,'#E2F0D9');
  x.q('revise').click();await read(x);
  assert.equal(inputs().find(i=>i.checked).value,'');
 }finally{x.dom.window.close();}
});

test('color failure retries only color',async()=>{
 const x=setup(m=>m.action==='read'?{...capture,features:{fillColorV1:true}}:
  {ok:true,state:'complete',color:{state:m.action==='submit'?'failed':'complete'}});
 try{
  await read(x);confirm(x);x.q('submit').click();await tick();
  assert.equal(x.q('retry-color').hidden,false);
  x.q('retry-color').click();await tick();
  assert.equal(x.calls.at(-1).action,'retry-color');
  assert.equal(x.calls.filter(m=>m.action==='submit').length,1);
 }finally{x.dom.window.close();}
});

test('async submit polls without treating acknowledgment as success',async()=>{
 const x=setup(m=>m.action==='read'?{...capture,features:{asyncSubmitV1:true}}:
  m.action==='submit'?{ok:true,state:'processing'}:{ok:true,state:'complete',message:'已回传'});
 try{
  await read(x);confirm(x);x.q('submit').click();await tick();
  assert.equal(x.q('progress').hidden,false);
  assert.notEqual(x.q('submit').textContent,'✓ 已回传');
  await new Promise(r=>setTimeout(r,1100));
  assert.equal(x.q('submit').textContent,'✓ 已回传');
  assert.equal(x.calls.filter(m=>m.action==='submit').length,1);
  assert.equal(x.calls.find(m=>m.action==='submit').async,true);
 }finally{x.dom.window.close();}
});

test('late submit result never labels a different selected task complete',async()=>{
 let resolve;
 const x=setup(m=>m.action==='read'?capture:new Promise(r=>{resolve=r;}));
 try{
  await read(x);confirm(x);x.q('submit').click();await tick();
  x.setTask({taskKey:'PT1-'+'c'.repeat(64)});
  resolve({ok:true,state:'complete',message:'已回传'});await tick();
  assert.equal(x.q('fields').hidden,true);
  assert.notEqual(x.q('submit').textContent,'✓ 已回传');
  assert.equal(x.q('message').textContent,'');
 }finally{x.dom.window.close();}
});
