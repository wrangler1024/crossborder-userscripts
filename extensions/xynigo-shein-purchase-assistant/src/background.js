'use strict';

importScripts('core.js');

const SETTINGS_KEY = 'xynigoPurchaseAssistantSettings';
const SESSION_KEY = 'xynigoPurchaseAssistantSession';
const XYNIGO_EXECUTOR_BASE_URL = 'http://xynigo.localhost:8766';
const PURCHASE_ASSISTANT_API_PREFIX = '/api/purchase-assistant/v1';
const DEFAULT_SETTINGS = Object.freeze({
  executorBaseUrl: XYNIGO_EXECUTOR_BASE_URL,
});

function isExtensionPage(sender) {
  const url = String(sender && sender.url ? sender.url : '');
  return url.startsWith('chrome-extension://' + chrome.runtime.id + '/');
}

function isAllowedSheinPage(sender) {
  const url = String(sender && sender.url ? sender.url : '');
  return /^https:\/\/(?:www|m)\.shein\.com\.mx\//i.test(url);
}

function validateExecutorBaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const loopback = ['127.0.0.1', 'localhost', 'xynigo.localhost'].includes(url.hostname);
    if (url.protocol !== 'http:' || !loopback || url.username || url.password || url.search || url.hash) {
      return { ok: false, error: '执行器地址必须是无凭证的本机 HTTP 地址' };
    }
    return { ok: true, url: url.origin };
  } catch {
    return { ok: false, error: '执行器地址格式不正确' };
  }
}

function migrateLegacyExecutorBaseUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const loopback = ['127.0.0.1', 'localhost', 'xynigo.localhost'].includes(url.hostname);
    if (loopback && (url.port === '8766' || url.port === '8767')) {
      return XYNIGO_EXECUTOR_BASE_URL;
    }
  } catch {
    return value;
  }
  return value;
}

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  settings.executorBaseUrl = migrateLegacyExecutorBaseUrl(settings.executorBaseUrl);
  return settings;
}

async function readSessionToken() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return String(stored[SESSION_KEY] || '');
}

async function saveSettings(input) {
  const checked = validateExecutorBaseUrl(input && input.executorBaseUrl);
  if (!checked.ok) return checked;
  const next = {
    executorBaseUrl: checked.url,
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  await chrome.storage.session.remove(SESSION_KEY);
  return { ok: true, settings: next };
}

async function storeSessionToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return { ok: false, error: '本地执行器返回的会话信息无效' };
  }
  await chrome.storage.session.set({ [SESSION_KEY]: token });
  return { ok: true, token };
}

async function fetchExecutor(url, token, pairing, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'X-Xynigo-Client': 'chrome-extension',
        ...(pairing ? { 'X-Xynigo-Pairing': 'auto' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.payload ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      },
      ...(options.payload ? { body: JSON.stringify(options.payload) } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload) {
      return {
        ok: false,
        error: payload && payload.error ? payload.error : '本地执行器返回异常',
        code: payload && payload.code ? payload.code : 'executor_error',
      };
    }
    return payload;
  } catch (error) {
    const detail = String(error && error.message ? error.message : '');
    const localAccessBlocked = /private network|local network|local access|blocked|permission/i.test(detail);
    return {
      ok: false,
      error: error && error.name === 'AbortError'
        ? '连接 Xynigo 主执行器超时'
        : (localAccessBlocked
          ? '团队偏好的“本地访问”未开启'
          : 'Xynigo 主执行器未运行；若终端已显示运行，请开启团队偏好的“本地访问”'),
      code: localAccessBlocked ? 'local_access_disabled' : 'executor_unreachable',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function acquireSessionToken(baseUrl) {
  const response = await fetchExecutor(
    baseUrl + PURCHASE_ASSISTANT_API_PREFIX + '/session', '', true);
  if (!response.ok) {
    return {
      ...response,
      error: response.error || '无法自动配对本地执行器',
      code: response.code || 'pairing_failed',
    };
  }
  return storeSessionToken(response.sessionToken);
}

async function ensureSessionToken(baseUrl, force) {
  if (!force) {
    const token = await readSessionToken();
    if (token) return { ok: true, token };
  }
  await chrome.storage.session.remove(SESSION_KEY);
  return acquireSessionToken(baseUrl);
}

async function requestExecutor(path, options = {}) {
  const settings = await readSettings();
  const checked = validateExecutorBaseUrl(settings.executorBaseUrl);
  if (!checked.ok) return checked;
  const endpoint = checked.url + PURCHASE_ASSISTANT_API_PREFIX + path;
  if (path === '/health') return fetchExecutor(endpoint, '', false);

  let session = await ensureSessionToken(checked.url, false);
  if (!session.ok) return session;
  let response = await fetchExecutor(endpoint, session.token, false, options);
  if (response.code === 'session_required') {
    session = await ensureSessionToken(checked.url, true);
    if (!session.ok) return session;
    response = await fetchExecutor(endpoint, session.token, false, options);
  }
  return response;
}

async function checkExecutorConnection() {
  const health = await requestExecutor('/health');
  if (!health.ok) return health;
  if (!health.configured) {
    return {
      ok: false,
      code: 'not_configured',
      error: 'Xynigo 主执行器尚未配置采购执行协作表',
    };
  }
  const settings = await readSettings();
  const checked = validateExecutorBaseUrl(settings.executorBaseUrl);
  if (!checked.ok) return checked;
  const session = await ensureSessionToken(checked.url, false);
  if (!session.ok) return session;
  const support = XynigoPurchaseCore.hubAutomationSupport(health);
  if (!support.supported) {
    return {
      ...health,
      paired: true,
      hubStudio: {
        available: false,
        clientRunning: false,
        localApiEnabled: false,
        authenticated: false,
        apiVersion: '',
        endpoint: '',
        reasonCode: support.reasonCode,
        message: support.message,
      },
    };
  }
  const capabilities = await requestExecutor('/capabilities');
  const capabilityError = capabilities.code === 'not_found'
    ? {
      reasonCode: 'executor_feature_inconsistent',
      message: 'Xynigo 主执行器功能声明不完整，请更新或重启主执行器',
    }
    : {
      reasonCode: capabilities.code || 'hubstudio_capability_unavailable',
      message: capabilities.error || 'HubStudio 能力状态暂不可用',
    };
  return {
    ...health,
    paired: true,
    hubStudio: capabilities.ok
      ? capabilities.hubStudio
      : {
        available: false,
        clientRunning: false,
        localApiEnabled: false,
        authenticated: false,
        apiVersion: '',
        endpoint: '',
        reasonCode: capabilityError.reasonCode,
        message: capabilityError.message,
      },
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    const extensionPage = isExtensionPage(sender);
    const sheinPage = isAllowedSheinPage(sender);
    switch (message && message.type) {
      case 'GET_SETTINGS':
        if (!extensionPage) return { ok: false, error: '无权读取插件配置' };
        return { ok: true, settings: await readSettings(), hasSession: Boolean(await readSessionToken()) };
      case 'SAVE_SETTINGS':
        if (!extensionPage) return { ok: false, error: '无权修改插件配置' };
        return saveSettings(message.settings);
      case 'EXECUTOR_HEALTH':
        if (!extensionPage && !sheinPage) return { ok: false, error: '不支持的来源' };
        return checkExecutorConnection();
      case 'LIST_TASKS': {
        if (!extensionPage && !sheinPage) return { ok: false, error: '不支持的来源' };
        const query = XynigoPurchaseCore.normalizeText(message.query).slice(0, 100);
        return requestExecutor('/tasks?query=' + encodeURIComponent(query));
      }
      case 'GET_RECIPIENT': {
        if (!sheinPage) return { ok: false, error: '只能在 SHEIN 页面读取收件信息' };
        const key = XynigoPurchaseCore.safeTaskKey(message.taskKey);
        if (!key) return { ok: false, error: '采购任务标识无效' };
        return requestExecutor('/tasks/' + encodeURIComponent(key) + '/recipient');
      }
      case 'HUB_ENV_LOCATE': {
        if (!sheinPage) return { ok: false, error: '只能在 SHEIN 页面定位 HubStudio 环境' };
        const identifier = String(message.identifier || '').trim().slice(0, 160);
        if (!identifier) return { ok: false, error: '请输入环境序号或 containerCode' };
        return requestExecutor('/hub/environments/locate?identifier=' + encodeURIComponent(identifier));
      }
      case 'HUB_ENV_CONTROL': {
        if (!sheinPage) return { ok: false, error: '只能在 SHEIN 页面操作 HubStudio 环境' };
        const action = String(message.action || '').trim().toLowerCase();
        const identifier = String(message.identifier || '').trim().slice(0, 160);
        if (!['open', 'close'].includes(action) || !identifier) {
          return { ok: false, error: 'HubStudio 环境操作参数无效' };
        }
        return requestExecutor('/hub/environments/' + action, {
          method: 'POST',
          payload: { identifier },
        });
      }
      case 'HUB_ENV_BATCH': {
        if (!sheinPage) return { ok: false, error: '只能在 SHEIN 页面操作 HubStudio 环境' };
        const action = String(message.action || '').trim().toLowerCase();
        const identifiers = Array.isArray(message.identifiers)
          ? message.identifiers.map((value) => String(value || '').trim().slice(0, 160)).filter(Boolean).slice(0, 20)
          : [];
        if (!['open', 'close'].includes(action) || !identifiers.length) {
          return { ok: false, error: 'HubStudio 批量操作参数无效' };
        }
        return requestExecutor('/hub/environments/batch', {
          method: 'POST',
          payload: { action, identifiers },
        });
      }
      default:
        return { ok: false, error: '不支持的操作' };
    }
  };

  run()
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: '插件后台异常' }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'open-purchase-assistant') return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== 'number') return;
    chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PURCHASE_ASSISTANT' }, () => {
      void chrome.runtime.lastError;
    });
  });
});
