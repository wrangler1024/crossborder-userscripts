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
