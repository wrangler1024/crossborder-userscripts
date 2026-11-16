(async function runLingxingVinePromotionAssistant() {
  'use strict';

  const Core = globalThis.LingxingVineCore;
  const chromeApi = globalThis.__LINGXING_VINE_CHROME__ || globalThis.chrome;
  if (!Core || !chromeApi?.storage?.local || document.getElementById('lingxing-vine-promotion-assistant')) {
    return;
  }

  const CHANNEL = 'lingxing-vine-promotion-assistant';
  const CHECK_STORAGE_KEY = 'lingxingVineCheckV1';
  const HISTORY_STORAGE_KEY = 'lingxingVineHistoryV1';
  const EXECUTION_STORAGE_KEY = 'lingxingVineExecutionV1';
  const LAUNCHER_POSITION_STORAGE_KEY = 'lingxingVineLauncherTopV1';
  const LAUNCHER_HEIGHT = 50;
  const LAUNCHER_TOP_MIN = 72;
  const LAUNCHER_BOTTOM_GAP = 24;
  const HISTORY_LIMIT = 20;
  const today = () => Core.dateRange(1).endDate;

  const host = document.createElement('div');
  host.id = 'lingxing-vine-promotion-assistant';
  host.style.all = 'initial';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  let stylesheetReady;
  if (typeof __LINGXING_VINE_INLINE_CSS__ !== 'undefined') {
    const stylesheet = document.createElement('style');
    stylesheet.textContent = __LINGXING_VINE_INLINE_CSS__;
    shadow.appendChild(stylesheet);
    stylesheetReady = Promise.resolve();
  } else {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = chromeApi.runtime.getURL('src/panel.css');
    stylesheetReady = new Promise((resolve) => {
      stylesheet.addEventListener('load', resolve, { once: true });
      stylesheet.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 500);
    });
    shadow.appendChild(stylesheet);
  }
  const template = document.createElement('template');
  template.innerHTML = `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <symbol id="i-vine" viewBox="0 0 24 24">
        <path d="M12 21V11.4"/>
        <path d="M12 13.1c-3.9 0-6.4-2.1-6.4-5.6 3.9 0 6.4 2.1 6.4 5.6Z"/>
        <path d="M12.3 10.9c0-3.9 2.2-6.4 5.7-6.4 0 3.9-2.2 6.4-5.7 6.4Z"/>
        <path d="M8.6 19.2c2.2 1 5.6 1 7.8 0"/>
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24">
        <path d="M19 8.2A8 8 0 1 0 19.6 14"/>
        <path d="M19 4.7v4.2h-4.2"/>
      </symbol>
      <symbol id="i-download" viewBox="0 0 24 24">
        <path d="M12 4.5v10.2"/>
        <path d="M8.5 11.5 12 15l3.5-3.5"/>
        <path d="M5 19.5h14"/>
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.2 9.2 16 19 6.8"/></symbol>
      <symbol id="i-check-circle" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.4"/><path d="m8.4 12.1 2.2 2.2 4.8-5"/>
      </symbol>
      <symbol id="i-clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.4"/><path d="M12 7.6V12l2.8 1.8"/>
      </symbol>
      <symbol id="i-minus" viewBox="0 0 24 24"><path d="M6 12h12"/></symbol>
      <symbol id="i-x" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.1 4.1"/>
      </symbol>
      <symbol id="i-list-check" viewBox="0 0 24 24">
        <path d="M9 7h10M9 12h10M9 17h7"/>
        <path d="m4 7 .8.8L6.3 6M4 12l.8.8 1.5-1.8M4 17l.8.8 1.5-1.8"/>
      </symbol>
      <symbol id="i-shield" viewBox="0 0 24 24">
        <path d="M12 3.8 19 7v4.8c0 4.2-2.7 7.1-7 8.4-4.3-1.3-7-4.2-7-8.4V7l7-3.2Z"/>
        <path d="m9 12 2 2 4-4"/>
      </symbol>
      <symbol id="i-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.4"/><path d="M12 10.6v5.1M12 7.8v.2"/>
      </symbol>
      <symbol id="i-history" viewBox="0 0 24 24">
        <path d="M4.5 9.2A8 8 0 1 1 4.2 15"/>
        <path d="M4.5 4.8v4.4h4.4M12 7.8V12l2.7 1.8"/>
      </symbol>
      <symbol id="i-orders" viewBox="0 0 24 24">
        <path d="M6 4.8h12v14.4H6z"/><path d="M9 8h6M9 11.5h6M9 15h4"/>
      </symbol>
      <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h13M14 8l4 4-4 4"/></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <path d="M12 4 21 19H3L12 4Z"/><path d="M12 9v4.5M12 16.8v.2"/>
      </symbol>
    </svg>

    <button class="launcher" id="launcher" type="button" hidden
      aria-label="Vine 推广标注助手，点击打开，上下拖动可调整位置"
      title="悬停展开 · 点击打开 · 上下拖动调整位置">
      <span class="launcher-mark"><svg class="ico"><use href="#i-vine"></use></svg></span>
      <span class="launcher-copy">
        <b>Vine 推广标注</b>
        <small id="launcherText">等待检查</small>
      </span>
      <span class="launcher-count is-zero" id="launcherCount">0</span>
    </button>

    <div class="backdrop" id="backdrop" hidden>
      <section class="panel" role="dialog" aria-modal="true" aria-label="Vine 推广标注助手">
        <header class="plugin-header">
          <div class="plugin-brand">
            <span class="brand-mark"><svg class="ico"><use href="#i-vine"></use></svg></span>
            <div>
              <h1>Vine 推广标注助手</h1>
              <small>只读检查 → 人工确认 → 标注与回读</small>
            </div>
          </div>
          <div class="header-actions">
            <span class="prototype-badge">正式版 0.1.4</span>
            <span class="connection-pill" id="connectionPill"><i></i><span id="connectionText">等待领星会话</span></span>
            <button class="header-button" id="historyButton" type="button">
              <svg class="ico"><use href="#i-history"></use></svg>检查记录
            </button>
            <button class="header-icon" id="minimizeButton" type="button" aria-label="收起插件窗口">
              <svg class="ico"><use href="#i-minus"></use></svg>
            </button>
            <button class="header-icon" id="closeButton" type="button" aria-label="关闭插件窗口">
              <svg class="ico"><use href="#i-x"></use></svg>
            </button>
          </div>
        </header>

        <section class="toolbar">
          <div class="toolbar-row">
            <span class="field-label">检查范围</span>
            <select class="range-select" id="rangeSelect" aria-label="检查范围">
              <option value="7">近 7 天</option>
              <option value="30" selected>近 30 天</option>
              <option value="90">近 90 天</option>
            </select>
            <span class="schedule-note">
              <svg class="ico"><use href="#i-clock"></use></svg>
              <span id="autoCheckNote">每天首次打开领星自动检查</span>
            </span>
            <span class="grow"></span>
            <button class="button ghost" id="exportPreviewButton" type="button">
              <svg class="ico"><use href="#i-download"></use></svg>导出预览
            </button>
            <button class="button primary" id="scanButton" type="button">
              <svg class="ico"><use href="#i-refresh"></use></svg>立即检查
            </button>
          </div>
          <div class="source-line">
            <span class="source-kind">VINE</span>
            <span>销售订单 · <span class="mono">promotionIds</span> 含 <span class="mono">vine.enrollment.*</span></span>
            <span class="source-tick"><svg class="ico"><use href="#i-check-circle"></use></svg><span id="lastChecked">尚未检查</span></span>
            <span class="source-divider">|</span>
            <span id="sourceOrderTotal">近 30 天 — 单</span>
            <span class="source-range" id="sessionLine">等待领星请求会话</span>
          </div>
        </section>

        <nav class="workflow" aria-label="检查和标注流程">
          <div class="steps">
            <span class="step complete" id="step1"><b>01</b>扫描订单</span>
            <span class="step-sep"></span>
            <span class="step active" id="step2"><b>02</b>预览待标</span>
            <span class="step-sep"></span>
            <span class="step" id="step3"><b>03</b>标注与核验</span>
          </div>
          <div class="workflow-stats">
            <span><strong class="green" id="markedStat">0</strong>已标</span>
            <span><strong class="amber" id="pendingStat">0</strong>待标</span>
            <span><strong id="vineStat">0</strong>Vine</span>
          </div>
        </nav>

        <div class="rule-banner">
          <strong>固定口径</strong>
          <span class="rule-chip fixed">Pending 也标</span>
          <span class="rule-chip fixed">取消 / 退款仍标</span>
          <span class="rule-chip">推广类型保持默认</span>
          <span class="rule-source">仅调用“标记推广”，不改费用、备注或订单状态</span>
        </div>

        <div class="session-banner" id="sessionBanner">
          <svg class="ico"><use href="#i-info"></use></svg>
          <span>等待领星页面发起一次正常接口请求。若一直未就绪，请刷新当前订单列表。</span>
        </div>

        <div class="resume-banner" id="resumeBanner" hidden>
          <svg class="ico"><use href="#i-alert"></use></svg>
          <span id="resumeText">上次提交结果尚未确认，请先回读。</span>
          <button id="resumeButton" type="button">回读上次批次</button>
        </div>

        <div class="workspace">
          <aside class="sidebar">
            <div class="sidebar-head">
              <label class="search-box">
                <svg class="ico"><use href="#i-search"></use></svg>
                <input id="searchInput" type="search" placeholder="搜索订单号 / 店铺 / SKU" autocomplete="off">
              </label>
              <div class="filters" id="filters"></div>
            </div>
            <div class="list-label"><span>待标注订单</span><span id="listCount">0 条</span></div>
            <div class="record-list" id="recordList"></div>
            <div class="sidebar-foot">
              <svg class="ico"><use href="#i-list-check"></use></svg>
              <button class="text-link" id="selectAllButton" type="button">选择全部待标</button>
              <span class="grow"></span>
              <button class="text-link" id="clearSelectionButton" type="button">清空</button>
            </div>
          </aside>

          <main class="main" id="main">
            <section data-view="ready">
              <div class="detail-top">
                <span class="eyebrow">检查结果</span>
                <span class="detail-time" id="detailTime">尚未读取</span>
              </div>
              <div class="result-top">
                <div class="result-icon"><svg class="ico"><use href="#i-vine"></use></svg></div>
                <div class="result-copy">
                  <h2 id="resultTitle">尚未检查 Vine 订单</h2>
                  <p id="resultCopy">连接当前领星会话后，只读读取销售订单并比对推广标记。</p>
                </div>
                <span class="badge warn" id="resultBadge"><i class="dot"></i>待检查</span>
              </div>
              <div class="result-counters">
                <div class="result-count"><b id="orderCountCard">0</b>销售订单</div>
                <div class="result-count ok"><b id="markedCountCard">0</b>已进入推广订单</div>
                <div class="result-count warn"><b id="pendingCountCard">0</b>本次待标注</div>
              </div>
              <div class="source-panel">
                <svg class="ico"><use href="#i-info"></use></svg>
                <div><b>检测依据：</b>商品行 <span class="mono">promotionIds</span> 以 <span class="mono">vine.enrollment.</span> 开头，且订单 <span class="mono">isAssessed != 1</span>。不使用金额、买家为空或 <span class="mono">isPromotion</span> 单独判断。</div>
              </div>
              <section class="order-panel">
                <div class="section-heading">
                  <h3>
                    <svg class="ico"><use href="#i-orders"></use></svg>
                    待标注订单 <span class="badge violet" id="tableCount">0 笔</span>
                  </h3>
                  <button class="text-link" id="tableSelectAll" type="button">全选</button>
                </div>
                <div class="order-table-wrap">
                  <table class="order-table">
                    <thead>
                      <tr>
                        <th style="width:42px"><input type="checkbox" id="masterCheck" aria-label="全选当前筛选订单"></th>
                        <th style="width:8%">市场</th>
                        <th style="width:25%">订单号 / 店铺</th>
                        <th style="width:18%">SKU / ASIN</th>
                        <th style="width:17%">下单时间</th>
                        <th style="width:10%">状态</th>
                        <th style="width:8%">金额</th>
                        <th style="width:9%">识别结果</th>
                      </tr>
                    </thead>
                    <tbody id="orderRows"></tbody>
                  </table>
                  <div class="empty-state" id="tableEmpty">当前没有待标注订单</div>
                </div>
              </section>
            </section>

            <section class="center-view" data-view="scanning" hidden>
              <div class="center-section">
                <div class="scan-orbit" aria-hidden="true"></div>
                <h2 id="scanningTitle">正在只读扫描销售订单</h2>
                <p id="scanningCopy">读取 Vine 标识与现有推广标记。检查阶段不会修改任何订单。</p>
                <div class="scan-steps">
                  <div class="scan-step is-active" data-scan-step="1"><span>1</span>读取订单与 Vine 标识</div>
                  <div class="scan-step" data-scan-step="2"><span>2</span>比对推广订单标记状态</div>
                  <div class="scan-step" data-scan-step="3"><span>3</span>生成待标注预览</div>
                </div>
              </div>
            </section>

            <section class="center-view" data-view="progress" hidden>
              <div class="center-section">
                <div class="scan-orbit" aria-hidden="true"></div>
                <h2>正在批量标记为推广订单</h2>
                <p>按已确认清单逐小批提交，使用默认推广类型；提交完成后重新读取 isAssessed。</p>
                <div class="progress-card">
                  <div class="progress-meta">
                    <strong><span id="progressDone">0</span> / <span id="progressTotal">0</span></strong>
                    <span id="progressLabel">准备提交</span>
                  </div>
                  <div class="progress-track"><div class="progress-bar" id="progressBar"></div></div>
                  <div class="progress-current">
                    <span id="progressCurrent">准备提交…</span>
                    <strong id="progressPercent">0%</strong>
                  </div>
                </div>
              </div>
            </section>

            <section class="center-view" data-view="success" hidden>
              <div class="center-section">
                <div class="success-icon" id="successIcon"><svg class="ico"><use href="#i-check"></use></svg></div>
                <h2 id="successTitle">本批处理完成</h2>
                <p id="successCopy">回读结果已生成。</p>
                <div class="success-result">
                  <span><svg class="ico"><use href="#i-check-circle"></use></svg><span id="successResultText">等待回读</span></span>
                  <span><svg class="ico"><use href="#i-clock"></use></svg><span id="successDuration">—</span></span>
                </div>
                <div class="success-table" id="successTable"></div>
              </div>
            </section>
          </main>
        </div>

        <footer class="plugin-footer">
          <div class="selection-info">
            <div class="select-icon"><svg class="ico"><use href="#i-shield"></use></svg></div>
            <div class="selection-copy">
              <strong><span id="selectionTitleText">已选择</span> <b id="selectedCount">0</b> <span id="selectionUnit">笔订单</span></strong>
              <small id="selectionSub">请先完成领星只读检查</small>
            </div>
          </div>
          <div class="footer-actions" id="readyFooter">
            <button class="button ghost" id="exportPreviewFooter" type="button">
              <svg class="ico"><use href="#i-download"></use></svg>导出预览
            </button>
            <button class="button" id="rescanButton" type="button">
              <svg class="ico"><use href="#i-refresh"></use></svg>重新检查
            </button>
            <button class="button primary" id="markButton" type="button" disabled>
              确认标注 <span id="markCount">0</span> 笔<svg class="ico"><use href="#i-arrow"></use></svg>
            </button>
          </div>
          <div class="footer-actions" id="successFooter" hidden>
            <button class="button" id="checkAgainButton" type="button">
              <svg class="ico"><use href="#i-refresh"></use></svg>再次检查
            </button>
            <button class="button primary" id="exportLogButton" type="button">
              <svg class="ico"><use href="#i-download"></use></svg>导出本次记录
            </button>
          </div>
        </footer>
      </section>
    </div>

    <dialog id="confirmDialog" aria-labelledby="confirmTitle">
      <div class="dialog-header">
        <div>
          <h2 id="confirmTitle">确认标记为推广订单</h2>
          <p>提交前已重新读取订单。领星原生操作没有二次确认，本窗口是最后一道人工确认。</p>
        </div>
        <button class="dialog-close" id="dialogClose" type="button" aria-label="关闭确认弹窗">
          <svg class="ico"><use href="#i-x"></use></svg>
        </button>
      </div>
      <div class="dialog-body">
        <div class="confirmation-summary">
          <svg class="ico"><use href="#i-vine"></use></svg>
          <div>
            <strong>即将标注 <b id="dialogCount">0</b> 笔 Vine 订单</strong>
            <small>提交后进入“推广订单”，随后逐单读取 isAssessed 校验。</small>
          </div>
        </div>
        <div class="review-list">
          <div class="review-row"><span>订单范围</span><b id="dialogOrderSummary">—</b></div>
          <div class="review-row"><span>推广类型</span><b>默认</b></div>
          <div class="review-row"><span>状态口径</span><b>Pending、已取消、退款均标记</b></div>
          <div class="review-row"><span>修改范围</span><b>仅推广标记</b></div>
          <div class="review-row"><span>保持不变</span><b>推广费用、备注、订单状态、其他费用</b></div>
        </div>
        <div class="review-orders" id="dialogOrders"></div>
        <label class="confirm-check">
          <input id="confirmChecked" type="checkbox">
          <span>已核对本批订单号、店铺和固定口径
            <small>提交后若回读失败会停止，不自动重复提交。</small>
          </span>
        </label>
      </div>
      <div class="dialog-footer">
        <button class="button" id="dialogCancel" type="button">返回检查</button>
        <button class="button primary" id="dialogConfirm" type="button" disabled>确认标注</button>
      </div>
    </dialog>

    <dialog id="historyDialog" aria-labelledby="historyTitle">
      <div class="dialog-header">
        <div>
          <h2 id="historyTitle">检查与执行记录</h2>
          <p>仅保存检查摘要和标注结果，不保存买家、令牌或请求头。</p>
        </div>
        <button class="dialog-close" id="historyClose" type="button" aria-label="关闭检查记录">
          <svg class="ico"><use href="#i-x"></use></svg>
        </button>
      </div>
      <div class="dialog-body"><div class="history-list" id="historyList"></div></div>
      <div class="dialog-footer"><button class="button" id="historyDone" type="button">关闭</button></div>
    </dialog>

    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  `;
  shadow.appendChild(template.content);

  const $ = (selector, root = shadow) => root.querySelector(selector);
  const $$ = (selector, root = shadow) => [...root.querySelectorAll(selector)];
  const elements = {
    launcher: $('#launcher'),
    launcherText: $('#launcherText'),
    launcherCount: $('#launcherCount'),
    backdrop: $('#backdrop'),
    connectionPill: $('#connectionPill'),
    connectionText: $('#connectionText'),
    sessionBanner: $('#sessionBanner'),
    sessionLine: $('#sessionLine'),
    rangeSelect: $('#rangeSelect'),
    scanButton: $('#scanButton'),
    rescanButton: $('#rescanButton'),
    markButton: $('#markButton'),
    markCount: $('#markCount'),
    historyButton: $('#historyButton'),
    exportPreviewButton: $('#exportPreviewButton'),
    exportPreviewFooter: $('#exportPreviewFooter'),
    exportLogButton: $('#exportLogButton'),
    lastChecked: $('#lastChecked'),
    autoCheckNote: $('#autoCheckNote'),
    sourceOrderTotal: $('#sourceOrderTotal'),
    detailTime: $('#detailTime'),
    markedStat: $('#markedStat'),
    pendingStat: $('#pendingStat'),
    vineStat: $('#vineStat'),
    orderCountCard: $('#orderCountCard'),
    markedCountCard: $('#markedCountCard'),
    pendingCountCard: $('#pendingCountCard'),
    resultTitle: $('#resultTitle'),
    resultCopy: $('#resultCopy'),
    resultBadge: $('#resultBadge'),
    scanningTitle: $('#scanningTitle'),
    scanningCopy: $('#scanningCopy'),
    filters: $('#filters'),
    searchInput: $('#searchInput'),
    listCount: $('#listCount'),
    recordList: $('#recordList'),
    selectAllButton: $('#selectAllButton'),
    clearSelectionButton: $('#clearSelectionButton'),
    tableCount: $('#tableCount'),
    tableSelectAll: $('#tableSelectAll'),
    masterCheck: $('#masterCheck'),
    orderRows: $('#orderRows'),
    tableEmpty: $('#tableEmpty'),
    readyView: $('[data-view="ready"]'),
    scanningView: $('[data-view="scanning"]'),
    progressView: $('[data-view="progress"]'),
    successView: $('[data-view="success"]'),
    main: $('#main'),
    readyFooter: $('#readyFooter'),
    successFooter: $('#successFooter'),
    selectionTitleText: $('#selectionTitleText'),
    selectedCount: $('#selectedCount'),
    selectionUnit: $('#selectionUnit'),
    selectionSub: $('#selectionSub'),
    progressDone: $('#progressDone'),
    progressTotal: $('#progressTotal'),
    progressBar: $('#progressBar'),
    progressPercent: $('#progressPercent'),
    progressCurrent: $('#progressCurrent'),
    progressLabel: $('#progressLabel'),
    successIcon: $('#successIcon'),
    successTitle: $('#successTitle'),
    successCopy: $('#successCopy'),
    successResultText: $('#successResultText'),
    successDuration: $('#successDuration'),
    successTable: $('#successTable'),
    resumeBanner: $('#resumeBanner'),
    resumeText: $('#resumeText'),
    resumeButton: $('#resumeButton'),
    confirmDialog: $('#confirmDialog'),
    dialogCount: $('#dialogCount'),
    dialogOrderSummary: $('#dialogOrderSummary'),
    dialogOrders: $('#dialogOrders'),
    confirmChecked: $('#confirmChecked'),
    dialogConfirm: $('#dialogConfirm'),
    historyDialog: $('#historyDialog'),
    historyList: $('#historyList'),
    toast: $('#toast'),
  };

  const state = {
    session: { ready: false, epoch: 0, scope: '', capturedAt: 0 },
    rangeDays: 30,
    totalOrders: 0,
    vineOrders: [],
    pendingOrders: [],
    selected: new Set(),
    market: 'all',
    query: '',
    focusedKey: null,
    view: 'ready',
    busy: false,
    lastCheck: null,
    history: [],
    lastExecution: null,
    confirmBatch: [],
    confirmFingerprint: '',
    autoScanStarted: false,
    previousScope: '',
    panelOpen: false,
    launcherTop: Math.round(window.innerHeight * 0.38),
    toastTimer: null,
  };

  const rpcWaiters = new Map();
  let rpcSequence = 0;

  function rpc(type, payload, timeoutMs = 40000) {
    const id = `vine-${Date.now()}-${++rpcSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        rpcWaiters.delete(id);
        reject(new Error('领星页面通信超时，请刷新后重试'));
      }, timeoutMs);
      rpcWaiters.set(id, { resolve, reject, timer });
      window.postMessage({
        channel: CHANNEL,
        direction: 'ui-to-page',
        id,
        type,
        payload,
      }, location.origin);
    });
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chromeApi.storage.local.get(keys, (result) => {
        const error = chromeApi.runtime.lastError;
        if (error) reject(error);
        else resolve(result || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chromeApi.storage.local.set(values, () => {
        const error = chromeApi.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  function clampLauncherTop(value) {
    const maxTop = Math.max(LAUNCHER_TOP_MIN, window.innerHeight - LAUNCHER_HEIGHT - LAUNCHER_BOTTOM_GAP);
    return Math.round(Math.min(maxTop, Math.max(LAUNCHER_TOP_MIN, Number(value) || LAUNCHER_TOP_MIN)));
  }

  function setLauncherTop(value, persist = false) {
    state.launcherTop = clampLauncherTop(value);
    elements.launcher.style.setProperty('top', `${state.launcherTop}px`, 'important');
    if (persist) {
      storageSet({ [LAUNCHER_POSITION_STORAGE_KEY]: state.launcherTop }).catch(() => {
        // Position memory is optional; dragging must keep working if storage is unavailable.
      });
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatDateTime(value = new Date()) {
    return value.toLocaleString('zh-CN', { hour12: false });
  }

  function formatShortTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || '尚未检查');
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    state.toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2600);
  }

  function setSteps(current, completed = []) {
    for (const id of ['step1', 'step2', 'step3']) {
      const node = shadow.getElementById(id);
      node.className = 'step';
      if (completed.includes(id)) node.classList.add('complete');
      if (id === current && !completed.includes(id)) node.classList.add('active');
    }
  }

  function setView(view) {
    state.view = view;
    elements.readyView.hidden = view !== 'ready';
    elements.scanningView.hidden = view !== 'scanning';
    elements.progressView.hidden = view !== 'progress';
    elements.successView.hidden = view !== 'success';
    elements.readyFooter.hidden = view === 'success';
    elements.successFooter.hidden = view !== 'success';
    elements.main.scrollTop = 0;
    if (view === 'ready') {
      setSteps('step2', ['step1']);
    } else if (view === 'scanning') {
      setSteps('step1');
    } else if (view === 'progress') {
      setSteps('step3');
    } else {
      setSteps(null, ['step1', 'step2', 'step3']);
    }
  }

  function setScanningStage(index) {
    $$('[data-scan-step]').forEach((node, nodeIndex) => {
      node.classList.toggle('is-active', nodeIndex <= index);
    });
  }

  function updateSession(session) {
    const previousScope = state.session.scope;
    state.session = { ...state.session, ...(session || {}) };
    elements.connectionPill.classList.toggle('is-ready', Boolean(state.session.ready));
    elements.connectionText.textContent = state.session.ready ? '领星会话已就绪' : '等待领星会话';
    elements.sessionLine.textContent = state.session.ready
      ? '只读检查通过后才可提交标注'
      : '等待领星请求会话';
    elements.sessionBanner.hidden = Boolean(state.session.ready);
    elements.scanButton.disabled = state.busy || !state.session.ready;
    elements.rescanButton.disabled = state.busy || !state.session.ready;
    renderFooter();

    if (state.session.ready && (!state.autoScanStarted || (previousScope && previousScope !== state.session.scope))) {
      if (previousScope && previousScope !== state.session.scope) {
        state.autoScanStarted = false;
        state.lastCheck = null;
        state.pendingOrders = [];
        state.vineOrders = [];
        state.totalOrders = 0;
        state.selected.clear();
        renderAll();
        showToast('领星登录账号已切换，正在重新检查');
      }
      void maybeAutoScan();
    }
  }

  function visibleOrders() {
    const query = state.query.trim().toLowerCase();
    return state.pendingOrders.filter((order) => {
      const marketMatch = state.market === 'all' || order.market === state.market;
      const haystack = [
        order.amazonOrderId,
        order.store,
        order.sku,
        order.asin,
        order.market,
        order.status,
      ].join(' ').toLowerCase();
      return marketMatch && (!query || haystack.includes(query));
    });
  }

  function selectedOrders() {
    return state.pendingOrders.filter((order) => state.selected.has(order.key));
  }

  function writeBlocked() {
    return Boolean(state.lastExecution
      && ['submitting', 'unknown'].includes(state.lastExecution.status));
  }

  function renderConnection() {
    elements.connectionPill.classList.toggle('is-ready', Boolean(state.session.ready));
    elements.connectionText.textContent = state.session.ready ? '领星会话已就绪' : '等待领星会话';
    elements.sessionBanner.hidden = Boolean(state.session.ready);
    elements.sourceOrderTotal.textContent = `近 ${state.rangeDays} 天 ${state.totalOrders || '—'} 单`;
    elements.sessionLine.textContent = state.session.ready
      ? '只读检查通过后才可提交标注'
      : '等待领星请求会话';
    elements.launcherCount.textContent = String(state.pendingOrders.length);
    elements.launcherCount.classList.toggle('is-zero', state.pendingOrders.length === 0);
    if (!state.lastCheck) {
      elements.launcherText.textContent = '等待今日检查';
    } else if (state.pendingOrders.length) {
      elements.launcherText.textContent = `${state.pendingOrders.length} 笔待标`;
    } else {
      elements.launcherText.textContent = '今日无待标';
    }
    elements.launcher.setAttribute(
      'aria-label',
      `Vine 推广标注助手，${elements.launcherText.textContent}。点击打开，上下拖动可调整位置`,
    );
  }

  function renderStats() {
    const vineCount = state.lastCheck?.vineCount || state.vineOrders.length;
    const pendingCount = state.pendingOrders.length;
    const assessedCount = state.lastCheck?.assessedCount ?? Math.max(0, vineCount - pendingCount);
    elements.markedStat.textContent = String(assessedCount);
    elements.pendingStat.textContent = String(pendingCount);
    elements.vineStat.textContent = String(vineCount);
    elements.orderCountCard.textContent = String(state.lastCheck?.totalOrders || state.totalOrders || 0);
    elements.markedCountCard.textContent = String(assessedCount);
    elements.pendingCountCard.textContent = String(pendingCount);
    elements.lastChecked.textContent = state.lastCheck
      ? `上次检查 ${formatShortTime(state.lastCheck.checkedAt)}`
      : '尚未检查';
    elements.detailTime.textContent = state.lastCheck
      ? `数据更新于 ${formatShortTime(state.lastCheck.checkedAt)}`
      : '尚未读取';

    if (state.lastCheck) {
      elements.resultTitle.innerHTML = pendingCount
        ? `发现 <strong>${pendingCount} 笔</strong> Vine 订单尚未标记`
        : '没有待标注的 Vine 订单';
      elements.resultCopy.textContent = pendingCount
        ? '订单已有 vine.enrollment.* 标识，但 isAssessed 仍不是 1。系统已剔除买家信息，仅展示核对所需订单字段。'
        : '本次检查范围内的 Vine 订单均已进入推广订单；取消和退款状态也会按相同规则纳入检查。';
      elements.resultBadge.className = `badge ${pendingCount ? 'warn' : 'success'}`;
      elements.resultBadge.innerHTML = `<i class="dot"></i>${pendingCount ? '待处理' : '已处理'}`;
    }
  }

  function renderFilters() {
    const counts = new Map();
    for (const order of state.pendingOrders) {
      counts.set(order.market, (counts.get(order.market) || 0) + 1);
    }
    const markets = Core.uniqueMarkets(state.pendingOrders);
    if (state.market !== 'all' && !markets.includes(state.market)) state.market = 'all';
    const buttons = [
      { market: 'all', label: '待标', count: state.pendingOrders.length },
      ...markets.map((market) => ({ market, label: market, count: counts.get(market) || 0 })),
    ];
    elements.filters.innerHTML = buttons.map((item) => `
      <button class="filter-button ${state.market === item.market ? 'active' : ''}" data-market="${escapeHtml(item.market)}" type="button">
        <b>${item.count}</b>${escapeHtml(item.label)}
      </button>
    `).join('');
  }

  function renderList() {
    const orders = visibleOrders();
    elements.listCount.textContent = `${orders.length} 条`;
    elements.recordList.innerHTML = orders.length
      ? orders.map((order) => `
        <div class="record ${state.focusedKey === order.key ? 'is-focused' : ''}" data-record-key="${escapeHtml(order.key)}">
          <input type="checkbox" data-check-key="${escapeHtml(order.key)}" ${state.selected.has(order.key) ? 'checked' : ''} aria-label="选择订单 ${escapeHtml(order.amazonOrderId)}">
          <div class="record-body">
            <div class="record-title mono" title="${escapeHtml(order.amazonOrderId)}">${escapeHtml(order.amazonOrderId)}</div>
            <div class="record-sub">${escapeHtml(order.store)} · ${escapeHtml(order.sku || order.asin || '—')}</div>
            <div class="record-bottom">
              <span class="badge ${order.status === 'Pending' ? 'warn' : 'violet'}"><i class="dot"></i>${escapeHtml(order.status || '状态未返回')}</span>
              <span class="record-amount">${escapeHtml(order.amount || '—')}</span>
            </div>
          </div>
        </div>
      `).join('')
      : '<div class="empty-state" style="display:block">当前没有符合筛选条件的待标订单</div>';
  }

  function statusBadge(order) {
    const cls = order.status === 'Pending' ? 'warn' : 'violet';
    return `<span class="badge ${cls}"><i class="dot"></i>${escapeHtml(order.status || '状态未返回')}</span>`;
  }

  function renderTable() {
    const orders = visibleOrders();
    elements.tableCount.textContent = `${orders.length} 笔`;
    elements.tableEmpty.style.display = orders.length ? 'none' : 'block';
    elements.orderRows.innerHTML = orders.map((order) => `
      <tr data-order-key="${escapeHtml(order.key)}">
        <td><input type="checkbox" data-check-key="${escapeHtml(order.key)}" ${state.selected.has(order.key) ? 'checked' : ''} aria-label="选择订单 ${escapeHtml(order.amazonOrderId)}"></td>
        <td><span class="market-tag">${escapeHtml(order.market || '—')}</span></td>
        <td>
          <span class="order-id mono" title="${escapeHtml(order.amazonOrderId)}">${escapeHtml(order.amazonOrderId)}</span>
          <span class="order-store">${escapeHtml(order.store)}</span>
        </td>
        <td>
          <span class="order-id" title="${escapeHtml(order.sku)}">${escapeHtml(order.sku || '—')}</span>
          <span class="order-sku mono">${escapeHtml(order.asin || 'ASIN 未返回')}</span>
        </td>
        <td>${escapeHtml(order.purchaseDateLocal)}</td>
        <td>${statusBadge(order)}</td>
        <td><span class="amount">${escapeHtml(order.amount || '—')}</span></td>
        <td><span class="badge success"><i class="dot"></i>Vine 待标</span></td>
      </tr>
    `).join('');
  }

  function renderSelectionState() {
    const selected = selectedOrders();
    const orders = visibleOrders();
    const visibleSelected = orders.filter((order) => state.selected.has(order.key));
    elements.selectedCount.textContent = String(selected.length);
    elements.markCount.textContent = String(selected.length);
    elements.selectionTitleText.textContent = '已选择';
    elements.selectionUnit.textContent = '笔订单';
    elements.masterCheck.disabled = orders.length === 0;
    elements.masterCheck.checked = orders.length > 0 && visibleSelected.length === orders.length;
    elements.masterCheck.indeterminate = visibleSelected.length > 0 && visibleSelected.length < orders.length;
    elements.tableSelectAll.textContent = orders.length > 0 && visibleSelected.length === orders.length ? '取消全选' : '全选';

    if (!state.session.ready) {
      elements.selectionSub.textContent = '等待领星会话；刷新订单列表后重试';
    } else if (writeBlocked()) {
      elements.selectionSub.textContent = '上次提交结果未确认，请先回读';
    } else if (!selected.length) {
      elements.selectionSub.textContent = '请选择至少一笔待标注订单';
    } else {
      elements.selectionSub.textContent = '使用默认推广类型；不修改费用、备注或订单状态';
    }
  }

  function renderFooter() {
    renderSelectionState();
    elements.markButton.disabled = state.busy
      || !state.session.ready
      || selectedOrders().length === 0
      || writeBlocked();
    elements.scanButton.disabled = state.busy || !state.session.ready;
    elements.rescanButton.disabled = state.busy || !state.session.ready;
  }

  function renderResumeBanner() {
    const unresolved = state.lastExecution
      && ['submitting', 'unknown'].includes(state.lastExecution.status);
    elements.resumeBanner.hidden = !unresolved;
    if (unresolved) {
      elements.resumeText.textContent = `上次批次 ${state.lastExecution.batchCount || state.lastExecution.items?.length || 0} 笔提交结果未确认，请先只读回读。`;
    }
  }

  function renderAll() {
    renderConnection();
    renderStats();
    renderFilters();
    renderList();
    renderTable();
    renderFooter();
    renderResumeBanner();
  }

  function saveLastCheck(classification, range, fetchedAt, recordHistory = true) {
    const pendingOrders = classification.pendingOrders.map((order) => ({
      key: order.key,
      sid: order.sid,
      amazonOrderId: order.amazonOrderId,
      purchaseDateLocal: order.purchaseDateLocal,
      purchaseDate: order.purchaseDate,
      market: order.market,
      store: order.store,
      status: order.status,
      amount: order.amount,
      sku: order.sku,
      asin: order.asin,
      isAssessed: order.isAssessed,
    }));
    state.lastCheck = {
      date: today(),
      checkedAt: fetchedAt,
      scope: state.session.scope || '',
      rangeDays: range.days,
      startDate: range.startDate,
      endDate: range.endDate,
      totalOrders: state.totalOrders,
      vineCount: classification.summary.vineCount,
      assessedCount: classification.summary.assessedCount,
      pendingCount: classification.summary.pendingCount,
      pendingOrders,
    };
    if (recordHistory) {
      state.history.unshift({
        kind: 'check',
        at: fetchedAt,
        rangeDays: range.days,
        totalOrders: state.totalOrders,
        vineCount: classification.summary.vineCount,
        pendingCount: classification.summary.pendingCount,
        scope: state.session.scope || '',
      });
      state.history = state.history.slice(0, HISTORY_LIMIT);
    }
    return storageSet({
      [CHECK_STORAGE_KEY]: state.lastCheck,
      [HISTORY_STORAGE_KEY]: state.history,
    });
  }

  async function fetchScanData(onPage = () => {}) {
    if (!state.session.ready) throw new Error('领星会话尚未就绪，请刷新订单列表');
    const range = Core.dateRange(state.rangeDays);
    const rows = [];
    let pageNo = 1;
    let totalOrders = 0;
    let totalPages = 1;

    while (pageNo <= Core.MAX_PAGES) {
      onPage(pageNo, totalPages);
      const result = await rpc('scan-page', {
        startDate: range.startDate,
        endDate: range.endDate,
        pageNo,
        pageSize: Core.PAGE_SIZE,
      }, 45000);
      if (!result || result.code !== 1 || !Array.isArray(result.data?.data)) {
        throw new Error(result?.msg || '领星订单列表返回格式变化');
      }
      totalOrders = Number(result.data.total) || totalOrders;
      totalPages = Number(result.data.totalPages) || pageNo;
      rows.push(...result.data.data);
      if (result.data.isLast || result.data.data.length < Core.PAGE_SIZE || pageNo >= totalPages) break;
      pageNo += 1;
    }

    if (pageNo > Core.MAX_PAGES) throw new Error('检查结果超过扩展单次处理上限，请缩小时间范围');
    if (totalOrders > Core.MAX_PAGES * Core.PAGE_SIZE) throw new Error('订单数量超过扩展安全上限，请缩小时间范围');

    return {
      range,
      rows,
      totalOrders,
      totalPages,
      fetchedAt: Date.now(),
      classification: Core.classifyOrders(rows),
    };
  }

  function applyScanData(scan, { preserveKeys = null, recordHistory = true } = {}) {
    state.totalOrders = scan.totalOrders;
    state.vineOrders = scan.classification.vineOrders;
    state.pendingOrders = scan.classification.pendingOrders;
    const candidateKeys = preserveKeys
      ? new Set(preserveKeys)
      : new Set(state.pendingOrders.map((order) => order.key));
    state.selected = new Set(
      state.pendingOrders
        .filter((order) => candidateKeys.has(order.key))
        .map((order) => order.key),
    );
    state.focusedKey = state.pendingOrders[0]?.key || null;
    return saveLastCheck(scan.classification, scan.range, scan.fetchedAt, recordHistory);
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.rangeSelect.disabled = busy;
    elements.scanButton.disabled = busy || !state.session.ready;
    elements.rescanButton.disabled = busy || !state.session.ready;
    elements.exportPreviewButton.disabled = busy;
    elements.exportPreviewFooter.disabled = busy;
    renderFooter();
  }

  async function scanAll({ auto = false, openIfPending = false, preserveKeys = null } = {}) {
    if (state.busy) return null;
    if (!state.session.ready) {
      showToast('等待领星请求会话；请刷新订单列表');
      return null;
    }

    setBusy(true);
    elements.scanningTitle.textContent = '正在只读扫描销售订单';
    elements.scanningCopy.textContent = `读取近 ${state.rangeDays} 天订单与 Vine 标识。检查阶段不会修改任何订单。`;
    setView('scanning');
    setScanningStage(0);
    try {
      const scan = await fetchScanData((pageNo, totalPages) => {
        elements.scanningCopy.textContent = `正在读取第 ${pageNo} / ${Math.max(pageNo, totalPages)} 页，检查阶段不会修改任何订单。`;
        if (pageNo >= 2) setScanningStage(1);
      });
      setScanningStage(2);
      await applyScanData(scan, { preserveKeys });
      setView('ready');
      renderAll();
      showToast(scan.classification.summary.pendingCount
        ? `检查完成：发现 ${scan.classification.summary.pendingCount} 笔 Vine 待标`
        : '检查完成：当前范围没有 Vine 待标订单');
      if (auto && openIfPending && scan.classification.summary.pendingCount > 0 && Core.isOrderListUrl(location.href)) {
        openPanel();
      } else {
        updatePathVisibility();
      }
      return scan;
    } catch (error) {
      setView('ready');
      renderAll();
      if (auto) state.autoScanStarted = false;
      showToast(String(error?.message || '检查失败，请稍后重试'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function maybeAutoScan() {
    if (state.autoScanStarted || !state.session.ready || state.busy) return;
    state.autoScanStarted = true;
    const cached = state.lastCheck;
    if (cached
      && cached.date === today()
      && cached.scope === state.session.scope) {
      updatePathVisibility();
      return;
    }
    await scanAll({ auto: true, openIfPending: true });
  }

  function applyLatestClassification(scan) {
    state.totalOrders = scan.totalOrders;
    state.vineOrders = scan.classification.vineOrders;
    state.pendingOrders = scan.classification.pendingOrders;
    if (state.market !== 'all' && !Core.uniqueMarkets(state.pendingOrders).includes(state.market)) {
      state.market = 'all';
    }
    for (const key of [...state.selected]) {
      if (!state.pendingOrders.some((order) => order.key === key)) state.selected.delete(key);
    }
    return saveLastCheck(scan.classification, scan.range, scan.fetchedAt, false);
  }

  async function prepareConfirmation() {
    if (state.busy) return;
    if (!state.session.ready) {
      showToast('等待领星会话；请刷新订单列表');
      return;
    }
    if (writeBlocked()) {
      showToast('上次提交结果未确认，请先回读');
      return;
    }
    const snapshot = selectedOrders();
    if (!snapshot.length) return;
    const snapshotKeys = snapshot.map((order) => order.key);

    setBusy(true);
    elements.scanningTitle.textContent = '正在提交前复核';
    elements.scanningCopy.textContent = '重新读取本批订单的 Vine 标识和 isAssessed 状态，不发送任何写请求。';
    setView('scanning');
    setScanningStage(0);
    try {
      const scan = await fetchScanData((pageNo, totalPages) => {
        elements.scanningCopy.textContent = `正在复核第 ${pageNo} / ${Math.max(pageNo, totalPages)} 页，尚未发送写请求。`;
        if (pageNo >= 2) setScanningStage(1);
      });
      setScanningStage(2);
      await applyLatestClassification(scan);
      const preflight = Core.preflightSelection(snapshot, state.pendingOrders);
      if (!preflight.ok) {
        state.selected = new Set(
          [...state.selected].filter((key) => state.pendingOrders.some((order) => order.key === key)),
        );
        renderAll();
        setView('ready');
        showToast(`订单状态已变化，本批有 ${preflight.missing.length} 笔不再待标，已刷新列表`);
        return;
      }

      state.confirmBatch = state.pendingOrders
        .filter((order) => snapshotKeys.includes(order.key))
        .sort((left, right) => snapshotKeys.indexOf(left.key) - snapshotKeys.indexOf(right.key));
      state.confirmFingerprint = Core.fingerprintOrders(state.confirmBatch);
      openConfirmDialog();
      renderAll();
      setView('ready');
    } catch (error) {
      setView('ready');
      renderAll();
      showToast(String(error?.message || '提交前复核失败'));
    } finally {
      setBusy(false);
    }
  }

  function openConfirmDialog() {
    const batch = state.confirmBatch;
    elements.dialogCount.textContent = String(batch.length);
    elements.dialogOrderSummary.textContent = batch.length > 2
      ? `${batch[0].amazonOrderId} 等 ${batch.length} 笔`
      : batch.map((order) => order.amazonOrderId).join(' · ');
    elements.dialogOrders.innerHTML = batch.map((order) => `
      <div class="review-order">
        <span class="mono">${escapeHtml(order.amazonOrderId)}</span>
        <span>${escapeHtml(order.market)} · ${escapeHtml(order.store)} · ${escapeHtml(order.status)}</span>
      </div>
    `).join('');
    elements.confirmChecked.checked = false;
    elements.dialogConfirm.disabled = true;
    if (!elements.confirmDialog.open) elements.confirmDialog.showModal();
  }

  function updateProgress(done, total, current, label = '正在提交并等待回读') {
    const percent = total ? Math.round((done / total) * 100) : 0;
    elements.progressDone.textContent = String(done);
    elements.progressTotal.textContent = String(total);
    elements.progressCurrent.textContent = current;
    elements.progressPercent.textContent = `${percent}%`;
    elements.progressBar.style.width = `${percent}%`;
    elements.progressLabel.textContent = label;
  }

  function itemFromOrder(order) {
    return {
      key: order.key,
      sid: order.sid,
      amazonOrderId: order.amazonOrderId,
      purchaseDateLocal: order.purchaseDateLocal,
      market: order.market,
      store: order.store,
      status: order.status,
      amount: order.amount,
      sku: order.sku,
      asin: order.asin,
      submitResult: 'pending',
      readback: '',
      message: '',
    };
  }

  async function executeConfirmedBatch() {
    const batch = [...state.confirmBatch];
    if (!batch.length || state.busy) return;
    if (Core.fingerprintOrders(batch) !== state.confirmFingerprint) {
      showToast('确认清单已变化，请重新复核');
      return;
    }
    if (writeBlocked()) {
      showToast('上次提交结果未确认，请先回读');
      return;
    }
    if (elements.confirmDialog.open) elements.confirmDialog.close();

    setBusy(true);
    const started = Date.now();
    const batchId = `VB-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 6)}`;
    const execution = {
      batchId,
      startedAt: formatDateTime(new Date(started)),
      status: 'submitting',
      scope: state.session.scope || '',
      rangeDays: state.rangeDays,
      batchCount: batch.length,
      acceptedCount: 0,
      items: batch.map(itemFromOrder),
    };
    state.lastExecution = execution;
    try {
      await storageSet({ [EXECUTION_STORAGE_KEY]: execution });
    } catch (_error) {
      state.lastExecution = null;
      setBusy(false);
      renderAll();
      showToast('本地执行记录保存失败，未发送标注请求');
      return;
    }

    setView('progress');
    updateProgress(0, batch.length, '正在准备提交…', '正在提交');
    renderResumeBanner();

    const chunks = Core.chunkOrders(batch, Core.WRITE_CHUNK_SIZE);
    let acceptedCount = 0;
    let submitError = '';
    let currentChunk = [];
    let journalWarning = '';

    for (const chunk of chunks) {
      currentChunk = chunk;
      const first = chunk[0];
      const last = chunk[chunk.length - 1];
      updateProgress(
        acceptedCount,
        batch.length,
        `${first.amazonOrderId}${chunk.length > 1 ? ` 至 ${last.amazonOrderId}` : ''}`,
        '正在提交',
      );
      try {
        const response = await rpc('mark-batch', {
          confirmed: true,
          orders: chunk.map((order) => ({
            sid: order.sid,
            amazonOrderId: order.amazonOrderId,
            purchaseDateLocal: order.purchaseDateLocal,
          })),
        }, 50000);
        if (response.data?.code !== 1) {
          throw new Error(String(response.data?.msg || response.data?.message || '领星未接受本批标注'));
        }
        for (const order of chunk) {
          const item = execution.items.find((entry) => entry.key === order.key);
          item.submitResult = 'accepted';
        }
        acceptedCount += chunk.length;
        execution.acceptedCount = acceptedCount;
        await storageSet({ [EXECUTION_STORAGE_KEY]: execution }).catch(() => {
          journalWarning = '本地执行记录未完整保存，请尽快导出结果';
        });
        updateProgress(
          acceptedCount,
          batch.length,
          `已受理 ${acceptedCount} 笔`,
          acceptedCount < batch.length ? '继续下一小批' : '提交完成，准备回读',
        );
      } catch (error) {
        submitError = String(error?.message || '提交结果不明确');
        for (const order of chunk) {
          const item = execution.items.find((entry) => entry.key === order.key);
          item.submitResult = 'unknown';
          item.message = submitError;
        }
        for (const order of batch) {
          const item = execution.items.find((entry) => entry.key === order.key);
          if (item.submitResult === 'pending') {
            item.submitResult = 'not-submitted';
            item.message = '本批因前序异常停止，未发送';
          }
        }
        break;
      }
    }

    execution.acceptedCount = acceptedCount;
    execution.status = acceptedCount ? 'submitted' : (currentChunk.length ? 'unknown' : 'failed');
    execution.submitError = submitError;
    await storageSet({ [EXECUTION_STORAGE_KEY]: execution }).catch(() => {
      journalWarning = '本地执行记录未完整保存，请尽快导出结果';
    });

    let readbackError = '';
    if (acceptedCount > 0) {
      updateProgress(acceptedCount, batch.length, '正在重新读取 isAssessed 状态…', '正在回读');
      try {
        const scan = await fetchScanData((pageNo, totalPages) => {
          elements.progressCurrent.textContent = `回读第 ${pageNo} / ${Math.max(pageNo, totalPages)} 页`;
        });
        await applyLatestClassification(scan);
        const accepted = execution.items.filter((item) => item.submitResult === 'accepted');
        const readback = Core.evaluateReadback(accepted, scan.classification.vineOrders);
        for (const result of readback) {
          const item = execution.items.find((entry) => entry.key === result.key);
          item.readback = result.readback;
          item.message = result.message;
        }
        const allPassed = readback.length === accepted.length && readback.every((item) => item.readback === 'passed');
        execution.status = allPassed && !submitError ? 'completed' : 'review';
        execution.readbackAt = Date.now();
      } catch (error) {
        readbackError = String(error?.message || '回读失败');
        execution.status = 'review';
        execution.readbackError = readbackError;
        for (const item of execution.items) {
          if (item.submitResult === 'accepted') {
            item.readback = 'unverified';
            item.message = readbackError;
          }
        }
      }
    } else {
      execution.status = 'failed';
    }

    state.selected.clear();
    state.lastExecution = execution;
    state.history.unshift({
      kind: 'execution',
      at: Date.now(),
      batchId,
      batchCount: batch.length,
      acceptedCount,
      passedCount: execution.items.filter((item) => item.readback === 'passed').length,
      status: execution.status,
      scope: state.session.scope || '',
    });
    state.history = state.history.slice(0, HISTORY_LIMIT);
    await storageSet({
      [EXECUTION_STORAGE_KEY]: execution,
      [HISTORY_STORAGE_KEY]: state.history,
    }).catch(() => {
      journalWarning = '本地执行记录未完整保存，请尽快导出结果';
    });

    setBusy(false);
    renderAll();
    renderSuccess(execution, Date.now() - started);
    if (submitError) showToast(`提交已停止：${submitError}`);
    if (readbackError) showToast(`回读失败：${readbackError}`);
    if (journalWarning) showToast(journalWarning);
  }

  function resultBadgeForItem(item) {
    if (item.readback === 'passed') return '<span class="badge success"><i class="dot"></i>核验通过</span>';
    if (item.submitResult === 'unknown') return '<span class="badge warn"><i class="dot"></i>结果待核实</span>';
    if (item.submitResult === 'not-submitted') return '<span class="badge danger"><i class="dot"></i>未提交</span>';
    if (item.readback === 'pending') return '<span class="badge warn"><i class="dot"></i>仍待标</span>';
    if (item.readback === 'missing') return '<span class="badge warn"><i class="dot"></i>回读未找到</span>';
    if (item.readback === 'unverified') return '<span class="badge warn"><i class="dot"></i>未回读</span>';
    return '<span class="badge warn"><i class="dot"></i>待核实</span>';
  }

  function renderSuccess(execution, elapsedMs) {
    const passed = execution.items.filter((item) => item.readback === 'passed').length;
    const accepted = execution.items.filter((item) => item.submitResult === 'accepted').length;
    const unresolved = execution.items.length - passed;
    const complete = execution.status === 'completed';
    const failed = execution.status === 'failed';

    elements.successIcon.classList.toggle('warn', !complete);
    elements.successTitle.textContent = complete
      ? `${passed} 笔订单已标记并核验`
      : failed
        ? '本批未完成提交'
        : accepted
          ? `已提交 ${accepted} 笔，${unresolved} 笔待核实`
          : '本批提交结果待核实';
    elements.successCopy.textContent = complete
      ? '回读确认本批 isAssessed = 1，推广类型为默认，未修改费用、备注或订单状态。'
      : '扩展已停止后续提交。请先按回读结果核对，不会自动重复提交同一批订单。';
    elements.successResultText.textContent = complete ? '回读全部通过' : `${passed} 笔通过`;
    elements.successDuration.textContent = `用时 ${(elapsedMs / 1000).toFixed(1)} 秒`;
    elements.successTable.innerHTML = execution.items.map((item) => `
      <div class="success-row">
        <strong class="mono" title="${escapeHtml(item.amazonOrderId)}">${escapeHtml(item.amazonOrderId)}</strong>
        <span>${escapeHtml(item.store)}</span>
        ${resultBadgeForItem(item)}
      </div>
    `).join('');

    elements.selectionTitleText.textContent = '本批';
    elements.selectedCount.textContent = String(execution.items.length);
    elements.selectionUnit.textContent = complete ? '笔订单已完成' : '笔订单待核实';
    elements.selectionSub.textContent = complete
      ? '回读确认 isAssessed = 1，执行记录可导出'
      : '结果未全部通过，不自动重试，请按记录人工核对';
    setView('success');
  }

  async function resolvePreviousExecution() {
    if (state.busy || !state.lastExecution || !state.session.ready) return;
    setBusy(true);
    elements.scanningTitle.textContent = '正在回读上次提交批次';
    elements.scanningCopy.textContent = '只读取当前 isAssessed 状态，不会重复发送标注请求。';
    setView('scanning');
    try {
      const scan = await fetchScanData((pageNo, totalPages) => {
        elements.scanningCopy.textContent = `正在读取第 ${pageNo} / ${Math.max(pageNo, totalPages)} 页，不会重复提交。`;
      });
      state.totalOrders = scan.totalOrders;
      state.vineOrders = scan.classification.vineOrders;
      state.pendingOrders = scan.classification.pendingOrders;
      const readback = Core.evaluateReadback(state.lastExecution.items, scan.classification.vineOrders);
      for (const result of readback) {
        const item = state.lastExecution.items.find((entry) => entry.key === result.key);
        item.readback = result.readback;
        item.message = result.message;
      }
      const allPassed = readback.every((item) => item.readback === 'passed');
      state.lastExecution.status = allPassed ? 'completed' : 'review';
      state.lastExecution.readbackAt = Date.now();
      await saveLastCheck(scan.classification, scan.range, scan.fetchedAt, false);
      await storageSet({ [EXECUTION_STORAGE_KEY]: state.lastExecution });
      renderAll();
      renderSuccess(state.lastExecution, 0);
      showToast(allPassed ? '上次批次回读全部通过' : '上次批次仍有结果待核实');
    } catch (error) {
      setView('ready');
      renderAll();
      showToast(String(error?.message || '回读失败'));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv(text, filename) {
    const blob = new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    shadow.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }

  function exportPreview() {
    const orders = selectedOrders();
    if (!orders.length) {
      showToast('当前没有选中的待标订单');
      return;
    }
    const stamp = today().replaceAll('-', '');
    downloadCsv(Core.previewCsv(orders), `vine-promotion-preview-${stamp}.csv`);
    showToast(`已导出 ${orders.length} 笔待标预览`);
  }

  function exportExecution() {
    if (!state.lastExecution?.items?.length) {
      showToast('暂无可导出的本次执行记录');
      return;
    }
    const stamp = today().replaceAll('-', '');
    downloadCsv(Core.executionCsv(state.lastExecution), `vine-promotion-execution-${stamp}.csv`);
    showToast(`已导出 ${state.lastExecution.items.length} 笔执行记录`);
  }

  function renderHistory() {
    elements.historyList.innerHTML = state.history.length
      ? state.history.map((entry) => {
        if (entry.kind === 'execution') {
          const complete = entry.status === 'completed';
          return `
            <div class="history-item">
              <div>
                <strong>${escapeHtml(formatShortTime(entry.at))} · 标注 ${entry.batchCount || 0} 笔</strong>
                <span>受理 ${entry.acceptedCount || 0} 笔 · 回读通过 ${entry.passedCount || 0} 笔</span>
              </div>
              <span class="badge ${complete ? 'success' : 'warn'}"><i class="dot"></i>${complete ? '已完成' : '待核实'}</span>
            </div>
          `;
        }
        return `
          <div class="history-item">
            <div>
              <strong>${escapeHtml(formatShortTime(entry.at))} · 只读检查</strong>
              <span>近 ${entry.rangeDays || 0} 天 ${entry.totalOrders || 0} 单 · Vine ${entry.vineCount || 0} · 待标 ${entry.pendingCount || 0}</span>
            </div>
            <span class="badge ${entry.pendingCount ? 'warn' : 'success'}"><i class="dot"></i>${entry.pendingCount ? '待处理' : '无待标'}</span>
          </div>
        `;
      }).join('')
      : '<div class="history-empty">暂无检查和执行记录</div>';
  }

  function updatePathVisibility() {
    const onOrderList = Core.isOrderListUrl(location.href);
    if (!onOrderList) {
      elements.launcher.hidden = true;
      if (state.panelOpen) closePanel();
      return;
    }
    elements.launcher.hidden = state.panelOpen;
  }

  function openPanel() {
    if (!Core.isOrderListUrl(location.href)) {
      showToast('请先打开「销售 → 平台订单 → 订单列表」');
      return;
    }
    state.panelOpen = true;
    elements.launcher.hidden = true;
    elements.backdrop.hidden = false;
    renderAll();
    if (state.session.ready && !state.lastCheck) void maybeAutoScan();
  }

  function closePanel() {
    state.panelOpen = false;
    elements.backdrop.hidden = true;
    updatePathVisibility();
  }

  async function loadStorage() {
    const values = await storageGet([
      CHECK_STORAGE_KEY,
      HISTORY_STORAGE_KEY,
      EXECUTION_STORAGE_KEY,
      LAUNCHER_POSITION_STORAGE_KEY,
    ]);
    state.launcherTop = clampLauncherTop(values[LAUNCHER_POSITION_STORAGE_KEY] || state.launcherTop);
    state.history = Array.isArray(values[HISTORY_STORAGE_KEY])
      ? values[HISTORY_STORAGE_KEY].slice(0, HISTORY_LIMIT)
      : [];
    state.lastExecution = values[EXECUTION_STORAGE_KEY] || null;

    const cached = values[CHECK_STORAGE_KEY];
    if (cached && Array.isArray(cached.pendingOrders)) {
      state.lastCheck = cached;
      state.rangeDays = Number(cached.rangeDays) || 30;
      state.totalOrders = Number(cached.totalOrders) || 0;
      state.pendingOrders = cached.pendingOrders.filter((order) => Number(order.isAssessed) !== 1);
      state.selected = new Set(state.pendingOrders.map((order) => order.key));
      state.focusedKey = state.pendingOrders[0]?.key || null;
    }
  }

  function bindLauncherInteraction() {
    let drag = null;
    let suppressClick = false;
    let suppressClickTimer = 0;

    function clearClickSuppression() {
      suppressClick = false;
      clearTimeout(suppressClickTimer);
      window.removeEventListener('click', suppressDragClick, true);
    }

    function suppressDragClick(event) {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      clearClickSuppression();
    }

    function removeDragListeners() {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', finishDrag, true);
      window.removeEventListener('pointercancel', finishDrag, true);
    }

    elements.launcher.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      clearClickSuppression();
      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startTop: state.launcherTop,
        moved: false,
      };
      try {
        elements.launcher.setPointerCapture?.(event.pointerId);
      } catch (_error) {
        // Window-level listeners below also handle pages that reject pointer capture.
      }
      window.addEventListener('pointermove', handlePointerMove, true);
      window.addEventListener('pointerup', finishDrag, true);
      window.addEventListener('pointercancel', finishDrag, true);
    });

    function handlePointerMove(event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaY) > 3) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      elements.launcher.classList.add('is-dragging');
      setLauncherTop(drag.startTop + deltaY);
    }

    function finishDrag(event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved = drag.moved;
      drag = null;
      removeDragListeners();
      elements.launcher.classList.remove('is-dragging');
      if (elements.launcher.hasPointerCapture?.(event.pointerId)) {
        elements.launcher.releasePointerCapture(event.pointerId);
      }
      if (!moved) return;
      setLauncherTop(state.launcherTop, true);
      suppressClick = true;
      window.addEventListener('click', suppressDragClick, true);
      suppressClickTimer = window.setTimeout(clearClickSuppression, 350);
    }

    elements.launcher.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        clearClickSuppression();
        return;
      }
      openPanel();
    });
    elements.launcher.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      event.stopPropagation();
      setLauncherTop(state.launcherTop + (event.key === 'ArrowUp' ? -24 : 24), true);
    });
    window.addEventListener('resize', () => setLauncherTop(state.launcherTop));
  }

  function bindEvents() {
    window.addEventListener('message', (event) => {
      if (event.source !== window
        || event.data?.channel !== CHANNEL
        || event.data?.direction !== 'page-to-ui') {
        return;
      }
      const data = event.data;
      if (data.type === 'session-state') {
        updateSession(data.session);
      }
      if (data.id && rpcWaiters.has(data.id)) {
        const waiter = rpcWaiters.get(data.id);
        rpcWaiters.delete(data.id);
        clearTimeout(waiter.timer);
        if (data.ok) waiter.resolve(data.result);
        else waiter.reject(new Error(data.error || '领星请求失败'));
      }
    });

    bindLauncherInteraction();
    $('#minimizeButton').addEventListener('click', closePanel);
    $('#closeButton').addEventListener('click', closePanel);
    elements.scanButton.addEventListener('click', () => void scanAll());
    elements.rescanButton.addEventListener('click', () => void scanAll());
    elements.rangeSelect.addEventListener('change', () => {
      state.rangeDays = Number(elements.rangeSelect.value) || 30;
      void scanAll();
    });
    elements.exportPreviewButton.addEventListener('click', exportPreview);
    elements.exportPreviewFooter.addEventListener('click', exportPreview);
    elements.markButton.addEventListener('click', () => void prepareConfirmation());
    elements.resumeButton.addEventListener('click', () => void resolvePreviousExecution());

    elements.searchInput.addEventListener('input', () => {
      state.query = elements.searchInput.value;
      renderList();
      renderTable();
      renderFooter();
    });

    elements.filters.addEventListener('click', (event) => {
      const button = event.target.closest('[data-market]');
      if (!button) return;
      state.market = button.dataset.market;
      renderFilters();
      renderList();
      renderTable();
      renderFooter();
    });

    shadow.addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-check-key]');
      if (!checkbox) return;
      if (checkbox.checked) state.selected.add(checkbox.dataset.checkKey);
      else state.selected.delete(checkbox.dataset.checkKey);
      renderList();
      renderTable();
      renderFooter();
    });

    shadow.addEventListener('click', (event) => {
      const record = event.target.closest('[data-record-key]');
      if (!record || event.target.matches('input')) return;
      state.focusedKey = record.dataset.recordKey;
      renderList();
      const row = $(`tr[data-order-key="${CSS.escape(state.focusedKey)}"]`);
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    elements.masterCheck.addEventListener('change', () => {
      const orders = visibleOrders();
      for (const order of orders) {
        if (elements.masterCheck.checked) state.selected.add(order.key);
        else state.selected.delete(order.key);
      }
      renderList();
      renderTable();
      renderFooter();
    });

    elements.tableSelectAll.addEventListener('click', () => {
      const orders = visibleOrders();
      const allSelected = orders.length > 0 && orders.every((order) => state.selected.has(order.key));
      for (const order of orders) {
        if (allSelected) state.selected.delete(order.key);
        else state.selected.add(order.key);
      }
      renderList();
      renderTable();
      renderFooter();
    });

    elements.selectAllButton.addEventListener('click', () => {
      state.selected = new Set(state.pendingOrders.map((order) => order.key));
      renderList();
      renderTable();
      renderFooter();
    });

    elements.clearSelectionButton.addEventListener('click', () => {
      state.selected.clear();
      renderList();
      renderTable();
      renderFooter();
    });

    elements.confirmChecked.addEventListener('change', () => {
      elements.dialogConfirm.disabled = !elements.confirmChecked.checked;
    });
    $('#dialogCancel').addEventListener('click', () => elements.confirmDialog.close());
    $('#dialogClose').addEventListener('click', () => elements.confirmDialog.close());
    elements.dialogConfirm.addEventListener('click', () => {
      void executeConfirmedBatch().catch((error) => {
        setBusy(false);
        renderAll();
        showToast(String(error?.message || '标注执行异常，请检查领星结果'));
      });
    });
    elements.confirmDialog.addEventListener('click', (event) => {
      if (event.target === elements.confirmDialog) elements.confirmDialog.close();
    });

    elements.historyButton.addEventListener('click', () => {
      renderHistory();
      if (!elements.historyDialog.open) elements.historyDialog.showModal();
    });
    $('#historyClose').addEventListener('click', () => elements.historyDialog.close());
    $('#historyDone').addEventListener('click', () => elements.historyDialog.close());
    elements.historyDialog.addEventListener('click', (event) => {
      if (event.target === elements.historyDialog) elements.historyDialog.close();
    });

    $('#checkAgainButton').addEventListener('click', () => void scanAll());
    elements.exportLogButton.addEventListener('click', exportExecution);

    chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'vine-promotion:open') return undefined;
      if (!Core.isOrderListUrl(location.href)) {
        sendResponse({ ok: false, error: '请先打开领星销售订单列表' });
        return false;
      }
      openPanel();
      sendResponse({ ok: true });
      return false;
    });
  }

  async function boot() {
    await stylesheetReady;
    await loadStorage();
    setLauncherTop(state.launcherTop);
    elements.rangeSelect.value = String(state.rangeDays);
    bindEvents();
    renderAll();
    setView('ready');
    updatePathVisibility();
    try {
      const session = await rpc('session-status', undefined, 3000);
      updateSession(session);
    } catch (_error) {
      updateSession({ ready: false });
    }
    setInterval(updatePathVisibility, 800);
  }

  try {
    await boot();
  } catch (error) {
    console.error('[Vine 推广标注助手] 初始化失败', error);
  }
})();
