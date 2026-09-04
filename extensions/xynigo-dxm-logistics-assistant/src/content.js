(function runXynigoDxmLogisticsAssistant() {
  'use strict';

  const Core = globalThis.XynigoDxmLogisticsCore;
  const ImportTools = globalThis.XynigoDxmLogisticsImport;
  const TemplateData = globalThis.XynigoDxmLogisticsTemplate;
  if (!Core || !ImportTools || !TemplateData || globalThis.__xynigoDxmLogisticsAssistantInstalled) return;
  globalThis.__xynigoDxmLogisticsAssistantInstalled = true;

  const ROOT_ID = 'xynigo-dxm-logistics-root';
  const FLOATING_ENTRY_ID = 'xynigo-dxm-logistics-entry';
  const ENTRY_ICON_URL = globalThis.XynigoDxmLogisticsAssets?.icon48
    || globalThis.chrome?.runtime?.getURL?.('icons/icon48.png')
    || '';
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const DETAIL_ENDPOINT = '/api/order/detail.json';
  const SHIPPING_OPTIONS_ENDPOINT = '/api/order/withOutPrintShippingList.json';
  const SHIPMENT_ENDPOINT = '/api/package/withOutPrintShip.json';
  const RETRY_COMMIT_ENDPOINT = '/api/package/commitPlatform.json';
  const MODE_SHIP = 'ship';
  const MODE_RETRY = 'retry';

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
    root.querySelector('[data-role="callout-title"]').textContent = isRetry
      ? '失败单重提不会改写物流信息。'
      : '这是不可撤销的店小秘写入操作。';
    root.querySelector('[data-role="callout-copy"]').textContent = isRetry
      ? '插件会核对失败订单现有物流单号和承运商，只调用店小秘“继续提交平台”。'
      : '插件会先自动搜索并回读订单详情；只有全部精确匹配后才能执行。';
    root.querySelector('[data-role="input-label"]').textContent = isRetry
      ? '订单号 + 当前物流单号'
      : '订单号 + 物流单号';
    root.querySelector('[data-action="preflight"]').textContent = isRetry ? '预检失败单' : '预检匹配';
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
            <p class="xynigo-dxm-logistics-kicker">XYNIGO · 第一期</p>
            <h2 id="xynigo-dxm-logistics-title">店小秘物流助手</h2>
            <p>粘贴订单号和物流单号，核对店小秘平台承运商后执行发货。</p>
          </div>
          <button type="button" class="xynigo-dxm-logistics-close" aria-label="关闭">×</button>
        </header>
        <main class="xynigo-dxm-logistics-main">
          <section data-stage="input">
            <div class="xynigo-dxm-logistics-mode" role="radiogroup" aria-label="操作模式">
              <label><input type="radio" name="xynigo-dxm-logistics-mode" value="ship"><span>首次发货</span></label>
              <label><input type="radio" name="xynigo-dxm-logistics-mode" value="retry"><span>失败单重提</span></label>
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
              <p>模板三列均必填：订单号、物流单号、物流商渠道。上传只会填入输入框，不会直接发货。</p>
            </div>
            <div class="xynigo-dxm-logistics-row">
              <label>
                <span>本批默认物流商</span>
                <select id="xynigo-dxm-logistics-carrier"></select>
              </label>
              <p>推荐直接从 Excel 复制两列；也支持逗号、分号或多个空格分隔。可选第三列覆盖单行物流商。</p>
            </div>
            <div class="xynigo-dxm-logistics-feedback" aria-live="polite"></div>
          </section>
          <section data-stage="preview" hidden>
            <div class="xynigo-dxm-logistics-summary"></div>
            <div class="xynigo-dxm-logistics-table-wrap">
              <table>
                <thead><tr><th>#</th><th>订单号</th><th>物流单号</th><th>输入物流商</th><th>店小秘平台承运商</th><th>内部包裹 ID</th><th>状态</th></tr></thead>
                <tbody></tbody>
              </table>
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
    const defaultMode = isFailureListPage() ? MODE_RETRY : MODE_SHIP;
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
    const download = root.querySelector('[data-action="download"]');
    const downloadTemplate = root.querySelector('[data-action="download-template"]');
    const uploadFile = root.querySelector('[data-action="upload-file"]');
    const importFile = root.querySelector('[data-role="import-file"]');
    const confirmed = root.querySelector('.xynigo-dxm-logistics-confirm input');
    const textarea = root.querySelector('#xynigo-dxm-logistics-input');

    close.addEventListener('click', removeAssistant);
    cancel.addEventListener('click', removeAssistant);
    back.addEventListener('click', () => showInputStage(root));
    confirmed.addEventListener('change', () => {
      execute.disabled = !confirmed.checked || running;
    });
    preflight.addEventListener('click', () => startPreflight(root));
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
      setFeedback(root, [
        `已从 ${file.name} 导入 ${parsed.entries.length} 个订单，已替换输入框内容。`,
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
      if (element.matches('[data-action="execute"]')) return;
      element.disabled = busy;
    });
    root.querySelector('.xynigo-dxm-logistics-close').disabled = busy;
    const execute = root.querySelector('[data-action="execute"]');
    if (busy) execute.disabled = true;
    if (message) setFeedback(root, message, 'progress');
  }

  function showInputStage(root) {
    if (running) return;
    root.querySelector('[data-stage="input"]').hidden = false;
    root.querySelector('[data-stage="preview"]').hidden = true;
    root.querySelector('[data-action="preflight"]').hidden = false;
    root.querySelector('[data-action="execute"]').hidden = true;
    root.querySelector('[data-action="back"]').hidden = true;
    root.querySelector('[data-action="download"]').hidden = true;
    root.querySelector('[data-action="cancel"]').textContent = '取消';
    root.querySelector('.xynigo-dxm-logistics-confirm input').checked = false;
    root.__xynigoMatches = null;
    root.__xynigoResults = null;
  }

  async function startPreflight(root) {
    const mode = selectedMode(root);
    if (mode === MODE_RETRY && !isFailureListPage()) {
      setFeedback(root, '失败单重提只能在店小秘“发货失败”列表页执行。', 'error');
      return;
    }
    if (mode === MODE_SHIP && isFailureListPage()) {
      setFeedback(root, '发货失败页禁止使用“首次发货”；请切换到“失败单重提”。', 'error');
      return;
    }
    const input = root.querySelector('#xynigo-dxm-logistics-input').value;
    const defaultCarrier = root.querySelector('#xynigo-dxm-logistics-carrier').value;
    const parsed = Core.parseInput(input, { defaultCarrier });
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
        : `正在店小秘搜索并精确核对 ${parsed.entries.length} 个订单…`,
    );
    try {
      const searchResult = await searchForOrders(parsed.entries);
      if (!searchResult.ok) throw new Error(searchResult.reason);
      const detailResult = await readVisibleOrders(parsed.entries, (done, total) => {
        setFeedback(root, `正在回读店小秘订单详情 ${done}/${total}…`, 'progress');
      });
      const matched = Core.matchEntries(parsed.entries, detailResult.records);
      if (!matched.ok || detailResult.records.length === 0) {
        const messages = [...warningMessages];
        if (matched.missing.length) {
          messages.push(`未找到：${matched.missing.map((item) => item.orderNo).join('、')}`);
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
      root.__xynigoMode = MODE_SHIP;
      root.__xynigoMatches = resolved.matches;
      renderPreview(root, resolved.matches, warningMessages, MODE_SHIP);
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

  function displayedSearchResultCount() {
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
    return Array.from(frequencies.entries())
      .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0][0];
  }

  async function searchForOrders(entries) {
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
    const displayedCount = displayedSearchResultCount();
    if (displayedCount !== null && displayedCount > entries.length) {
      return {
        ok: false,
        reason: `店小秘搜索结果未收敛到本批订单（页面仍显示 ${displayedCount} 条，本批仅 ${entries.length} 单）；已停止预检，请刷新页面后重试。`,
      };
    }
    if (displayedCount !== null && visibleRows.matchedOrderNumbers.length < displayedCount) {
      return {
        ok: false,
        reason: `店小秘页面显示 ${displayedCount} 条结果，但插件只能确认其中 ${visibleRows.matchedOrderNumbers.length} 条属于本批；已停止预检。`,
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
      const previous = rowsById.get(key) || { id, text: '' };
      previous.text = `${previous.text} ${row.textContent || ''}`;
      rowsById.set(key, previous);
    });
    rowsById.forEach(({ id, text }, key) => {
      const rowText = Core.normalizeOrderNo(text);
      const matchedOrderNo = orderNumbers.find((orderNo) => rowText.includes(orderNo));
      if (!matchedOrderNo) {
        unmatchedRows.push(key);
      } else if (id) {
        matchedOrderNumbers.add(matchedOrderNo);
        ids.push(id);
      }
    });
    return {
      ids: ids.slice(0, 300),
      unmatchedRows,
      matchedOrderNumbers: Array.from(matchedOrderNumbers),
      totalRows: rowsById.size,
    };
  }

  async function fetchOrderDetail(internalPackageId) {
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
    return parsed;
  }

  async function readVisibleOrders(entries, onProgress) {
    const ids = classifyVisibleRows(entries).ids;
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
          records.push(await fetchOrderDetail(internalPackageId));
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
        errors.push(
          `订单 ${item.orderNo}：${resolution.reason}。可选：${availableProviderSummary(resolution.availableProviderNames)}`,
        );
        return;
      }
      resolvedMatches.push({ ...item, ...resolution });
    });
    return { ok: errors.length === 0, matches: resolvedMatches, errors };
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

  function renderPreview(root, matches, warnings, mode = MODE_SHIP) {
    root.querySelector('[data-stage="input"]').hidden = true;
    root.querySelector('[data-stage="preview"]').hidden = false;
    root.querySelector('[data-action="preflight"]').hidden = true;
    root.querySelector('[data-action="execute"]').hidden = false;
    root.querySelector('[data-action="back"]').hidden = false;
    root.querySelector('[data-action="cancel"]').textContent = '取消';
    const summary = root.querySelector('.xynigo-dxm-logistics-summary');
    const isRetry = mode === MODE_RETRY;
    summary.textContent = warnings.length
      ? `已精确匹配 ${matches.length} 个${isRetry ? '失败' : ''}订单。${warnings.join('；')}`
      : `已精确匹配 ${matches.length} 个${isRetry ? '失败' : ''}订单。请逐行核对后再执行。`;
    const headerValues = isRetry
      ? ['#', '订单号', '现有物流单号', '现有承运商', '失败原因', '内部包裹 ID', '状态']
      : ['#', '订单号', '物流单号', '输入物流商', '店小秘平台承运商', '内部包裹 ID', '状态'];
    const headerRow = root.querySelector('[data-stage="preview"] thead tr');
    headerRow.replaceChildren(...headerValues.map((value) => {
      const cell = document.createElement('th');
      cell.textContent = value;
      return cell;
    }));
    root.querySelector('.xynigo-dxm-logistics-confirm span').textContent = isRetry
      ? '我已核对失败订单、现有物流单号和承运商，确认仅执行“继续提交平台”。'
      : '我已逐行核对订单号、物流单号及店小秘平台承运商，确认执行不可撤销的店小秘发货写入。';
    const executeButton = root.querySelector('[data-action="execute"]');
    executeButton.textContent = isRetry ? '确认并重新提交平台' : '确认并执行发货';
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
        : [
          index + 1,
          item.orderNo,
          item.trackingNo,
          item.requestedProviderName,
          item.platformProviderName,
          item.internalPackageId,
          '待执行',
        ];
      values.forEach((value, columnIndex) => {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        if (columnIndex === 6) cell.dataset.result = 'pending';
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
  }

  async function executePreview(root) {
    const matches = root.__xynigoMatches;
    const mode = root.__xynigoMode || MODE_SHIP;
    const isRetry = mode === MODE_RETRY;
    const confirmed = root.querySelector('.xynigo-dxm-logistics-confirm input').checked;
    if (!Array.isArray(matches) || matches.length === 0 || !confirmed || running) return;
    setBusy(root, true);
    root.querySelector('[data-action="back"]').hidden = true;
    root.querySelector('[data-action="cancel"]').hidden = true;
    const execute = root.querySelector('[data-action="execute"]');
    execute.textContent = `${isRetry ? '正在重提' : '正在执行'} 0/${matches.length}`;
    const resultCells = root.querySelectorAll('[data-stage="preview"] tbody td:last-child');
    const results = [];

    for (let index = 0; index < matches.length; index += 1) {
      const item = matches[index];
      execute.textContent = `${isRetry ? '正在重提' : '正在执行'} ${index + 1}/${matches.length}`;
      resultCells[index].textContent = '提交中…';
      resultCells[index].dataset.result = 'running';
      const result = isRetry ? await retryFailedShipment(item) : await submitShipment(item);
      results.push({ ...item, operation: mode, ...result });
      resultCells[index].textContent = result.state === 'submitted'
        ? (isRetry ? '已重新提交，待平台确认' : '已提交，待平台确认')
        : (result.state === 'unknown' ? '结果未知' : `失败：${result.message}`);
      resultCells[index].title = result.message;
      resultCells[index].dataset.result = result.state;
    }

    root.__xynigoResults = results;
    const submittedCount = results.filter((item) => item.state === 'submitted').length;
    const unknownCount = results.filter((item) => item.state === 'unknown').length;
    const failedCount = results.length - submittedCount - unknownCount;
    root.querySelector('.xynigo-dxm-logistics-summary').textContent =
      `${isRetry ? '重提' : '提交'}完成：店小秘已受理 ${submittedCount}，失败 ${failedCount}，结果未知 ${unknownCount}。`
      + (submittedCount ? ' 已受理订单仍需到店小秘“发货成功/发货失败”列表确认平台结果。' : '')
      + (unknownCount ? ' 结果未知的订单必须先去店小秘列表核对，禁止直接重试。' : '');
    root.querySelector('[data-action="download"]').hidden = false;
    root.querySelector('[data-action="cancel"]').hidden = false;
    root.querySelector('[data-action="cancel"]').textContent = '关闭';
    execute.hidden = true;
    setBusy(root, false);
  }

  async function submitShipment(item) {
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

  createFloatingEntry();
})();
