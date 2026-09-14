"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
test("real content entry mounts purchase details on an MX order page", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "https://www.shein.com.mx/user/orders/detail/DEMO-ORDER-01",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  try {
    w.chrome = {
      runtime: {
        getURL: (p) => "https://example.invalid/" + p,
        lastError: null,
        onMessage: { addListener() {} },
        sendMessage(m, cb) {
          cb({ ok: true, tasks: [], features: { purchaseDetailsV1: true } });
        },
      },
    };
    for (const file of ["core.js", "purchase-details.js", "content.js"])
      w.eval(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"));
    await new Promise((r) => setTimeout(r, 10));
    const root = w.document.getElementById("xynigo-purchase-assistant-host");
    assert(root);
    assert(!root.querySelector(".xpa-details").hidden);
    assert(root.querySelector('[data-pd="read"]').disabled);
    assert(root.querySelector(".xpa-footer").hidden);
  } finally {
    w.close();
  }
});
