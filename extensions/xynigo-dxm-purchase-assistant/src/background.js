(function exposeXynigoDxmBackground(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.chrome?.runtime?.onMessage && root?.chrome?.storage?.local) {
    api.install(root.chrome);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXynigoDxmBackground() {
  'use strict';

  const SETTINGS_KEY = 'xynigoDxmPurchaseSettings';
  const CONNECT_MESSAGE = 'xynigo-dxm:connect';
  const STATUS_MESSAGE = 'xynigo-dxm:status';
  const SAVE_DRAFT_MESSAGE = 'xynigo-dxm:save-draft';
  const SUBMIT_MESSAGE = 'xynigo-dxm:submit';
  const GET_ORDER_MESSAGE = 'xynigo-dxm:get-order';
  const BRIDGE_APPROVED_MESSAGE = 'xynigo-dxm:bridge-approved';
  const DEFAULT_PORTS = Object.freeze(Array.from({ length: 15 }, (_item, index) => 8765 + index));
  const REQUEST_TIMEOUT_MS = 20000;
  const DISCOVERY_TIMEOUT_MS = 700;
  const TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;

  function normalizeApiBaseUrl(value) {
    const raw = String(value || '').trim();
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_error) {
      throw new Error('Xynigo 本机服务地址格式无效');
    }
    const port = parsed.port ? Number(parsed.port) : 80;
    if (parsed.protocol !== 'http:'
      || parsed.hostname !== '127.0.0.1'
      || !Number.isInteger(port)
      || port < 1
      || port > 65535
      || (parsed.pathname !== '/' && parsed.pathname !== '')
      || parsed.search
      || parsed.hash
      || parsed.username
      || parsed.password) {
      throw new Error('Xynigo 本机服务必须是 http://127.0.0.1:端口');
    }
    return `http://127.0.0.1:${port}`;
  }

  function normalizeBridgeToken(value) {
    const token = String(value || '').trim();
    if (!TOKEN_RE.test(token)) throw new Error('插件连接已失效，请重新连接 Xynigo');
    return token;
  }

  function storageGet(chromeApi, keys) {
    return new Promise((resolve, reject) => {
      chromeApi.storage.local.get(keys, (values) => {
        const error = chromeApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(values || {});
      });
    });
  }

  function storageSet(chromeApi, values) {
    return new Promise((resolve, reject) => {
      chromeApi.storage.local.set(values, () => {
        const error = chromeApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  async function loadBridgeSettings(chromeApi) {
    const values = await storageGet(chromeApi, SETTINGS_KEY);
    const settings = values[SETTINGS_KEY] || {};
    return {
      apiBaseUrl: normalizeApiBaseUrl(settings.apiBaseUrl),
      bridgeToken: normalizeBridgeToken(settings.bridgeToken),
    };
  }

  async function requestJson(fetchImpl, url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Xynigo 本机服务请求超时');
      throw new Error('无法连接 Xynigo 本机服务');
    } finally {
      clearTimeout(timer);
    }

    let body;
    try {
      body = await response.json();
    } catch (_error) {
      const contentType = response.headers?.get?.('content-type') || '未知类型';
      throw new Error(`Xynigo 返回了无效响应（HTTP ${response.status || 0}，${contentType}）`);
    }
    if (!response.ok || body?.ok === false) {
      const error = new Error(body?.error || body?.message || `Xynigo 请求失败（${response.status}）`);
      error.code = body?.code || 'XYNIGO_REQUEST_FAILED';
      error.status = response.status || 0;
      throw error;
    }
    return body;
  }

  function bridgeBody(chromeApi, settings, extra = {}) {
    return JSON.stringify({
      clientId: chromeApi.runtime.id,
      bridgeToken: settings.bridgeToken,
      ...extra,
    });
  }

  async function statusWithSettings(chromeApi, fetchImpl, settings) {
    const body = await requestJson(
      fetchImpl,
      `${settings.apiBaseUrl}/api/extension/v1/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: bridgeBody(chromeApi, settings),
      },
    );
    if (body.service !== 'xynigo-sourcing' || body.apiVersion !== 1) {
      throw new Error('连接的不是兼容版本 Xynigo');
    }
    return {
      apiBaseUrl: settings.apiBaseUrl,
      authenticated: Boolean(body.authenticated),
      identity: body.identity || null,
      code: body.code || '',
      message: body.message || '',
    };
  }

  async function status(chromeApi, fetchImpl) {
    return statusWithSettings(chromeApi, fetchImpl, await loadBridgeSettings(chromeApi));
  }

  async function purchaseRequest(chromeApi, fetchImpl, action, payload) {
    const settings = await loadBridgeSettings(chromeApi);
    const paths = {
      draft: '/api/extension/v1/purchase-orders/draft',
      submit: '/api/extension/v1/purchase-orders/submit',
      get: '/api/extension/v1/purchase-orders/get',
    };
    const path = paths[action];
    if (!path) throw new Error('采购接口动作无效');
    const extra = action === 'get' ? { orderKey: payload } : { draft: payload };
    const body = await requestJson(
      fetchImpl,
      `${settings.apiBaseUrl}${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: bridgeBody(chromeApi, settings, extra),
      },
    );
    if (!body.data || typeof body.data !== 'object') {
      throw new Error('Xynigo 采购接口未返回有效数据');
    }
    return body.data;
  }

  async function saveDraft(chromeApi, fetchImpl, draft) {
    if (!draft || typeof draft !== 'object' || !draft.orderKey) {
      throw new Error('采购草稿数据无效');
    }
    return purchaseRequest(chromeApi, fetchImpl, 'draft', draft);
  }

  async function submit(chromeApi, fetchImpl, draft) {
    if (!draft || typeof draft !== 'object' || !draft.orderKey) {
      throw new Error('采购单数据无效');
    }
    return purchaseRequest(chromeApi, fetchImpl, 'submit', draft);
  }

  async function getOrder(chromeApi, fetchImpl, orderKey) {
    const normalized = String(orderKey || '').trim();
    if (!normalized) throw new Error('采购单标识无效');
    return purchaseRequest(chromeApi, fetchImpl, 'get', normalized);
  }

  async function requestPairingAt(chromeApi, fetchImpl, apiBaseUrl) {
    const manifest = chromeApi.runtime.getManifest?.() || {};
    const body = await requestJson(
      fetchImpl,
      `${apiBaseUrl}/api/extension/v1/pair/request`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          clientId: chromeApi.runtime.id,
          clientVersion: manifest.version || '',
        }),
      },
      DISCOVERY_TIMEOUT_MS,
    );
    if (body.service !== 'xynigo-sourcing'
      || body.apiVersion !== 1
      || body.status !== 'approval-required') {
      throw new Error('本机端口不是兼容版本 Xynigo');
    }
    const approvalUrl = new URL(String(body.approvalUrl || ''));
    if (approvalUrl.origin !== apiBaseUrl || approvalUrl.pathname !== '/extension-connect') {
      throw new Error('Xynigo 返回了无效连接确认地址');
    }
    return { apiBaseUrl, approvalUrl: approvalUrl.href };
  }

  async function connect(chromeApi, fetchImpl) {
    const values = await storageGet(chromeApi, SETTINGS_KEY);
    const stored = values[SETTINGS_KEY] || {};
    const candidates = [];
    try {
      if (stored.apiBaseUrl) candidates.push(normalizeApiBaseUrl(stored.apiBaseUrl));
    } catch (_error) {
      // Ignore stale settings and continue with fixed loopback discovery.
    }
    DEFAULT_PORTS.forEach((port) => candidates.push(`http://127.0.0.1:${port}`));
    for (const candidate of [...new Set(candidates)]) {
      try {
        return await requestPairingAt(chromeApi, fetchImpl, candidate);
      } catch (_error) {
        // Discovery failures are expected for ports used by unrelated local services.
      }
    }
    throw new Error('未找到支持插件连接的 Xynigo，请先启动或更新 Xynigo');
  }

  function senderBaseUrl(sender) {
    let parsed;
    try {
      parsed = new URL(String(sender?.url || ''));
    } catch (_error) {
      throw new Error('Xynigo 连接页面来源无效');
    }
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') {
      throw new Error('只接受 Xynigo 本机连接页面');
    }
    return normalizeApiBaseUrl(parsed.origin);
  }

  function install(chromeApi, fetchImpl = globalThis.fetch.bind(globalThis)) {
    chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const actions = {
        [CONNECT_MESSAGE]: () => connect(chromeApi, fetchImpl),
        [STATUS_MESSAGE]: () => status(chromeApi, fetchImpl),
        [SAVE_DRAFT_MESSAGE]: () => saveDraft(chromeApi, fetchImpl, message.draft),
        [SUBMIT_MESSAGE]: () => submit(chromeApi, fetchImpl, message.draft),
        [GET_ORDER_MESSAGE]: () => getOrder(chromeApi, fetchImpl, message.orderKey),
      };
      const action = actions[message?.type];
      if (!action) return false;
      action().then((data) => sendResponse({ ok: true, data })).catch((error) => {
        sendResponse({
          ok: false,
          error: {
            code: error?.code || 'XYNIGO_BRIDGE_ERROR',
            message: error?.message || 'Xynigo 插件连接失败',
          },
        });
      });
      return true;
    });

    chromeApi.runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
      if (message?.type !== BRIDGE_APPROVED_MESSAGE) return false;
      (async () => {
        const apiBaseUrl = normalizeApiBaseUrl(message.apiBaseUrl);
        if (senderBaseUrl(sender) !== apiBaseUrl) {
          throw new Error('Xynigo 连接页面与服务地址不一致');
        }
        const settings = {
          apiBaseUrl,
          bridgeToken: normalizeBridgeToken(message.bridgeToken),
        };
        const connection = await statusWithSettings(chromeApi, fetchImpl, settings);
        await storageSet(chromeApi, { [SETTINGS_KEY]: settings });
        return connection;
      })().then((data) => sendResponse({ ok: true, data })).catch((error) => {
        sendResponse({ ok: false, error: error?.message || '插件连接确认失败' });
      });
      return true;
    });
  }

  return {
    BRIDGE_APPROVED_MESSAGE,
    CONNECT_MESSAGE,
    DEFAULT_PORTS,
    GET_ORDER_MESSAGE,
    SAVE_DRAFT_MESSAGE,
    STATUS_MESSAGE,
    SUBMIT_MESSAGE,
    connect,
    getOrder,
    install,
    normalizeApiBaseUrl,
    purchaseRequest,
    requestJson,
    saveDraft,
    status,
    submit,
  };
});
