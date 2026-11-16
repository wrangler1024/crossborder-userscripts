// ==UserScript==
// @name         领星 Vine 推广标注助手
// @namespace    crossborder-userscripts/lingxing-vine-promotion-assistant
// @version      0.1.4
// @description  只读检查领星 Vine 订单，人工确认后小批量标记推广并回读；Pending、取消和退款订单纳入检查
// @author       Samforo
// @homepageURL  https://github.com/wrangler1024/crossborder-userscripts/tree/main/extensions/lingxing-vine-promotion-assistant
// @supportURL   https://github.com/wrangler1024/crossborder-userscripts/issues
// @icon         https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/extensions/lingxing-vine-promotion-assistant/icons/icon128.png
// @match        https://erp.lingxing.com/erp/*
// @run-at       document-start
// @noframes
// @grant        none
// @updateURL    https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-vine-promotion-assistant/lingxing-vine-promotion-assistant.meta.js
// @downloadURL  https://raw.githubusercontent.com/wrangler1024/crossborder-userscripts/main/scripts/lingxing-vine-promotion-assistant/lingxing-vine-promotion-assistant.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (globalThis.__LINGXING_VINE_USERSCRIPT_STARTED__) return;
  globalThis.__LINGXING_VINE_USERSCRIPT_STARTED__ = true;

(function exposeLingxingVineCore(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LingxingVineCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createLingxingVineCore() {
  'use strict';

  const GATEWAY_ORIGIN = 'https://gw.lingxingerp.com';
  const ORDER_LIST_PATH = '/amz-order/api/order/OrderList';
  const SET_ASSESS_PATH = '/amz-order/api/order/setAssess';
  const VINE_PROMOTION_PREFIX = 'vine.enrollment.';
  const DEFAULT_RANGE_DAYS = 30;
  const MAX_RANGE_DAYS = 90;
  const PAGE_SIZE = 200;
  const MAX_PAGES = 50;
  const WRITE_CHUNK_SIZE = 20;

  const pad = (value) => String(value).padStart(2, '0');

  function clean(value) {
    return String(value ?? '').trim();
  }

  function formatLocalDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dateRange(days = DEFAULT_RANGE_DAYS, now = new Date()) {
    const normalizedDays = Math.min(MAX_RANGE_DAYS, Math.max(1, Number(days) || DEFAULT_RANGE_DAYS));
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (normalizedDays - 1));
    return {
      days: normalizedDays,
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(now),
    };
  }

  function promotionIdsOf(item) {
    if (Array.isArray(item?.promotionIds)) return item.promotionIds.map(clean).filter(Boolean);
    if (typeof item?.promotionIds === 'string') {
      return item.promotionIds.split(/[,|\s]+/).map(clean).filter(Boolean);
    }
    return [];
  }

  function vineItemsOf(order) {
    if (!Array.isArray(order?.slist)) return [];
    return order.slist.filter((item) => promotionIdsOf(item)
      .some((promotionId) => promotionId.startsWith(VINE_PROMOTION_PREFIX)));
  }

  function isVineOrder(order) {
    return vineItemsOf(order).length > 0;
  }

  function assessedValue(value) {
    return Number(value) === 1 ? 1 : 0;
  }

  function orderKey(order) {
    return [
      clean(order?.sid),
      clean(order?.amazonOrderId),
      clean(order?.purchaseDateLocal),
    ].join('|');
  }

  function normalizeOrder(order) {
    const vineItems = vineItemsOf(order);
    if (!vineItems.length) return null;

    const skuValues = [...new Set(vineItems.map((item) => clean(item.sellerSku || item.sku)).filter(Boolean))];
    const asinValues = [...new Set(vineItems.map((item) => clean(item.asin)).filter(Boolean))];
    const promotionIds = [...new Set(vineItems.flatMap(promotionIdsOf))];

    return {
      key: orderKey(order),
      sid: Number(order.sid),
      amazonOrderId: clean(order.amazonOrderId),
      purchaseDateLocal: clean(order.purchaseDateLocal),
      purchaseDate: clean(order.purchaseDate),
      market: clean(order.marketplace),
      store: clean(order.sellerName),
      status: clean(order.orderStatus),
      amount: clean(order.orderTotalAmount),
      sku: skuValues.join(' / '),
      asin: asinValues.join(' / '),
      productName: clean(vineItems[0]?.title || vineItems[0]?.productName),
      promotionIds,
      isAssessed: assessedValue(order.isAssessed),
      isPromotion: assessedValue(order.isPromotion),
      fulfillmentChannel: clean(order.fulfillmentChannel),
      lastUpdateDate: clean(order.lastUpdateDate),
    };
  }

  function classifyOrders(rows) {
    const seen = new Set();
    const vineOrders = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      if (!isVineOrder(row)) continue;
      const normalized = normalizeOrder(row);
      if (!normalized || !normalized.amazonOrderId || seen.has(normalized.key)) continue;
      seen.add(normalized.key);
      vineOrders.push(normalized);
    }

    const pendingOrders = vineOrders.filter((order) => order.isAssessed !== 1);
    return {
      vineOrders,
      pendingOrders,
      assessedOrders: vineOrders.filter((order) => order.isAssessed === 1),
      summary: {
        vineCount: vineOrders.length,
        assessedCount: vineOrders.length - pendingOrders.length,
        pendingCount: pendingOrders.length,
      },
    };
  }

  function buildOrderListPayload({ startDate, endDate, pageNo = 1, pageSize = PAGE_SIZE }) {
    return {
      startDate: clean(startDate),
      endDate: clean(endDate),
      sortField: 'purchaseDateLocal',
      sortType: 'desc',
      searchField: 'amazonOrderId',
      searchValue: '',
      exactSearch: 0,
      fulfillmentChannel: '',
      pageNo: Number(pageNo),
      pageSize: Number(pageSize),
      isMcfOrder: '0',
      req_time_sequence: String(pageNo),
    };
  }

  function extractOrderPage(response) {
    const data = response?.data;
    if (!response || response.code !== 1 || response.success === false) {
      throw new Error(clean(response?.msg || response?.message || '领星订单查询失败'));
    }
    if (!data || !Array.isArray(data.data)) {
      throw new Error('领星订单列表返回格式变化，已停止');
    }
    return {
      rows: data.data,
      total: Number(data.total) || 0,
      totalPages: Number(data.totalPages) || 0,
      pageNo: Number(data.pageNo) || 1,
      pageSize: Number(data.pageSize) || PAGE_SIZE,
      isLast: Boolean(data.isLast),
    };
  }

  function buildAssessPayload(orders) {
    if (!Array.isArray(orders) || !orders.length) throw new Error('本批没有可提交订单');
    if (orders.length > WRITE_CHUNK_SIZE) throw new Error(`单批最多 ${WRITE_CHUNK_SIZE} 笔，请拆分提交`);
    return orders.map((order) => {
      const sid = Number(order?.sid);
      const amazonOrderId = clean(order?.amazonOrderId);
      const purchaseDateLocal = clean(order?.purchaseDateLocal);
      if (!Number.isFinite(sid) || sid <= 0 || !amazonOrderId || !purchaseDateLocal) {
        throw new Error('订单缺少 sid、订单号或本地下单时间，已停止');
      }
      return { sid, amazonOrderId, purchaseDateLocal };
    });
  }

  function chunkOrders(orders, size = WRITE_CHUNK_SIZE) {
    const chunks = [];
    for (let index = 0; index < orders.length; index += size) {
      chunks.push(orders.slice(index, index + size));
    }
    return chunks;
  }

  function fingerprintOrders(orders) {
    return orders
      .map((order) => `${orderKey(order)}|${clean(order.sku)}|${clean(order.asin)}`)
      .sort()
      .join('\n');
  }

  function preflightSelection(snapshot, latestPending) {
    const expectedKeys = new Set((snapshot || []).map(orderKey));
    const latestKeys = new Set((latestPending || []).map(orderKey));
    const missing = [...expectedKeys].filter((key) => !latestKeys.has(key));
    const added = [...latestKeys].filter((key) => !expectedKeys.has(key));
    return {
      ok: expectedKeys.size > 0 && missing.length === 0,
      missing,
      added,
      expectedCount: expectedKeys.size,
      latestCount: latestKeys.size,
    };
  }

  function evaluateReadback(batch, latestVineOrders) {
    const byKey = new Map((latestVineOrders || []).map((order) => [orderKey(order), order]));
    return (batch || []).map((order) => {
      const latest = byKey.get(orderKey(order));
      if (!latest) {
        return { ...order, readback: 'missing', message: '回读未找到该订单' };
      }
      if (latest.isAssessed === 1) {
        return { ...order, readback: 'passed', message: 'isAssessed = 1' };
      }
      return { ...order, readback: 'pending', message: '仍为待标注，请人工核实' };
    });
  }

  function promotionTypeDefault() {
    return { promotionId: 0, typeName: '默认' };
  }

  function csvCell(value) {
    return `"${clean(value).replaceAll('"', '""')}"`;
  }

  function toCsv(rows) {
    return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function previewCsv(orders, generatedAt = new Date()) {
    return toCsv([
      ['生成时间', '市场', '店铺', '订单号', '订单状态', '金额', 'SKU', 'ASIN', '识别结果', '拟用推广类型'],
      ...(orders || []).map((order) => [
        generatedAt.toLocaleString('zh-CN', { hour12: false }),
        order.market,
        order.store,
        order.amazonOrderId,
        order.status,
        order.amount,
        order.sku,
        order.asin,
        'Vine 待标',
        '默认',
      ]),
    ]);
  }

  function executionCsv(execution) {
    const submitLabels = {
      accepted: '领星已受理',
      unknown: '结果待核实',
      'not-submitted': '未提交',
      pending: '待提交',
    };
    const readbackLabels = {
      passed: '核验通过',
      pending: '仍待标',
      missing: '回读未找到',
      unverified: '未回读',
    };
    return toCsv([
      ['批次号', '执行时间', '市场', '店铺', '订单号', '下单时间', '金额', '提交结果', '回读结果', '推广类型'],
      ...(execution?.items || []).map((item) => [
        execution.batchId,
        execution.startedAt,
        item.market,
        item.store,
        item.amazonOrderId,
        item.purchaseDateLocal,
        item.amount,
        submitLabels[item.submitResult] || '结果待核实',
        readbackLabels[item.readback] || '未回读',
        '默认',
      ]),
    ]);
  }

  function isOrderListUrl(value) {
    try {
      const url = new URL(value, 'https://erp.lingxing.com');
      return url.origin === 'https://erp.lingxing.com' && /^\/erp\/orderList\/?$/.test(url.pathname);
    } catch (_error) {
      return false;
    }
  }

  function uniqueMarkets(orders) {
    return [...new Set((orders || []).map((order) => clean(order.market)).filter(Boolean))].sort();
  }

  return {
    GATEWAY_ORIGIN,
    ORDER_LIST_PATH,
    SET_ASSESS_PATH,
    VINE_PROMOTION_PREFIX,
    DEFAULT_RANGE_DAYS,
    MAX_RANGE_DAYS,
    PAGE_SIZE,
    MAX_PAGES,
    WRITE_CHUNK_SIZE,
    dateRange,
    promotionIdsOf,
    vineItemsOf,
    isVineOrder,
    orderKey,
    normalizeOrder,
    classifyOrders,
    buildOrderListPayload,
    extractOrderPage,
    buildAssessPayload,
    chunkOrders,
    fingerprintOrders,
    preflightSelection,
    evaluateReadback,
    promotionTypeDefault,
    toCsv,
    previewCsv,
    executionCsv,
    isOrderListUrl,
    uniqueMarkets,
  };
});


(function runLingxingVinePageSession() {
  'use strict';

  if (window.top !== window.self) return;

  const CHANNEL = 'lingxing-vine-promotion-assistant';
  const GATEWAY_ORIGIN = 'https://gw.lingxingerp.com';
  const ORDER_LIST_PATH = '/amz-order/api/order/OrderList';
  const SET_ASSESS_PATH = '/amz-order/api/order/setAssess';
  const REQUEST_TIMEOUT_MS = 30000;
  const SESSION_HEADER_NAMES = new Set([
    'auth-token',
    'x-ak-company-id',
    'x-ak-uid',
    'x-ak-zid',
    'x-ak-version',
    'x-ak-env-key',
    'x-ak-language',
    'x-ak-platform',
    'x-ak-request-source',
    'x-ak-ad-page-name',
    'ak-client-type',
    'ak-origin',
  ]);

  const nativeFetch = window.fetch.bind(window);
  const xhrState = new WeakMap();
  const state = {
    headers: {},
    identity: '',
    scope: '',
    epoch: 0,
    ready: false,
    capturedAt: 0,
  };

  function post(message, targetOrigin = location.origin) {
    window.postMessage({
      channel: CHANNEL,
      direction: 'page-to-ui',
      ...message,
    }, targetOrigin);
  }

  function publicSessionState() {
    return {
      ready: state.ready,
      epoch: state.epoch,
      scope: state.scope,
      capturedAt: state.capturedAt,
    };
  }

  function broadcastSession() {
    post({ type: 'session-state', session: publicSessionState() });
  }

  function identityScope(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function captureSession(headers) {
    const nextHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
      const lowerName = name.toLowerCase();
      if (SESSION_HEADER_NAMES.has(lowerName) && value !== undefined && value !== null) {
        nextHeaders[lowerName] = String(value);
      }
    }

    if (!nextHeaders['auth-token'] || !nextHeaders['x-ak-company-id']) return;

    const identity = [
      nextHeaders['x-ak-company-id'],
      nextHeaders['x-ak-uid'],
      nextHeaders['x-ak-zid'],
    ].join('|');
    const changed = state.ready && state.identity !== identity;
    if (!state.ready || changed) state.epoch += 1;

    state.headers = nextHeaders;
    state.identity = identity;
    state.scope = identityScope(identity);
    state.ready = true;
    state.capturedAt = Date.now();

    if (!state.lastBroadcastEpoch || state.lastBroadcastEpoch !== state.epoch) {
      state.lastBroadcastEpoch = state.epoch;
      broadcastSession();
    }
  }

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
    let gatewayRequest = false;
    try {
      gatewayRequest = new URL(url, location.href).origin === GATEWAY_ORIGIN;
    } catch (_error) {
      gatewayRequest = false;
    }
    xhrState.set(this, { gatewayRequest, headers: {} });
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
    const requestState = xhrState.get(this);
    if (requestState?.gatewayRequest) {
      requestState.headers[String(name).toLowerCase()] = String(value);
    }
    return originalXhrSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function patchedSend(...args) {
    const requestState = xhrState.get(this);
    if (requestState?.gatewayRequest) captureSession(requestState.headers);
    return originalXhrSend.apply(this, args);
  };

  window.fetch = function patchedFetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      if (new URL(url, location.href).origin === GATEWAY_ORIGIN) {
        const headers = {};
        const sourceHeaders = new Headers(init?.headers || input?.headers || {});
        sourceHeaders.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        captureSession(headers);
      }
    } catch (_error) {
      // Page requests must continue unchanged.
    }
    return nativeFetch(input, init);
  };

  function sanitizeItem(item) {
    return {
      asin: String(item?.asin || ''),
      sellerSku: String(item?.sellerSku || ''),
      sku: String(item?.sku || ''),
      title: String(item?.title || ''),
      productName: String(item?.productName || ''),
      quantityOrdered: item?.quantityOrdered ?? null,
      promotionIds: Array.isArray(item?.promotionIds)
        ? item.promotionIds.map(String)
        : [],
    };
  }

  function sanitizeOrder(order) {
    return {
      amazonOrderId: String(order?.amazonOrderId || ''),
      sid: order?.sid,
      sellerName: String(order?.sellerName || ''),
      marketplace: String(order?.marketplace || ''),
      orderStatus: String(order?.orderStatus || ''),
      orderTotalAmount: String(order?.orderTotalAmount || ''),
      purchaseDateLocal: String(order?.purchaseDateLocal || ''),
      purchaseDate: String(order?.purchaseDate || ''),
      fulfillmentChannel: String(order?.fulfillmentChannel || ''),
      isAssessed: order?.isAssessed ?? null,
      isPromotion: order?.isPromotion ?? null,
      isReturn: order?.isReturn ?? null,
      isReturnOrder: order?.isReturnOrder ?? null,
      isReplacedOrder: order?.isReplacedOrder ?? null,
      isReplacementOrder: order?.isReplacementOrder ?? null,
      lastUpdateDate: String(order?.lastUpdateDate || ''),
      slist: Array.isArray(order?.slist) ? order.slist.map(sanitizeItem) : [],
    };
  }

  async function gatewayPost(path, body) {
    if (!state.ready) {
      throw new Error('领星会话尚未就绪，请刷新订单列表后再试');
    }
    if (![ORDER_LIST_PATH, SET_ASSESS_PATH].includes(path)) {
      throw new Error('扩展不允许调用该领星接口');
    }

    const epoch = state.epoch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await nativeFetch(`${GATEWAY_ORIGIN}${path}`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          ...state.headers,
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
          'x-ak-request-id': crypto.randomUUID(),
          'x-ak-request-source': state.headers['x-ak-request-source'] || 'erp',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      let data;
      try {
        data = await response.json();
      } catch (_error) {
        throw new Error(`领星返回了无效响应（HTTP ${response.status}）`);
      }

      if (state.epoch !== epoch) {
        throw new Error('领星登录账号已改变，请重新检查');
      }
      if (response.status === 401 || response.status === 403) {
        state.ready = false;
        broadcastSession();
      }
      if (!response.ok) {
        throw new Error(String(data?.msg || data?.message || `领星请求失败（HTTP ${response.status}）`).slice(0, 300));
      }
      return { httpStatus: response.status, data };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('领星请求超时，请稍后重试');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  }

  async function scanPage(payload) {
    const startDate = String(payload?.startDate || '');
    const endDate = String(payload?.endDate || '');
    const pageNo = Number(payload?.pageNo);
    const pageSize = Number(payload?.pageSize);
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      throw new Error('检查日期范围无效');
    }
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 50) {
      throw new Error('分页页码无效');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      throw new Error('分页大小无效');
    }

    const result = await gatewayPost(ORDER_LIST_PATH, {
      startDate,
      endDate,
      sortField: 'purchaseDateLocal',
      sortType: 'desc',
      searchField: 'amazonOrderId',
      searchValue: '',
      exactSearch: 0,
      fulfillmentChannel: '',
      pageNo,
      pageSize,
      isMcfOrder: '0',
      req_time_sequence: String(pageNo),
    });
    const data = result.data;
    if (data?.code !== 1 || !Array.isArray(data?.data?.data)) {
      throw new Error(String(data?.msg || data?.message || '领星订单列表返回格式变化'));
    }
    return {
      httpStatus: result.httpStatus,
      code: data.code,
      msg: String(data.msg || ''),
      data: {
        total: Number(data.data.total) || 0,
        totalPages: Number(data.data.totalPages) || 0,
        pageNo: Number(data.data.pageNo) || pageNo,
        pageSize: Number(data.data.pageSize) || pageSize,
        isLast: Boolean(data.data.isLast),
        data: data.data.data.map(sanitizeOrder),
      },
    };
  }

  async function markBatch(payload) {
    if (payload?.confirmed !== true) throw new Error('尚未完成人工确认');
    const orders = Array.isArray(payload?.orders) ? payload.orders : [];
    if (!orders.length || orders.length > 20) throw new Error('提交批次必须为 1 至 20 笔');

    const body = orders.map((order) => {
      const sid = Number(order?.sid);
      const amazonOrderId = String(order?.amazonOrderId || '').trim();
      const purchaseDateLocal = String(order?.purchaseDateLocal || '').trim();
      if (!Number.isFinite(sid) || sid <= 0 || !amazonOrderId || !purchaseDateLocal) {
        throw new Error('提交订单缺少必填字段');
      }
      return { sid, amazonOrderId, purchaseDateLocal };
    });
    return gatewayPost(SET_ASSESS_PATH, body);
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== 'ui-to-page') {
      return;
    }

    const { id, type, payload } = event.data;
    if (!id || !type) return;

    try {
      let result;
      if (type === 'session-status') {
        result = publicSessionState();
      } else if (type === 'scan-page') {
        result = await scanPage(payload);
      } else if (type === 'mark-batch') {
        result = await markBatch(payload);
      } else {
        throw new Error('不支持的扩展请求');
      }
      post({ id, ok: true, result });
    } catch (error) {
      post({ id, ok: false, error: String(error?.message || error || '领星请求失败').slice(0, 500) });
    }
  });

  post({ type: 'session-state', session: publicSessionState() });
})();


(function exposeLingxingVineUserscriptRuntime(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LingxingVineUserscriptRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntime() {
  'use strict';

  function createChromeShim(root = globalThis, options = {}) {
    const prefix = options.prefix || 'xynigo:lingxing-vine:';
    const memory = new Map();

    function storage() {
      try {
        return root.localStorage || null;
      } catch (_error) {
        return null;
      }
    }

    function allKeys() {
      const keys = new Set(memory.keys());
      const localStorage = storage();
      if (localStorage) {
        try {
          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length));
          }
        } catch (_error) {
          // Memory storage remains available when site storage is blocked.
        }
      }
      return [...keys];
    }

    function read(key) {
      const localStorage = storage();
      if (localStorage) {
        try {
          const raw = localStorage.getItem(prefix + key);
          if (raw !== null) return JSON.parse(raw);
        } catch (_error) {
          // Fall through to the in-memory value.
        }
      }
      return memory.get(key);
    }

    function write(key, value) {
      memory.set(key, value);
      const localStorage = storage();
      if (!localStorage) return;
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch (_error) {
        // Keep the in-memory value when quota or privacy settings reject persistence.
      }
    }

    function remove(key) {
      memory.delete(key);
      const localStorage = storage();
      if (!localStorage) return;
      try {
        localStorage.removeItem(prefix + key);
      } catch (_error) {
        // Memory value is already removed.
      }
    }

    function resolveKeys(keys) {
      if (keys === null || keys === undefined) {
        return { names: allKeys(), defaults: {} };
      }
      if (typeof keys === 'string') {
        return { names: [keys], defaults: {} };
      }
      if (Array.isArray(keys)) {
        return { names: keys.map(String), defaults: {} };
      }
      if (typeof keys === 'object') {
        return { names: Object.keys(keys), defaults: keys };
      }
      return { names: [], defaults: {} };
    }

    function get(keys, callback = () => {}) {
      const { names, defaults } = resolveKeys(keys);
      const result = {};
      for (const key of names) {
        const value = read(key);
        if (value !== undefined) result[key] = value;
        else if (Object.prototype.hasOwnProperty.call(defaults, key)) result[key] = defaults[key];
      }
      queueMicrotask(() => callback(result));
    }

    function set(values, callback = () => {}) {
      for (const [key, value] of Object.entries(values || {})) write(key, value);
      queueMicrotask(() => callback());
    }

    function clear(callback = () => {}) {
      for (const key of allKeys()) remove(key);
      queueMicrotask(() => callback());
    }

    return {
      storage: {
        local: {
          get,
          set,
          remove(keys, callback = () => {}) {
            const { names } = resolveKeys(keys);
            for (const key of names) remove(key);
            queueMicrotask(() => callback());
          },
          clear,
        },
        onChanged: {
          addListener() {},
          removeListener() {},
        },
      },
      runtime: {
        lastError: null,
        getURL(value) {
          return String(value || '');
        },
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
    };
  }

  return { createChromeShim };
});


  (async () => {
    if (!document.documentElement) {
      await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    globalThis.__LINGXING_VINE_CHROME__ = globalThis.LingxingVineUserscriptRuntime.createChromeShim(
      globalThis,
      { prefix: 'xynigo:lingxing-vine:' },
    );
    const __LINGXING_VINE_INLINE_CSS__ = ":host {\n  --ink: #262641;\n  --primary: #6552d9;\n  --strong: #5040b7;\n  --line: #dfdef0;\n  --surface: #f8f7fd;\n  --soft: #f0edfc;\n  --muted: #817b96;\n  --gradient: linear-gradient(115deg, #4d61db, #7050d8 65%, #8650cc);\n  --header-gradient: linear-gradient(115deg, #161e40, #2d2458 64%, #40265f);\n  --green: #278367;\n  --green-soft: #eaf6f0;\n  --amber: #ad751c;\n  --amber-soft: #fff3dd;\n  --red: #be514d;\n  --red-soft: #fcefeb;\n  all: initial;\n  color: var(--ink);\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Microsoft YaHei\",\n    \"PingFang SC\", \"Hiragino Sans GB\", sans-serif;\n}\n\n* {\n  box-sizing: border-box;\n}\n\nbutton,\ninput,\nselect {\n  font: inherit;\n}\n\nbutton {\n  cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n}\n\n[hidden] {\n  display: none !important;\n}\n\n.ico {\n  display: block;\n  width: 16px;\n  height: 16px;\n  flex: 0 0 16px;\n  fill: none;\n  stroke: currentColor;\n  stroke-width: 1.7;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n}\n\n.mono {\n  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;\n  letter-spacing: -.02em;\n}\n\n.muted {\n  color: var(--muted);\n}\n\n.grow {\n  flex: 1;\n}\n\n.launcher {\n  position: fixed;\n  z-index: 2147483600;\n  right: 14px;\n  top: 42%;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: max-content;\n  max-width: 52px;\n  height: 50px;\n  min-width: 0;\n  padding: 8px;\n  overflow: visible;\n  border: 1px solid rgba(107, 88, 208, .4);\n  border-radius: 999px 0 0 999px;\n  background: linear-gradient(135deg, #24224b, #4f3b8f);\n  box-shadow: 0 12px 36px rgba(24, 23, 58, .28);\n  color: #fff;\n  text-align: left;\n  cursor: grab;\n  touch-action: none;\n  user-select: none;\n  transition:\n    max-width .22s cubic-bezier(.2, .8, .2, 1),\n    padding .22s ease,\n    background .18s ease,\n    box-shadow .18s ease;\n}\n\n.launcher:hover,\n.launcher:focus-visible,\n.launcher.is-dragging {\n  max-width: 190px;\n  padding: 8px 12px 8px 8px;\n  background: linear-gradient(135deg, #2e2a60, #6246a8);\n  box-shadow: 0 14px 42px rgba(24, 23, 58, .36);\n}\n\n.launcher:active {\n  cursor: grabbing;\n}\n\n.launcher:focus-visible {\n  outline: 3px solid rgba(174, 233, 204, .42);\n  outline-offset: 3px;\n}\n\n.launcher-mark {\n  display: grid;\n  place-items: center;\n  width: 34px;\n  height: 34px;\n  flex: 0 0 34px;\n  border: 1px solid rgba(147, 219, 236, .55);\n  border-radius: 50%;\n  background: rgba(255, 255, 255, .08);\n  color: #aee9cc;\n}\n\n.launcher-mark .ico {\n  width: 21px;\n  height: 21px;\n}\n\n.launcher-copy {\n  display: grid;\n  gap: 1px;\n  max-width: 0;\n  min-width: 0;\n  overflow: hidden;\n  opacity: 0;\n  transform: translateX(5px);\n  transition:\n    max-width .2s cubic-bezier(.2, .8, .2, 1),\n    opacity .13s ease,\n    transform .2s ease;\n}\n\n.launcher:hover .launcher-copy,\n.launcher:focus-visible .launcher-copy,\n.launcher.is-dragging .launcher-copy {\n  max-width: 138px;\n  opacity: 1;\n  transform: translateX(0);\n}\n\n.launcher-copy b {\n  font-size: 12px;\n  font-weight: 650;\n  white-space: nowrap;\n}\n\n.launcher-copy small {\n  color: #cfc8e9;\n  font-size: 9px;\n  white-space: nowrap;\n}\n\n.launcher-count {\n  position: absolute;\n  top: -5px;\n  right: 6px;\n  display: grid;\n  place-items: center;\n  min-width: 19px;\n  height: 19px;\n  margin-left: 0;\n  padding: 0 5px;\n  border-radius: 999px;\n  background: #f1b84e;\n  color: #4e3712;\n  box-shadow: 0 3px 9px rgba(24, 23, 58, .3);\n  font-size: 9px;\n  font-weight: 800;\n}\n\n.launcher-count.is-zero {\n  background: #86d7b3;\n  color: #174b3b;\n}\n\n.backdrop {\n  position: fixed;\n  inset: 0;\n  z-index: 2147483601;\n  display: grid;\n  place-items: center;\n  padding: 18px;\n  background: rgba(17, 20, 37, .58);\n  backdrop-filter: blur(2px);\n}\n\n.panel {\n  width: min(1180px, calc(100vw - 36px));\n  height: min(880px, calc(100vh - 36px));\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  border: 1px solid #ccc8e6;\n  border-radius: 14px;\n  background: var(--surface);\n  box-shadow: 0 22px 74px rgba(23, 22, 55, .34);\n  animation: panel-in .25s cubic-bezier(.2, .8, .2, 1) both;\n}\n\n@keyframes panel-in {\n  from {\n    opacity: 0;\n    transform: translateY(9px) scale(.992);\n  }\n  to {\n    opacity: 1;\n    transform: translateY(0) scale(1);\n  }\n}\n\n.plugin-header {\n  height: 80px;\n  flex: 0 0 80px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 18px;\n  padding: 15px 22px;\n  border-bottom: 1px solid rgba(182, 160, 243, .3);\n  background: var(--header-gradient);\n  color: #fff;\n}\n\n.plugin-brand {\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n\n.brand-mark {\n  display: grid;\n  place-items: center;\n  width: 40px;\n  height: 40px;\n  flex: 0 0 40px;\n  border: 1.5px solid transparent;\n  border-radius: 50%;\n  background:\n    linear-gradient(145deg, #303a78, #332052) padding-box,\n    linear-gradient(135deg, #50c9ef, #8170f3, #b359e5) border-box;\n  box-shadow: 0 3px 14px rgba(19, 20, 44, .25);\n}\n\n.brand-mark .ico {\n  width: 24px;\n  height: 24px;\n  color: #f1edff;\n}\n\n.plugin-brand h1 {\n  margin: 0;\n  font-size: 20px;\n  font-weight: 650;\n  line-height: 1.35;\n  letter-spacing: .2px;\n}\n\n.plugin-brand small {\n  display: block;\n  margin-top: 3px;\n  color: #cbc9e9;\n  font-size: 11px;\n  letter-spacing: .25px;\n}\n\n.header-actions {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.prototype-badge {\n  padding: 3px 8px;\n  border: 1px solid rgba(186, 167, 237, .31);\n  border-radius: 4px;\n  background: rgba(185, 158, 229, .08);\n  color: #ded3f6;\n  font-size: 10px;\n  letter-spacing: .3px;\n}\n\n.connection-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  height: 30px;\n  padding: 0 10px;\n  border: 1px solid rgba(170, 196, 225, .25);\n  border-radius: 999px;\n  background: rgba(255, 255, 255, .06);\n  color: #d8e7f3;\n  font-size: 10px;\n  white-space: nowrap;\n}\n\n.connection-pill i {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: #e8ba56;\n  box-shadow: 0 0 0 3px rgba(232, 186, 86, .11);\n}\n\n.connection-pill.is-ready i {\n  background: #79d6b0;\n  box-shadow: 0 0 0 3px rgba(121, 214, 176, .11);\n}\n\n.header-button {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  height: 30px;\n  padding: 0 10px;\n  border: 1px solid rgba(168, 160, 206, .44);\n  border-radius: 7px;\n  background: rgba(169, 156, 221, .05);\n  color: #f5f2ff;\n  font-size: 11px;\n}\n\n.header-button:hover {\n  background: rgba(169, 156, 221, .14);\n}\n\n.header-icon {\n  display: grid;\n  place-items: center;\n  width: 30px;\n  height: 30px;\n  padding: 0;\n  border: 0;\n  border-radius: 7px;\n  background: transparent;\n  color: #bbb3d8;\n}\n\n.header-icon:hover {\n  background: rgba(169, 156, 221, .13);\n  color: #fff;\n}\n\n.header-icon .ico {\n  width: 17px;\n  height: 17px;\n}\n\n.toolbar {\n  flex: 0 0 auto;\n  padding: 12px 18px 9px;\n  border-bottom: 1px solid var(--line);\n  background: #fff;\n}\n\n.toolbar-row {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n}\n\n.field-label {\n  color: #8b819c;\n  font-size: 12px;\n}\n\n.range-select {\n  min-width: 128px;\n  height: 34px;\n  padding: 0 30px 0 10px;\n  border: 1px solid #d7d4eb;\n  border-radius: 7px;\n  background: #fff;\n  color: var(--ink);\n  font-size: 12px;\n}\n\n.schedule-note {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  color: #89819d;\n  font-size: 11px;\n  white-space: nowrap;\n}\n\n.schedule-note .ico {\n  width: 13px;\n  height: 13px;\n  color: #8c7dc2;\n}\n\n.button {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 7px;\n  height: 34px;\n  padding: 0 13px;\n  border: 1px solid #d7d4eb;\n  border-radius: 8px;\n  background: #fff;\n  color: var(--ink);\n  font-size: 12px;\n  line-height: 1.4;\n  white-space: nowrap;\n  transition: background .15s, border-color .15s, box-shadow .15s;\n}\n\n.button:hover {\n  border-color: #c1b7df;\n  background: #f1eefb;\n}\n\n.button.primary {\n  border-color: transparent;\n  background: var(--gradient);\n  color: #fff;\n  box-shadow: 0 3px 9px rgba(101, 82, 217, .18);\n}\n\n.button.primary:hover {\n  background: linear-gradient(115deg, #4256cd, #6442cb 65%, #7840bf);\n}\n\n.button.ghost {\n  border-color: transparent;\n  background: transparent;\n  color: #73698a;\n}\n\n.button.ghost:hover {\n  background: #ece8f7;\n  color: var(--strong);\n}\n\n.button:disabled {\n  cursor: not-allowed;\n  opacity: .42;\n  box-shadow: none;\n}\n\n.source-line {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  min-width: 0;\n  margin-top: 9px;\n  color: #8c849d;\n  font-size: 11px;\n}\n\n.source-kind {\n  display: grid;\n  place-items: center;\n  width: 30px;\n  height: 21px;\n  border: 1px solid #d8d5eb;\n  border-radius: 4px;\n  background: #f1eefb;\n  color: #6955b5;\n  font-size: 8px;\n  font-weight: 800;\n  letter-spacing: .06em;\n}\n\n.source-tick {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  color: #558874;\n  white-space: nowrap;\n}\n\n.source-tick .ico {\n  width: 12px;\n  height: 12px;\n}\n\n.source-divider {\n  color: #d0cadf;\n}\n\n.source-range {\n  margin-left: auto;\n  color: #9a92a9;\n  white-space: nowrap;\n}\n\n.workflow {\n  flex: 0 0 auto;\n  min-height: 54px;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 11px 20px;\n  border-bottom: 1px solid var(--line);\n  background: linear-gradient(100deg, #f4f3fd, #faf9ff);\n}\n\n.steps {\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.step {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  padding: 2px;\n  color: #9a92ab;\n  font-size: 12px;\n}\n\n.step b {\n  display: grid;\n  place-items: center;\n  width: 21px;\n  height: 21px;\n  border: 1px solid #d9d2e8;\n  border-radius: 50%;\n  font-size: 10px;\n  font-weight: 550;\n}\n\n.step.active {\n  color: #5e49b7;\n  font-weight: 600;\n}\n\n.step.active b {\n  border: 0;\n  background: #7358d5;\n  box-shadow: 0 0 0 3px #e8e2f8;\n  color: #fff;\n}\n\n.step.complete {\n  color: #8b7fa6;\n}\n\n.step.complete b {\n  border-color: transparent;\n  background: #e8e1f5;\n  color: #7b65ad;\n}\n\n.step-sep {\n  width: 28px;\n  height: 1px;\n  background: #ddd6ed;\n}\n\n.workflow-stats {\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  color: #958da4;\n  font-size: 11px;\n}\n\n.workflow-stats strong {\n  margin-right: 4px;\n  font-size: 15px;\n  font-variant-numeric: tabular-nums;\n}\n\n.workflow-stats .green {\n  color: var(--green);\n}\n\n.workflow-stats .amber {\n  color: var(--amber);\n}\n\n.rule-banner {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-height: 39px;\n  padding: 8px 20px;\n  border-bottom: 1px solid #ebe6f3;\n  background: #fff;\n  color: #9b91aa;\n  font-size: 10px;\n}\n\n.rule-banner strong {\n  color: #817393;\n  font-weight: 550;\n}\n\n.rule-chip {\n  padding: 2px 7px;\n  border: 1px solid #ece6f3;\n  border-radius: 999px;\n  background: #fbf9fe;\n  color: #9a8ca6;\n  white-space: nowrap;\n}\n\n.rule-chip.fixed {\n  border-color: #efe0bd;\n  background: #fff9eb;\n  color: #a88036;\n}\n\n.rule-source {\n  margin-left: auto;\n  color: #a59bad;\n  white-space: nowrap;\n}\n\n.session-banner,\n.resume-banner {\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 8px 20px;\n  border-bottom: 1px solid #efe3c9;\n  background: #fffaef;\n  color: #99702f;\n  font-size: 10px;\n}\n\n.session-banner .ico,\n.resume-banner .ico {\n  width: 14px;\n  height: 14px;\n  flex-basis: 14px;\n}\n\n.resume-banner {\n  border-bottom-color: #f0d7d3;\n  background: #fff5f2;\n  color: #9b514b;\n}\n\n.resume-banner button {\n  height: 26px;\n  margin-left: auto;\n  padding: 0 9px;\n  border: 1px solid #e5c0ba;\n  border-radius: 6px;\n  background: #fff;\n  color: #955149;\n  font-size: 10px;\n}\n\n.workspace {\n  flex: 1;\n  min-height: 0;\n  display: grid;\n  grid-template-columns: 248px minmax(0, 1fr);\n}\n\n.sidebar {\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  border-right: 1px solid var(--line);\n  background: #f4f3fb;\n}\n\n.sidebar-head {\n  padding: 14px 12px 9px;\n}\n\n.search-box {\n  height: 33px;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 0 9px;\n  border: 1px solid #dcd6e9;\n  border-radius: 7px;\n  background: #fff;\n}\n\n.search-box .ico {\n  width: 14px;\n  height: 14px;\n  color: #a69ab9;\n}\n\n.search-box input {\n  min-width: 0;\n  width: 100%;\n  padding: 0;\n  border: 0;\n  outline: 0;\n  background: transparent;\n  color: var(--ink);\n  font-size: 11px;\n}\n\n.search-box input::placeholder {\n  color: #aaa2b9;\n}\n\n.filters {\n  display: flex;\n  gap: 4px;\n  margin-top: 11px;\n  overflow-x: auto;\n  scrollbar-width: none;\n}\n\n.filters::-webkit-scrollbar {\n  display: none;\n}\n\n.filter-button {\n  min-width: 60px;\n  display: flex;\n  flex: 1 0 auto;\n  flex-direction: column;\n  gap: 0;\n  padding: 4px 7px;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: #9a90aa;\n  font-size: 10px;\n  line-height: 1.5;\n}\n\n.filter-button b {\n  font-size: 13px;\n  font-weight: 650;\n}\n\n.filter-button.active {\n  background: #eae4f7;\n  color: #6e51ba;\n}\n\n.list-label {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 2px 14px 7px;\n  color: #a39aaf;\n  font-size: 10px;\n}\n\n.record-list {\n  flex: 1;\n  overflow: auto;\n  padding: 0 9px 12px;\n  scrollbar-width: thin;\n  scrollbar-color: #d1c9e3 transparent;\n}\n\n.record {\n  position: relative;\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  margin-bottom: 7px;\n  padding: 10px 9px;\n  border: 1px solid #dfdaeb;\n  border-radius: 8px;\n  background: rgba(255, 255, 255, .72);\n  cursor: pointer;\n  transition: background .15s, border-color .15s;\n}\n\n.record:hover {\n  border-color: #c1b1e2;\n  background: #fcfaff;\n}\n\n.record.is-focused {\n  border-color: #8973de;\n  background: linear-gradient(115deg, #f3f1ff, #faf7ff);\n  box-shadow: inset 3px 0 #7e5cd7;\n}\n\n.record input {\n  width: 14px;\n  height: 14px;\n  margin: 3px 0 0;\n  accent-color: #7056d2;\n}\n\n.record-body {\n  flex: 1;\n  min-width: 0;\n}\n\n.record-title {\n  overflow: hidden;\n  margin-bottom: 3px;\n  color: #534c65;\n  font-size: 11px;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.record-sub {\n  overflow: hidden;\n  color: #9b91ab;\n  font-size: 9px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.record-bottom {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  margin-top: 6px;\n}\n\n.record-amount {\n  color: #8c7b99;\n  font-size: 9px;\n  font-variant-numeric: tabular-nums;\n}\n\n.sidebar-foot {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 9px 13px;\n  border-top: 1px solid #e0daec;\n  color: #8c809e;\n  font-size: 11px;\n}\n\n.sidebar-foot .ico {\n  width: 13px;\n  height: 13px;\n}\n\n.text-link {\n  padding: 0;\n  border: 0;\n  background: none;\n  color: #7964ad;\n  font-size: 10px;\n}\n\n.text-link:hover {\n  color: #5e45a3;\n}\n\n.main {\n  min-width: 0;\n  padding: 16px 20px 14px;\n  overflow: auto;\n  background: #fff;\n  scrollbar-width: thin;\n  scrollbar-color: #ddd5e9 transparent;\n}\n\n.detail-top {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  margin-bottom: 9px;\n}\n\n.eyebrow {\n  color: #a193b1;\n  font-size: 11px;\n  letter-spacing: .25px;\n}\n\n.detail-time {\n  color: #a89db7;\n  font-size: 10px;\n}\n\n.result-top {\n  display: flex;\n  align-items: center;\n  gap: 14px;\n  padding: 14px 16px;\n  border: 1px solid #e8e1f1;\n  border-radius: 9px;\n  background: linear-gradient(115deg, #f3f3fc, #f7f4fc);\n}\n\n.result-icon {\n  display: grid;\n  place-items: center;\n  width: 58px;\n  height: 58px;\n  flex: 0 0 58px;\n  border-radius: 10px;\n  background: #fff;\n  color: #8d71c8;\n}\n\n.result-icon .ico {\n  width: 31px;\n  height: 31px;\n}\n\n.result-copy {\n  min-width: 0;\n  flex: 1;\n}\n\n.result-copy h2 {\n  margin: 0;\n  color: #3f3952;\n  font-size: 20px;\n  font-weight: 600;\n  letter-spacing: -.02em;\n}\n\n.result-copy h2 strong {\n  color: #6246bd;\n  font-weight: 700;\n}\n\n.result-copy p {\n  margin: 5px 0 0;\n  color: #9487a2;\n  font-size: 10px;\n  line-height: 1.7;\n}\n\n.badge {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 2px 7px;\n  border-radius: 5px;\n  font-size: 10px;\n  font-weight: 500;\n  line-height: 1.6;\n  white-space: nowrap;\n}\n\n.badge.success {\n  background: var(--green-soft);\n  color: #287c61;\n}\n\n.badge.warn {\n  background: var(--amber-soft);\n  color: #a87520;\n}\n\n.badge.danger {\n  background: var(--red-soft);\n  color: #b55650;\n}\n\n.badge.violet {\n  background: #eee9fc;\n  color: #7055bf;\n}\n\n.dot {\n  width: 6px;\n  height: 6px;\n  display: inline-block;\n  flex: 0 0 6px;\n  border-radius: 50%;\n  background: currentColor;\n}\n\n.result-counters {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 10px;\n  margin: 12px 0;\n}\n\n.result-count {\n  padding: 10px 14px;\n  border: 1px solid #e6e0ef;\n  border-radius: 8px;\n  background: #fff;\n  color: #8f839c;\n  font-size: 10px;\n}\n\n.result-count b {\n  display: block;\n  margin-bottom: 1px;\n  color: #4e4562;\n  font-size: 24px;\n  font-weight: 550;\n  line-height: 1.2;\n  font-variant-numeric: tabular-nums;\n}\n\n.result-count.ok b {\n  color: var(--green);\n}\n\n.result-count.warn {\n  border-color: #f0e1c4;\n  background: #fffdf8;\n}\n\n.result-count.warn b {\n  color: var(--amber);\n}\n\n.source-panel {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  margin-bottom: 12px;\n  padding: 9px 12px;\n  border: 1px solid #eae3f4;\n  border-radius: 7px;\n  background: #faf8fd;\n  color: #a18daf;\n  font-size: 10px;\n  line-height: 1.7;\n}\n\n.source-panel .ico {\n  width: 14px;\n  height: 14px;\n  margin-top: 1px;\n  color: #ae97c5;\n}\n\n.source-panel b {\n  color: #8a70a0;\n  font-weight: 500;\n}\n\n.order-panel {\n  overflow: hidden;\n  border: 1px solid #e4ddec;\n  border-radius: 8px;\n}\n\n.section-heading {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 10px 13px;\n}\n\n.section-heading h3 {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  margin: 0;\n  color: #51475f;\n  font-size: 12px;\n  font-weight: 600;\n}\n\n.section-heading h3 .ico {\n  width: 15px;\n  height: 15px;\n  color: #9280b2;\n}\n\n.order-table-wrap {\n  overflow: auto;\n  border-top: 1px solid #eee8f4;\n}\n\n.order-table {\n  width: 100%;\n  border-collapse: collapse;\n  table-layout: fixed;\n  font-size: 10px;\n}\n\n.order-table th {\n  height: 36px;\n  padding: 0 10px;\n  border-bottom: 1px solid #eee8f4;\n  background: #f4f1fa;\n  color: #897d99;\n  font-size: 9px;\n  font-weight: 550;\n  text-align: left;\n  white-space: nowrap;\n}\n\n.order-table td {\n  padding: 9px 10px;\n  border-bottom: 1px solid #f0ebf5;\n  color: #81758d;\n  vertical-align: middle;\n}\n\n.order-table tr:last-child td {\n  border-bottom: 0;\n}\n\n.order-table tbody tr:hover td {\n  background: #fcfaff;\n}\n\n.order-table input[type=\"checkbox\"],\n.record input[type=\"checkbox\"] {\n  accent-color: #7056d2;\n}\n\n.market-tag {\n  display: inline-flex;\n  padding: 2px 5px;\n  border: 1px solid #e2dcef;\n  border-radius: 4px;\n  background: #faf8fd;\n  color: #8f7ca7;\n  font-size: 9px;\n  white-space: nowrap;\n}\n\n.order-id {\n  display: block;\n  overflow: hidden;\n  color: #584b67;\n  font-size: 10px;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.order-store,\n.order-sku {\n  display: block;\n  overflow: hidden;\n  margin-top: 2px;\n  color: #a397af;\n  font-size: 9px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.amount {\n  color: #6b5e78;\n  font-variant-numeric: tabular-nums;\n}\n\n.empty-state {\n  display: none;\n  padding: 40px 16px;\n  color: #aaa0b5;\n  font-size: 11px;\n  text-align: center;\n}\n\n.center-view {\n  min-height: 100%;\n  display: grid;\n  place-items: center;\n  padding: 28px;\n}\n\n.center-section {\n  width: min(640px, 100%);\n  text-align: center;\n}\n\n.scan-orbit {\n  position: relative;\n  width: 68px;\n  height: 68px;\n  margin: 0 auto 19px;\n  border: 1px solid #e4dcf3;\n  border-radius: 50%;\n  background: #f8f5fe;\n}\n\n.scan-orbit:before,\n.scan-orbit:after {\n  position: absolute;\n  inset: 9px;\n  border: 1px solid #d5c8ef;\n  border-radius: 50%;\n  content: \"\";\n}\n\n.scan-orbit:before {\n  border-color: transparent;\n  border-top-color: #7358d5;\n  animation: orbit 1.1s linear infinite;\n}\n\n.scan-orbit:after {\n  inset: 21px;\n  border: 0;\n  background: var(--gradient);\n  box-shadow: 0 0 0 8px rgba(115, 88, 213, .08);\n}\n\n@keyframes orbit {\n  to {\n    transform: rotate(360deg);\n  }\n}\n\n.center-section h2 {\n  margin: 0;\n  color: #443a55;\n  font-size: 19px;\n  font-weight: 600;\n}\n\n.center-section > p {\n  max-width: 520px;\n  margin: 7px auto 17px;\n  color: #9d91aa;\n  font-size: 11px;\n  line-height: 1.8;\n}\n\n.scan-steps {\n  display: grid;\n  gap: 8px;\n  max-width: 410px;\n  margin: 24px auto 0;\n  text-align: left;\n}\n\n.scan-step {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 9px 12px;\n  border: 1px solid #eee8f5;\n  border-radius: 7px;\n  background: #fcfbfe;\n  color: #a094ac;\n  font-size: 10px;\n}\n\n.scan-step span {\n  display: grid;\n  place-items: center;\n  width: 21px;\n  height: 21px;\n  border-radius: 50%;\n  background: #f0ebf7;\n  color: #9b8bad;\n  font-size: 9px;\n}\n\n.scan-step.is-active {\n  border-color: #dcd0f1;\n  background: #f7f3ff;\n  color: #705ba0;\n}\n\n.scan-step.is-active span {\n  background: #7258d4;\n  color: #fff;\n}\n\n.progress-card {\n  margin-top: 22px;\n  padding: 16px;\n  border: 1px solid #e6dff0;\n  border-radius: 9px;\n  background: #fff;\n  text-align: left;\n}\n\n.progress-meta,\n.progress-current {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n}\n\n.progress-meta {\n  margin-bottom: 10px;\n  color: #8e7d9e;\n  font-size: 10px;\n}\n\n.progress-meta strong {\n  color: #57456d;\n  font-size: 14px;\n  font-weight: 600;\n}\n\n.progress-track {\n  height: 7px;\n  overflow: hidden;\n  border-radius: 999px;\n  background: #eee9f7;\n}\n\n.progress-bar {\n  width: 0;\n  height: 100%;\n  border-radius: inherit;\n  background: var(--gradient);\n  transition: width .25s ease;\n}\n\n.progress-current {\n  margin-top: 9px;\n  color: #8d7a9b;\n  font-size: 10px;\n}\n\n.progress-current span {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.progress-current strong {\n  color: #7255b1;\n}\n\n.success-icon {\n  display: grid;\n  place-items: center;\n  width: 72px;\n  height: 72px;\n  margin: 0 auto 18px;\n  border-radius: 50%;\n  background: var(--green-soft);\n  color: var(--green);\n  box-shadow: 0 0 0 10px rgba(234, 245, 240, .65);\n}\n\n.success-icon.warn {\n  background: var(--amber-soft);\n  color: var(--amber);\n  box-shadow: 0 0 0 10px rgba(255, 243, 221, .65);\n}\n\n.success-icon .ico {\n  width: 34px;\n  height: 34px;\n}\n\n.success-result {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  margin: 13px 0 18px;\n  color: #568573;\n  font-size: 10px;\n}\n\n.success-result span {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 3px 8px;\n  border-radius: 999px;\n  background: #f1faf6;\n}\n\n.success-result .ico {\n  width: 11px;\n  height: 11px;\n}\n\n.success-table {\n  overflow: hidden;\n  border: 1px solid #e4ddec;\n  border-radius: 8px;\n  text-align: left;\n}\n\n.success-row {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) 120px 120px;\n  gap: 12px;\n  align-items: center;\n  min-height: 44px;\n  padding: 8px 12px;\n  border-bottom: 1px solid #eee8f3;\n  color: #796a85;\n  font-size: 10px;\n}\n\n.success-row:last-child {\n  border-bottom: 0;\n}\n\n.success-row strong {\n  overflow: hidden;\n  color: #544565;\n  font-size: 11px;\n  font-weight: 600;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.success-row span {\n  color: #9789a3;\n}\n\n.success-row .badge {\n  justify-self: end;\n}\n\n.plugin-footer {\n  min-height: 76px;\n  flex: 0 0 auto;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 13px 19px;\n  border-top: 1px solid var(--line);\n  background: #f8f6fd;\n}\n\n.selection-info {\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  gap: 9px;\n}\n\n.select-icon {\n  display: grid;\n  place-items: center;\n  width: 32px;\n  height: 32px;\n  flex: 0 0 32px;\n  border-radius: 8px;\n  background: #ede7fb;\n  color: #8b6dc9;\n}\n\n.select-icon .ico {\n  width: 17px;\n  height: 17px;\n}\n\n.selection-copy {\n  min-width: 0;\n}\n\n.selection-copy strong {\n  display: block;\n  color: #817090;\n  font-size: 12px;\n  font-weight: 500;\n}\n\n.selection-copy strong b {\n  margin: 0 2px;\n  color: #7051b2;\n  font-size: 16px;\n  font-weight: 650;\n}\n\n.selection-copy small {\n  display: block;\n  overflow: hidden;\n  margin-top: 1px;\n  color: #b0a0bd;\n  font-size: 10px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.footer-actions {\n  display: flex;\n  align-items: center;\n  gap: 9px;\n}\n\n.footer-actions .button {\n  height: 36px;\n}\n\n.footer-actions .primary {\n  padding-left: 18px;\n  padding-right: 16px;\n}\n\n.footer-actions .primary .ico {\n  width: 14px;\n  height: 14px;\n  margin-left: 3px;\n}\n\ndialog {\n  width: 580px;\n  max-width: calc(100vw - 40px);\n  max-height: calc(100vh - 44px);\n  margin: auto;\n  padding: 0;\n  overflow: auto;\n  border: 1px solid #d6ceea;\n  border-radius: 12px;\n  background: #fff;\n  box-shadow: 0 22px 65px rgba(36, 29, 67, .3);\n  color: var(--ink);\n}\n\ndialog::backdrop {\n  background: rgba(32, 27, 60, .44);\n  backdrop-filter: blur(2px);\n}\n\n.dialog-header {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 17px 20px 14px;\n  border-bottom: 1px solid #e9e2f0;\n}\n\n.dialog-header h2 {\n  margin: 0;\n  color: #443852;\n  font-size: 16px;\n  font-weight: 620;\n}\n\n.dialog-header p {\n  margin: 3px 0 0;\n  color: #a190af;\n  font-size: 11px;\n}\n\n.dialog-close {\n  display: grid;\n  place-items: center;\n  width: 28px;\n  height: 28px;\n  flex: 0 0 28px;\n  padding: 0;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: #a294b0;\n}\n\n.dialog-close:hover {\n  background: #f2edf8;\n  color: #705c83;\n}\n\n.dialog-body {\n  padding: 19px 20px;\n}\n\n.dialog-footer {\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 13px 20px;\n  border-top: 1px solid var(--line);\n  background: #fbf9fd;\n}\n\n.confirmation-summary {\n  display: flex;\n  align-items: center;\n  gap: 13px;\n  padding: 15px;\n  border: 1px solid #e5daf4;\n  border-radius: 8px;\n  background: #f3eefb;\n}\n\n.confirmation-summary .ico {\n  width: 28px;\n  height: 28px;\n  flex: 0 0 28px;\n  color: #8c6bc3;\n}\n\n.confirmation-summary strong {\n  display: block;\n  color: #7d5ead;\n  font-size: 14px;\n  font-weight: 500;\n}\n\n.confirmation-summary strong b {\n  margin: 0 3px;\n  font-size: 23px;\n  font-weight: 650;\n}\n\n.confirmation-summary small {\n  display: block;\n  margin-top: 2px;\n  color: #ad96c0;\n  font-size: 10px;\n}\n\n.review-list {\n  margin-top: 12px;\n  color: #9e8bab;\n  font-size: 11px;\n  line-height: 2.2;\n}\n\n.review-row {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 3px 0;\n  border-bottom: 1px solid #f1eaf7;\n}\n\n.review-row b {\n  max-width: 72%;\n  color: #897098;\n  font-weight: 500;\n  text-align: right;\n}\n\n.review-orders {\n  max-height: 130px;\n  overflow: auto;\n  margin-top: 10px;\n  padding: 9px 11px;\n  border: 1px solid #eee7f5;\n  border-radius: 7px;\n  background: #fcfbfe;\n  scrollbar-width: thin;\n}\n\n.review-order {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 4px 0;\n  color: #8f829b;\n  font-size: 10px;\n}\n\n.review-order .mono {\n  color: #655473;\n}\n\n.confirm-check {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  margin-top: 16px;\n  color: #8f7b9e;\n  font-size: 11px;\n}\n\n.confirm-check input {\n  width: 14px;\n  height: 14px;\n  margin-top: 2px;\n  accent-color: #7056d2;\n}\n\n.confirm-check small {\n  display: block;\n  margin-top: 3px;\n  color: #b7a4c5;\n  font-size: 10px;\n}\n\n.dialog-tip {\n  margin: 12px 0 0;\n  color: #a796b3;\n  font-size: 10px;\n  line-height: 1.7;\n}\n\n.history-list {\n  display: grid;\n  gap: 8px;\n}\n\n.history-item {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 14px;\n  padding: 11px 12px;\n  border: 1px solid #eee8f4;\n  border-radius: 7px;\n  background: #fcfbfe;\n}\n\n.history-item strong {\n  display: block;\n  color: #746580;\n  font-size: 11px;\n  font-weight: 550;\n}\n\n.history-item span {\n  display: block;\n  margin-top: 3px;\n  color: #a99dad;\n  font-size: 9px;\n}\n\n.history-empty {\n  padding: 34px 12px;\n  color: #a99caf;\n  font-size: 11px;\n  text-align: center;\n}\n\n.toast {\n  position: fixed;\n  z-index: 2147483647;\n  left: 50%;\n  bottom: 34px;\n  max-width: min(480px, calc(100vw - 32px));\n  padding: 9px 15px;\n  border: 1px solid rgba(191, 180, 225, .34);\n  border-radius: 8px;\n  background: rgba(39, 31, 62, .94);\n  box-shadow: 0 10px 34px rgba(23, 18, 40, .28);\n  color: #fff;\n  font-size: 11px;\n  line-height: 1.55;\n  opacity: 0;\n  pointer-events: none;\n  transform: translate(-50%, 8px);\n  transition: opacity .18s, transform .18s;\n}\n\n.toast.show {\n  opacity: 1;\n  transform: translate(-50%, 0);\n}\n\n@media (max-width: 980px) {\n  .workspace {\n    grid-template-columns: 210px minmax(0, 1fr);\n  }\n\n  .source-range,\n  .rule-source {\n    display: none;\n  }\n\n  .prototype-badge {\n    display: none;\n  }\n}\n\n@media (max-width: 820px) {\n  .backdrop {\n    padding: 8px;\n  }\n\n  .panel {\n    width: calc(100vw - 16px);\n    height: calc(100vh - 16px);\n    border-radius: 10px;\n  }\n\n  .plugin-header {\n    height: 72px;\n    flex-basis: 72px;\n    padding: 12px 14px;\n  }\n\n  .plugin-brand h1 {\n    font-size: 17px;\n  }\n\n  .plugin-brand small {\n    font-size: 9px;\n  }\n\n  .connection-pill,\n  .header-button {\n    display: none;\n  }\n\n  .toolbar {\n    padding-right: 14px;\n    padding-left: 14px;\n  }\n\n  .field-label,\n  .range-select {\n    display: none;\n  }\n\n  .source-range {\n    display: none;\n  }\n\n  .workflow {\n    padding-right: 14px;\n    padding-left: 14px;\n  }\n\n  .workflow-stats {\n    display: none;\n  }\n\n  .step-sep {\n    width: 12px;\n  }\n\n  .rule-banner {\n    padding-right: 14px;\n    padding-left: 14px;\n    overflow-x: auto;\n  }\n\n  .workspace {\n    grid-template-columns: 190px minmax(0, 1fr);\n  }\n\n  .main {\n    padding: 13px 12px;\n  }\n\n  .result-icon {\n    display: none;\n  }\n\n  .result-copy h2 {\n    font-size: 16px;\n  }\n\n  .result-counters {\n    gap: 6px;\n  }\n\n  .result-count {\n    padding: 9px 10px;\n  }\n\n  .result-count b {\n    font-size: 19px;\n  }\n\n  .plugin-footer {\n    padding-right: 12px;\n    padding-left: 12px;\n  }\n\n  .select-icon {\n    display: none;\n  }\n\n  .selection-copy small {\n    max-width: 245px;\n  }\n\n  .footer-actions .ghost {\n    display: none;\n  }\n\n  .footer-actions .button {\n    padding-right: 10px;\n    padding-left: 10px;\n    font-size: 10px;\n  }\n\n  .order-table th:nth-child(2),\n  .order-table td:nth-child(2),\n  .order-table th:nth-child(4),\n  .order-table td:nth-child(4),\n  .order-table th:nth-child(7),\n  .order-table td:nth-child(7) {\n    display: none;\n  }\n\n  .order-table th:first-child,\n  .order-table td:first-child {\n    width: 5% !important;\n    padding-right: 0;\n    padding-left: 12px;\n  }\n}\n\n@media (max-width: 650px) {\n  .workspace {\n    grid-template-columns: 1fr;\n  }\n\n  .sidebar {\n    display: none;\n  }\n\n  .steps {\n    gap: 7px;\n  }\n\n  .step {\n    font-size: 10px;\n  }\n\n  .step-sep {\n    width: 8px;\n  }\n\n  .rule-chip:nth-of-type(2) {\n    display: none;\n  }\n\n  .selection-copy small {\n    max-width: 185px;\n  }\n\n  .order-table th:nth-child(2),\n  .order-table td:nth-child(2),\n  .order-table th:nth-child(4),\n  .order-table td:nth-child(4),\n  .order-table th:nth-child(7),\n  .order-table td:nth-child(7) {\n    display: none;\n  }\n\n  .order-table th:first-child,\n  .order-table td:first-child {\n    width: 5% !important;\n    padding-right: 0;\n    padding-left: 12px;\n  }\n\n  .success-row {\n    grid-template-columns: minmax(0, 1fr) 100px;\n  }\n\n  .success-row span:nth-child(2) {\n    display: none;\n  }\n\n  .launcher {\n    right: 8px;\n    max-width: 48px;\n    height: 48px;\n  }\n\n  .launcher:hover,\n  .launcher:focus-visible,\n  .launcher.is-dragging {\n    max-width: 174px;\n  }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  *,\n  *:before,\n  *:after {\n    animation-duration: .01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: .01ms !important;\n    scroll-behavior: auto !important;\n  }\n}\n";

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

  })().catch((error) => {
    console.error('[Vine 推广标注助手] 油猴版初始化失败', error);
  });
})();
