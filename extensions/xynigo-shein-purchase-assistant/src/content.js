'use strict';

(function initPurchaseAssistant() {
  const HOST_ID = 'xynigo-purchase-assistant-host';
  const CONTENT_VERSION = '0.9.0';
  const SITE = XynigoPurchaseCore.siteFromUrl(location.href);
  if (!SITE) return;
  const SITE_PROFILE = XynigoPurchaseCore.SITE_PROFILES[SITE];
  const CHECKOUT_PATH = /\/checkout(?:\/|$)/i;
  const BUSINESS_ICON_URL = chrome.runtime.getURL('icons/icon48.png');
  const EXECUTOR_CONNECTED_TEXT = 'localhost 执行器已连接 · 自动配对完成';
  const EXECUTOR_DISCONNECTED_TEXT = 'localhost 执行器未连接';
  const EXECUTOR_CONNECTION_ERROR_CODES = new Set([
    'executor_unreachable',
    'local_access_disabled',
    'pairing_denied',
    'pairing_failed',
    'session_required',
    'authentication_required',
    'cloud_unreachable',
    'data_source_mapping_required',
    'executor_update_required',
  ]);
  const FIELD_STEPS = SITE === 'US' ? [
    { key: 'firstName', label: 'First Name', fieldLabels: ['First Name'], type: 'text' },
    { key: 'lastName', label: 'Last Name', fieldLabels: ['Last Name'], type: 'text' },
    { key: 'phone', label: 'Phone Number', fieldLabels: ['Phone Number'], type: 'phone' },
    { key: 'postalCode', label: 'Postcode', fieldLabels: ['Postcode'], type: 'text' },
    { key: 'state', label: 'State/Province', fieldLabels: ['State/Province'], type: 'select' },
    { key: 'city', label: 'City', fieldLabels: ['City'], type: 'text' },
    { key: 'address1', label: 'Street address', fieldLabels: ['Street address'], type: 'text' },
    { key: 'address2', label: 'Apt / Suite', fieldLabels: ['Apt, suite,unit,etc(optional)'], type: 'text', optional: true },
  ] : [
    { key: 'firstName', label: 'Nombre', fieldLabels: ['Nombre'], type: 'text' },
    { key: 'lastName', label: 'Apellido', fieldLabels: ['Apellido'], type: 'text' },
    { key: 'phone', label: 'Teléfono', fieldLabels: ['Número de Teléfono', 'Telefono'], type: 'phone' },
    { key: 'postalCode', label: 'Código postal', fieldLabels: ['Código postal', 'Codigo postal'], type: 'postal' },
    { key: 'state', label: 'Estado', fieldLabels: ['Estado'], type: 'select' },
    { key: 'city', label: 'Ciudad', fieldLabels: ['Municipio/Distrito/Ciudad', 'Ciudad'], type: 'select' },
    { key: 'address1', label: 'Dirección', fieldLabels: ['Dirección de la calle', 'Direccion de la calle'], type: 'text' },
    { key: 'address2', label: '地址补充', fieldLabels: ['Apartamento, suite, unidad', 'Apartamento, suite, unidad, etc. (opcional)'], type: 'text', optional: true },
    { key: 'curp', label: 'CURP', fieldLabels: ['CURP'], type: 'text' },
  ];
  const PRE_LOCATION_TEXT_KEYS = ['phone'];
  const POST_LOCATION_TEXT_KEYS = ['address1', 'address2'];
  const RETRYABLE_TEXT_KEYS = PRE_LOCATION_TEXT_KEYS.concat(
    SITE === 'US' ? ['city', 'postalCode'] : [], POST_LOCATION_TEXT_KEYS,
  );

  let tasks = [];
  let selectedTask = null;
  let detailsController = null;
  let running = false;
  let statusByKey = {};
  let root = null;
  let panelTop = 58;
  let fabTop = null;
  let suppressFabClick = false;
  let connectionRevision = 0;
  let taskListRevision = 0;
  let lastCurpWrite = null;
  let curpSwitchPromise = Promise.resolve();

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function compareVersions(left, right) {
    const leftParts = String(left || '').split('.').map((part) => Number(part) || 0);
    const rightParts = String(right || '').split('.').map((part) => Number(part) || 0);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (difference) return difference;
    }
    return 0;
  }

  function clampVerticalTop(value, elementHeight) {
    const margin = 8;
    const maximum = Math.max(margin, window.innerHeight - Math.max(1, elementHeight) - margin);
    return Math.min(maximum, Math.max(margin, Math.round(value)));
  }

  function applyVerticalPosition(mode) {
    if (!root) return;
    const element = root.querySelector(mode === 'fab' ? '[data-role="fab"]' : '.xpa-panel');
    const height = element ? element.getBoundingClientRect().height : 0;
    if (mode === 'fab') {
      if (fabTop === null) fabTop = Math.round((window.innerHeight - Math.max(52, height)) / 2);
      fabTop = clampVerticalTop(fabTop, height || 52);
      root.style.top = fabTop + 'px';
      return;
    }
    panelTop = clampVerticalTop(panelTop, height || Math.min(820, window.innerHeight - 74));
    root.style.top = panelTop + 'px';
  }

  function bindVerticalDrag(handle, mode) {
    let drag = null;
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (drag.moved && mode === 'fab') {
        suppressFabClick = true;
        setTimeout(() => { suppressFabClick = false; }, 0);
      }
      drag = null;
      root.classList.remove('is-dragging');
      try { handle.releasePointerCapture(event.pointerId); } catch {}
    };
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (mode === 'panel' && event.target.closest('[data-role="close"]')) return;
      const currentTop = mode === 'fab' ? fabTop : panelTop;
      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startTop: Number.isFinite(currentTop) ? currentTop : parseFloat(root.style.top) || 8,
        moved: false,
      };
      handle.setPointerCapture(event.pointerId);
      root.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const deltaY = event.clientY - drag.startY;
      if (Math.abs(deltaY) >= 4) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      const target = mode === 'fab'
        ? root.querySelector('[data-role="fab"]')
        : root.querySelector('.xpa-panel');
      const height = target ? target.getBoundingClientRect().height : 0;
      const nextTop = clampVerticalTop(drag.startTop + deltaY, height);
      if (mode === 'fab') fabTop = nextTop;
      else panelTop = nextTop;
      root.style.top = nextTop + 'px';
    });
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: '插件后台暂不可用' });
          return;
        }
        resolve(response || { ok: false, error: '插件后台无响应' });
      });
    });
  }

  function setNotice(text, tone) {
    if (!root) return;
    const node = root.querySelector('[data-role="notice"]');
    node.textContent = text || '';
    node.dataset.tone = tone || 'neutral';
  }

  function setConnection(ok) {
    if (!root) return;
    const node = root.querySelector('[data-role="connection"]');
    node.classList.toggle('is-ok', Boolean(ok));
    node.querySelector('b').textContent = ok
      ? EXECUTOR_CONNECTED_TEXT
      : EXECUTOR_DISCONNECTED_TEXT;
  }

  function setSourceSummary(source) {
    if (!root || !source) return;
    const active = source.active || source;
    const label = source.label || active.label;
    const node = root.querySelector('[data-role="connection"] em');
    if (node && label) node.textContent = label;
  }

  function beginConnectionUpdate() {
    connectionRevision += 1;
    return connectionRevision;
  }

  function applyConnectionUpdate(revision, ok) {
    if (revision !== connectionRevision) return false;
    setConnection(ok);
    return true;
  }

  function confirmExecutorConnected() {
    const revision = beginConnectionUpdate();
    applyConnectionUpdate(revision, true);
  }

  function markExecutorDisconnected(response) {
    const code = String(response && response.code ? response.code : '');
    if (!EXECUTOR_CONNECTION_ERROR_CODES.has(code)) return;
    const revision = beginConnectionUpdate();
    applyConnectionUpdate(revision, false);
  }

  async function refreshExecutorStatus() {
    const revision = beginConnectionUpdate();
    const health = await sendMessage({ type: 'EXECUTOR_HEALTH' });
    applyConnectionUpdate(revision, Boolean(health.ok));
    if (health.ok) setSourceSummary(health.source);
    return health;
  }

  function clearRecipientCard() {
    if (!root) return;
    const card = root.querySelector('[data-role="recipient-card"]');
    const fields = root.querySelector('[data-role="recipient-fields"]');
    fields.replaceChildren();
    card.hidden = true;
    const curpStatus = root.querySelector('[data-role="curp-source-status"]');
    if (curpStatus) curpStatus.textContent = '读取当前订单提供的 CURP；缺失或异常时提示人工处理。';
  }

  async function copyRecipientValue(value, button) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } finally {
        textarea.remove();
      }
    }
    const label = button.querySelector('em');
    label.textContent = copied ? '已复制' : '请手动选择';
    setTimeout(() => { label.textContent = '复制'; }, 1200);
  }

  function renderRecipientCard(recipient, validation) {
    if (!root) return;
    const card = root.querySelector('[data-role="recipient-card"]');
    const container = root.querySelector('[data-role="recipient-fields"]');
    const values = validation.values;
    const entries = [
      ['收货人姓名', recipient.recipientName],
      [stepByKey('firstName').label + '（SHEIN）', values.firstName],
      [stepByKey('lastName').label + '（SHEIN）', values.lastName],
      ['收货人电话', recipient.recipientPhone],
      ['邮编', recipient.postalCode],
      ['收货人州/省', recipient.stateProvince],
      ['收货人城市', recipient.city],
      [validation.addressAdjusted ? '地址1（原始）' : '地址1', recipient.addressLine1],
      [validation.addressAdjusted ? '地址2（原始）' : '地址2', recipient.addressLine2],
    ];
    if (SITE === 'MX') {
      entries.push(['CURP（数据源）', recipient.curpStatus === 'conflict' ? '' : recipient.curp]);
      const curpStatus = root.querySelector('[data-role="curp-source-status"]');
      if (curpStatus) curpStatus.textContent = validation.curp.ok
        ? '已读取当前订单 CURP，填写后将回读核对。'
        : validation.curp.error;
    }
    if (validation.postalCodeAdjusted) entries.push(['Postcode（SHEIN）', values.postalCode]);
    if (validation.postalCodePadded) entries.push(['邮编（补零后）', values.postalCode]);
    if (validation.addressAdjusted) {
      entries.push(
        [stepByKey('address1').label + '（SHEIN）', values.address1],
        ['地址补充（SHEIN）', values.address2],
      );
    }
    container.replaceChildren();
    for (const [labelText, rawValue] of entries) {
      const value = XynigoPurchaseCore.normalizeText(rawValue);
      const item = document.createElement('div');
      item.className = 'xpa-recipient-field';
      const label = document.createElement('span');
      label.textContent = labelText;
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !value;
      const text = document.createElement('b');
      text.textContent = value || '—';
      const action = document.createElement('em');
      action.textContent = '复制';
      button.append(text, action);
      if (value) button.addEventListener('click', () => copyRecipientValue(value, button));
      item.append(label, button);
      container.appendChild(item);
    }
    card.hidden = false;
  }

  async function loadRecipientPreview(task) {
    clearRecipientCard();
    setNotice('正在只读加载当前任务的收件信息…', 'neutral');
    const response = await sendMessage({ type: 'GET_RECIPIENT', taskKey: task.taskKey });
    if (running || !selectedTask || selectedTask.taskKey !== task.taskKey) return;
    if (!response.ok || !response.recipient) {
      markExecutorDisconnected(response);
      setNotice(response.error || '收件信息读取失败', 'error');
      return;
    }
    confirmExecutorConnected();
    setSourceSummary(response.source);
    const validation = validateTaskRecipient(response.recipient, task);
    renderRecipientCard(response.recipient, validation);
    setNotice(
      validation.ok
        ? validation.addressAdjusted
          ? '长地址已按 ' + SITE_PROFILE.label + ' 每行 ' + validation.addressLineLimit + ' 字符限制自动拆分，可核对后继续填写'
          : '收件信息已显示，可直接复制或继续一键填写'
        : '收件信息已显示；自动填写校验：' + validation.issues.join('；'),
      validation.ok ? 'success' : 'error',
    );
  }

  function updateProgress() {
    if (!root) return;
    const done = FIELD_STEPS.filter((step) => statusByKey[step.key] === 'done').length;
    root.querySelector('[data-role="progress-count"]').textContent = done + ' / ' + FIELD_STEPS.length;
    root.querySelector('[data-role="progress-bar"]').style.width = (done / FIELD_STEPS.length * 100) + '%';
    for (const step of FIELD_STEPS) {
      const node = root.querySelector('[data-field-key="' + step.key + '"]');
      const status = statusByKey[step.key] || 'pending';
      node.dataset.status = status;
      node.querySelector('i').textContent = status === 'done' ? '✓' : status === 'active' ? '•' : status === 'error' || status === 'manual' ? '!' : '';
    }
  }

  function renderTasks() {
    if (!root) return;
    const list = root.querySelector('[data-role="task-list"]');
    list.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement('p');
      empty.className = 'xpa-empty';
      empty.textContent = '暂无可执行任务';
      list.appendChild(empty);
      return;
    }

    for (const task of tasks) {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = running;
      button.className = 'xpa-task-option';
      button.classList.toggle('is-selected', selectedTask && selectedTask.taskKey === task.taskKey);
      const main = document.createElement('span');
      const id = document.createElement('b');
      id.textContent = task.salesOrderNo || task.taskKey;
      const item = document.createElement('small');
      item.textContent = [task.store, task.specSummary, '数量 ' + (task.quantity || '-')].filter(Boolean).join(' · ');
      main.append(id, item);
      const state = document.createElement('em');
      state.textContent = task.status || '表格任务';
      button.append(main, state);
      button.addEventListener('click', () => {
        if (running) return;
        selectedTask = task;
        void sendMessage({type: 'REMEMBER_PURCHASE_TASK', task: {taskKey: task.taskKey, salesOrderNo: task.salesOrderNo}});
        if (detailsController) detailsController.taskChanged();
        if (SITE === 'MX') curpSwitchPromise = curpSwitchPromise.then(() => clearOwnedCurp(task.taskKey)).catch(() => false);
        statusByKey = {};
        clearRecipientCard();
        renderTasks();
        renderSelectedTask();
        updateProgress();
        void loadRecipientPreview(task);
      });
      list.appendChild(button);
    }
  }

  function renderSelectedTask() {
    if (!root) return;
    if (detailsController) detailsController.taskChanged();
    const id = root.querySelector('[data-role="selected-id"]');
    const meta = root.querySelector('[data-role="selected-meta"]');
    const button = root.querySelector('[data-role="fill-button"]');
    if (!selectedTask) {
      id.textContent = '未选择任务';
      meta.textContent = '请先从任务列表选择一项';
      button.disabled = true;
      return;
    }
    id.textContent = selectedTask.salesOrderNo || selectedTask.taskKey;
    meta.textContent = [
      selectedTask.store,
      selectedTask.packageNo ? '包裹 ' + selectedTask.packageNo : '',
      selectedTask.site || (SITE + ' · 任务未提供国家，请核对'),
      selectedTask.specSummary,
      '采购数量 ' + (selectedTask.quantity || '-'),
      selectedTask.guidePrice ? '指导价 ' + selectedTask.guidePrice : '',
    ].filter(Boolean).join(' · ');
    button.disabled = running || !CHECKOUT_PATH.test(location.pathname) || Boolean(XynigoPurchaseCore.taskSiteIssue(selectedTask.site, SITE));
  }

  function collapsePanel() {
    if (!root || root.classList.contains('is-collapsed')) return;
    const activeElement = document.activeElement;
    root.classList.add('is-collapsed');
    if (activeElement && root.contains(activeElement) && typeof activeElement.blur === 'function') {
      activeElement.blur();
    }
    requestAnimationFrame(() => applyVerticalPosition('fab'));
  }

  function isPanelOpen() {
    return root && root.isConnected && !root.classList.contains('is-collapsed');
  }

  function openPanel() {
    if (!root || !root.classList.contains('is-collapsed')) return;
    root.classList.remove('is-collapsed');
    requestAnimationFrame(() => applyVerticalPosition('panel'));
    void refreshExecutorStatus();
  }

  function createPanel() {
    const host = document.createElement('aside');
    host.id = HOST_ID;
    host.dataset.xynigoVersion = CONTENT_VERSION;
    host.classList.add('is-collapsed');
    host.innerHTML =
      '<button type="button" class="xpa-fab" data-role="fab" aria-label="打开采购助手"><span><img src="' + BUSINESS_ICON_URL + '" alt=""></span><b>采购助手</b></button>' +
      '<section class="xpa-panel" aria-label="Xynigo SHEIN 采购助手">' +
        '<header class="xpa-header"><span class="xpa-mark"><img src="' + BUSINESS_ICON_URL + '" alt=""></span><div><small>Xynigo · v' + CONTENT_VERSION + ' · ' + SITE + '</small><h2>采购助手</h2></div><button type="button" data-role="close" aria-label="收起">×</button></header>' +
        '<div class="xpa-connection" data-role="connection"><span></span><b>正在检查本地执行器…</b><em>飞书普通表格</em></div>' +
        '<div class="xpa-body">' +
          '<div class="xpa-section-label"><span>查找采购任务</span><button type="button" data-role="refresh">刷新</button></div>' +
          '<div class="xpa-task-search"><input type="search" data-role="task-query" placeholder="销售订单号 / 包裹号" autocomplete="off"><button type="button" data-role="task-search">搜索</button></div>' +
          '<div class="xpa-task-list" data-role="task-list"><p class="xpa-empty">请输入订单号或包裹号</p></div>' +
          '<section class="xpa-selected"><small>当前任务</small><b data-role="selected-id">未选择任务</b><span data-role="selected-meta">请先选择任务</span></section>' +
          '<section class="xpa-recipient" data-role="recipient-card" hidden><div><b>收件信息（原始 + SHEIN 姓名）</b><small>仅当前页面临时显示 · 鼠标点击任一字段即复制当前显示值</small></div><div data-role="recipient-fields"></div></section>' +
          '<section class="xpa-progress"><div><span>地址字段</span><b data-role="progress-count">0 / 8</b></div><p><i data-role="progress-bar"></i></p><ul>' +
            FIELD_STEPS.map((step) => '<li data-field-key="' + step.key + '" data-status="pending"><i></i><span>' + step.label + '</span></li>').join('') +
          '</ul></section>' +
          (SITE === 'MX'
            ? '<div class="xpa-curp-note"><b>CURP 随地址填写</b><span data-role="curp-source-status">读取当前订单提供的 CURP；缺失或异常时提示人工处理。</span></div>'
            : '<div class="xpa-curp-note"><b>美国站收件信息</b><span>地址每行最多 30 字符，填写后请核对收件人、州和邮编。</span></div>') +
          '<div class="xpa-notice" data-role="notice" data-tone="neutral">请先连接本地执行器</div>' +
        '</div>' +
        '<footer class="xpa-footer"><button type="button" data-role="fill-button" disabled>一键填写收件信息</button><small>' + (SITE === 'US' ? '不会点击 SAVE / CONTINUE / 支付' : '不会点击 GUARDAR / CONTINUAR / 支付') + '</small></footer>' +
      '</section>';
    document.documentElement.appendChild(host);
    root = host;
    detailsController = XynigoPurchaseDetails.mount(root, sendMessage, () => selectedTask, setFillingState);
    void sendMessage({type:'RESTORE_PURCHASE_TASK'}).then(async response => {
      if (!response?.task || selectedTask || running) return;
      const result = await sendMessage({type:'LIST_TASKS', query:response.task.salesOrderNo});
      if(selectedTask || running) return;
      const task = result?.tasks?.find(x => x.taskKey === response.task.taskKey);
      if(task) { selectedTask = task; tasks = [task]; renderTasks(); renderSelectedTask(); detailsController.taskChanged(); }
    });

    root.querySelector('[data-role="close"]').addEventListener('click', collapsePanel);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing && isPanelOpen()) {
        const focusInside = root.contains(document.activeElement);
        event.preventDefault();
        event.stopPropagation();
        collapsePanel();
        if (focusInside) root.querySelector('[data-role="fab"]').focus({ preventScroll: true });
      }
    }, true);
    document.addEventListener('pointerdown', (event) => {
      // Autofill clicks page fields programmatically; only user input dismisses.
      if (!event.isTrusted || !isPanelOpen() || event.composedPath().includes(root)) return;
      collapsePanel();
    }, true);
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'OPEN_PURCHASE_ASSISTANT') openPanel();
    });
    const fab = root.querySelector('[data-role="fab"]');
    const header = root.querySelector('.xpa-header');
    fab.addEventListener('click', (event) => {
      if (suppressFabClick) {
        event.preventDefault();
        return;
      }
      openPanel();
    });
    bindVerticalDrag(fab, 'fab');
    bindVerticalDrag(header, 'panel');
    window.addEventListener('resize', () => {
      applyVerticalPosition(root.classList.contains('is-collapsed') ? 'fab' : 'panel');
    });
    root.querySelector('[data-role="refresh"]').addEventListener('click', loadTasks);
    root.querySelector('[data-role="task-search"]').addEventListener('click', loadTasks);
    root.querySelector('[data-role="task-query"]').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loadTasks();
      }
    });
    root.querySelector('[data-role="fill-button"]').addEventListener('click', runFill);
    requestAnimationFrame(() => applyVerticalPosition('fab'));
    renderSelectedTask();
    updateProgress();
  }

  async function loadTasks() {
    if (!root || running) return;
    const revision = ++taskListRevision;
    clearRecipientCard();
    const query = XynigoPurchaseCore.normalizeText(root.querySelector('[data-role="task-query"]').value);
    const health = await refreshExecutorStatus();
    if (running || revision !== taskListRevision) return;
    if (!health.ok) {
      tasks = [];
      selectedTask = null;
      renderTasks();
      renderSelectedTask();
      setNotice(
        health.error || '请打开 Xynigo 桌面客户端完成登录和数据源配置',
        'error',
      );
      return;
    }
    if (!query) {
      tasks = [];
      renderTasks();
      setNotice(
        health.ok
          ? '请输入销售订单号或包裹号后搜索'
          : (health.error || '请启动本地执行器，插件将自动完成配对'),
        health.ok ? 'neutral' : 'error',
      );
      return;
    }
    setNotice('正在搜索采购任务…', 'neutral');
    const response = await sendMessage({ type: 'LIST_TASKS', query });
    if (running || revision !== taskListRevision) return;
    if (!response.ok) {
      markExecutorDisconnected(response);
      tasks = [];
      renderTasks();
      setNotice(response.error || '任务读取失败', 'error');
      return;
    }
    confirmExecutorConnected();
    setSourceSummary(response.source);
    tasks = Array.isArray(response.tasks) ? response.tasks : [];
    if (selectedTask) {
      selectedTask = tasks.find((task) => task.taskKey === selectedTask.taskKey) || null;
    }
    renderTasks();
    renderSelectedTask();
    const suffix = response.truncated ? '，仅显示前 20 个' : '';
    setNotice(tasks.length ? '找到 ' + (response.total || tasks.length) + ' 个匹配任务' + suffix + '，请选择当前订单' : '未找到匹配任务', tasks.length ? 'success' : 'neutral');
  }

  function isRenderedElement(node) {
    if (!node || !node.isConnected) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findFieldByLabel(candidates) {
    const normalizeLabel = (text) => XynigoPurchaseCore.normalizeOption(text).replace(/[\s*]/g, '');
    const labels = Array.from(document.querySelectorAll('[id^="sui-input-title-label-"]'))
      .filter(isRenderedElement);
    const wanted = new Set(candidates.map(normalizeLabel));
    const fields = new Set();
    for (const label of labels.filter((node) => wanted.has(normalizeLabel(node.textContent)))) {
      const suffix = '[aria-labelledby~="' + CSS.escape(label.id) + '"]';
      for (const field of document.querySelectorAll(['input', 'textarea', 'select'].map((tag) => tag + suffix).join(','))) {
        if (isRenderedElement(field)) fields.add(field);
      }
    }
    // Count every known label variant together: mixed old/new duplicate forms
    // must not become an implicit preference for the first alias.
    return fields.size === 1 ? fields.values().next().value : null;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!setter || typeof setter.set !== 'function') throw new Error('当前字段不支持自动填写');
    setter.set.call(element, value);
  }

  function textFieldValueMatches(field, value) {
    return XynigoPurchaseCore.normalizeText(field && field.value)
      === XynigoPurchaseCore.normalizeText(value);
  }

  async function commitTextValue(field, value, strategy) {
    assertPageContext();
    field.click();
    try {
      field.focus({ preventScroll: true });
    } catch {
      field.focus();
    }
    if (SITE === 'US' || (SITE === 'MX' && field === findFieldByLabel(['CURP']))) {
      const ready = await waitFor(() => !field.readOnly && !field.disabled, 1600, 80);
      if (!ready) throw new Error('输入框尚未激活，请点击收件信息字段后重试');
      if (field.maxLength >= 0 && String(value).length > field.maxLength) {
        throw new Error('填写内容超过当前输入框长度限制，请人工核对');
      }
    }
    assertPageContext();
    if (typeof field.select === 'function') field.select();

    const inputStrategy = strategy || 'native';
    let inserted = false;
    if (inputStrategy !== 'native' && typeof document.execCommand === 'function') {
      try {
        inserted = document.execCommand('insertText', false, value);
      } catch {
        inserted = false;
      }
    }
    if (!inserted || inputStrategy === 'hybrid' || !textFieldValueMatches(field, value)) {
      field.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertReplacementText',
        data: value,
      }));
      setNativeValue(field, value);
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertReplacementText',
        data: value,
      }));
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitFor(predicate, timeoutMs, intervalMs) {
    const deadline = Date.now() + (timeoutMs || 5000);
    let last = null;
    while (Date.now() < deadline) {
      last = predicate();
      if (last) return last;
      await sleep(intervalMs || 80);
    }
    return null;
  }

  function visibleSelectMenus() {
    return Array.from(document.querySelectorAll('.sui-select__menu,[role="listbox"]')).filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function optionsInMenu(menu) {
    return Array.from(menu.querySelectorAll('.sui-select-option,[role="option"]'));
  }

  function menuDistanceFromField(menu, field) {
    const anchor = field.closest('.sui-input-titlewarp') || field;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const horizontalOverlap = Math.max(
      0,
      Math.min(anchorRect.right, menuRect.right) - Math.max(anchorRect.left, menuRect.left),
    );
    const verticalGap = Math.min(
      Math.abs(menuRect.top - anchorRect.bottom),
      Math.abs(anchorRect.top - menuRect.bottom),
    );
    return verticalGap + Math.abs(menuRect.left - anchorRect.left) + (horizontalOverlap ? 0 : 10000);
  }

  async function waitForStableFieldValue(step, value, stableMs, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let stableSince = 0;
    while (Date.now() < deadline) {
      if (verifyField(step, value)) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) return true;
      } else {
        stableSince = 0;
      }
      await sleep(100);
    }
    return false;
  }

  function visiblePostalSuggestion(field, postalCode) {
    const listId = field.getAttribute('aria-controls');
    if (!listId) return null;
    const list = document.getElementById(listId);
    if (!list) return null;
    const listRect = list.getBoundingClientRect();
    if (listRect.width <= 0 || listRect.height <= 0) return null;
    const candidates = Array.from(list.querySelectorAll('[role="option"],li,[data-value]'));
    return candidates.find((node) => {
      const rect = node.getBoundingClientRect();
      const candidate = (node.getAttribute('data-value') || '') + ' ' + (node.textContent || '');
      return rect.width > 0
        && rect.height > 0
        && XynigoPurchaseCore.postalSuggestionMatches(candidate, postalCode);
    }) || null;
  }

  async function fillText(step, value) {
    const strategies = step.key === 'address2'
      ? ['keyboard', 'native', 'hybrid']
      : ['native', 'keyboard'];
    for (let attempt = 0; attempt < strategies.length; attempt += 1) {
      const field = await waitFor(() => findFieldByLabel(step.fieldLabels), 5000, 100);
      if (!field) return { ok: false, error: '未找到唯一可见的 ' + step.label + ' 字段' };
      await commitTextValue(field, value, strategies[attempt]);
      await sleep(step.key === 'address2' ? 260 : 80);
      const currentField = findFieldByLabel(step.fieldLabels) || field;
      if (currentField && typeof currentField.blur === 'function') currentField.blur();
      const stableMs = step.key === 'address2' ? 700 : 450;
      const timeoutMs = step.key === 'address2' ? 3600 : 2500;
      if (await waitForStableFieldValue(step, value, stableMs, timeoutMs)) return { ok: true };
      await sleep(120);
    }
    return { ok: false, error: step.label + ' 稳定回读不一致' };
  }

  async function fillNamePair(values) {
    const firstStep = stepByKey('firstName');
    const lastStep = stepByKey('lastName');
    statusByKey.firstName = 'active';
    statusByKey.lastName = 'active';
    updateProgress();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const orderedSteps = attempt % 2 === 0
        ? [firstStep, lastStep]
        : [lastStep, firstStep];
      let missingField = false;
      for (const step of orderedSteps) {
        const field = await waitFor(() => findFieldByLabel(step.fieldLabels), 5000, 100);
        if (!field) {
          missingField = true;
          break;
        }
        await commitTextValue(field, values[step.key], 'keyboard');
        await sleep(220);
      }
      const activeField = document.activeElement;
      if (activeField && typeof activeField.blur === 'function') activeField.blur();
      if (!missingField) {
        const stable = await waitFor(() => (
          verifyField(firstStep, values.firstName)
          && verifyField(lastStep, values.lastName)
        ), 3500, 120);
        if (stable) {
          await sleep(500);
          if (
            verifyField(firstStep, values.firstName)
            && verifyField(lastStep, values.lastName)
          ) {
            statusByKey.firstName = 'done';
            statusByKey.lastName = 'done';
            updateProgress();
            return [
              { key: 'firstName', label: firstStep.label, ok: true },
              { key: 'lastName', label: lastStep.label, ok: true },
            ];
          }
        }
      }
      await sleep(180);
    }

    statusByKey.firstName = 'error';
    statusByKey.lastName = 'error';
    updateProgress();
    return [
      { key: 'firstName', label: firstStep.label, ok: false, error: '姓名组合替换后回读不一致' },
      { key: 'lastName', label: lastStep.label, ok: false, error: '姓名组合替换后回读不一致' },
    ];
  }

  async function fillPostalCode(step, value) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const field = await waitFor(() => findFieldByLabel(step.fieldLabels), 5000, 100);
      if (!field) return { ok: false, error: '未找到 ' + step.label + ' 字段' };
      await commitTextValue(field, value, 'keyboard');
      const suggestion = await waitFor(
        () => visiblePostalSuggestion(findFieldByLabel(step.fieldLabels) || field, value),
        2200,
        100,
      );
      if (suggestion) {
        assertPageContext();
        suggestion.click();
      } else {
        const current = findFieldByLabel(step.fieldLabels) || field;
        current.blur();
      }
      if (await waitForStableFieldValue(step, value, 1200, 4500)) return { ok: true };
      await sleep(180);
    }
    return { ok: false, error: step.label + ' 被 SHEIN 异步清空或未接受' };
  }

  async function chooseOption(step, value) {
    const field = await waitFor(() => findFieldByLabel(step.fieldLabels), 5000, 100);
    if (!field) return { ok: false, error: '未找到 ' + step.label + ' 下拉框' };
    if (SITE !== 'US') await waitFor(() => visibleSelectMenus().length === 0, 2000, 80);
    const control = field.closest('.sui-input-titlewarp') || field.closest('[role="combobox"]') || field;
    const previousMenus = new Set(visibleSelectMenus());
    assertPageContext();
    if (control.getAttribute('aria-expanded') !== 'true') control.click();
    await waitFor(() => control.getAttribute('aria-expanded') === 'true', 1500, 60);
    if (isUsCitySelect(step, field) && !XynigoPurchaseCore.optionMatches(field.value, value)) {
      // After choosing a state, SHEIN may replace the city text input with
      // a searchable SUI select. Typing filters it; an option click commits it.
      field.focus({ preventScroll: true });
      if (await waitFor(() => !field.readOnly && !field.disabled, 600, 80)) {
        await commitTextValue(field, value, 'keyboard');
      }
    }
    const menu = await waitFor(() => {
      const menus = visibleSelectMenus();
      if (SITE === 'US') {
        const local = field.closest('.sui-select');
        const ownMenus = local ? Array.from(local.querySelectorAll('.sui-select__menu,[role="listbox"]')).filter(isRenderedElement) : [];
        if (ownMenus.length === 1) return ownMenus[0];
        const ownedId = field.getAttribute('aria-controls') || control.getAttribute('aria-controls');
        const owned = ownedId && ownedId !== 'associate-listbox' ? document.getElementById(ownedId) : null;
        if (owned && menus.includes(owned)) return owned;
        // The address association menu is shared by many unrelated inputs.
        return menus.filter((node) => !previousMenus.has(node) && node.id !== 'associate-listbox')
          .sort((a, b) => menuDistanceFromField(a, field) - menuDistanceFromField(b, field))
          .find((node) => menuDistanceFromField(node, field) < 400) || null;
      }
      const matchingMenu = menus.find((node) => optionsInMenu(node).some((option) => (
        selectValueMatches(step, option.textContent, value)
      )));
      if (matchingMenu) return matchingMenu;
      return menus.sort((left, right) => (
        menuDistanceFromField(left, field) - menuDistanceFromField(right, field)
      ))[0] || null;
    }, 5000, 100);
    if (!menu) return { ok: false, error: step.label + ' 下拉列表未展开' };

    let option = null;
    for (let attempt = 0; attempt < 45 && !option; attempt += 1) {
      const options = optionsInMenu(menu);
      option = options.find((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && selectValueMatches(step, node.textContent, value);
      }) || null;
      if (option) break;
      const candidates = [menu].concat(Array.from(menu.querySelectorAll('*')));
      const scroller = candidates.find((node) => node.scrollHeight > node.clientHeight + 8);
      if (!scroller) break;
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.min(
        scroller.scrollHeight,
        before + Math.max(120, Math.floor(scroller.clientHeight * 0.75)),
      );
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(120);
      if (scroller.scrollTop === before) break;
    }
    if (!option) return { ok: false, error: step.label + ' 选项未匹配：' + value };
    assertPageContext();
    option.click();
    const matched = await waitForStableFieldValue(step, value, 600, 5000);
    await waitFor(() => control.getAttribute('aria-expanded') !== 'true', 2000, 80);
    return matched ? { ok: true } : { ok: false, error: step.label + ' 选择后回读不一致' };
  }

  function hasFieldError(field) {
    if (!field || !field.isConnected) return true;
    const addressField = field.closest('.addr-field');
    if (addressField?.classList.contains('addr-field__error')) return true;
    if (addressField && Array.from(addressField.querySelectorAll('.addr-field__error-text,.customer-address__content__error'))
      .some((node) => isRenderedElement(node) && node.textContent.trim())) return true;
    if (field.getAttribute('aria-invalid') === 'true') return true;
    if (typeof field.checkValidity === 'function' && !field.checkValidity()) return true;
    const describedErrors = (field.getAttribute('aria-describedby') || '').split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((node) => node && isRenderedElement(node) && node.getAttribute('role') === 'alert' && node.textContent.trim());
    return describedErrors.length > 0;
  }

  function verifyField(step, value) {
    const field = findFieldByLabel(step.fieldLabels);
    if (hasFieldError(field)) return false;
    const actual = String(field.value || '');
    if (SITE === 'MX' && step.key === 'curp') return Boolean(findCurpRadio()?.checked) && String(actual).trim().toUpperCase() === value;
    if (isUsPostcodeSelect(step, field)) {
      const selected = Array.from(field.closest('.sui-select').querySelectorAll('[role="option"][aria-selected="true"]'));
      return postalValueMatches(actual, value) && field.getAttribute('aria-expanded') !== 'true'
        && selected.some((option) => postalValueMatches(option.textContent, value));
    }
    if (isUsCitySelect(step, field)) {
      const selected = Array.from(field.closest('.sui-select').querySelectorAll('[role="option"][aria-selected="true"]'));
      return XynigoPurchaseCore.optionMatches(actual, value)
        && selected.some((option) => XynigoPurchaseCore.optionMatches(option.textContent, value));
    }
    if (step.type === 'phone') {
      return SITE === 'US'
        ? XynigoPurchaseCore.normalizeUsPhone(actual) === value
        : actual.replace(/\D/g, '').endsWith(String(value).replace(/\D/g, ''));
    }
    if (step.type === 'select') {
      return selectValueMatches(step, actual, value);
    }
    if (SITE === 'US' && step.key === 'postalCode') return XynigoPurchaseCore.normalizeUsPostal(actual) === value;
    return XynigoPurchaseCore.normalizeText(actual) === XynigoPurchaseCore.normalizeText(value);
  }

  function stepByKey(key) {
    return FIELD_STEPS.find((step) => step.key === key);
  }

  function isUsCitySelect(step, field) {
    return SITE === 'US' && step.key === 'city' && Boolean(field?.closest('.sui-select'));
  }

  function isUsPostcodeSelect(step, field) {
    return SITE === 'US' && step.key === 'postalCode' && Boolean(field?.closest('.sui-select'));
  }

  function postalValueMatches(actual, expected) {
    return XynigoPurchaseCore.normalizeUsPostal(actual) === XynigoPurchaseCore.normalizeUsPostal(expected);
  }

  async function fillUsPostcodeSelect(step, value) {
    // US targets are converted to five digits before any form interaction.
    // A SUI select still needs its exact option committed, not just typed text.
    if (!/^\d{5}$/.test(value)) return { ok: false, error: 'Postcode 应为 5 位数字' };
    const field = findFieldByLabel(step.fieldLabels);
    if (!field?.closest('.sui-select')) return { ok: false, error: 'Postcode 选择框已变化，请重试' };
    const control = field.closest('.sui-input-titlewarp') || field;
    assertPageContext();
    if (control.getAttribute('aria-expanded') !== 'true') control.click();
    const readMenu = () => {
      const current = findFieldByLabel(step.fieldLabels);
      return Array.from(current?.closest('.sui-select')?.querySelectorAll('.sui-select__menu[role="listbox"]') || []).find(isRenderedElement);
    };
    if (!await waitFor(readMenu, 3500, 100)) return { ok: false, error: 'Postcode 下拉列表未展开' };
    const exactOptions = () => {
      const menu = readMenu();
      return menu ? optionsInMenu(menu).filter((node) => isRenderedElement(node) && postalValueMatches(node.textContent, value)) : [];
    };
    // Replace an old ZIP+4 filter directly with the five-digit target. Do not
    // search the full ZIP+4 or clear to an empty intermediate value first.
    if (!exactOptions().length) {
      const current = findFieldByLabel(step.fieldLabels);
      await commitTextValue(current, value, 'native');
      const currentControl = current.closest('.sui-input-titlewarp') || current;
      if (currentControl.getAttribute('aria-expanded') !== 'true') currentControl.click();
    }
    const matches = await waitFor(() => {
      const options = exactOptions();
      return options.length ? options : null;
    }, 3000, 100);
    if (!matches) return { ok: false, retryable: false, error: 'Postcode 已按前五位处理，但页面未提供对应选项，请人工核对' };
    if (matches.length !== 1) return { ok: false, retryable: false, error: 'Postcode 存在多个相同候选，请人工核对' };
    assertPageContext(); matches[0].click();
    return await waitForStableFieldValue(step, value, 1200, 4000)
      ? { ok: true } : { ok: false, error: 'Postcode 选择后未被页面接受或被重置，请重试' };
  }

  function selectValueMatches(step, actual, expected) {
    return step.key === 'state'
      ? XynigoPurchaseCore.stateMatches(actual, expected, SITE)
      : XynigoPurchaseCore.optionMatches(actual, expected);
  }

  function validateTaskRecipient(recipient, task) {
    const validation = XynigoPurchaseCore.validateRecipient(recipient, SITE);
    for (const sourceSite of [task?.site, recipient.site, recipient.country]) {
      const issue = XynigoPurchaseCore.taskSiteIssue(sourceSite, SITE);
      if (issue && !validation.issues.includes(issue)) validation.issues.push(issue);
    }
    validation.ok = validation.issues.length === 0;
    return validation;
  }

  function assertPageContext() {
    if (XynigoPurchaseCore.siteFromUrl(location.href) !== SITE || !CHECKOUT_PATH.test(location.pathname)) {
      throw new Error('页面已离开当前站点的结算地址页，已停止填写');
    }
    if (SITE === 'US') {
      const country = findFieldByLabel(['Location']);
      if (!country || XynigoPurchaseCore.normalizeSite(country.value) !== 'US') {
        throw new Error('请先打开国家为 United States 的收件地址表单');
      }
    }
  }

  function setFillingState(value) {
    running = value;
    if (value) taskListRevision += 1;
    for (const node of root.querySelectorAll('[data-role="task-query"],[data-role="task-search"],[data-role="refresh"],.xpa-task-option')) {
      node.disabled = value;
    }
    renderSelectedTask();
  }

  async function executeStep(step, values) {
    const value = values[step.key];
    statusByKey[step.key] = 'active';
    updateProgress();
    try {
      assertPageContext();
      const result = verifyField(step, value)
        ? { ok: true, unchanged: true }
        : isUsPostcodeSelect(step, findFieldByLabel(step.fieldLabels))
          ? await fillUsPostcodeSelect(step, value)
        : step.type === 'select' || isUsCitySelect(step, findFieldByLabel(step.fieldLabels))
          ? await chooseOption(step, value)
          : step.type === 'postal'
            ? await fillPostalCode(step, value)
            : await fillText(step, value);
      statusByKey[step.key] = result.ok ? 'done' : 'error';
      updateProgress();
      return { key: step.key, label: step.label, ...result };
    } catch (error) {
      statusByKey[step.key] = 'error';
      updateProgress();
      return {
        key: step.key,
        label: step.label,
        ok: false,
        error: error && error.message ? error.message : step.label + ' 填写异常',
      };
    }
  }

  function markDependencyError(step, error) {
    statusByKey[step.key] = 'error';
    updateProgress();
    return { key: step.key, label: step.label, ok: false, error };
  }

  async function executeStepsSequentially(keys, values) {
    const results = [];
    for (const key of keys) {
      results.push(await executeStep(stepByKey(key), values));
      await sleep(160);
    }
    return results;
  }

  async function retryMismatchedTextFields(results, values) {
    if (
      !verifyField(stepByKey('firstName'), values.firstName)
      || !verifyField(stepByKey('lastName'), values.lastName)
    ) {
      setNotice('检测到姓名组被页面恢复，正在成组重试…', 'neutral');
      const nameResults = await fillNamePair(values);
      nameResults.forEach((result) => results.set(result.key, result));
    }

    const retrySteps = RETRYABLE_TEXT_KEYS
      .map((key) => stepByKey(key))
      .filter((step) => results.get(step.key)?.retryable !== false && !verifyField(step, values[step.key]));
    if (!retrySteps.length) return;

    setNotice('检测到文本字段被页面重置，正在逐项重试…', 'neutral');
    for (const step of retrySteps) {
      const result = await executeStep(step, values);
      results.set(result.key, result);
      await sleep(160);
    }
  }

  function findCurpRadio() {
    const radios = Array.from(document.querySelectorAll('.add-multiple__radio input[type="radio"][value="national_id"]'))
      .filter((radio) => isRenderedElement(radio.closest('label')) && XynigoPurchaseCore.normalizeOption(radio.closest('label').textContent) === 'curp');
    return radios.length === 1 ? radios[0] : null;
  }

  async function clearOwnedCurp(nextTaskKey, force = false) {
    if (SITE !== 'MX' || !lastCurpWrite || (!force && lastCurpWrite.taskKey === nextTaskKey)) return true;
    const field = findFieldByLabel(['CURP']);
    const owned = lastCurpWrite;
    if (!field || field.value !== owned.value || !findCurpRadio()?.checked) {
      lastCurpWrite = null; // An edited or different document field belongs to the user.
      return true;
    }
    await commitTextValue(field, '', 'native');
    field.blur();
    const cleared = await waitFor(() => findFieldByLabel(['CURP'])?.value === '', 1800, 100);
    if (cleared) lastCurpWrite = null;
    return Boolean(cleared);
  }

  async function fillCurp(validation, taskKey) {
    const step = stepByKey('curp');
    const info = validation.curp;
    statusByKey.curp = 'active'; updateProgress();
    try {
      if (!info.ok) {
        const cleared = await clearOwnedCurp(taskKey, true);
        const existing = findFieldByLabel(['CURP']);
        const suffix = !cleared ? '；上一单 CURP 未能清空，请人工清除' : existing?.value ? '；页面已有证件值，请人工核对本单归属' : '';
        statusByKey.curp = ['invalid', 'conflict'].includes(info.status) || !cleared ? 'error' : 'manual';
        return { key: 'curp', label: 'CURP', ok: false, error: info.error + suffix };
      }
      assertPageContext();
      const radio = findCurpRadio();
      if (!radio) throw new Error('未找到唯一的 CURP 证件类型选项，请人工选择');
      if (!radio.checked) radio.closest('label').click();
      if (!await waitFor(() => findCurpRadio()?.checked && findFieldByLabel(['CURP']), 2500, 100)) throw new Error('页面未切换到 CURP 输入框');
      const field = findFieldByLabel(['CURP']);
      await commitTextValue(field, info.value, 'native');
      // Track even a subsequently rejected value so it cannot leak into the next task.
      lastCurpWrite = { taskKey, value: info.value };
      field.blur();
      if (!await waitForStableFieldValue(step, info.value, 1000, 3500)) throw new Error('CURP 未被页面接受或回读不一致，请人工核对');
      statusByKey.curp = 'done';
      return { key: 'curp', label: 'CURP', ok: true };
    } catch (error) {
      statusByKey.curp = 'error';
      return { key: 'curp', label: 'CURP', ok: false, error: error?.message || 'CURP 填写异常' };
    } finally { updateProgress(); }
  }

  async function runFill() {
    if (running || !selectedTask) return;
    if (!CHECKOUT_PATH.test(location.pathname)) {
      setNotice('请先进入 SHEIN 结算地址页', 'error');
      return;
    }
    const task = selectedTask;
    setFillingState(true);
    statusByKey = {};
    renderSelectedTask();
    updateProgress();
    setNotice('正在按任务唯一键临时读取收件信息…', 'neutral');
    let recipient = null;
    try {
      await curpSwitchPromise;
      assertPageContext();
      const taskIssue = XynigoPurchaseCore.taskSiteIssue(task.site, SITE);
      if (taskIssue) throw new Error(taskIssue);
      const response = await sendMessage({ type: 'GET_RECIPIENT', taskKey: task.taskKey });
      if (!response.ok || !response.recipient) {
        markExecutorDisconnected(response);
        throw new Error(response.error || '收件信息读取失败');
      }
      confirmExecutorConnected();
      setSourceSummary(response.source);
      recipient = response.recipient;
      const validation = validateTaskRecipient(recipient, task);
      renderRecipientCard(recipient, validation);
      if (!validation.ok) throw new Error(validation.issues.join('；'));
      assertPageContext();
      const missingFields = FIELD_STEPS.filter((step) => step.key !== 'curp' && !findFieldByLabel(step.fieldLabels));
      if (missingFields.length) throw new Error('请打开唯一的收件地址编辑表单，未找到或存在重复字段：' + missingFields.map((step) => step.label).join('、'));

      const results = new Map();
      setNotice('正在成组填写 ' + stepByKey('firstName').label + ' / ' + stepByKey('lastName').label + '…', 'neutral');
      const nameResults = await fillNamePair(validation.values);
      nameResults.forEach((result) => results.set(result.key, result));

      setNotice('正在填写电话…', 'neutral');
      const identityResults = await executeStepsSequentially(PRE_LOCATION_TEXT_KEYS, validation.values);
      identityResults.forEach((result) => results.set(result.key, result));

      const stateStep = stepByKey('state');
      const cityStep = stepByKey('city');
      if (SITE === 'MX') {
        setNotice('正在填写邮编并等待自动补全…', 'neutral');
        const initialPostalResult = await executeStep(stepByKey('postalCode'), validation.values);
        results.set(initialPostalResult.key, initialPostalResult);
        if (initialPostalResult.ok) {
          setNotice('正在等待邮编自动带出州和城市…', 'neutral');
          await waitFor(() => (
            verifyField(stateStep, validation.values.state)
            && verifyField(cityStep, validation.values.city)
          ), 3000, 120);
        }
      }

      setNotice(SITE === 'US' ? '正在选择州并填写城市…' : '正在核对州和城市，必要时回退到下拉选择…', 'neutral');
      const stateResult = await executeStep(stateStep, validation.values);
      results.set(stateResult.key, stateResult);
      await sleep(220);
      const cityResult = stateResult.ok || verifyField(cityStep, validation.values.city)
        ? await executeStep(cityStep, validation.values)
        : markDependencyError(cityStep, stateStep.label + ' 未完成，' + cityStep.label + ' 已跳过');
      results.set(cityResult.key, cityResult);
      await sleep(220);

      setNotice('正在最终核对邮编…', 'neutral');
      const postalResult = await executeStep(stepByKey('postalCode'), validation.values);
      results.set(postalResult.key, postalResult);

      setNotice(
        validation.addressAdjusted
          ? '正在填写自动拆分后的两行地址…'
          : '正在依次填写街道地址和地址补充…',
        'neutral',
      );
      const addressResults = await executeStepsSequentially(POST_LOCATION_TEXT_KEYS, validation.values);
      addressResults.forEach((result) => results.set(result.key, result));

      await sleep(350);
      await retryMismatchedTextFields(results, validation.values);
      if (SITE === 'MX') results.set('curp', await fillCurp(validation, task.taskKey));
      if (SITE === 'US') {
        // City/address updates can replace or clear the postcode asynchronously.
        // Finish with a bounded postcode recheck after all other field writes.
        const step = stepByKey('postalCode');
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (results.get(step.key)?.retryable === false) break;
          const result = await executeStep(step, validation.values);
          results.set(step.key, result);
          if (!result.ok && result.retryable === false) break;
          if (result.ok && await waitForStableFieldValue(step, validation.values.postalCode, 1500, 3500)) break;
          statusByKey[step.key] = 'error';
          results.set(step.key, { ...result, ok: false, error: 'Postcode 在地址联动后未能保持五位值' });
          updateProgress();
        }
      }
      await sleep(350);
      const issues = new Map(
        Array.from(results.values()).filter((result) => !result.ok).map((result) => [result.key, result.error]),
      );
      for (const step of FIELD_STEPS) {
        if (statusByKey[step.key] === 'done' && !verifyField(step, validation.values[step.key])) {
          statusByKey[step.key] = 'error';
          updateProgress();
          issues.set(step.key, step.label + ' 最终回读不一致');
        }
      }
      const postcodeNotice = SITE === 'US' && validation.postalCodeAdjusted && verifyField(stepByKey('postalCode'), validation.values.postalCode)
        ? 'Postcode 已按前五位填写：' + validation.values.postalCode + '（原始邮编保留在预览中）。'
        : validation.postalCodePadded && statusByKey.postalCode === 'done' && verifyField(stepByKey('postalCode'), validation.values.postalCode)
          ? '墨西哥邮编已在前面补 0：' + validation.values.postalCode + '（原始邮编保留在预览中）。' : '';
      const failedSteps = FIELD_STEPS.filter((step) => statusByKey[step.key] !== 'done');
      if (failedSteps.length) {
        const doneCount = FIELD_STEPS.length - failedSteps.length;
        const detail = failedSteps.map((step) => (
          step.label + '：' + (issues.get(step.key) || '未完成')
        )).join('；');
        setNotice(
          postcodeNotice + '已完成 ' + doneCount + ' / ' + FIELD_STEPS.length + '；' + detail + '。其他字段已保留，请人工处理或重试',
          'error',
        );
      } else {
        setNotice(
          postcodeNotice + (validation.addressAdjusted ? '长地址已自动拆分为两行，' : '')
            + '地址字段回读一致。'
            + (SITE === 'US' ? '请核对收件人、州和邮编后手动保存地址' : 'CURP 已回读确认，请核对后手动保存地址'),
          'success',
        );
      }
    } catch (error) {
      for (const step of FIELD_STEPS) {
        if (statusByKey[step.key] === 'active') statusByKey[step.key] = 'error';
      }
      updateProgress();
      setNotice(error && error.message ? error.message : '填写过程中发生异常', 'error');
    } finally {
      recipient = null;
      setFillingState(false);
    }
  }

  function maybeMount() {
    if (!CHECKOUT_PATH.test(location.pathname) && !(SITE === 'MX' && /^\/user\/orders\/detail\/[A-Za-z0-9-]+$/.test(location.pathname))) return;
    const existing = document.getElementById(HOST_ID);
    if (existing && compareVersions(existing.dataset.xynigoVersion, CONTENT_VERSION) >= 0) return;
    if (existing) existing.remove();
    createPanel();
    loadTasks();
  }

  maybeMount();
  const observer = new MutationObserver(maybeMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
