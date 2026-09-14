/* Purchase evidence UI. Only the authenticated executor reads and writes evidence. */
(function (global) {
  "use strict";
  function mount(root, send, getTask, setBusy) {
    const marker = crypto.randomUUID();
    document.documentElement.setAttribute("data-xynigo-receipt-tab", marker);
    const body = root.querySelector(".xpa-body");
    const footer = root.querySelector(".xpa-footer");
    const addressNodes = Array.from(body.children).filter(
      (e) =>
        !e.matches(
          ".xpa-section-label,.xpa-task-search,.xpa-task-list,.xpa-selected",
        ),
    );
    const addressGroup = document.createElement("div");
    body.append(addressGroup);
    addressNodes.forEach((e) => addressGroup.append(e));
    const tabs = document.createElement("div");
    tabs.className = "xpa-detail-tabs";
    tabs.innerHTML =
      '<button type="button" aria-pressed="true">收件信息</button><button type="button" aria-pressed="false">采购详情</button>';
    root.querySelector(".xpa-connection").after(tabs);
    const panel = document.createElement("section");
    panel.className = "xpa-details";
    panel.hidden = true;
    panel.innerHTML =
      '<label>当前 HubStudio 环境序号<input data-pd="env" autocomplete="off" placeholder="输入当前环境序号"></label>' +
      '<button type="button" data-pd="read">读取订单并截图</button><p class="xpa-pd-note">墨西哥站订单详情页 · 回传前核对当前任务</p>' +
      '<div data-pd="fields" hidden><dl><dt>采购订单号</dt><dd data-pd="order"></dd><dt>实际付款</dt><dd class="xpa-pd-money" data-pd="money"></dd><dt>付款状态</dt><dd>已付款</dd></dl>' +
      '<button type="button" data-pd="preview">预览下单截图</button><img data-pd="image" alt="当前采购订单详情截图" hidden>' +
      '<p data-pd="target" class="xpa-pd-note"></p><div data-pd="existing" hidden></div>' +
      '<label data-pd="reason-label" hidden>修订 / 重新下单原因<input data-pd="reason" maxlength="300" placeholder="填写原因，历史订单与截图保留"></label>' +
      '<fieldset data-pd="colors" class="xpa-pd-colors" hidden><legend>回传成功后填色 · 当前任务 A～AR 列</legend></fieldset>' +
      '<label class="xpa-pd-confirm"><input type="checkbox" data-pd="confirm">已核对任务、订单金额和截图，本次付款只记录一次</label>' +
      '<button type="button" data-pd="submit" disabled>确认回传</button></div>' +
      '<div data-pd="progress" class="xpa-pd-progress" role="status" hidden><span class="xpa-pd-spinner" aria-hidden="true"></span><div><strong data-pd="progress-title"></strong><span data-pd="elapsed"></span><p data-pd="progress-note"></p></div></div>' +
      '<div data-pd="message" aria-live="polite"></div><button type="button" data-pd="status" hidden>查询回传结果</button>' +
      '<button type="button" data-pd="retry-color" hidden>仅重试填色</button><button type="button" data-pd="retry" hidden>仅补传截图</button><button type="button" data-pd="revise" hidden>修订 / 重新下单</button>';
    body.append(panel);
    const q = (key) => panel.querySelector('[data-pd="' + key + '"]');
    const colors = [["不填色",""],["浅绿","#E2F0D9"],["浅蓝","#DDEBF7"],["浅黄","#FFF2CC"],["浅橙","#FCE4D6"],["浅粉","#F4DCE6"],["浅紫","#E4DFEC"],["浅青","#DDF2EF"]];
    colors.forEach(([name, value]) => {
      const label=document.createElement("label");
      const input=document.createElement("input");
      input.type="radio"; input.name="receipt-color-"+marker; input.value=value; input.checked=!value;
      const swatch=document.createElement("span");swatch.className="xpa-pd-swatch";swatch.style.backgroundColor=value||"transparent";
      swatch.setAttribute("aria-hidden","true");
      label.append(input,swatch,document.createTextNode(name));q("colors").append(label);
    });
    let capture = null,
      locked = false,
      sent = false,
      revision = 0,
      selectedKey = "",
      contextUrl = location.href;
    const text = (key, value) => {
      q(key).textContent = String(value || "");
    };
    const message = (value) => text("message", value);
    function update() {
      q("submit").disabled =
        locked || sent || !capture || !q("confirm").checked;
      q("read").disabled = locked || sent || !getTask();
      q("env").disabled = locked || sent;
      q("reason").disabled = locked || sent;
      q("confirm").disabled = locked || sent;
      q("status").disabled = locked;
      q("retry").disabled = locked;
      q("revise").disabled = locked;
      q("retry-color").disabled = locked;
      q("colors").hidden = !capture?.features?.fillColorV1;
      q("colors").querySelectorAll("input").forEach(input => {input.disabled=locked||sent||!capture?.features?.fillColorV1;});
    }
    let progressTimer = null;
    function progress(title, note) {
      clearInterval(progressTimer);
      const started = Date.now();
      q("progress").hidden = false;
      text("progress-title", title);
      text("progress-note", note);
      const render = () => text("elapsed", "已等待 " + Math.floor((Date.now()-started)/1000) + " 秒");
      render();
      progressTimer = setInterval(render, 1000);
    }
    function busy(value) {
      locked = value;
      panel.setAttribute("aria-busy", String(value));
      if (!value) {
        clearInterval(progressTimer);
        progressTimer = null;
        q("progress").hidden = true;
      }
      setBusy(value);
      update();
    }
    function clear() {
      revision++;
      capture = null;
      sent = false;
      q("confirm").checked = false;
      q("fields").hidden = true;
      q("image").hidden = true;
      q("image").removeAttribute("src");
      q("status").hidden = true;
      q("retry").hidden = true;
      q("revise").hidden = true;
      q("retry-color").hidden = true;
      q("colors").querySelectorAll("input").forEach(input=>{input.checked=!input.value;});
      text("submit", "确认回传");
      q("reason").value = "";
      message("");
      update();
    }
    function taskChanged() {
      const key = getTask()?.taskKey || "";
      if (key !== selectedKey) {
        selectedKey = key;
        clear();
      }
      update();
    }
    const tabButtons = tabs.querySelectorAll("button");
    tabButtons.forEach((button, i) =>
      button.addEventListener("click", () => {
        if (locked) return;
        panel.hidden = i === 0;
        addressGroup.hidden = i === 1;
        footer.hidden = i === 1;
        tabButtons.forEach((b, j) =>
          b.setAttribute("aria-pressed", String(i === j)),
        );
        taskChanged();
      }),
    );
    q("confirm").addEventListener("change", update);
    q("preview").addEventListener("click", () => {
      q("image").hidden = !q("image").hidden;
      text("preview", q("image").hidden ? "预览下单截图" : "收起截图");
    });
    q("env").addEventListener("input", clear);
    q("read").addEventListener("click", async () => {
      if (locked || sent || !getTask()) return;
      clear();
      const current = revision;
      busy(true);
      progress("正在连接执行器", "请保持当前订单页面打开");
      message("");
      try {
        const health = await send({ type: "EXECUTOR_HEALTH", light: true });
        if (
          !health?.health?.features?.purchaseDetailsV1 &&
          !health?.features?.purchaseDetailsV1
        ) {
          message("请升级到支持采购详情的 Xynigo 执行器");
          return;
        }
        progress("正在读取订单并生成截图", "截图时面板将短暂收起，请保持当前订单页面打开");
        const result = await send({
          type: "PURCHASE_DETAILS",
          action: "read",
          taskKey: getTask().taskKey,
          identifier: q("env").value.trim(),
          marker,
          pageUrl: location.href,
        });
        if (current !== revision) return;
        if (!result?.ok) {
          message(result?.error || "读取失败，请重新检查环境与任务");
          return;
        }
        capture = result;
        contextUrl = location.href;
        q("fields").hidden = false;
        text("order", result.order.orderNo);
        text("money", result.order.amount + " " + result.order.currency);
        q("image").src = "data:image/jpeg;base64," + result.image;
        text(
          "target",
          "回传至：" +
            result.target.targetLabel +
            " / " +
            result.target.sheetName +
            " · " +
            result.target.rowCount +
            " 个商品行，实付记一次",
        );
        const existing = result.target.existing;
        q("existing").hidden = !existing;
        q("reason-label").hidden = !existing;
        if (existing)
          text(
            "existing",
            "已有记录：" +
              existing.orderNo +
              " / " +
              existing.amount +
              " " +
              existing.currency +
              "。修订保留旧凭证。",
          );
        message("已读取并截图，请核对。采购状态不会更新。");
        if (existing && existing.state !== "complete") {
          sent = true;
          showResult(existing);
        } else if (capture.features?.fillColorV1 && ["pending","failed"].includes(existing?.color?.state)) {
          q("retry-color").hidden = false;
          message("已有凭证填色未完成，可仅重试填色；如需修订，请填写原因后确认。");
        }
      } catch (error) {
        if (current === revision) message("读取未完成，请检查连接后重新读取");
      } finally {
        busy(false);
      }
    });
    function showResult(result) {
      if (!result?.ok) {
        message(result?.error || "结果暂时无法确认，请查询回传结果");
        q("status").hidden = false;
        if (result?.code === "receipt_conflict") {
          q("status").hidden = true;
          q("revise").hidden = false;
        }
        return;
      }
      message(result.message);
      q("status").hidden = !["processing", "pending", "text_done", "uncertain"].includes(
        result.state,
      );
      q("retry").hidden = result.state !== "image_failed";
      q("retry-color").hidden = !(capture?.features?.fillColorV1 && result.state === "complete" && ["pending","failed"].includes(result.color?.state));
      if (result.state === "complete") {
        text("submit", "✓ 已回传");
        q("status").hidden = true;
        q("revise").hidden = false;
      }
      update();
    }
    async function submit(action) {
      if (locked || !capture) return;
      if (action === "submit" && (sent || !q("confirm").checked)) return;
      if (action === "submit" && location.href !== contextUrl) {
        clear();
        message("当前页面已变化，请重新读取");
        return;
      }
      if (
        action === "submit" &&
        capture.target.existing &&
        !q("reason").value.trim()
      ) {
        message("请填写修订或重新下单原因");
        return;
      }
      const current=revision;
      const submittingCapture=capture;
      sent = true;
      busy(true);
      const titles = {submit:"正在回传采购凭证", "retry-image":"正在补传截图", status:"正在查询回传结果", "retry-color":"正在补填颜色"};
      progress(titles[action], action === "status" ? "正在确认服务器记录，不会重复提交" : "等待订单信息、截图处理及结果核验，请勿重复提交");
      message("");
      try {
        const request = {
          type:"PURCHASE_DETAILS",action,captureId:submittingCapture.captureId,
          confirmed:true,reason:q("reason").value.trim()
        };
        if(submittingCapture.features?.fillColorV1 && action==="submit")
          request.fillColor=q("colors").querySelector("input:checked").value;
        if(submittingCapture.features?.asyncSubmitV1 && action!=="status") request.async=true;
        let result=await send(request);
        const pollUntil=Date.now()+120000;
        while(current===revision && result?.ok && result.state==="processing" && Date.now()<pollUntil){
          await new Promise(resolve=>setTimeout(resolve,1000));
          result=await send({type:"PURCHASE_DETAILS",action:"status",captureId:submittingCapture.captureId});
        }
        if(current===revision) showResult(result);
      } catch (error) {
        if(current===revision) showResult({ok:false,error:"结果暂时无法确认，请查询回传结果"});
      } finally {
        busy(false);
      }
    }
    q("revise").addEventListener("click", () => {
      if (locked) return;
      clear();
      message("请重新读取当前订单，填写修订原因后提交。");
    });
    q("submit").addEventListener("click", () => submit("submit"));
    q("status").addEventListener("click", () => submit("status"));
    q("retry").addEventListener("click", () => submit("retry-image"));
    q("retry-color").addEventListener("click", () => submit("retry-color"));
    // SPA navigation invalidates unsent evidence; submitted requests can still be reconciled.
    const timer = setInterval(() => {
      if (location.href !== contextUrl && !locked && !sent) {
        contextUrl = location.href;
        clear();
      }
    }, 1000);
    window.addEventListener(
      "pagehide",
      () => {
        clearInterval(timer);
        clearInterval(progressTimer);
        q("image").removeAttribute("src");
      },
      { once: true },
    );
    if (
      !/^https:\/\/www\.shein\.com\.mx\/user\/orders\/detail\//.test(
        location.href,
      )
    )
      message("采购详情首版仅支持墨西哥站订单详情页");
    if (/^\/user\/orders\/detail\//.test(location.pathname))
      tabButtons[1].click();
    update();
    return { taskChanged };
  }
  global.XynigoPurchaseDetails = { mount };
})(globalThis);
