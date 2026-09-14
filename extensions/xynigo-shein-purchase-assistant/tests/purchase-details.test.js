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
