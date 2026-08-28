'use strict';

(function initPurchaseAssistant() {
  const HOST_ID = 'xynigo-purchase-assistant-host';
  const CONTENT_VERSION = '0.5.2';
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
  ]);
  const FIELD_STEPS = [
    { key: 'firstName', label: 'Nombre', fieldLabels: ['Nombre'], type: 'text' },
    { key: 'lastName', label: 'Apellido', fieldLabels: ['Apellido'], type: 'text' },
    { key: 'phone', label: 'Teléfono', fieldLabels: ['Número de Teléfono', 'Telefono'], type: 'phone' },
    { key: 'postalCode', label: 'Código postal', fieldLabels: ['Código postal', 'Codigo postal'], type: 'postal' },
    { key: 'state', label: 'Estado', fieldLabels: ['Estado'], type: 'select' },
    { key: 'city', label: 'Ciudad', fieldLabels: ['Municipio/Distrito/Ciudad', 'Ciudad'], type: 'select' },
    { key: 'address1', label: 'Dirección', fieldLabels: ['Dirección de la calle', 'Direccion de la calle'], type: 'text' },
    { key: 'address2', label: '地址补充', fieldLabels: ['Apartamento, suite, unidad'], type: 'text', optional: true },
  ];
  const PRE_LOCATION_TEXT_KEYS = ['phone'];
  const POST_LOCATION_TEXT_KEYS = ['address1', 'address2'];
  const RETRYABLE_TEXT_KEYS = PRE_LOCATION_TEXT_KEYS.concat(POST_LOCATION_TEXT_KEYS);

  let tasks = [];
  let selectedTask = null;
  let running = false;
  let statusByKey = {};
  let root = null;
  let panelTop = 58;
  let fabTop = null;
  let suppressFabClick = false;
  let hubCapability = null;
  let connectionRevision = 0;
  let hubHealthRevision = 0;

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
    const hubRevision = ++hubHealthRevision;
    const health = await sendMessage({ type: 'EXECUTOR_HEALTH' });
    applyConnectionUpdate(revision, Boolean(health.ok));
    if (hubRevision === hubHealthRevision) {
      setHubStudioCapability(health.hubStudio || {
        available: false,
        message: health.error || 'Xynigo 主执行器未运行',
      });
    }
    return health;
  }

  function setHubStudioCapability(capability) {
    if (!root) return;
    const node = root.querySelector('[data-role="hub-capability"]');
    const available = Boolean(capability && capability.available);
    hubCapability = capability || null;
    node.dataset.tone = available ? 'success' : 'warning';
    node.textContent = available
      ? 'HubStudio 自动化已就绪'
      : 'HubStudio 自动化暂不可用，不影响当前页面填写'
        + (capability && capability.message ? '：' + capability.message : '');
    const controls = root.querySelector('[data-role="hub-controls"]');
    controls.hidden = !available;
  }

  async function runHubEnvironmentAction(action) {
    if (!root || !hubCapability || !hubCapability.available) return;
    const input = root.querySelector('[data-role="hub-identifier"]');
    const result = root.querySelector('[data-role="hub-result"]');
    const identifier = String(input.value || '').trim();
    if (!identifier) {
      result.textContent = '请输入环境序号或 containerCode';
      return;
    }
    if (action === 'close' && !window.confirm('确认关闭 HubStudio 环境 ' + identifier + '？')) return;
    result.textContent = action === 'locate' ? '正在定位环境…' : '正在执行 HubStudio 操作…';
    const response = action === 'locate'
      ? await sendMessage({ type: 'HUB_ENV_LOCATE', identifier })
      : await sendMessage({ type: 'HUB_ENV_CONTROL', action, identifier });
    if (!response.ok) {
      result.textContent = response.error || 'HubStudio 操作失败';
      return;
    }
    const env = response.environment || {};
    result.textContent = [env.serialNumber, env.containerName, env.containerCode]
      .filter(Boolean).join(' · ') + (action === 'open' ? ' · 已打开' : action === 'close' ? ' · 已关闭' : '');
  }

  function clearRecipientCard() {
    if (!root) return;
    const card = root.querySelector('[data-role="recipient-card"]');
    const fields = root.querySelector('[data-role="recipient-fields"]');
    fields.replaceChildren();
    card.hidden = true;
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

  function renderRecipientCard(recipient, values) {
    if (!root) return;
    const card = root.querySelector('[data-role="recipient-card"]');
    const container = root.querySelector('[data-role="recipient-fields"]');
    const entries = [
      ['收货人姓名', recipient.recipientName],
      ['Nombre（SHEIN）', values.firstName],
      ['Apellido（SHEIN）', values.lastName],
      ['收货人电话', recipient.recipientPhone],
      ['邮编', recipient.postalCode],
      ['收货人州/省', recipient.stateProvince],
      ['收货人城市', recipient.city],
      ['地址1', recipient.addressLine1],
      ['地址2', recipient.addressLine2],
    ];
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
    if (!selectedTask || selectedTask.taskKey !== task.taskKey) return;
    if (!response.ok || !response.recipient) {
      markExecutorDisconnected(response);
      setNotice(response.error || '收件信息读取失败', 'error');
      return;
    }
    confirmExecutorConnected();
    const validation = XynigoPurchaseCore.validateRecipient(response.recipient);
    renderRecipientCard(response.recipient, validation.values);
    setNotice(
      validation.ok
        ? '收件信息已显示，可直接复制或继续一键填写'
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
      node.querySelector('i').textContent = status === 'done' ? '✓' : status === 'active' ? '•' : status === 'error' ? '!' : '';
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
        selectedTask = task;
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
      selectedTask.site || 'MX',
      selectedTask.specSummary,
      '采购数量 ' + (selectedTask.quantity || '-'),
      selectedTask.guidePrice ? '指导价 ' + selectedTask.guidePrice : '',
    ].filter(Boolean).join(' · ');
    button.disabled = running;
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
        '<header class="xpa-header"><span class="xpa-mark"><img src="' + BUSINESS_ICON_URL + '" alt=""></span><div><small>Xynigo · v' + CONTENT_VERSION + '</small><h2>采购助手</h2></div><button type="button" data-role="close" aria-label="收起">×</button></header>' +
        '<div class="xpa-connection" data-role="connection"><span></span><b>正在检查本地执行器…</b><em>飞书普通表格</em></div>' +
        '<div class="xpa-hub-capability" data-role="hub-capability" data-tone="neutral">HubStudio 自动化能力检测中</div>' +
        '<section class="xpa-hub-controls" data-role="hub-controls" hidden><b>HubStudio 增强操作</b><div><input type="text" data-role="hub-identifier" placeholder="环境序号 / containerCode"><button type="button" data-hub-action="locate">定位</button><button type="button" data-hub-action="open">打开</button><button type="button" data-hub-action="close">关闭</button></div><small data-role="hub-result">仅操作明确指定的环境</small></section>' +
        '<div class="xpa-body">' +
          '<div class="xpa-section-label"><span>查找采购任务</span><button type="button" data-role="refresh">刷新</button></div>' +
          '<div class="xpa-task-search"><input type="search" data-role="task-query" placeholder="销售订单号 / 包裹号" autocomplete="off"><button type="button" data-role="task-search">搜索</button></div>' +
          '<div class="xpa-task-list" data-role="task-list"><p class="xpa-empty">请输入订单号或包裹号</p></div>' +
          '<section class="xpa-selected"><small>当前任务</small><b data-role="selected-id">未选择任务</b><span data-role="selected-meta">请先选择任务</span></section>' +
          '<section class="xpa-recipient" data-role="recipient-card" hidden><div><b>收件信息（原始 + SHEIN 姓名）</b><small>仅当前页面临时显示 · 鼠标点击任一字段即复制当前显示值</small></div><div data-role="recipient-fields"></div></section>' +
          '<section class="xpa-progress"><div><span>地址字段</span><b data-role="progress-count">0 / 8</b></div><p><i data-role="progress-bar"></i></p><ul>' +
            FIELD_STEPS.map((step) => '<li data-field-key="' + step.key + '" data-status="pending"><i></i><span>' + step.label + '</span></li>').join('') +
          '</ul></section>' +
          '<div class="xpa-curp-note"><b>CURP 人工填写</b><span>插件不会生成、填写或保存证件标识。</span></div>' +
          '<div class="xpa-notice" data-role="notice" data-tone="neutral">请先连接本地执行器</div>' +
        '</div>' +
        '<footer class="xpa-footer"><button type="button" data-role="fill-button" disabled>一键填写收件信息</button><small>不会点击 GUARDAR / CONTINUAR / 支付</small></footer>' +
      '</section>';
    document.documentElement.appendChild(host);
    root = host;

    root.querySelector('[data-role="close"]').addEventListener('click', collapsePanel);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') collapsePanel();
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
    root.querySelectorAll('[data-hub-action]').forEach((button) => {
      button.addEventListener('click', () => {
        void runHubEnvironmentAction(button.dataset.hubAction);
      });
    });
    requestAnimationFrame(() => applyVerticalPosition('fab'));
    renderSelectedTask();
    updateProgress();
  }

  async function loadTasks() {
    if (!root) return;
    clearRecipientCard();
    const query = XynigoPurchaseCore.normalizeText(root.querySelector('[data-role="task-query"]').value);
    const health = await refreshExecutorStatus();
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
    if (!response.ok) {
      markExecutorDisconnected(response);
      tasks = [];
      renderTasks();
      setNotice(response.error || '任务读取失败', 'error');
      return;
    }
    confirmExecutorConnected();
    tasks = Array.isArray(response.tasks) ? response.tasks : [];
    if (selectedTask) {
      selectedTask = tasks.find((task) => task.taskKey === selectedTask.taskKey) || null;
    }
    renderTasks();
    renderSelectedTask();
    const suffix = response.truncated ? '，仅显示前 20 个' : '';
    setNotice(tasks.length ? '找到 ' + (response.total || tasks.length) + ' 个匹配任务' + suffix + '，请选择当前订单' : '未找到匹配任务', tasks.length ? 'success' : 'neutral');
  }

  function findFieldByLabel(candidates) {
    const labels = Array.from(document.querySelectorAll('[id^="sui-input-title-label-"]'));
    for (const candidate of candidates) {
      const wanted = XynigoPurchaseCore.normalizeOption(candidate);
      const label = labels.find((node) => XynigoPurchaseCore.normalizeOption(node.textContent).startsWith(wanted));
      if (!label) continue;
      const selector = '[aria-labelledby="' + CSS.escape(label.id) + '"]';
      const field = document.querySelector(selector);
      if (field) return field;
    }
    return null;
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!setter || typeof setter.set !== 'function') throw new Error('当前字段不支持自动填写');
    setter.set.call(element, value);
  }

  function commitTextValue(field, value, preferKeyboardInput) {
    field.click();
    try {
      field.focus({ preventScroll: true });
    } catch {
      field.focus();
    }
    if (typeof field.select === 'function') field.select();

    let inserted = false;
    if (preferKeyboardInput && typeof document.execCommand === 'function') {
      try {
        inserted = document.execCommand('insertText', false, value);
      } catch {
        inserted = false;
      }
    }
    if (!inserted) {
      field.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: value,
      }));
      setNativeValue(field, value);
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
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
    if (!value && step.optional) return { ok: true, skipped: true };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const field = await waitFor(() => findFieldByLabel(step.fieldLabels), 5000, 100);
      if (!field) return { ok: false, error: '未找到 ' + step.label + ' 字段' };
      commitTextValue(field, value, false);
      field.blur();
      if (await waitForStableFieldValue(step, value, 450, 2500)) return { ok: true };
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
        commitTextValue(field, values[step.key], true);
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
      { key: 'firstName', label: firstStep.label, ok: false, error: 'Nombre/Apellido 组合替换后回读不一致' },
      { key: 'lastName', label: lastStep.label, ok: false, error: 'Nombre/Apellido 组合替换后回读不一致' },
    ];
  }

  async function fillPostalCode(step, value) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const field = await waitFor(() => findFieldByLabel(step.fieldLabels), 5000, 100);
      if (!field) return { ok: false, error: '未找到 ' + step.label + ' 字段' };
      commitTextValue(field, value, true);
      const suggestion = await waitFor(
        () => visiblePostalSuggestion(findFieldByLabel(step.fieldLabels) || field, value),
        2200,
        100,
      );
      if (suggestion) {
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
    await waitFor(() => visibleSelectMenus().length === 0, 2000, 80);
    const control = field.closest('.sui-input-titlewarp') || field.closest('[role="combobox"]') || field;
    control.click();
    await waitFor(() => control.getAttribute('aria-expanded') === 'true', 1500, 60);
    const menu = await waitFor(() => {
      const menus = visibleSelectMenus();
      const matchingMenu = menus.find((node) => optionsInMenu(node).some((option) => (
        XynigoPurchaseCore.optionMatches(option.textContent, value)
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
        return rect.width > 0 && rect.height > 0 && XynigoPurchaseCore.optionMatches(node.textContent, value);
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
    option.click();
    const matched = await waitFor(
      () => XynigoPurchaseCore.optionMatches(field.value, value),
      5000,
      120,
    );
    await waitFor(() => control.getAttribute('aria-expanded') !== 'true', 2000, 80);
    return matched ? { ok: true } : { ok: false, error: step.label + ' 选择后回读不一致' };
  }

  function verifyField(step, value) {
    if (!value && step.optional) return true;
    const field = findFieldByLabel(step.fieldLabels);
    if (!field) return false;
    if (field.getAttribute('aria-invalid') === 'true') return false;
    if (typeof field.checkValidity === 'function' && !field.checkValidity()) return false;
    const actual = String(field.value || '');
    if (step.type === 'phone') {
      return actual.replace(/\D/g, '').endsWith(String(value).replace(/\D/g, ''));
    }
    if (step.type === 'select') {
      return XynigoPurchaseCore.optionMatches(actual, value);
    }
    return XynigoPurchaseCore.normalizeText(actual) === XynigoPurchaseCore.normalizeText(value);
  }

  function stepByKey(key) {
    return FIELD_STEPS.find((step) => step.key === key);
  }

  async function executeStep(step, values) {
    const value = values[step.key];
    statusByKey[step.key] = 'active';
    updateProgress();
    try {
      const result = verifyField(step, value)
        ? { ok: true, unchanged: true }
        : step.type === 'select'
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
      .filter((step) => !verifyField(step, values[step.key]));
    if (!retrySteps.length) return;

    setNotice('检测到文本字段被页面重置，正在逐项重试…', 'neutral');
    for (const step of retrySteps) {
      const result = await executeStep(step, values);
      results.set(result.key, result);
      await sleep(160);
    }
  }

  async function runFill() {
    if (running || !selectedTask) return;
    if (!CHECKOUT_PATH.test(location.pathname)) {
      setNotice('请先进入 SHEIN 结算地址页', 'error');
      return;
    }
    running = true;
    statusByKey = {};
    renderSelectedTask();
    updateProgress();
    setNotice('正在按任务唯一键临时读取收件信息…', 'neutral');
    let recipient = null;
    try {
      const response = await sendMessage({ type: 'GET_RECIPIENT', taskKey: selectedTask.taskKey });
      if (!response.ok || !response.recipient) {
        markExecutorDisconnected(response);
        throw new Error(response.error || '收件信息读取失败');
      }
      confirmExecutorConnected();
      recipient = response.recipient;
      const validation = XynigoPurchaseCore.validateRecipient(recipient);
      renderRecipientCard(recipient, validation.values);
      if (!validation.ok) throw new Error(validation.issues.join('；'));

      const results = new Map();
      setNotice('正在成组替换 Nombre / Apellido…', 'neutral');
      const nameResults = await fillNamePair(validation.values);
      nameResults.forEach((result) => results.set(result.key, result));

      setNotice('正在填写电话…', 'neutral');
      const identityResults = await executeStepsSequentially(PRE_LOCATION_TEXT_KEYS, validation.values);
      identityResults.forEach((result) => results.set(result.key, result));

      setNotice('正在填写邮编并等待自动补全…', 'neutral');
      const initialPostalResult = await executeStep(stepByKey('postalCode'), validation.values);
      results.set(initialPostalResult.key, initialPostalResult);

      const stateStep = stepByKey('state');
      const cityStep = stepByKey('city');
      if (results.get('postalCode')?.ok) {
        setNotice('正在等待邮编自动带出州和城市…', 'neutral');
        await waitFor(() => (
          verifyField(stateStep, validation.values.state)
          && verifyField(cityStep, validation.values.city)
        ), 3000, 120);
      }

      setNotice('正在核对州和城市，必要时回退到下拉选择…', 'neutral');
      const stateResult = await executeStep(stateStep, validation.values);
      results.set(stateResult.key, stateResult);
      await sleep(220);
      const cityResult = stateResult.ok || verifyField(cityStep, validation.values.city)
        ? await executeStep(cityStep, validation.values)
        : markDependencyError(cityStep, 'Estado 未完成，Ciudad 已跳过');
      results.set(cityResult.key, cityResult);
      await sleep(220);

      setNotice('正在最终核对邮编…', 'neutral');
      const postalResult = await executeStep(stepByKey('postalCode'), validation.values);
      results.set(postalResult.key, postalResult);

      setNotice('正在填写街道地址…', 'neutral');
      const addressResults = await Promise.all(
        POST_LOCATION_TEXT_KEYS.map((key) => executeStep(stepByKey(key), validation.values)),
      );
      addressResults.forEach((result) => results.set(result.key, result));

      await sleep(350);
      await retryMismatchedTextFields(results, validation.values);
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
      const failedSteps = FIELD_STEPS.filter((step) => statusByKey[step.key] === 'error');
      if (failedSteps.length) {
        const doneCount = FIELD_STEPS.length - failedSteps.length;
        const detail = failedSteps.map((step) => (
          step.label + '：' + (issues.get(step.key) || '未完成')
        )).join('；');
        setNotice(
          '已完成 ' + doneCount + ' / ' + FIELD_STEPS.length + '；' + detail + '。其他字段已保留，请人工处理或重试',
          'error',
        );
      } else {
        setNotice('地址字段回读一致。请人工补充 CURP，并核对后保存地址', 'success');
      }
    } catch (error) {
      setNotice(error && error.message ? error.message : '填写过程中发生异常', 'error');
    } finally {
      recipient = null;
      running = false;
      renderSelectedTask();
    }
  }

  function maybeMount() {
    if (!CHECKOUT_PATH.test(location.pathname)) return;
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
