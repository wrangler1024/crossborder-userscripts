(function runXynigoDxmLogisticsAssistant() {
  'use strict';

  const Core = globalThis.XynigoDxmLogisticsCore;
  const ImportTools = globalThis.XynigoDxmLogisticsImport;
  const TemplateData = globalThis.XynigoDxmLogisticsTemplate;
  if (!Core || !ImportTools || !TemplateData || globalThis.__xynigoDxmLogisticsAssistantInstalled) return;
  globalThis.__xynigoDxmLogisticsAssistantInstalled = true;

  const ROOT_ID = 'xynigo-dxm-logistics-root';
  const FLOATING_ENTRY_ID = 'xynigo-dxm-logistics-entry';
  const PENDING_REVIEW_PATH = '/web/order/paid';
  const ENTRY_ICON_URL = globalThis.XynigoDxmLogisticsAssets?.icon48
    || globalThis.chrome?.runtime?.getURL?.('icons/icon48.png')
    || '';
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const DETAIL_ENDPOINT = '/api/order/detail.json';
  const SPLIT_DETAIL_ENDPOINT = '/api/order/splitedOrderDetail.json';
  const SPLIT_COMMIT_ENDPOINT = '/api/order/batchSplitOrder.json';
  const SHIPPING_OPTIONS_ENDPOINT = '/api/order/withOutPrintShippingList.json';
  const SHIPMENT_ENDPOINT = '/api/package/withOutPrintShip.json';
  const RETRY_COMMIT_ENDPOINT = '/api/package/commitPlatform.json';
  const MODE_SHIP = 'ship';
  const MODE_SPLIT = 'split';
  const MODE_RETRY = 'retry';
  const DEFAULT_SHIPMENT_CONCURRENCY = 2;
  const MAX_SHIPMENT_CONCURRENCY = 4;

  let running = false;
  let floatingTop = null;
  let suppressFloatingClick = false;

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function removeAssistant() {
    if (running) return;
    document.getElementById(ROOT_ID)?.remove();
  }

  function isPendingReviewPage() {
    return window.location.pathname.replace(/\/+$/, '') === PENDING_REVIEW_PATH;
  }

  function syncPageAvailability() {
    if (isPendingReviewPage()) {
      createFloatingEntry();
      return;
    }
    document.getElementById(FLOATING_ENTRY_ID)?.remove();
    if (!running) document.getElementById(ROOT_ID)?.remove();
  }

  function clampFloatingTop(value, elementHeight) {
    const margin = 8;
    const maximum = Math.max(margin, window.innerHeight - Math.max(1, elementHeight) - margin);
    return Math.min(maximum, Math.max(margin, Math.round(value)));
  }

  function applyFloatingPosition(entry) {
    if (!entry?.isConnected) return;
    const button = entry.querySelector('button');
    const height = button?.getBoundingClientRect().height || 52;
    if (floatingTop === null) floatingTop = Math.round((window.innerHeight - Math.max(52, height)) / 2);
    floatingTop = clampFloatingTop(floatingTop, height);
    entry.style.setProperty('top', `${floatingTop}px`, 'important');
  }

  function bindFloatingDrag(entry, button) {
    let drag = null;
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.moved) {
        suppressFloatingClick = true;
        setTimeout(() => { suppressFloatingClick = false; }, 0);
      }
      drag = null;
      entry.classList.remove('is-dragging');
      try { button.releasePointerCapture(event.pointerId); } catch (_error) {}
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startTop: Number.isFinite(floatingTop) ? floatingTop : parseFloat(entry.style.top) || 8,
        moved: false,
      };
      button.setPointerCapture(event.pointerId);
      entry.classList.add('is-dragging');
    });
    button.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaY) >= 4) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      const height = button.getBoundingClientRect().height || 52;
      floatingTop = clampFloatingTop(drag.startTop + deltaY, height);
      entry.style.setProperty('top', `${floatingTop}px`, 'important');
    });
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', finish);
  }

  function isFailureListPage() {
    return location.pathname.replace(/\/+$/, '') === '/web/order/shipped/fail';
  }

  function selectedMode(root) {
    return root.querySelector('input[name="xynigo-dxm-logistics-mode"]:checked')?.value || MODE_SHIP;
  }

  function applyModeUi(root) {
    const mode = selectedMode(root);
    const isRetry = mode === MODE_RETRY;
    const isSplit = mode === MODE_SPLIT;
    root.querySelector('[data-role="callout-title"]').textContent = isRetry
      ? '失败单重提不会改写物流信息。'
      : (isSplit ? '本批只处理已出物流的采购子单。' : '这是不可撤销的店小秘写入操作。');
    root.querySelector('[data-role="callout-copy"]').textContent = isRetry
      ? '插件会核对失败订单现有物流单号和承运商，只调用店小秘“继续提交平台”。'
      : (isSplit
        ? '插件读取 SHEIN 原订单商品；需要时先按商品图生成并执行拆单，回读新包裹后再映射、确认发货。'
        : '插件会先自动搜索并回读订单详情；只有全部精确匹配后才能执行。');
    root.querySelector('[data-role="input-label"]').textContent = isRetry
      ? '订单号 + 当前物流单号'
      : (isSplit ? '采购子单号 + 物流单号' : '订单号 + 物流单号');
    root.querySelector('[data-action="preflight"]').textContent = isRetry
      ? '预检失败单'
      : (isSplit ? '读取商品并规划拆单' : '预检匹配');
    root.querySelector('#xynigo-dxm-logistics-input').placeholder = isSplit
      ? 'GSH1SAMPLE0001A-1\tJMXTEST000000001\nGSH1SAMPLE0001A-2\tJMXTEST000000002'
      : 'GSU1SAMPLE0001A\t1Z999AA10123456784\nGSU1SAMPLE0002B\t1Z999AA10123456785';
    root.querySelector('[data-role="import-help"]').textContent = isSplit
      ? '模板“订单号”列填写采购子单号；只录入本批已有物流的子单，待物流子单无需填写。'
      : '模板三列均必填：订单号、物流单号、物流商渠道。上传只会填入输入框，不会直接发货。';
    root.querySelector('[data-role="input-help"]').textContent = isSplit
      ? '采购子单号统一为“原订单号-序号”；可选第三列覆盖单行物流商。'
      : '推荐直接从 Excel 复制两列；也支持逗号、分号或多个空格分隔。可选第三列覆盖单行物流商。';
  }

  function createFloatingEntry() {
    if (document.getElementById(FLOATING_ENTRY_ID)) return;
    const entry = document.createElement('aside');
    entry.id = FLOATING_ENTRY_ID;
    entry.setAttribute('aria-label', 'Xynigo 店小秘物流助手入口');
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', '打开物流助手');
    button.setAttribute('title', '点击打开；按住可上下拖动');
    const iconWrap = document.createElement('span');
    const icon = document.createElement('img');
    icon.src = ENTRY_ICON_URL;
    icon.alt = '';
    const label = document.createElement('b');
    label.textContent = '物流助手';
    iconWrap.appendChild(icon);
    button.append(iconWrap, label);
    entry.appendChild(button);
    document.documentElement.appendChild(entry);
    button.addEventListener('click', (event) => {
      if (suppressFloatingClick) {
        event.preventDefault();
        return;
      }
      openAssistant();
    });
    bindFloatingDrag(entry, button);
    requestAnimationFrame(() => applyFloatingPosition(entry));
    window.addEventListener('resize', () => applyFloatingPosition(entry));
  }

  function fixedMarkup() {
    return `
      <div class="xynigo-dxm-logistics-backdrop" aria-hidden="true"></div>
      <section class="xynigo-dxm-logistics-dialog" role="dialog" aria-modal="true" aria-labelledby="xynigo-dxm-logistics-title">
        <header class="xynigo-dxm-logistics-header">
          <div>
            <p class="xynigo-dxm-logistics-kicker">XYNIGO · V0.3</p>
            <h2 id="xynigo-dxm-logistics-title">店小秘物流助手</h2>
            <p>粘贴订单号和物流单号，核对店小秘平台承运商后执行发货。</p>
          </div>
          <button type="button" class="xynigo-dxm-logistics-close" aria-label="关闭">×</button>
        </header>
        <main class="xynigo-dxm-logistics-main">
          <section data-stage="input">
            <div class="xynigo-dxm-logistics-mode" role="radiogroup" aria-label="操作模式">
              <label><input type="radio" name="xynigo-dxm-logistics-mode" value="ship"><span>首次发货</span></label>
              <label><input type="radio" name="xynigo-dxm-logistics-mode" value="split"><span>拆单分批发货</span></label>
            </div>
            <div class="xynigo-dxm-logistics-callout">
              <strong data-role="callout-title">这是不可撤销的店小秘写入操作。</strong>
              <span data-role="callout-copy">插件会先自动搜索并回读订单详情；只有全部精确匹配后才能执行。</span>
            </div>
            <label class="xynigo-dxm-logistics-label" data-role="input-label" for="xynigo-dxm-logistics-input">订单号 + 物流单号</label>
            <textarea id="xynigo-dxm-logistics-input" spellcheck="false" placeholder="GSU1SAMPLE0001A&#9;1Z999AA10123456784&#10;GSU1SAMPLE0002B&#9;1Z999AA10123456785"></textarea>
            <div class="xynigo-dxm-logistics-import-tools">
              <input type="file" data-role="import-file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
              <div>
                <button type="button" data-action="download-template" class="xynigo-dxm-logistics-secondary">下载导入模板</button>
                <button type="button" data-action="upload-file" class="xynigo-dxm-logistics-secondary">上传 Excel/CSV</button>
              </div>
              <p data-role="import-help">模板三列均必填：订单号、物流单号、物流商渠道。上传只会填入输入框，不会直接发货。</p>
            </div>
            <div class="xynigo-dxm-logistics-row">
              <label>
                <span>本批默认物流商</span>
                <select id="xynigo-dxm-logistics-carrier"></select>
              </label>
              <p data-role="input-help">推荐直接从 Excel 复制两列；也支持逗号、分号或多个空格分隔。可选第三列覆盖单行物流商。</p>
            </div>
            <div class="xynigo-dxm-logistics-feedback" aria-live="polite"></div>
          </section>
          <section data-stage="mapping" hidden>
            <div class="xynigo-dxm-logistics-summary" data-role="mapping-summary"></div>
            <div class="xynigo-dxm-logistics-package-groups" data-role="package-groups"></div>
            <div class="xynigo-dxm-logistics-table-wrap xynigo-dxm-logistics-mapping-table">
              <table>
                <thead><tr><th>#</th><th>采购子单号</th><th>原订单号</th><th>物流单号</th><th>物流商</th><th>映射到店小秘包裹</th></tr></thead>
                <tbody></tbody>
              </table>
            </div>
            <label class="xynigo-dxm-logistics-single-package-confirm" data-role="single-package-confirm" hidden>
              <input type="checkbox">
              <span></span>
            </label>
            <div class="xynigo-dxm-logistics-feedback" data-role="mapping-feedback" aria-live="polite"></div>
          </section>
          <section data-stage="split-plan" hidden>
            <div class="xynigo-dxm-logistics-summary" data-role="split-plan-summary"></div>
            <div class="xynigo-dxm-logistics-split-orders" data-role="split-orders"></div>
            <label class="xynigo-dxm-logistics-confirm xynigo-dxm-logistics-split-confirm">
              <input type="checkbox">
              <span>我已按商品图、SKU/规格和数量核对拆单计划，确认执行不可撤销的店小秘拆单。本步骤只拆包裹，不填写物流、不发货。</span>
            </label>
            <div class="xynigo-dxm-logistics-feedback" data-role="split-plan-feedback" aria-live="polite"></div>
          </section>
          <section data-stage="preview" hidden>
            <div class="xynigo-dxm-logistics-summary"></div>
            <div class="xynigo-dxm-logistics-execution-metrics" data-role="execution-metrics" hidden>
              <div><small>执行进度</small><strong data-metric="progress">0/0</strong></div>
              <div><small>执行时长</small><strong data-metric="duration">0.0秒</strong></div>
              <div><small>初始并发</small><strong data-metric="requested-concurrency">—</strong></div>
              <div><small>当前并发</small><strong data-metric="effective-concurrency">—</strong></div>
              <div><small>接口繁忙</small><strong data-metric="busy-count">0 次</strong></div>
            </div>
            <div class="xynigo-dxm-logistics-table-wrap">
              <table>
                <thead><tr><th>#</th><th>订单号</th><th>物流单号</th><th>输入物流商</th><th>店小秘平台承运商</th><th>内部包裹 ID</th><th>状态</th></tr></thead>
                <tbody></tbody>
              </table>
            </div>
            <div class="xynigo-dxm-logistics-execution-settings" data-role="shipment-concurrency">
              <strong>执行并发数</strong>
              <div role="radiogroup" aria-label="执行发货并发数">
                <label><input type="radio" name="xynigo-dxm-logistics-concurrency" value="1"><span>1</span></label>
                <label><input type="radio" name="xynigo-dxm-logistics-concurrency" value="2" checked><span>2</span></label>
                <label><input type="radio" name="xynigo-dxm-logistics-concurrency" value="3"><span>3</span></label>
                <label><input type="radio" name="xynigo-dxm-logistics-concurrency" value="4"><span>4</span></label>
              </div>
              <small>默认 2；店小秘繁忙时自动降为 1，出现结果未知时停止派发剩余订单。</small>
            </div>
            <label class="xynigo-dxm-logistics-confirm">
              <input type="checkbox">
              <span>我已逐行核对订单号、物流单号及店小秘平台承运商，确认执行不可撤销的店小秘发货写入。</span>
            </label>
          </section>
        </main>
        <footer class="xynigo-dxm-logistics-footer">
          <button type="button" data-action="cancel" class="xynigo-dxm-logistics-secondary">取消</button>
          <button type="button" data-action="back" class="xynigo-dxm-logistics-secondary" hidden>返回修改</button>
          <button type="button" data-action="download" class="xynigo-dxm-logistics-secondary" hidden>下载结果 CSV</button>
          <button type="button" data-action="preflight" class="xynigo-dxm-logistics-primary">预检匹配</button>
          <button type="button" data-action="execute-split" class="xynigo-dxm-logistics-danger" hidden disabled>确认并执行店小秘拆单</button>
          <button type="button" data-action="continue-mapping" class="xynigo-dxm-logistics-primary" hidden>核对本批物流</button>
          <button type="button" data-action="execute" class="xynigo-dxm-logistics-danger" hidden disabled>确认并执行发货</button>
        </footer>
      </section>`;
  }

  function openAssistant() {
    if (document.getElementById(ROOT_ID)) return;
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = fixedMarkup();
    document.body.appendChild(root);

    const carrier = root.querySelector('#xynigo-dxm-logistics-carrier');
    Core.CARRIERS.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.providerName;
      option.textContent = item.label;
      carrier.appendChild(option);
    });
    carrier.value = 'UPS';
    const defaultMode = MODE_SHIP;
    const defaultModeInput = root.querySelector(`input[name="xynigo-dxm-logistics-mode"][value="${defaultMode}"]`);
    if (defaultModeInput) defaultModeInput.checked = true;
    root.querySelectorAll('input[name="xynigo-dxm-logistics-mode"]').forEach((inputElement) => {
      inputElement.addEventListener('change', () => applyModeUi(root));
    });
    applyModeUi(root);

    const close = root.querySelector('.xynigo-dxm-logistics-close');
    const cancel = root.querySelector('[data-action="cancel"]');
    const back = root.querySelector('[data-action="back"]');
    const preflight = root.querySelector('[data-action="preflight"]');
    const execute = root.querySelector('[data-action="execute"]');
    const executeSplit = root.querySelector('[data-action="execute-split"]');
    const continueMapping = root.querySelector('[data-action="continue-mapping"]');
    const download = root.querySelector('[data-action="download"]');
    const downloadTemplate = root.querySelector('[data-action="download-template"]');
    const uploadFile = root.querySelector('[data-action="upload-file"]');
    const importFile = root.querySelector('[data-role="import-file"]');
    const confirmed = root.querySelector('.xynigo-dxm-logistics-confirm input');
    const splitConfirmed = root.querySelector('.xynigo-dxm-logistics-split-confirm input');
    const textarea = root.querySelector('#xynigo-dxm-logistics-input');

    close.addEventListener('click', removeAssistant);
    cancel.addEventListener('click', removeAssistant);
    back.addEventListener('click', () => showPreviousStage(root));
    confirmed.addEventListener('change', () => {
      execute.disabled = !confirmed.checked || running;
    });
    preflight.addEventListener('click', () => startPreflight(root));
    splitConfirmed.addEventListener('change', () => syncSplitPlanUi(root));
    executeSplit.addEventListener('click', () => executeSplitPlans(root));
    continueMapping.addEventListener('click', () => continueSplitPreflight(root));
    execute.addEventListener('click', () => executePreview(root));
    download.addEventListener('click', () => downloadResults(root.__xynigoResults || []));
    downloadTemplate.addEventListener('click', () => downloadImportTemplate(root));
    uploadFile.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async () => {
      const [file] = importFile.files || [];
      if (!file) return;
      try {
        await importShipmentFile(root, file);
      } finally {
        importFile.value = '';
      }
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') removeAssistant();
    });
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }, 0);
  }

  function setFeedback(root, messages, tone = 'info') {
    const feedback = root.querySelector('.xynigo-dxm-logistics-feedback');
    feedback.dataset.tone = tone;
    feedback.replaceChildren();
    const list = Array.isArray(messages) ? messages : [messages];
    list.filter(Boolean).forEach((message) => {
      const line = document.createElement('p');
      line.textContent = String(message);
      feedback.appendChild(line);
    });
  }

  function blobFromTemplateData() {
    const base64 = String(TemplateData.base64 || '');
    if (!base64) throw new Error('扩展内置模板数据缺失，请重新安装最新版插件');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytes.length === 0) throw new Error('扩展内置模板数据为空，请重新安装最新版插件');
    return new Blob([bytes], { type: TemplateData.mimeType });
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function downloadImportTemplate(root) {
    try {
      triggerBlobDownload(blobFromTemplateData(), TemplateData.filename);
      setFeedback(root, '模板已交给 Comet 下载；如未出现文件，请查看浏览器下载列表。', 'success');
    } catch (error) {
      setFeedback(root, error?.message || '模板下载失败，请刷新店小秘页面后重试', 'error');
    }
  }

  async function rowsFromImportFile(file) {
    const filename = String(file?.name || '');
    const extension = filename.toLocaleLowerCase().split('.').pop();
    if (!['xlsx', 'csv'].includes(extension)) {
      throw new Error('仅支持 .xlsx 或 .csv 文件');
    }
    if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('导入文件为空');
    if (file.size > MAX_IMPORT_BYTES) throw new Error('导入文件不能超过 5 MB');
    if (extension === 'csv') {
      const text = await file.text();
      const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
      const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
      return { rows: ImportTools.parseDelimitedText(text, delimiter), sourceLabel: 'CSV' };
    }
    if (!globalThis.JSZip?.loadAsync) {
      throw new Error('Excel 解析组件未加载，请刷新店小秘页面后重试');
    }
    const rows = await ImportTools.parseXlsxRows(
      await file.arrayBuffer(),
      globalThis.JSZip,
      globalThis.DOMParser,
    );
    return { rows, sourceLabel: 'Excel' };
  }

  async function importShipmentFile(root, file) {
    setBusy(root, true, `正在本地读取 ${file.name}…`);
    try {
      const imported = await rowsFromImportFile(file);
      const parsed = ImportTools.rowsToInput(imported.rows, Core, {
        maxEntries: Core.MAX_ENTRIES,
        sourceLabel: imported.sourceLabel,
      });
      if (!parsed.ok) {
        setFeedback(root, parsed.errors.map((item) => item.message), 'error');
        return;
      }
      const textarea = root.querySelector('#xynigo-dxm-logistics-input');
      setNativeInputValue(textarea, parsed.input);
      const itemLabel = selectedMode(root) === MODE_SPLIT ? '采购子单' : '订单';
      setFeedback(root, [
        `已从 ${file.name} 导入 ${parsed.entries.length} 个${itemLabel}，已替换输入框内容。`,
        ...parsed.warnings.map((item) => item.message),
        '尚未发货，请继续执行预检并逐行核对。',
      ], 'success');
    } catch (error) {
      setFeedback(root, error?.message || '导入文件读取失败', 'error');
    } finally {
      setBusy(root, false);
    }
  }

  function setBusy(root, busy, message = '') {
    running = busy;
    root.dataset.busy = busy ? 'true' : 'false';
    root.querySelectorAll('button, textarea, select, input').forEach((element) => {
      if (element.matches('[data-action="execute"], [data-action="execute-split"]')) return;
      element.disabled = busy;
    });
    root.querySelector('.xynigo-dxm-logistics-close').disabled = busy;
    const execute = root.querySelector('[data-action="execute"]');
    const executeSplit = root.querySelector('[data-action="execute-split"]');
    if (busy) execute.disabled = true;
    if (busy) executeSplit.disabled = true;
    if (message) setFeedback(root, message, 'progress');
    if (!busy) queueMicrotask(syncPageAvailability);
  }

  function showInputStage(root) {
    if (running) return;
    root.querySelector('[data-stage="input"]').hidden = false;
    root.querySelector('[data-stage="mapping"]').hidden = true;
    root.querySelector('[data-stage="split-plan"]').hidden = true;
    root.querySelector('[data-stage="preview"]').hidden = true;
    root.querySelector('[data-action="preflight"]').hidden = false;
    root.querySelector('[data-action="continue-mapping"]').hidden = true;
    root.querySelector('[data-action="execute-split"]').hidden = true;
    root.querySelector('[data-action="execute"]').hidden = true;
    root.querySelector('[data-action="back"]').hidden = true;
    root.querySelector('[data-action="download"]').hidden = true;
    root.querySelector('[data-action="cancel"]').textContent = '取消';
    root.querySelector('.xynigo-dxm-logistics-confirm input').checked = false;
    root.querySelector('.xynigo-dxm-logistics-split-confirm input').checked = false;
    root.__xynigoMatches = null;
    root.__xynigoResults = null;
    root.__xynigoExcluded = null;
    root.__xynigoSplitContext = null;
  }

  function showPreviousStage(root) {
    if (running) return;
    if (root.__xynigoMode === MODE_SPLIT
      && root.__xynigoSplitContext
      && !root.querySelector('[data-stage="preview"]').hidden) {
      root.querySelector('[data-stage="preview"]').hidden = true;
      root.querySelector('[data-stage="mapping"]').hidden = false;
      root.querySelector('[data-action="execute"]').hidden = true;
      root.querySelector('[data-action="continue-mapping"]').hidden = false;
      root.querySelector('.xynigo-dxm-logistics-confirm input').checked = false;
      root.__xynigoMatches = null;
      return;
    }
    showInputStage(root);
  }

  async function startPreflight(root) {
    if (!isPendingReviewPage()) {
      setFeedback(root, '物流助手只允许在店小秘“订单—待审核”页面使用。', 'error');
      return;
    }
    const mode = selectedMode(root);
    if (mode === MODE_RETRY && !isFailureListPage()) {
      setFeedback(root, '失败单重提只能在店小秘“发货失败”列表页执行。', 'error');
      return;
    }
    if (mode !== MODE_RETRY && isFailureListPage()) {
      setFeedback(root, '发货失败页禁止使用“首次发货”或“拆单分批发货”；请切换到“失败单重提”。', 'error');
      return;
    }
    const input = root.querySelector('#xynigo-dxm-logistics-input').value;
    const defaultCarrier = root.querySelector('#xynigo-dxm-logistics-carrier').value;
    const parsed = mode === MODE_SPLIT
      ? Core.parseSplitInput(input, { defaultCarrier })
      : Core.parseInput(input, { defaultCarrier });
    if (!parsed.ok) {
      setFeedback(root, parsed.errors.map((item) => item.message), 'error');
      return;
    }

    const warningMessages = parsed.warnings.map((item) => item.message);
    setBusy(
      root,
      true,
      mode === MODE_RETRY
        ? `正在店小秘核对 ${parsed.entries.length} 个失败订单的现有物流信息…`
        : (mode === MODE_SPLIT
          ? `正在店小秘读取 ${Core.uniqueSearchEntries(parsed.entries).length} 个原订单的拆分包裹…`
          : `正在店小秘搜索并精确核对 ${parsed.entries.length} 个订单…`),
    );
    try {
      const searchEntries = mode === MODE_SPLIT ? Core.uniqueSearchEntries(parsed.entries) : parsed.entries;
      const searchResult = await searchForOrders(searchEntries, { allowMultiplePackages: mode === MODE_SPLIT });
      if (!searchResult.ok) throw new Error(searchResult.reason);
      const detailResult = await readVisibleOrders(searchEntries, (done, total) => {
        setFeedback(root, `正在回读店小秘订单详情 ${done}/${total}…`, 'progress');
      });
      if (mode === MODE_SPLIT) {
        const messages = [...warningMessages];
        if (detailResult.errors.length) {
          messages.push(`另有 ${detailResult.errors.length} 个店小秘包裹无法回读；为避免错配，已停止预检。`);
        }
        if (detailResult.errors.length || detailResult.records.length === 0) {
          setFeedback(root, messages.length ? messages : '未读取到可映射的店小秘拆分包裹。', 'error');
          return;
        }
        const splitDetails = [];
        for (const { orderNo } of searchEntries) {
          const orderEntries = parsed.entries.filter((entry) => entry.orderNo === orderNo);
          const orderRecords = detailResult.records.filter((record) => record.orderNo === orderNo);
          if (orderRecords.length === 0) {
            messages.push(`原订单 ${orderNo} 未找到可处理的店小秘包裹`);
            continue;
          }
          if (orderRecords.length > 1 && orderEntries.length > orderRecords.length) {
            messages.push(
              `原订单 ${orderNo} 当前有 ${orderRecords.length} 个待处理包裹，但本批有 ${orderEntries.length} 个采购子单；无法安全判断应继续拆哪个包裹，请先人工核对。`,
            );
            continue;
          }
          if (orderRecords.length !== 1) continue;
          try {
            setFeedback(root, `正在读取原订单 ${orderNo} 的可拆商品…`, 'progress');
            const splitDetail = await fetchSplitOrderDetail(orderRecords[0]);
            if (splitDetail.totalQuantity > 1) {
              const blockReason = Core.packageFirstShipmentBlockReason(orderRecords[0]);
              if (blockReason) messages.push(`原订单 ${orderNo}：${blockReason}`);
              else splitDetails.push(splitDetail);
            } else if (orderEntries.length > 1) {
              messages.push(`原订单 ${orderNo} 只有 1 件可拆商品，无法生成 ${orderEntries.length} 个采购子单包裹`);
            }
          } catch (error) {
            messages.push(`原订单 ${orderNo}：${error?.message || '拆单详情读取失败'}`);
          }
        }
        const blockingMessages = messages.slice(warningMessages.length);
        if (blockingMessages.length) {
          setFeedback(root, messages, 'error');
          return;
        }
        root.__xynigoMode = MODE_SPLIT;
        root.__xynigoSplitContext = {
          entries: parsed.entries,
          records: detailResult.records,
          warnings: warningMessages,
          splitDetails,
          splitAllocations: new Map(),
          splitPlans: [],
          splitCommitted: false,
        };
        if (splitDetails.length) renderSplitPlan(root);
        else renderSplitMapping(root, parsed.entries, detailResult.records, warningMessages);
        return;
      }
      const matched = Core.matchEntries(parsed.entries, detailResult.records);
      const missingBlocksOperation = mode === MODE_RETRY && matched.missing.length > 0;
      const hasBlockingMatchFailure = matched.ambiguous.length > 0
        || detailResult.errors.length > 0
        || detailResult.records.length === 0
        || matched.matches.length === 0
        || missingBlocksOperation;
      if (hasBlockingMatchFailure) {
        const messages = [...warningMessages];
        if (matched.missing.length) {
          messages.push(`${mode === MODE_RETRY ? '未找到' : '当前没有可发货订单'}：${matched.missing.map((item) => item.orderNo).join('、')}`);
        }
        if (matched.ambiguous.length) {
          messages.push(`匹配到多个店小秘包裹：${matched.ambiguous.map((item) => item.entry.orderNo).join('、')}`);
        }
        if (detailResult.errors.length) {
          messages.push(`另有 ${detailResult.errors.length} 条列表记录无法回读；请刷新店小秘页面后重试。`);
        }
        messages.push('请确认订单仍在当前店铺的可发货状态，并检查店小秘搜索结果。');
        setFeedback(root, messages, 'error');
        return;
      }
      if (mode === MODE_RETRY) {
        const prepared = prepareRetryMatches(matched.matches);
        if (!prepared.ok) {
          setFeedback(root, [...warningMessages, ...prepared.errors], 'error');
          return;
        }
        root.__xynigoMode = MODE_RETRY;
        root.__xynigoMatches = prepared.matches;
        renderPreview(root, prepared.matches, warningMessages, MODE_RETRY);
        return;
      }
      setFeedback(root, `正在向店小秘核对 ${matched.matches.length} 个订单的平台承运商…`, 'progress');
      const resolved = await resolvePlatformProviders(matched.matches);
      if (!resolved.ok) {
        setFeedback(root, [...warningMessages, ...resolved.errors], 'error');
        return;
      }
      const excluded = matched.missing.map((item) => ({
        ...item,
        state: 'skipped',
        operation: MODE_SHIP,
        requestedProviderName: item.providerName,
        platformProviderName: '',
        internalPackageId: '',
        message: '当前待审核页面未找到，可能已审核、发货、退款或订单状态已变化；本批未提交',
      }));
      root.__xynigoMode = MODE_SHIP;
      root.__xynigoMatches = resolved.matches;
      root.__xynigoExcluded = excluded;
      renderPreview(root, resolved.matches, warningMessages, MODE_SHIP, {
        inputCount: parsed.entries.length,
        excluded,
      });
    } catch (error) {
      setFeedback(root, error?.message || '店小秘订单预检失败', 'error');
    } finally {
      setBusy(root, false);
    }
  }

  function setNativeInputValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isOutsideAssistant(element) {
    return Boolean(element && !element.closest(`#${ROOT_ID}`));
  }

  function exactTextElements(text, scope = document) {
    const selectors = 'button, a, [role="button"], [role="tab"], li, label, span, div';
    return Array.from(scope.querySelectorAll(selectors)).filter((element) => (
      isOutsideAssistant(element)
      && isVisible(element)
      && Core.normalizeText(element.textContent || element.value) === text
    ));
  }

  function findOrderSearchInput() {
    const selectors = [
      '#searchContent',
      'input[name="searchContent"]',
      'textarea[name="searchContent"]',
      'input[placeholder*="多个订单号"]',
      'textarea[placeholder*="多个订单号"]',
    ];
    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => isOutsideAssistant(element) && isVisible(element)) || null;
  }

  function hasNearbyFilterToggle(searchElement) {
    let scope = searchElement.parentElement;
    for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
      if (exactTextElements('筛选', scope).length > 0) return depth;
    }
    return Number.POSITIVE_INFINITY;
  }

  function findSearchModeToggle() {
    return exactTextElements('搜索')
      .map((element) => ({ element, depth: hasNearbyFilterToggle(element) }))
      .filter((item) => Number.isFinite(item.depth))
      .sort((left, right) => left.depth - right.depth)[0]?.element || null;
  }

  function waitForOrderSearchInput(timeoutMs = 4000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const searchInput = findOrderSearchInput();
        if (searchInput || Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(searchInput);
        }
      }, 100);
    });
  }

  async function activateSearchMode() {
    const existingInput = findOrderSearchInput();
    if (existingInput) return existingInput;
    const toggle = findSearchModeToggle();
    if (!toggle) return null;
    toggle.click();
    return waitForOrderSearchInput();
  }

  function findSearchFormScope(searchInput) {
    let scope = searchInput.parentElement;
    for (let depth = 0; scope && depth < 7; depth += 1, scope = scope.parentElement) {
      const text = Core.normalizeText(scope.textContent);
      if (text.includes('搜索内容') && text.includes('搜索类型')) return scope;
    }
    return searchInput.closest('.search-section') || searchInput.parentElement?.parentElement || document;
  }

  function selectOrderNumberSearchType(searchInput) {
    const scope = findSearchFormScope(searchInput);
    const orderNumber = exactTextElements('订单号', scope).find((element) => (
      !element.closest('table, thead, tbody, .vxe-table, .vxe-table--body-wrapper')
    ));
    orderNumber?.click();
  }

  function findSearchButton(searchInput) {
    const selectors = 'button, [role="button"], input[type="submit"]';
    let scope = searchInput.parentElement;
    for (let depth = 0; scope && depth < 7; depth += 1, scope = scope.parentElement) {
      const button = Array.from(scope.querySelectorAll(selectors)).find((candidate) => {
        if (!isOutsideAssistant(candidate) || !isVisible(candidate)) return false;
        const text = Core.normalizeText(candidate.textContent || candidate.value);
        return text === '搜索' || text === '查询';
      });
      if (button) return button;
    }
    return null;
  }

  function rowFingerprint() {
    return Array.from(document.querySelectorAll('tr.vxe-body--row[rowid]'))
      .map((row) => row.getAttribute('rowid') || '')
      .filter(Boolean)
      .join('|');
  }

  function waitForSearchSettled(previousFingerprint, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastFingerprint = '';
      let stableTicks = 0;
      const timer = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const fingerprint = rowFingerprint();
        if (fingerprint === lastFingerprint) stableTicks += 1;
        else stableTicks = 0;
        lastFingerprint = fingerprint;
        const changed = fingerprint !== previousFingerprint;
        if ((elapsed >= 900 && changed && stableTicks >= 2)
          || (elapsed >= 2200 && stableTicks >= 3)
          || elapsed >= timeoutMs) {
          clearInterval(timer);
          resolve({ changed, fingerprint });
        }
      }, 250);
    });
  }

  function displayedSearchResultCount(preferredCount = null, expectedMaximum = null) {
    const pattern = /第\s*\d+\s*-\s*\d+\s*条[，,]?\s*共\s*([\d,]+)\s*条记录/;
    const frequencies = new Map();
    document.querySelectorAll('span, div, p, label').forEach((element) => {
      if (!isOutsideAssistant(element) || !isVisible(element)) return;
      const text = Core.normalizeText(element.textContent);
      if (text.length > 80) return;
      const match = text.match(pattern);
      if (!match) return;
      const count = Number(match[1].replace(/,/g, ''));
      if (!Number.isSafeInteger(count) || count < 0) return;
      frequencies.set(count, (frequencies.get(count) || 0) + 1);
    });
    if (frequencies.size === 0) return null;
    const counts = Array.from(frequencies.keys());
    if (Number.isSafeInteger(preferredCount) && counts.includes(preferredCount)) {
      return preferredCount;
    }
    if (Number.isSafeInteger(expectedMaximum)) {
      const withinExpected = counts.filter((count) => count <= expectedMaximum);
      if (withinExpected.length) return Math.max(...withinExpected);
    }
    return Math.min(...counts);
  }

  async function searchForOrders(entries, options = {}) {
    const allowMultiplePackages = options.allowMultiplePackages === true;
    const searchInput = await activateSearchMode();
    if (!searchInput) {
      return {
        ok: false,
        reason: '无法切换到店小秘“搜索”模式或定位订单搜索框；已停止预检，未读取当前整页订单。',
      };
    }
    selectOrderNumberSearchType(searchInput);
    const searchButton = findSearchButton(searchInput);
    if (!searchButton) {
      return {
        ok: false,
        reason: '已进入店小秘“搜索”模式，但未找到原生搜索按钮；已停止预检。',
      };
    }
    const previousFingerprint = rowFingerprint();
    setNativeInputValue(searchInput, entries.map((item) => item.orderNo).join(','));
    searchButton.click();
    await waitForSearchSettled(previousFingerprint);
    const visibleRows = classifyVisibleRows(entries);
    const expectedMaximum = allowMultiplePackages ? Core.MAX_ENTRIES : entries.length;
    const displayedCount = displayedSearchResultCount(visibleRows.ids.length, expectedMaximum);
    if (displayedCount !== null && displayedCount > expectedMaximum) {
      return {
        ok: false,
        reason: allowMultiplePackages
          ? `店小秘搜索结果共有 ${displayedCount} 个包裹，超过当前单页安全上限 ${Core.MAX_ENTRIES}；请缩小批次。`
          : `店小秘搜索结果未收敛到本批订单（页面仍显示 ${displayedCount} 条，本批仅 ${entries.length} 单）；已停止预检，请刷新页面后重试。`,
      };
    }
    const missingSearchOrders = entries.filter((entry) => (
      !visibleRows.matchedOrderNumbers.includes(Core.normalizeOrderNo(entry.orderNo))
    ));
    if (allowMultiplePackages && missingSearchOrders.length) {
      return {
        ok: false,
        reason: `店小秘搜索结果缺少原订单：${missingSearchOrders.map((item) => item.orderNo).join('、')}；已停止预检。`,
      };
    }
    if (!allowMultiplePackages && displayedCount !== null && visibleRows.matchedOrderNumbers.length < displayedCount) {
      return {
        ok: false,
        reason: `店小秘页面显示 ${displayedCount} 条结果，但插件只能确认其中 ${visibleRows.matchedOrderNumbers.length} 条属于本批；已停止预检。`,
      };
    }
    if (allowMultiplePackages && displayedCount !== null && visibleRows.ids.length < displayedCount) {
      return {
        ok: false,
        reason: `店小秘页面显示 ${displayedCount} 个拆分包裹，但插件只能确认 ${visibleRows.ids.length} 个属于本批原订单；已停止预检。`,
      };
    }
    if (displayedCount !== null && visibleRows.ids.length > displayedCount) {
      return {
        ok: false,
        reason: `店小秘页面显示 ${displayedCount} 条结果，但检测到 ${visibleRows.ids.length} 个目标包裹；可能存在拆包或重复行，已停止预检。`,
      };
    }
    if (displayedCount === null && visibleRows.unmatchedRows.length > 0) {
      return {
        ok: false,
        reason: `无法读取店小秘页面结果总数，且当前列表仍有 ${visibleRows.unmatchedRows.length} 条不属于本批；已停止预检，请刷新页面后重试。`,
      };
    }
    return { ok: true };
  }

  function classifyVisibleRows(entries) {
    const orderNumbers = entries.map((entry) => Core.normalizeOrderNo(entry.orderNo));
    const ids = [];
    const unmatchedRows = [];
    const matchedOrderNumbers = new Set();
    const rowsById = new Map();
    let anonymousRowIndex = 0;
    document.querySelectorAll('tr.vxe-body--row[rowid]').forEach((row) => {
      const id = String(row.getAttribute('rowid') || '').trim();
      const key = id || `row-${anonymousRowIndex += 1}`;
      const previous = rowsById.get(key) || { id, text: '', imageUrls: [] };
      previous.text = `${previous.text} ${row.textContent || ''}`;
      row.querySelectorAll('img').forEach((image) => {
        const candidates = [
          image.currentSrc,
          image.src,
          image.getAttribute('src'),
          image.getAttribute('data-src'),
          image.getAttribute('data-original'),
        ];
        const url = candidates.map((candidate) => (
          Core.normalizePackageImageUrl(candidate, location.href)
        )).find(Boolean);
        if (url && !previous.imageUrls.includes(url)) previous.imageUrls.push(url);
      });
      rowsById.set(key, previous);
    });
    const matchedRows = [];
    rowsById.forEach(({ id, text, imageUrls }, key) => {
      const rowText = Core.normalizeOrderNo(text);
      const matchedOrderNo = orderNumbers.find((orderNo) => rowText.includes(orderNo));
      if (!matchedOrderNo) {
        unmatchedRows.push(key);
      } else if (id) {
        matchedOrderNumbers.add(matchedOrderNo);
        ids.push(id);
        matchedRows.push({ id, orderNo: matchedOrderNo, pageImageUrls: imageUrls.slice(0, 6) });
      }
    });
    return {
      ids: ids.slice(0, 300),
      unmatchedRows,
      matchedOrderNumbers: Array.from(matchedOrderNumbers),
      matchedRows,
      totalRows: rowsById.size,
    };
  }

  async function fetchOrderDetail(internalPackageId, pageEvidence = null) {
    const body = new URLSearchParams({ orderId: internalPackageId, history: '' }).toString();
    const response = await fetch(DETAIL_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
    if (!response.ok) throw new Error(`订单详情请求失败（HTTP ${response.status}）`);
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error('订单详情返回的不是 JSON，请确认店小秘登录状态');
    }
    const parsed = Core.parseOrderDetail(payload, internalPackageId);
    if (!parsed.ok) throw new Error(parsed.reason);
    return {
      ...parsed,
      pageImageUrls: Array.isArray(pageEvidence?.pageImageUrls) ? pageEvidence.pageImageUrls : [],
    };
  }

  async function fetchSplitOrderDetail(record) {
    const packageId = String(record?.internalPackageId || '').trim();
    const body = new URLSearchParams({ packageId, type: '1' }).toString();
    const response = await fetch(SPLIT_DETAIL_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
    if (!response.ok) throw new Error(`拆单详情请求失败（HTTP ${response.status}）`);
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error('拆单详情返回的不是 JSON，请确认店小秘登录状态');
    }
    const hasCode = Object.prototype.hasOwnProperty.call(payload || {}, 'code');
    const rawCode = hasCode ? String(payload.code == null ? '' : payload.code).trim() : '0';
    const code = /^-?\d+$/.test(rawCode) ? Number(rawCode) : Number.NaN;
    if (!Number.isFinite(code)) throw new Error('拆单详情返回了无效错误码');
    if (code !== 0) {
      throw new Error(Core.normalizeText(payload.msg || payload.message) || `拆单详情读取失败（错误码 ${code}）`);
    }
    const parsed = Core.parseSplitOrderDetail(payload, packageId, record?.orderNo);
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed;
  }

  async function readVisibleOrders(entries, onProgress) {
    const visibleRows = classifyVisibleRows(entries);
    const ids = visibleRows.ids;
    const evidenceById = new Map(visibleRows.matchedRows.map((item) => [item.id, item]));
    if (ids.length === 0) return { records: [], errors: [] };
    const records = [];
    const errors = [];
    let cursor = 0;
    let done = 0;
    const workerCount = Math.min(4, ids.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < ids.length) {
        const index = cursor;
        cursor += 1;
        const internalPackageId = ids[index];
        try {
          records.push(await fetchOrderDetail(internalPackageId, evidenceById.get(internalPackageId)));
        } catch (error) {
          errors.push({ internalPackageId, message: error?.message || '订单详情读取失败' });
        } finally {
          done += 1;
          onProgress?.(done, ids.length);
        }
      }
    });
    await Promise.all(workers);
    return { records, errors };
  }

  async function fetchShippingOptions(matches) {
    const packageIds = matches.map((item) => item.internalPackageId).join(',');
    const body = new URLSearchParams({ packageIds }).toString();
    const response = await fetch(SHIPPING_OPTIONS_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
    if (!response.ok) throw new Error(`平台承运商预检失败（HTTP ${response.status}）`);
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      throw new Error('平台承运商预检返回的不是 JSON，请确认店小秘登录状态');
    }
    const code = payload && Object.prototype.hasOwnProperty.call(payload, 'code')
      ? Number(payload.code)
      : 0;
    if (Number.isFinite(code) && code !== 0) {
      throw new Error(Core.normalizeText(payload.msg || payload.message) || `平台承运商预检失败（错误码 ${code}）`);
    }
    return payload;
  }

  function availableProviderSummary(names) {
    const values = Array.isArray(names) ? names.filter(Boolean) : [];
    if (values.length === 0) return '店小秘未返回可选项';
    const visible = values.slice(0, 8).join('、');
    return values.length > 8 ? `${visible} 等 ${values.length} 项` : visible;
  }

  async function resolvePlatformProviders(matches) {
    const payload = await fetchShippingOptions(matches);
    const resolvedMatches = [];
    const errors = [];
    matches.forEach((item) => {
      const resolution = Core.resolvePlatformProvider(payload, item.internalPackageId, item.providerName);
      if (!resolution.ok) {
        const itemLabel = item.purchaseSubOrderNo
          ? `采购子单 ${item.purchaseSubOrderNo}`
          : `订单 ${item.orderNo}`;
        errors.push(
          `${itemLabel}：${resolution.reason}。可选：${availableProviderSummary(resolution.availableProviderNames)}`,
        );
        return;
      }
      resolvedMatches.push({ ...item, ...resolution });
    });
    return { ok: errors.length === 0, matches: resolvedMatches, errors };
  }

  function setSplitPlanFeedback(root, messages, tone = 'info') {
    const feedback = root.querySelector('[data-role="split-plan-feedback"]');
    feedback.dataset.tone = tone;
    feedback.replaceChildren();
    const list = Array.isArray(messages) ? messages : [messages];
    list.filter(Boolean).forEach((message) => {
      const line = document.createElement('p');
      line.textContent = String(message);
      feedback.appendChild(line);
    });
  }

  function splitProductLabel(product) {
    const identity = product?.sku || product?.title || '商品';
    return `${identity}${product?.variant ? ` · ${product.variant}` : ''}`;
  }

  function splitEntriesForDetail(context, detail) {
    return context.entries
      .filter((entry) => entry.orderNo === detail.orderNo)
      .sort((left, right) => left.purchaseSequence - right.purchaseSequence);
  }

  function syncSplitPlanUi(root) {
    const context = root.__xynigoSplitContext;
    if (!context) return { ok: false, errors: ['拆单上下文已失效'] };
    context.splitAllocations = context.splitAllocations || new Map();
    const plans = [];
    const errors = [];
    const allocatedByOrderAndKey = new Map();

    context.splitDetails.forEach((detail) => {
      const orderEntries = splitEntriesForDetail(context, detail);
      const allocations = [];
      orderEntries.forEach((entry) => {
        const allocation = context.splitAllocations.get(entry.purchaseSubOrderNo);
        if (!allocation?.splitKey) {
          errors.push(`采购子单 ${entry.purchaseSubOrderNo} 尚未选择商品`);
          return;
        }
        allocations.push({ purchaseSubOrderNo: entry.purchaseSubOrderNo, ...allocation });
        const allocationKey = `${detail.orderNo}\n${allocation.splitKey}`;
        allocatedByOrderAndKey.set(
          allocationKey,
          (allocatedByOrderAndKey.get(allocationKey) || 0) + (Number(allocation.quantity) || 0),
        );
      });
      if (allocations.length === orderEntries.length) {
        const plan = Core.buildBatchSplitPlan(detail, allocations);
        if (plan.ok) plans.push(plan);
        else errors.push(...plan.errors.map((message) => `${detail.orderNo}：${message}`));
      }
    });

    root.querySelectorAll('[data-split-product-key]').forEach((card) => {
      const key = `${card.dataset.orderNo}\n${card.dataset.splitProductKey}`;
      const allocated = allocatedByOrderAndKey.get(key) || 0;
      const total = Number(card.dataset.productCount) || 0;
      card.dataset.full = String(allocated >= total);
      const badge = card.querySelector('[data-role="split-product-badge"]');
      if (badge) badge.textContent = `已分 ${allocated}/${total}`;
    });
    root.querySelectorAll('[data-split-child-row]').forEach((row) => {
      const purchaseSubOrderNo = row.dataset.splitChildRow;
      const allocation = context.splitAllocations.get(purchaseSubOrderNo);
      const detail = context.splitDetails.find((item) => item.orderNo === row.dataset.orderNo);
      const product = detail?.products.find((item) => item.splitKey === allocation?.splitKey);
      const active = context.activeSplitPurchaseSubOrderNo === purchaseSubOrderNo;
      row.dataset.active = String(active);
      row.dataset.assigned = String(Boolean(product));
      const choose = row.querySelector('[data-action="activate-split-child"]');
      choose.textContent = product
        ? `${splitProductLabel(product)} · 点击改配`
        : (active ? '正在选择：请点击上方商品' : '点击选择此子单');
      const quantity = row.querySelector('[data-role="split-quantity"]');
      quantity.value = product ? String(allocation.quantity) : '1';
      quantity.disabled = running || !product;
      const clear = row.querySelector('[data-action="clear-split-product"]');
      clear.hidden = !product;
    });

    context.splitPlans = plans;
    const confirmed = root.querySelector('.xynigo-dxm-logistics-split-confirm input').checked;
    const execute = root.querySelector('[data-action="execute-split"]');
    execute.disabled = running || context.splitLocked || !confirmed || errors.length > 0
      || plans.length !== context.splitDetails.length;
    if (context.splitLocked) {
      setSplitPlanFeedback(root, '拆单结果需要人工核对；本页已锁定，插件不会继续拆单或发货。请刷新店小秘页面后重新预检。', 'error');
    } else if (errors.length) {
      setSplitPlanFeedback(root, errors, 'error');
    } else {
      const packageCount = plans.reduce((sum, plan) => sum + plan.packageVectors.length, 0);
      setSplitPlanFeedback(
        root,
        `拆单计划已完整：${plans.length} 个原订单将生成 ${packageCount} 个包裹。勾选确认后只执行拆单，完成回读后还需再次映射并确认发货。`,
        'success',
      );
    }
    return { ok: errors.length === 0 && plans.length === context.splitDetails.length, plans, errors };
  }

  function activateSplitChild(root, purchaseSubOrderNo) {
    const context = root.__xynigoSplitContext;
    if (!context || context.splitLocked) return;
    context.activeSplitPurchaseSubOrderNo = purchaseSubOrderNo;
    syncSplitPlanUi(root);
  }

  function chooseSplitProduct(root, orderNo, splitKey) {
    const context = root.__xynigoSplitContext;
    if (!context || context.splitLocked) return;
    const activeEntry = context.entries.find((entry) => (
      entry.purchaseSubOrderNo === context.activeSplitPurchaseSubOrderNo
      && entry.orderNo === orderNo
    ));
    if (!activeEntry) {
      setSplitPlanFeedback(root, `请先选择原订单 ${orderNo} 下方的采购子单，再点击商品。`, 'error');
      return;
    }
    const detail = context.splitDetails.find((item) => item.orderNo === orderNo);
    const product = detail?.products.find((item) => item.splitKey === splitKey);
    if (!product) return;
    let allocatedElsewhere = 0;
    context.splitAllocations.forEach((allocation, purchaseSubOrderNo) => {
      if (purchaseSubOrderNo !== activeEntry.purchaseSubOrderNo && allocation.splitKey === splitKey) {
        const sibling = context.entries.find((entry) => entry.purchaseSubOrderNo === purchaseSubOrderNo);
        if (sibling?.orderNo === orderNo) allocatedElsewhere += Number(allocation.quantity) || 0;
      }
    });
    if (allocatedElsewhere >= product.productCount) {
      setSplitPlanFeedback(root, `商品 ${splitProductLabel(product)} 的 ${product.productCount} 件已全部分配。`, 'error');
      return;
    }
    const previous = context.splitAllocations.get(activeEntry.purchaseSubOrderNo);
    const quantity = previous?.splitKey === splitKey
      ? Math.min(previous.quantity, product.productCount - allocatedElsewhere)
      : 1;
    context.splitAllocations.set(activeEntry.purchaseSubOrderNo, { splitKey, quantity });
    const orderEntries = splitEntriesForDetail(context, detail);
    context.activeSplitPurchaseSubOrderNo = orderEntries.find((entry) => (
      !context.splitAllocations.get(entry.purchaseSubOrderNo)
    ))?.purchaseSubOrderNo || activeEntry.purchaseSubOrderNo;
    syncSplitPlanUi(root);
  }

  function changeSplitQuantity(root, purchaseSubOrderNo, value) {
    const context = root.__xynigoSplitContext;
    const current = context?.splitAllocations.get(purchaseSubOrderNo);
    if (!context || !current || context.splitLocked) return;
    context.splitAllocations.set(purchaseSubOrderNo, { ...current, quantity: Number(value) });
    syncSplitPlanUi(root);
  }

  function clearSplitProduct(root, purchaseSubOrderNo) {
    const context = root.__xynigoSplitContext;
    if (!context || context.splitLocked) return;
    context.splitAllocations.delete(purchaseSubOrderNo);
    context.activeSplitPurchaseSubOrderNo = purchaseSubOrderNo;
    syncSplitPlanUi(root);
  }

  function renderSplitPlan(root) {
    const context = root.__xynigoSplitContext;
    root.querySelector('[data-stage="input"]').hidden = true;
    root.querySelector('[data-stage="mapping"]').hidden = true;
    root.querySelector('[data-stage="split-plan"]').hidden = false;
    root.querySelector('[data-stage="preview"]').hidden = true;
    root.querySelector('[data-action="preflight"]').hidden = true;
    root.querySelector('[data-action="execute-split"]').hidden = false;
    root.querySelector('[data-action="continue-mapping"]').hidden = true;
    root.querySelector('[data-action="execute"]').hidden = true;
    root.querySelector('[data-action="back"]').hidden = false;
    root.querySelector('[data-action="download"]').hidden = true;
    root.querySelector('[data-role="split-plan-summary"]').textContent =
      `发现 ${context.splitDetails.length} 个尚未拆开的多件 SHEIN 订单。先选采购子单，再点击对应商品；每个已出物流子单生成一个包裹，未分配商品留在原包裹。`;
    const splitOrders = root.querySelector('[data-role="split-orders"]');
    splitOrders.replaceChildren();
    context.splitDetails.forEach((detail) => {
      const section = document.createElement('section');
      section.className = 'xynigo-dxm-logistics-split-order';
      const heading = document.createElement('h3');
      heading.textContent = `${detail.orderNo} · ${detail.products.length} 种商品 / ${detail.totalQuantity} 件`;
      const gallery = document.createElement('div');
      gallery.className = 'xynigo-dxm-logistics-split-products';
      detail.products.forEach((product) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'xynigo-dxm-logistics-split-product';
        card.dataset.splitProductKey = product.splitKey;
        card.dataset.orderNo = detail.orderNo;
        card.dataset.productCount = String(product.productCount);
        if (product.imageUrl) {
          const image = document.createElement('img');
          image.src = product.imageUrl;
          image.alt = splitProductLabel(product);
          image.loading = 'lazy';
          card.appendChild(image);
        }
        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = splitProductLabel(product);
        const badge = document.createElement('b');
        badge.dataset.role = 'split-product-badge';
        copy.append(title, badge);
        card.appendChild(copy);
        card.addEventListener('click', () => chooseSplitProduct(root, detail.orderNo, product.splitKey));
        gallery.appendChild(card);
      });
      const childList = document.createElement('div');
      childList.className = 'xynigo-dxm-logistics-split-children';
      splitEntriesForDetail(context, detail).forEach((entry) => {
        const row = document.createElement('div');
        row.dataset.splitChildRow = entry.purchaseSubOrderNo;
        row.dataset.orderNo = entry.orderNo;
        const identity = document.createElement('span');
        identity.innerHTML = `<strong></strong><small></small>`;
        identity.querySelector('strong').textContent = entry.purchaseSubOrderNo;
        identity.querySelector('small').textContent = `${entry.trackingNo} · ${entry.providerName}`;
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.dataset.action = 'activate-split-child';
        choose.addEventListener('click', () => activateSplitChild(root, entry.purchaseSubOrderNo));
        const quantityLabel = document.createElement('label');
        quantityLabel.textContent = '数量';
        const quantity = document.createElement('input');
        quantity.type = 'number';
        quantity.min = '1';
        quantity.step = '1';
        quantity.value = '1';
        quantity.dataset.role = 'split-quantity';
        quantity.addEventListener('change', () => changeSplitQuantity(root, entry.purchaseSubOrderNo, quantity.value));
        quantityLabel.appendChild(quantity);
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.dataset.action = 'clear-split-product';
        clear.textContent = '清除';
        clear.addEventListener('click', () => clearSplitProduct(root, entry.purchaseSubOrderNo));
        row.append(identity, choose, quantityLabel, clear);
        childList.appendChild(row);
      });
      section.append(heading, gallery, childList);
      splitOrders.appendChild(section);
    });
    const firstEntry = context.splitDetails
      .flatMap((detail) => splitEntriesForDetail(context, detail))[0];
    context.activeSplitPurchaseSubOrderNo = context.activeSplitPurchaseSubOrderNo
      || firstEntry?.purchaseSubOrderNo || '';
    root.querySelector('.xynigo-dxm-logistics-split-confirm input').checked = false;
    syncSplitPlanUi(root);
  }

  async function submitSplitPlan(plan) {
    const body = new URLSearchParams({
      packageId: plan.packageId,
      splitOrderList: plan.splitOrderList,
    }).toString();
    let response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        response = await fetch(SPLIT_COMMIT_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          redirect: 'follow',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return {
        state: 'unknown',
        ok: false,
        message: error?.name === 'AbortError'
          ? '拆单请求超时，店小秘是否已执行无法确认'
          : '拆单请求网络中断，店小秘是否已执行无法确认',
      };
    }
    if (!response.ok) {
      return {
        state: response.status >= 500 ? 'unknown' : 'failed',
        ok: false,
        message: `店小秘拆单请求失败（HTTP ${response.status}）`,
      };
    }
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      return { state: 'unknown', ok: false, message: '店小秘拆单响应无法解析，是否已执行无法确认' };
    }
    if (!Object.prototype.hasOwnProperty.call(payload || {}, 'code')) {
      return { state: 'unknown', ok: false, message: '店小秘拆单响应缺少结果码，是否已执行无法确认' };
    }
    const rawCode = String(payload.code == null ? '' : payload.code).trim();
    const code = /^-?\d+$/.test(rawCode) ? Number(rawCode) : Number.NaN;
    const message = Core.normalizeText(payload.msg || payload.message || '');
    if (Number.isFinite(code) && code === 0) {
      return { state: 'submitted', ok: true, message: message || '店小秘已受理拆单' };
    }
    if (!Number.isFinite(code)) {
      return { state: 'unknown', ok: false, message: '店小秘拆单响应结果码无效，是否已执行无法确认' };
    }
    return { state: 'failed', ok: false, message: message || `店小秘拆单失败（错误码 ${code}）` };
  }

  async function rereadAfterSplit(root, context, plans) {
    const searchEntries = Core.uniqueSearchEntries(context.entries);
    const expectedCounts = new Map(searchEntries.map(({ orderNo }) => [
      orderNo,
      context.records.filter((record) => record.orderNo === orderNo).length,
    ]));
    plans.forEach((plan) => expectedCounts.set(plan.orderNo, plan.packageVectors.length));
    let lastReason = '店小秘拆单后的包裹尚未出现在待审核列表';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      setSplitPlanFeedback(root, `拆单已受理，正在回读新包裹 ${attempt}/5…`, 'progress');
      try {
        const searched = await searchForOrders(searchEntries, { allowMultiplePackages: true });
        if (!searched.ok) {
          lastReason = searched.reason;
        } else {
          const detailResult = await readVisibleOrders(searchEntries);
          const countErrors = [];
          expectedCounts.forEach((expected, orderNo) => {
            const actual = detailResult.records.filter((record) => record.orderNo === orderNo).length;
            if (actual !== expected) countErrors.push(`${orderNo} 应有 ${expected} 个包裹，当前回读到 ${actual} 个`);
          });
          if (detailResult.errors.length === 0 && countErrors.length === 0) {
            return { ok: true, records: detailResult.records };
          }
          lastReason = [
            ...countErrors,
            ...(detailResult.errors.length ? [`另有 ${detailResult.errors.length} 个包裹详情无法回读`] : []),
          ].join('；');
        }
      } catch (error) {
        lastReason = error?.message || '拆单结果回读失败';
      }
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return { ok: false, reason: lastReason };
  }

  async function executeSplitPlans(root) {
    const context = root.__xynigoSplitContext;
    const validation = syncSplitPlanUi(root);
    const confirmed = root.querySelector('.xynigo-dxm-logistics-split-confirm input').checked;
    if (!context || context.splitLocked || !confirmed || !validation.ok || running) return;
    if (!isPendingReviewPage()) {
      setSplitPlanFeedback(root, '当前已离开店小秘“待审核”页面，已阻止拆单。', 'error');
      return;
    }
    const plans = validation.plans;
    const execute = root.querySelector('[data-action="execute-split"]');
    setBusy(root, true);
    root.querySelector('[data-action="back"]').hidden = true;
    root.querySelector('[data-action="cancel"]').hidden = true;
    try {
      for (let index = 0; index < plans.length; index += 1) {
        execute.textContent = `正在拆单 ${index + 1}/${plans.length}`;
        setSplitPlanFeedback(root, `正在串行提交原订单 ${plans[index].orderNo}；拆单期间不会发货…`, 'progress');
        const result = await submitSplitPlan(plans[index]);
        if (!result.ok) {
          context.splitLocked = true;
          throw new Error(
            `原订单 ${plans[index].orderNo}：${result.message}。已停止后续拆单和发货，请先刷新店小秘页面人工核对包裹结果。`,
          );
        }
      }
      const reread = await rereadAfterSplit(root, context, plans);
      if (!reread.ok) {
        context.splitLocked = true;
        throw new Error(`${reread.reason}。插件已停止发货，请刷新店小秘页面人工核对后重新预检。`);
      }
      context.records = reread.records;
      context.splitCommitted = true;
      context.assignments = new Map();
      root.querySelector('.xynigo-dxm-logistics-split-confirm input').checked = false;
      renderSplitMapping(root, context.entries, context.records, context.warnings);
      setMappingFeedback(
        root,
        `店小秘拆单已完成并回读 ${context.records.length} 个包裹。请按商品图将采购子单映射到新包裹；此处尚未发货。`,
        'success',
      );
    } catch (error) {
      setSplitPlanFeedback(root, error?.message || '拆单执行中止', 'error');
      execute.textContent = '拆单已停止，请刷新核对';
      execute.disabled = true;
    } finally {
      root.querySelector('[data-action="cancel"]').hidden = false;
      root.querySelector('[data-action="cancel"]').textContent = context.splitLocked ? '关闭' : '取消';
      if (!context.splitCommitted) root.querySelector('[data-action="back"]').hidden = false;
      setBusy(root, false);
      if (!context.splitCommitted) syncSplitPlanUi(root);
    }
  }

  function packageItemSummary(record) {
    const items = Array.isArray(record?.packageItems) ? record.packageItems : [];
    if (!items.length) return '详情未返回商品文字，请结合商品图和包裹 ID 核对';
    const summaries = items.slice(0, 4).map((item) => {
      const identity = item.sku || item.title || '商品';
      const variant = item.variant ? ` · ${item.variant}` : '';
      const quantity = item.quantity ? ` ×${item.quantity}` : '';
      return `${identity}${variant}${quantity}`;
    });
    return `${summaries.join('；')}${items.length > 4 ? `；另有 ${items.length - 4} 项` : ''}`;
  }

  function packageImageUrls(record) {
    const urls = [];
    const add = (value) => {
      const url = Core.normalizePackageImageUrl(value);
      if (url && !urls.includes(url)) urls.push(url);
    };
    (record?.packageItems || []).forEach((item) => add(item?.imageUrl));
    (record?.pageImageUrls || []).forEach(add);
    return urls.slice(0, 4);
  }

  function appendPackageEvidence(container, record) {
    const images = document.createElement('div');
    images.className = 'xynigo-dxm-logistics-package-images';
    const imageUrls = packageImageUrls(record);
    if (imageUrls.length) {
      imageUrls.forEach((url) => {
        const image = document.createElement('img');
        image.src = url;
        image.alt = '店小秘包裹商品图';
        image.loading = 'lazy';
        images.appendChild(image);
      });
    } else {
      const empty = document.createElement('span');
      empty.textContent = '无商品图';
      images.appendChild(empty);
    }
    const summary = document.createElement('p');
    summary.textContent = packageItemSummary(record);
    container.append(images, summary);
  }

  function setMappingFeedback(root, messages, tone = 'info') {
    const feedback = root.querySelector('[data-role="mapping-feedback"]');
    feedback.dataset.tone = tone;
    feedback.replaceChildren();
    const list = Array.isArray(messages) ? messages : [messages];
    list.filter(Boolean).forEach((message) => {
      const line = document.createElement('p');
      line.textContent = String(message);
      feedback.appendChild(line);
    });
  }

  function syncSplitMappingUi(root) {
    const context = root.__xynigoSplitContext;
    if (!context) return;
    const assignments = context.assignments || new Map();
    context.assignments = assignments;
    const assignedChildrenByPackage = new Map();
    assignments.forEach((packageId, purchaseSubOrderNo) => {
      if (packageId) assignedChildrenByPackage.set(packageId, purchaseSubOrderNo);
    });
    root.querySelectorAll('[data-package-card-id]').forEach((card) => {
      const purchaseSubOrderNo = assignedChildrenByPackage.get(card.dataset.packageCardId) || '';
      card.dataset.selected = purchaseSubOrderNo ? 'true' : 'false';
      card.dataset.active = purchaseSubOrderNo === context.activePurchaseSubOrderNo ? 'true' : 'false';
      const badge = card.querySelector('[data-role="package-card-badge"]');
      badge.textContent = purchaseSubOrderNo ? `已匹配 ${purchaseSubOrderNo}` : '点击匹配';
      card.setAttribute('aria-label', purchaseSubOrderNo
        ? `包裹 ${card.dataset.packageCardId}，已匹配 ${purchaseSubOrderNo}`
        : `选择包裹 ${card.dataset.packageCardId}`);
    });
    root.querySelectorAll('[data-purchase-sub-order-row]').forEach((row) => {
      const purchaseSubOrderNo = row.dataset.purchaseSubOrderRow;
      const packageId = assignments.get(purchaseSubOrderNo) || '';
      const isActive = purchaseSubOrderNo === context.activePurchaseSubOrderNo;
      row.dataset.active = isActive ? 'true' : 'false';
      row.dataset.matched = packageId ? 'true' : 'false';
      const target = row.querySelector('[data-action="activate-purchase-sub-order"]');
      target.textContent = packageId
        ? `包裹 ${packageId} · 点击改配`
        : (isActive ? '正在匹配：请点击上方包裹卡片' : '点击选择此子单');
      const clear = row.querySelector('[data-action="clear-package-mapping"]');
      clear.hidden = !packageId;
    });
    const matchedCount = assignedChildrenByPackage.size;
    const totalCount = context.entries.length;
    const activeLabel = context.activePurchaseSubOrderNo
      ? `当前：${context.activePurchaseSubOrderNo}`
      : '';
    setMappingFeedback(
      root,
      matchedCount === totalCount
        ? '映射已完成；继续后还会核对包裹状态和店小秘平台承运商。'
        : `已匹配 ${matchedCount}/${totalCount} 个采购子单。${activeLabel ? `${activeLabel}，请直接点击上方对应包裹卡片。` : ''}`,
      matchedCount === totalCount ? 'success' : 'info',
    );
  }

  function activatePurchaseSubOrder(root, purchaseSubOrderNo) {
    const context = root.__xynigoSplitContext;
    if (!context || !context.entries.some((item) => item.purchaseSubOrderNo === purchaseSubOrderNo)) return;
    context.activePurchaseSubOrderNo = purchaseSubOrderNo;
    syncSplitMappingUi(root);
  }

  function nextUnmappedPurchaseSubOrder(context, currentEntry) {
    const entries = [...context.entries].sort((left, right) => (
      left.orderNo.localeCompare(right.orderNo) || left.purchaseSequence - right.purchaseSequence
    ));
    return entries.find((entry) => (
      entry.orderNo === currentEntry.orderNo
      && !context.assignments.get(entry.purchaseSubOrderNo)
      && entry.purchaseSubOrderNo !== currentEntry.purchaseSubOrderNo
    )) || entries.find((entry) => !context.assignments.get(entry.purchaseSubOrderNo)) || null;
  }

  function choosePackageCard(root, packageId) {
    const context = root.__xynigoSplitContext;
    if (!context) return;
    const assignedChild = Array.from(context.assignments.entries())
      .find(([, assignedPackageId]) => assignedPackageId === packageId)?.[0] || '';
    if (assignedChild) {
      context.activePurchaseSubOrderNo = assignedChild;
      syncSplitMappingUi(root);
      setMappingFeedback(root, `包裹 ${packageId} 已匹配给 ${assignedChild}；如需改配，请直接点击另一个未匹配包裹。`, 'info');
      return;
    }
    const activeEntry = context.entries.find((item) => (
      item.purchaseSubOrderNo === context.activePurchaseSubOrderNo
    )) || nextUnmappedPurchaseSubOrder(context, { orderNo: '' });
    if (!activeEntry) {
      setMappingFeedback(root, '本批采购子单均已匹配；如需改配，请先点击下方对应子单。', 'info');
      return;
    }
    const record = context.records.find((item) => item.internalPackageId === packageId);
    if (!record || record.orderNo !== activeEntry.orderNo) {
      setMappingFeedback(root, `采购子单 ${activeEntry.purchaseSubOrderNo} 只能选择原订单 ${activeEntry.orderNo} 下的包裹。`, 'error');
      return;
    }
    context.assignments.set(activeEntry.purchaseSubOrderNo, packageId);
    const nextEntry = nextUnmappedPurchaseSubOrder(context, activeEntry);
    context.activePurchaseSubOrderNo = nextEntry?.purchaseSubOrderNo || activeEntry.purchaseSubOrderNo;
    syncSplitMappingUi(root);
  }

  function clearPackageMapping(root, purchaseSubOrderNo) {
    const context = root.__xynigoSplitContext;
    if (!context) return;
    context.assignments.delete(purchaseSubOrderNo);
    context.activePurchaseSubOrderNo = purchaseSubOrderNo;
    syncSplitMappingUi(root);
  }

  function renderSplitMapping(root, entries, records, warnings) {
    root.querySelector('[data-stage="input"]').hidden = true;
    root.querySelector('[data-stage="mapping"]').hidden = false;
    root.querySelector('[data-stage="split-plan"]').hidden = true;
    root.querySelector('[data-stage="preview"]').hidden = true;
    root.querySelector('[data-action="preflight"]').hidden = true;
    root.querySelector('[data-action="continue-mapping"]').hidden = false;
    root.querySelector('[data-action="execute-split"]').hidden = true;
    root.querySelector('[data-action="execute"]').hidden = true;
    root.querySelector('[data-action="back"]').hidden = false;
    root.querySelector('[data-action="download"]').hidden = true;
    root.querySelector('[data-action="cancel"]').textContent = '取消';

    const uniqueOriginalOrders = Core.uniqueSearchEntries(entries);
    root.querySelector('[data-role="mapping-summary"]').textContent =
      `已读取 ${uniqueOriginalOrders.length} 个原订单、${records.length} 个店小秘包裹；本批只映射并发货 ${entries.length} 个已有物流的采购子单。先选择下方子单，再直接点击上方包裹卡片。`
      + (warnings.length ? ` ${warnings.join('；')}` : ' 未映射包裹保持不动。');

    const sortedEntries = [...entries].sort((left, right) => (
      left.orderNo.localeCompare(right.orderNo) || left.purchaseSequence - right.purchaseSequence
    ));
    const context = root.__xynigoSplitContext;
    context.assignments = context.assignments || new Map();
    context.activePurchaseSubOrderNo = sortedEntries.find((entry) => (
      !context.assignments.get(entry.purchaseSubOrderNo)
    ))?.purchaseSubOrderNo || sortedEntries[0]?.purchaseSubOrderNo || '';

    const groups = root.querySelector('[data-role="package-groups"]');
    groups.replaceChildren();
    uniqueOriginalOrders.forEach(({ orderNo }) => {
      const orderEntries = entries.filter((item) => item.orderNo === orderNo);
      const orderRecords = records
        .filter((item) => item.orderNo === orderNo)
        .sort((left, right) => left.internalPackageId.localeCompare(right.internalPackageId));
      const section = document.createElement('section');
      section.className = 'xynigo-dxm-logistics-package-group';
      const heading = document.createElement('h3');
      heading.textContent = `${orderNo} · 本批 ${orderEntries.length}/${orderRecords.length} 个包裹`;
      const gallery = document.createElement('div');
      gallery.className = 'xynigo-dxm-logistics-package-gallery';
      orderRecords.forEach((record) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'xynigo-dxm-logistics-package-card';
        card.dataset.packageCardId = record.internalPackageId;
        card.dataset.action = 'select-package-card';
        const header = document.createElement('header');
        const id = document.createElement('strong');
        id.textContent = `包裹 ${record.internalPackageId}`;
        const meta = document.createElement('span');
        const status = document.createElement('small');
        status.textContent = record.orderStatus || '状态未返回';
        const badge = document.createElement('b');
        badge.dataset.role = 'package-card-badge';
        meta.append(status, badge);
        header.append(id, meta);
        card.appendChild(header);
        appendPackageEvidence(card, record);
        card.addEventListener('click', () => choosePackageCard(root, record.internalPackageId));
        gallery.appendChild(card);
      });
      section.append(heading, gallery);
      groups.appendChild(section);
    });

    const singlePackageOrders = uniqueOriginalOrders
      .map((item) => item.orderNo)
      .filter((orderNo) => records.filter((record) => record.orderNo === orderNo).length === 1);
    const singlePackageConfirm = root.querySelector('[data-role="single-package-confirm"]');
    singlePackageConfirm.hidden = singlePackageOrders.length === 0;
    singlePackageConfirm.querySelector('input').checked = false;
    singlePackageConfirm.querySelector('span').textContent = singlePackageOrders.length
      ? `原订单 ${singlePackageOrders.join('、')} 当前只回读到 1 个待发货包裹；我已在店小秘确认订单已经完成拆单，或这是最后一个剩余包裹，并已核对商品对应正确。`
      : '';

    const tbody = root.querySelector('[data-stage="mapping"] tbody');
    tbody.replaceChildren();
    sortedEntries.forEach((entry, index) => {
      const row = document.createElement('tr');
      row.dataset.purchaseSubOrderRow = entry.purchaseSubOrderNo;
      [index + 1, entry.purchaseSubOrderNo, entry.orderNo, entry.trackingNo, entry.providerName]
        .forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          row.appendChild(cell);
        });
      const mappingCell = document.createElement('td');
      const mappingActions = document.createElement('div');
      mappingActions.className = 'xynigo-dxm-logistics-mapping-actions';
      const activate = document.createElement('button');
      activate.type = 'button';
      activate.dataset.action = 'activate-purchase-sub-order';
      activate.className = 'xynigo-dxm-logistics-mapping-target';
      activate.addEventListener('click', () => activatePurchaseSubOrder(root, entry.purchaseSubOrderNo));
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.dataset.action = 'clear-package-mapping';
      clear.className = 'xynigo-dxm-logistics-mapping-clear';
      clear.textContent = '清除';
      clear.addEventListener('click', () => clearPackageMapping(root, entry.purchaseSubOrderNo));
      mappingActions.append(activate, clear);
      mappingCell.appendChild(mappingActions);
      row.appendChild(mappingCell);
      tbody.appendChild(row);
    });
    syncSplitMappingUi(root);
  }

  async function continueSplitPreflight(root) {
    if (running || !root.__xynigoSplitContext) return;
    const singlePackageConfirm = root.querySelector('[data-role="single-package-confirm"]');
    if (!singlePackageConfirm.hidden && !singlePackageConfirm.querySelector('input').checked) {
      setMappingFeedback(root, '当前有原订单只回读到 1 个包裹；请先去店小秘确认已完成拆单或确为最后剩余包裹，再勾选确认。', 'error');
      return;
    }
    const { entries, records, warnings, assignments } = root.__xynigoSplitContext;
    const assigned = Core.assignSplitPackages(entries, records, assignments);
    if (!assigned.ok) {
      setMappingFeedback(root, assigned.errors, 'error');
      return;
    }
    setBusy(root, true);
    setMappingFeedback(root, `正在核对 ${assigned.matches.length} 个店小秘包裹的平台承运商…`, 'progress');
    try {
      const resolved = await resolvePlatformProviders(assigned.matches);
      if (!resolved.ok) {
        setMappingFeedback(root, resolved.errors, 'error');
        return;
      }
      root.__xynigoMode = MODE_SPLIT;
      root.__xynigoMatches = resolved.matches;
      renderPreview(root, resolved.matches, warnings, MODE_SPLIT);
    } catch (error) {
      setMappingFeedback(root, error?.message || '拆单包裹预检失败', 'error');
    } finally {
      setBusy(root, false);
    }
  }

  function prepareRetryMatches(matches) {
    const preparedMatches = [];
    const errors = [];
    matches.forEach((item) => {
      if (!item.currentTrackingNo) {
        errors.push(`订单 ${item.orderNo}：店小秘失败单没有现有物流单号，请先在订单详情中补充。`);
        return;
      }
      if (item.currentTrackingNo !== item.trackingNo) {
        errors.push(
          `订单 ${item.orderNo}：输入物流单号 ${item.trackingNo} 与店小秘现有物流单号 ${item.currentTrackingNo} 不一致，禁止重提。`,
        );
        return;
      }
      if (!item.currentProviderName) {
        errors.push(`订单 ${item.orderNo}：店小秘失败单没有现有承运商，请先在订单详情中修正。`);
        return;
      }
      if (!Core.carrierNameMatches(item.providerName, item.currentProviderName)) {
        errors.push(
          `订单 ${item.orderNo}：输入物流商 ${item.providerName} 与店小秘现有承运商 ${item.currentProviderName} 不一致，请先修正物流信息。`,
        );
        return;
      }
      preparedMatches.push({
        ...item,
        requestedProviderName: item.providerName,
        platformProviderName: item.currentProviderName,
        operation: MODE_RETRY,
      });
    });
    return { ok: errors.length === 0, matches: preparedMatches, errors };
  }

  function renderPreview(root, matches, warnings, mode = MODE_SHIP, options = {}) {
    root.querySelector('[data-stage="input"]').hidden = true;
    root.querySelector('[data-stage="mapping"]').hidden = true;
    root.querySelector('[data-stage="split-plan"]').hidden = true;
    root.querySelector('[data-stage="preview"]').hidden = false;
    root.querySelector('[data-action="preflight"]').hidden = true;
    root.querySelector('[data-action="continue-mapping"]').hidden = true;
    root.querySelector('[data-action="execute-split"]').hidden = true;
    root.querySelector('[data-action="execute"]').hidden = false;
    root.querySelector('[data-action="back"]').hidden = false;
    root.querySelector('[data-action="cancel"]').textContent = '取消';
    const summary = root.querySelector('[data-stage="preview"] > .xynigo-dxm-logistics-summary');
    const isRetry = mode === MODE_RETRY;
    const isSplit = mode === MODE_SPLIT;
    root.querySelector('[data-role="shipment-concurrency"]').hidden = isRetry;
    resetExecutionMetrics(root, matches.length);
    const excluded = Array.isArray(options.excluded) ? options.excluded : [];
    const inputCount = Number.isSafeInteger(options.inputCount)
      ? options.inputCount
      : matches.length + excluded.length;
    if (isSplit) {
      summary.textContent = `本批已精确映射 ${matches.length} 个采购子单。仅下列店小秘包裹会发货，其他拆分包裹保持不动。`
        + (warnings.length ? ` ${warnings.join('；')}` : '');
    } else if (!isRetry && excluded.length) {
      summary.textContent = `导入 ${inputCount} 个订单：可发货 ${matches.length} 个，已安全排除 ${excluded.length} 个不在当前待审核页面的订单。`
        + (warnings.length ? ` ${warnings.join('；')}` : ' 请核对排除原因和可发货清单后再执行。');
    } else {
      summary.textContent = warnings.length
        ? `已精确匹配 ${matches.length} 个${isRetry ? '失败' : ''}订单。${warnings.join('；')}`
        : `已精确匹配 ${matches.length} 个${isRetry ? '失败' : ''}订单。请逐行核对后再执行。`;
    }
    const headerValues = isRetry
      ? ['#', '订单号', '现有物流单号', '现有承运商', '失败原因', '内部包裹 ID', '状态']
      : (isSplit
        ? ['#', '采购子单号', '原订单号', '物流单号', '输入物流商', '店小秘平台承运商', '内部包裹 ID', '状态']
        : ['#', '订单号', '物流单号', '输入物流商', '店小秘平台承运商', '内部包裹 ID', '状态']);
    const headerRow = root.querySelector('[data-stage="preview"] thead tr');
    headerRow.replaceChildren(...headerValues.map((value) => {
      const cell = document.createElement('th');
      cell.textContent = value;
      return cell;
    }));
    root.querySelector('.xynigo-dxm-logistics-confirm span').textContent = isRetry
      ? '我已核对失败订单、现有物流单号和承运商，确认仅执行“继续提交平台”。'
      : (isSplit
        ? '我已逐行核对采购子单、商品图、店小秘包裹、物流单号和平台承运商，确认只执行本批拆单发货。'
        : (excluded.length
          ? `我已核对 ${matches.length} 个可发货订单和 ${excluded.length} 个已排除订单，确认只对可发货订单执行店小秘写入。`
          : '我已逐行核对订单号、物流单号及店小秘平台承运商，确认执行不可撤销的店小秘发货写入。'));
    const executeButton = root.querySelector('[data-action="execute"]');
    executeButton.textContent = isRetry
      ? '确认并重新提交平台'
      : (isSplit ? '确认并执行本批发货' : (excluded.length ? `确认并执行 ${matches.length} 条发货` : '确认并执行发货'));
    root.__xynigoMode = mode;
    const tbody = root.querySelector('[data-stage="preview"] tbody');
    tbody.replaceChildren();
    matches.forEach((item, index) => {
      const row = document.createElement('tr');
      const values = isRetry
        ? [
          index + 1,
          item.orderNo,
          item.currentTrackingNo,
          item.currentProviderName,
          item.failureMessage || '—',
          item.internalPackageId,
          '待重提',
        ]
        : (isSplit
          ? [
            index + 1,
            item.purchaseSubOrderNo,
            item.orderNo,
            item.trackingNo,
            item.requestedProviderName,
            item.platformProviderName,
            item.internalPackageId,
            '待执行',
          ]
          : [
            index + 1,
            item.orderNo,
            item.trackingNo,
            item.requestedProviderName,
            item.platformProviderName,
            item.internalPackageId,
            '待执行',
          ]);
      values.forEach((value, columnIndex) => {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        if (columnIndex === values.length - 1) cell.dataset.result = 'pending';
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    if (!isRetry && !isSplit) {
      excluded.forEach((item, index) => {
        const row = document.createElement('tr');
        row.dataset.excluded = 'true';
        const values = [
          matches.length + index + 1,
          item.orderNo,
          item.trackingNo,
          item.requestedProviderName || item.providerName,
          '—',
          '—',
          '已排除',
        ];
        values.forEach((value, columnIndex) => {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          if (columnIndex === values.length - 1) {
            cell.dataset.result = 'skipped';
            cell.title = item.message;
          }
          row.appendChild(cell);
        });
        tbody.appendChild(row);
      });
    }
  }

  async function executePreview(root) {
    const matches = root.__xynigoMatches;
    const mode = root.__xynigoMode || MODE_SHIP;
    const isRetry = mode === MODE_RETRY;
    const isSplit = mode === MODE_SPLIT;
    const confirmed = root.querySelector('.xynigo-dxm-logistics-confirm input').checked;
    if (!Array.isArray(matches) || matches.length === 0 || !confirmed || running) return;
    if (!isPendingReviewPage()) {
      root.querySelector('[data-stage="preview"] > .xynigo-dxm-logistics-summary').textContent =
        '当前已离开店小秘“待审核”页面，已阻止发货写入。';
      return;
    }
    setBusy(root, true);
    root.querySelector('[data-action="back"]').hidden = true;
    root.querySelector('[data-action="cancel"]').hidden = true;
    const execute = root.querySelector('[data-action="execute"]');
    const requestedConcurrency = isRetry ? 1 : selectedShipmentConcurrency(root);
    const startedAt = Date.now();
    let completedForMetrics = 0;
    let busyCountForMetrics = 0;
    let firstBusyIndexForMetrics = null;
    let effectiveConcurrencyForMetrics = requestedConcurrency;
    const metrics = root.querySelector('[data-role="execution-metrics"]');
    metrics.hidden = false;
    updateExecutionMetrics(root, {
      total: matches.length,
      completed: 0,
      durationMs: 0,
      requestedConcurrency,
      effectiveConcurrency: requestedConcurrency,
      busyCount: 0,
      firstBusyIndex: null,
    });
    const durationTimer = setInterval(() => {
      updateExecutionMetrics(root, {
        total: matches.length,
        completed: completedForMetrics,
        durationMs: Date.now() - startedAt,
        requestedConcurrency,
        effectiveConcurrency: effectiveConcurrencyForMetrics,
        busyCount: busyCountForMetrics,
        firstBusyIndex: firstBusyIndexForMetrics,
      });
    }, 250);
    execute.textContent = `${isRetry ? '正在重提' : (isSplit ? '正在分批发货' : '正在执行')} 0/${matches.length}`
      + (isRetry ? '' : `（并发 ${requestedConcurrency}）`);
    const resultCells = root.querySelectorAll('[data-stage="preview"] tbody td:last-child');
    const actionText = isRetry ? '正在重提' : (isSplit ? '正在分批发货' : '正在执行');
    let execution = { paused: false, degradedToSerial: false };
    let results;

    const updateResultCell = (index, result) => {
      resultCells[index].textContent = shipmentResultText(result, isRetry);
      resultCells[index].title = result.message;
      resultCells[index].dataset.result = result.state;
    };

    if (isRetry) {
      const retryResults = [];
      for (let index = 0; index < matches.length; index += 1) {
        execute.textContent = `${actionText} ${index + 1}/${matches.length}`;
        resultCells[index].textContent = '提交中…';
        resultCells[index].dataset.result = 'running';
        const result = await retryFailedShipment(matches[index]);
        retryResults.push(result);
        updateResultCell(index, result);
        completedForMetrics = index + 1;
        updateExecutionMetrics(root, {
          total: matches.length,
          completed: completedForMetrics,
          durationMs: Date.now() - startedAt,
          requestedConcurrency,
          effectiveConcurrency: 1,
          busyCount: 0,
          firstBusyIndex: null,
        });
        if (result.state === 'unknown') {
          execution.paused = true;
          for (let pendingIndex = index + 1; pendingIndex < matches.length; pendingIndex += 1) {
            const pausedResult = pausedShipmentResult();
            retryResults.push(pausedResult);
            updateResultCell(pendingIndex, pausedResult);
          }
          break;
        }
      }
      results = retryResults.map((result, index) => ({ ...matches[index], operation: mode, ...result }));
    } else {
      execution = await executeShipmentQueue(matches, requestedConcurrency, {
        onStart(index, dispatchedCount, concurrency) {
          resultCells[index].textContent = '提交中…';
          resultCells[index].dataset.result = 'running';
          execute.textContent = `${actionText}：已派发 ${dispatchedCount}/${matches.length}（并发 ${concurrency}）`;
        },
        onResult(index, result, completedCount, concurrency) {
          updateResultCell(index, result);
          completedForMetrics = completedCount;
          effectiveConcurrencyForMetrics = concurrency;
          updateExecutionMetrics(root, {
            total: matches.length,
            completed: completedCount,
            durationMs: Date.now() - startedAt,
            requestedConcurrency,
            effectiveConcurrency: concurrency,
            busyCount: busyCountForMetrics,
            firstBusyIndex: firstBusyIndexForMetrics,
          });
          execute.textContent = `${actionText}：已完成 ${completedCount}/${matches.length}（并发 ${concurrency}）`;
        },
        onBusy(info) {
          busyCountForMetrics = info.busyCount;
          firstBusyIndexForMetrics = info.firstBusyIndex;
          effectiveConcurrencyForMetrics = info.concurrency;
          updateExecutionMetrics(root, {
            total: matches.length,
            completed: info.completedCount,
            durationMs: Date.now() - startedAt,
            requestedConcurrency,
            effectiveConcurrency: info.concurrency,
            busyCount: info.busyCount,
            firstBusyIndex: info.firstBusyIndex,
          });
          execute.textContent = info.degraded
            ? `第 ${info.index + 1} 条遇到店小秘繁忙，已降为串行；已完成 ${info.completedCount}/${matches.length}`
            : `店小秘仍繁忙（第 ${info.busyCount} 次）；已完成 ${info.completedCount}/${matches.length}`;
        },
      });
      results = execution.results.map((result, index) => ({ ...matches[index], operation: mode, ...result }));
    }

    clearInterval(durationTimer);
    execution.durationMs = Date.now() - startedAt;
    execution.requestedConcurrency = execution.requestedConcurrency || requestedConcurrency;
    execution.effectiveConcurrency = execution.effectiveConcurrency || effectiveConcurrencyForMetrics;
    execution.busyCount = execution.busyCount || 0;
    if (!Number.isSafeInteger(execution.firstBusyIndex)) execution.firstBusyIndex = null;
    completedForMetrics = matches.length;
    updateExecutionMetrics(root, {
      total: matches.length,
      completed: matches.length,
      durationMs: execution.durationMs,
      requestedConcurrency: execution.requestedConcurrency,
      effectiveConcurrency: execution.effectiveConcurrency,
      busyCount: execution.busyCount,
      firstBusyIndex: execution.firstBusyIndex,
    });

    const excludedResults = Array.isArray(root.__xynigoExcluded) ? root.__xynigoExcluded : [];
    root.__xynigoResults = [...results, ...excludedResults];
    const submittedCount = results.filter((item) => item.state === 'submitted').length;
    const unknownCount = results.filter((item) => item.state === 'unknown').length;
    const pausedCount = results.filter((item) => item.state === 'paused').length;
    const failedCount = results.filter((item) => item.state === 'failed').length;
    root.querySelector('[data-stage="preview"] > .xynigo-dxm-logistics-summary').textContent =
      `${isRetry ? '重提' : (isSplit ? '本批发货' : '提交')}完成：店小秘已受理 ${submittedCount}，失败 ${failedCount}，结果未知 ${unknownCount}，暂停未提交 ${pausedCount}。`
      + (excludedResults.length ? ` 已排除 ${excludedResults.length} 个状态已变化订单，未提交。` : '')
      + ` 执行时长 ${formatExecutionDuration(execution.durationMs)}；初始并发 ${execution.requestedConcurrency}，最终并发 ${execution.effectiveConcurrency}，接口繁忙 ${execution.busyCount} 次。`
      + (execution.degradedToSerial
        ? ` 第 ${execution.firstBusyIndex + 1} 条首次触发繁忙，后续请求已自动降为串行。`
        : '')
      + (submittedCount ? ' 已受理订单仍需到店小秘“发货成功/发货失败”列表确认平台结果。' : '')
      + (unknownCount ? ' 因出现结果未知，插件已停止派发剩余订单；请先去店小秘列表核对，禁止直接重试。' : '');
    root.querySelector('[data-action="download"]').hidden = false;
    root.querySelector('[data-action="cancel"]').hidden = false;
    root.querySelector('[data-action="cancel"]').textContent = '关闭';
    execute.hidden = true;
    setBusy(root, false);
  }

  function selectedShipmentConcurrency(root) {
    const rawValue = Number(root.querySelector('input[name="xynigo-dxm-logistics-concurrency"]:checked')?.value);
    if (!Number.isSafeInteger(rawValue)) return DEFAULT_SHIPMENT_CONCURRENCY;
    return Math.min(MAX_SHIPMENT_CONCURRENCY, Math.max(1, rawValue));
  }

  function formatExecutionDuration(durationMs) {
    const safeDurationMs = Math.max(0, Number(durationMs) || 0);
    if (safeDurationMs < 10000) return `${(safeDurationMs / 1000).toFixed(1)}秒`;
    const totalSeconds = Math.floor(safeDurationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}小时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
    if (minutes) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
    return `${seconds}秒`;
  }

  function resetExecutionMetrics(root, total) {
    const metrics = root.querySelector('[data-role="execution-metrics"]');
    metrics.hidden = true;
    updateExecutionMetrics(root, {
      total,
      completed: 0,
      durationMs: 0,
      requestedConcurrency: null,
      effectiveConcurrency: null,
      busyCount: 0,
      firstBusyIndex: null,
    });
  }

  function updateExecutionMetrics(root, values) {
    const metrics = root.querySelector('[data-role="execution-metrics"]');
    const setMetric = (name, value) => {
      const element = metrics.querySelector(`[data-metric="${name}"]`);
      if (element) element.textContent = String(value);
    };
    const busyCount = Math.max(0, Number(values.busyCount) || 0);
    const firstBusyIndex = Number.isSafeInteger(values.firstBusyIndex) ? values.firstBusyIndex : null;
    setMetric('progress', `${values.completed || 0}/${values.total || 0}`);
    setMetric('duration', formatExecutionDuration(values.durationMs));
    setMetric('requested-concurrency', values.requestedConcurrency || '—');
    setMetric('effective-concurrency', values.effectiveConcurrency || '—');
    setMetric('busy-count', busyCount
      ? `${busyCount} 次 · 首次第 ${firstBusyIndex + 1} 条`
      : '0 次');
    metrics.dataset.requestedConcurrency = values.requestedConcurrency || '';
    metrics.dataset.effectiveConcurrency = values.effectiveConcurrency || '';
    metrics.dataset.busyCount = String(busyCount);
    metrics.dataset.firstBusyIndex = firstBusyIndex === null ? '' : String(firstBusyIndex);
    metrics.dataset.durationMs = String(Math.max(0, Math.round(Number(values.durationMs) || 0)));
    metrics.dataset.degraded = String(
      Boolean(values.requestedConcurrency > 1 && values.effectiveConcurrency === 1 && busyCount > 0),
    );
  }

  function pausedShipmentResult() {
    return {
      state: 'paused',
      ok: false,
      retryable: false,
      message: '因前序订单结果未知，已停止派发；本订单未提交',
    };
  }

  function shipmentResultText(result, isRetry) {
    if (result.state === 'submitted') return isRetry ? '已重新提交，待平台确认' : '已提交，待平台确认';
    if (result.state === 'unknown') return '结果未知';
    if (result.state === 'paused') return '已暂停，未提交';
    return `失败：${result.message}`;
  }

  function executeShipmentQueue(matches, requestedConcurrency, callbacks = {}) {
    const initialConcurrency = Math.min(
      MAX_SHIPMENT_CONCURRENCY,
      Math.max(1, Number.isSafeInteger(requestedConcurrency) ? requestedConcurrency : DEFAULT_SHIPMENT_CONCURRENCY),
    );
    return new Promise((resolve) => {
      const results = new Array(matches.length);
      let concurrency = initialConcurrency;
      let nextIndex = 0;
      let activeCount = 0;
      let dispatchedCount = 0;
      let completedCount = 0;
      let paused = false;
      let degradedToSerial = false;
      let busyCount = 0;
      let firstBusyIndex = null;
      let settled = false;

      const finishIfReady = () => {
        if (activeCount > 0 || (!paused && nextIndex < matches.length)) return false;
        if (paused) {
          while (nextIndex < matches.length) {
            const index = nextIndex;
            nextIndex += 1;
            const result = pausedShipmentResult();
            results[index] = result;
            completedCount += 1;
            callbacks.onResult?.(index, result, completedCount, concurrency);
          }
        }
        if (!settled) {
          settled = true;
          resolve({
            results,
            paused,
            degradedToSerial,
            requestedConcurrency: initialConcurrency,
            effectiveConcurrency: concurrency,
            busyCount,
            firstBusyIndex,
          });
        }
        return true;
      };

      const pump = () => {
        if (finishIfReady()) return;
        while (!paused && activeCount < concurrency && nextIndex < matches.length) {
          const index = nextIndex;
          nextIndex += 1;
          activeCount += 1;
          dispatchedCount += 1;
          callbacks.onStart?.(index, dispatchedCount, concurrency);
          submitShipment(matches[index], {
            onBusy(attempt) {
              busyCount += 1;
              if (firstBusyIndex === null) firstBusyIndex = index;
              const degraded = concurrency > 1;
              if (degraded) {
                concurrency = 1;
                degradedToSerial = true;
              }
              callbacks.onBusy?.({
                index,
                attempt,
                completedCount,
                busyCount,
                firstBusyIndex,
                concurrency,
                degraded,
              });
            },
          }).catch((error) => ({
            state: 'unknown',
            ok: false,
            retryable: false,
            message: error?.message || '发货执行异常，店小秘是否已受理无法确认',
          })).then((result) => {
            results[index] = result;
            completedCount += 1;
            if (result.state === 'unknown') paused = true;
            callbacks.onResult?.(index, result, completedCount, concurrency);
          }).finally(() => {
            activeCount -= 1;
            pump();
          });
        }
      };

      pump();
    });
  }

  async function submitShipment(item, callbacks = {}) {
    let body;
    try {
      body = Core.buildShipmentBody(item);
    } catch (error) {
      return { state: 'failed', ok: false, message: error?.message || '发货参数预检失败' };
    }
    const maxBusyRetries = 5;
    for (let attempt = 0; attempt <= maxBusyRetries; attempt += 1) {
      let response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
          response = await fetch(SHIPMENT_ENDPOINT, {
            method: 'POST',
            credentials: 'include',
            redirect: 'follow',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        return {
          state: 'unknown',
          ok: false,
          message: error?.name === 'AbortError'
            ? '请求超时，店小秘是否已受理无法确认'
            : '网络中断，店小秘是否已受理无法确认',
        };
      }
      if (!response.ok) {
        return {
          state: response.status >= 500 ? 'unknown' : 'failed',
          ok: false,
          message: `店小秘发货请求失败（HTTP ${response.status}）`,
        };
      }
      let payload;
      try {
        payload = await response.json();
      } catch (_error) {
        return { state: 'unknown', ok: false, message: '店小秘发货响应无法解析，是否已受理无法确认' };
      }
      const interpreted = Core.interpretShipmentResponse(payload);
      if (!interpreted.retryable) return interpreted;
      callbacks.onBusy?.(attempt + 1);
      if (attempt >= maxBusyRetries) {
        return { state: 'failed', ok: false, message: '店小秘持续繁忙，超过有限重试次数' };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { state: 'failed', ok: false, message: '店小秘发货未完成' };
  }

  async function retryFailedShipment(item) {
    const body = new URLSearchParams({ packageId: item.internalPackageId }).toString();
    let response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        response = await fetch(RETRY_COMMIT_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          redirect: 'follow',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return {
        state: 'unknown',
        ok: false,
        message: error?.name === 'AbortError'
          ? '重提请求超时，店小秘是否已受理无法确认'
          : '重提时网络中断，店小秘是否已受理无法确认',
      };
    }
    if (!response.ok) {
      return {
        state: response.status >= 500 ? 'unknown' : 'failed',
        ok: false,
        message: `店小秘失败单重提请求失败（HTTP ${response.status}）`,
      };
    }
    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      return { state: 'unknown', ok: false, message: '失败单重提响应无法解析，是否已受理无法确认' };
    }
    const interpreted = Core.interpretShipmentResponse(payload);
    if (interpreted.retryable) {
      return { state: 'failed', ok: false, message: interpreted.message };
    }
    return interpreted;
  }

  function downloadResults(results) {
    if (!Array.isArray(results) || results.length === 0) return;
    const blob = new Blob([Core.resultsToCsv(results)], { type: 'text/csv;charset=utf-8' });
    triggerBlobDownload(
      blob,
      `Xynigo店小秘物流助手结果_${new Date().toISOString().slice(0, 10)}_${Date.now()}.csv`,
    );
  }

  let activePath = window.location.pathname;
  syncPageAvailability();
  if (isPendingReviewPage()) {
    window.setInterval(() => {
      const nextPath = window.location?.pathname;
      if (!nextPath || activePath === nextPath) return;
      activePath = nextPath;
      syncPageAvailability();
    }, 250);
    window.addEventListener('popstate', syncPageAvailability);
    window.addEventListener('hashchange', syncPageAvailability);
  }
})();
