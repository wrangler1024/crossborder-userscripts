(function exposeXynigoDxmBackground(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.chrome?.runtime?.onMessage && root?.chrome?.storage) api.install(root.chrome);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXynigoDxmBackground() {
  'use strict';

  const CLOUD_API_BASE_URL = 'https://xynigo.samforo.icu';
  const AUTH_STATE_KEY = 'xynigoDxmCloudAuth';
  const STATUS_MESSAGE = 'xynigo-dxm:status';
  const AUTH_START_MESSAGE = 'xynigo-dxm:auth-start';
  const AUTH_POLL_MESSAGE = 'xynigo-dxm:auth-poll';
  const SAVE_DRAFT_MESSAGE = 'xynigo-dxm:save-draft';
  const SUBMIT_MESSAGE = 'xynigo-dxm:submit';
  const GET_ORDER_MESSAGE = 'xynigo-dxm:get-order';
  const REQUEST_TIMEOUT_MS = 20000;
  const TOKEN_RE = /^[A-Za-z0-9_-]{32,256}$/;
  const ALLOWED_LOGIN_HOSTS = new Set(['accounts.feishu.cn', 'xynigo.samforo.icu']);

  function storageArea(chromeApi) {
    if (!chromeApi.storage?.session) {
      throw new Error('当前浏览器不支持插件会话安全存储，请更新 Chrome/Comet');
    }
    return chromeApi.storage.session;
  }

  function storageGet(chromeApi, keys) {
    return new Promise((resolve, reject) => {
      storageArea(chromeApi).get(keys, (values) => {
        const error = chromeApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(values || {});
      });
    });
  }

  function storageSet(chromeApi, values) {
    return new Promise((resolve, reject) => {
      storageArea(chromeApi).set(values, () => {
        const error = chromeApi.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve();
      });
    });
  }

  async function loadAuthState(chromeApi) {
    const values = await storageGet(chromeApi, AUTH_STATE_KEY);
    const state = values[AUTH_STATE_KEY];
    return state && typeof state === 'object' ? state : {};
  }

  async function saveAuthState(chromeApi, state) {
    await storageSet(chromeApi, { [AUTH_STATE_KEY]: state || {} });
  }

  function validatedToken(value, message) {
    const token = String(value || '').trim();
    if (!TOKEN_RE.test(token)) throw new Error(message || 'Xynigo 登录会话无效');
    return token;
  }

  function publicIdentity(value) {
    if (!value || typeof value !== 'object'
      || !value.user || typeof value.user !== 'object'
      || !value.tenant || typeof value.tenant !== 'object'
      || !Array.isArray(value.roles)
      || !Array.isArray(value.permissions)) {
      throw new Error('Xynigo 返回了无效的成员信息');
    }
    return {
      user: {
        id: String(value.user.id || ''),
        name: String(value.user.name || '').slice(0, 255),
        avatarUrl: String(value.user.avatarUrl || '').slice(0, 2048),
        status: String(value.user.status || ''),
      },
      tenant: {
        id: String(value.tenant.id || ''),
        name: String(value.tenant.name || '').slice(0, 255),
      },
      roles: [...new Set(value.roles.map(String).filter(Boolean))].sort(),
      permissions: [...new Set(value.permissions.map(String).filter(Boolean))].sort(),
    };
  }

  async function requestJson(fetchImpl, path, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${CLOUD_API_BASE_URL}${path}`, {
        ...options,
        credentials: 'omit',
        headers: {
          Accept: 'application/json',
          'X-Xynigo-Source': 'extension_direct',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Xynigo 云端请求超时');
      throw new Error('无法连接 Xynigo 云端服务');
    } finally {
      clearTimeout(timer);
    }

    let body;
    try {
      body = await response.json();
    } catch (_error) {
      const error = new Error(response.ok
        ? `Xynigo 返回了无效响应（HTTP ${response.status || 0}）`
        : `Xynigo 云端服务异常（HTTP ${response.status || 0}）`);
      error.code = response.ok ? 'cloud_invalid_response' : 'cloud_http_error';
      error.status = response.status || 0;
      throw error;
    }
    if (!response.ok || body?.ok === false) {
      const detail = body?.detail && typeof body.detail === 'object' ? body.detail : {};
      const error = new Error(detail.message || body?.error || body?.message || `Xynigo 请求失败（${response.status}）`);
      error.code = detail.code || body?.code || 'XYNIGO_REQUEST_FAILED';
      error.status = response.status || 0;
      throw error;
    }
    return body;
  }

  function jsonRequestBody(payload) {
    return {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    };
  }

  async function authenticatedRequest(chromeApi, fetchImpl, path, options = {}) {
    const state = await loadAuthState(chromeApi);
    const sessionToken = validatedToken(
      state.sessionToken,
      '飞书登录已失效，请在插件中重新登录',
    );
    try {
      return await requestJson(fetchImpl, path, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${sessionToken}`,
        },
      });
    } catch (error) {
      const invalidSession = error?.status === 401
        || (error?.status === 403 && ['session_invalid', 'authentication_required', 'user_disabled', 'tenant_disabled'].includes(error?.code));
      if (invalidSession) await saveAuthState(chromeApi, {});
      throw error;
    }
  }

  async function status(chromeApi, fetchImpl) {
    const state = await loadAuthState(chromeApi);
    const pending = state.pending && typeof state.pending === 'object'
      && Number(state.pending.expiresAt || 0) > Date.now();
    if (!state.sessionToken) {
      return {
        apiBaseUrl: CLOUD_API_BASE_URL,
        authenticated: false,
        identity: null,
        code: 'authentication_required',
        message: '请使用飞书登录运营采购助手',
        loginPending: Boolean(pending),
      };
    }
    try {
      const identity = publicIdentity(await authenticatedRequest(chromeApi, fetchImpl, '/v1/auth/me'));
      await saveAuthState(chromeApi, { ...state, identity, pending: null });
      return {
        apiBaseUrl: CLOUD_API_BASE_URL,
        authenticated: true,
        identity,
        code: '',
        message: '',
        loginPending: false,
      };
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        return {
          apiBaseUrl: CLOUD_API_BASE_URL,
          authenticated: false,
          identity: null,
          code: error.code || 'authentication_required',
          message: error.message || '登录已失效，请重新登录',
          loginPending: false,
        };
      }
      throw error;
    }
  }

  async function startAuth(chromeApi, fetchImpl) {
    const started = await requestJson(
      fetchImpl,
      '/v1/auth/local/start',
      { method: 'POST', ...jsonRequestBody({}) },
    );
    const loginUrl = String(started.loginUrl || '').trim();
    let parsed;
    try {
      parsed = new URL(loginUrl);
    } catch (_error) {
      throw new Error('Xynigo 返回了无效的飞书登录地址');
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_LOGIN_HOSTS.has(parsed.hostname)
      || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
      throw new Error('Xynigo 返回了不可信的飞书登录地址');
    }
    const expiresIn = Number(started.expiresIn || 0);
    if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 600) {
      throw new Error('Xynigo 飞书登录有效期无效');
    }
    const pollToken = validatedToken(started.pollToken, 'Xynigo 飞书登录请求无效');
    await saveAuthState(chromeApi, {
      pending: { pollToken, expiresAt: Date.now() + (expiresIn * 1000) },
    });
    return { loginUrl, expiresIn };
  }

  async function pollAuth(chromeApi, fetchImpl) {
    const state = await loadAuthState(chromeApi);
    const pending = state.pending && typeof state.pending === 'object' ? state.pending : null;
    if (!pending || Number(pending.expiresAt || 0) <= Date.now()) {
      await saveAuthState(chromeApi, {});
      const error = new Error('飞书登录请求已过期，请重新发起');
      error.code = 'local_login_expired';
      throw error;
    }
    const result = await requestJson(
      fetchImpl,
      '/v1/auth/local/poll',
      {
        method: 'POST',
        ...jsonRequestBody({ pollToken: validatedToken(pending.pollToken) }),
      },
    );
    if (result.status === 'pending') return { status: 'pending' };
    if (result.status !== 'authenticated') {
      await saveAuthState(chromeApi, {});
      throw new Error('Xynigo 返回了无效的飞书登录状态');
    }
    const sessionToken = validatedToken(result.sessionToken, 'Xynigo 登录会话无效');
    const identity = publicIdentity(result.identity);
    await saveAuthState(chromeApi, { sessionToken, identity, pending: null });
    return { status: 'authenticated', identity };
  }

  async function purchaseRequest(chromeApi, fetchImpl, action, payload) {
    const paths = {
      draft: '/v1/purchase-orders/draft',
      submit: '/v1/purchase-orders/submit',
      get: '/v1/purchase-orders/get',
    };
    const path = paths[action];
    if (!path) throw new Error('采购接口动作无效');
    const requestPayload = action === 'get' ? { orderKey: payload } : payload;
    const body = await authenticatedRequest(
      chromeApi,
      fetchImpl,
      path,
      { method: 'POST', ...jsonRequestBody(requestPayload) },
    );
    if (!body.data || typeof body.data !== 'object') throw new Error('Xynigo 采购接口未返回有效数据');
    return body.data;
  }

  async function saveDraft(chromeApi, fetchImpl, draft) {
    if (!draft || typeof draft !== 'object' || !draft.orderKey) throw new Error('采购草稿数据无效');
    return purchaseRequest(chromeApi, fetchImpl, 'draft', draft);
  }

  async function submit(chromeApi, fetchImpl, draft) {
    if (!draft || typeof draft !== 'object' || !draft.orderKey) throw new Error('采购单数据无效');
    return purchaseRequest(chromeApi, fetchImpl, 'submit', draft);
  }

  async function getOrder(chromeApi, fetchImpl, orderKey) {
    const normalized = String(orderKey || '').trim();
    if (!normalized) throw new Error('采购单标识无效');
    return purchaseRequest(chromeApi, fetchImpl, 'get', normalized);
  }

  function install(chromeApi, fetchImpl = globalThis.fetch.bind(globalThis)) {
    chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const actions = {
        [STATUS_MESSAGE]: () => status(chromeApi, fetchImpl),
        [AUTH_START_MESSAGE]: () => startAuth(chromeApi, fetchImpl),
        [AUTH_POLL_MESSAGE]: () => pollAuth(chromeApi, fetchImpl),
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
            code: error?.code || 'XYNIGO_CLOUD_ERROR',
            message: error?.message || 'Xynigo 云端请求失败',
          },
        });
      });
      return true;
    });
  }

  return {
    AUTH_POLL_MESSAGE,
    AUTH_START_MESSAGE,
    AUTH_STATE_KEY,
    CLOUD_API_BASE_URL,
    GET_ORDER_MESSAGE,
    SAVE_DRAFT_MESSAGE,
    STATUS_MESSAGE,
    SUBMIT_MESSAGE,
    getOrder,
    install,
    pollAuth,
    purchaseRequest,
    requestJson,
    saveDraft,
    startAuth,
    status,
    submit,
  };
});
