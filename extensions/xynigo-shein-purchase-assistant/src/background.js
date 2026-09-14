'use strict';

importScripts('core.js');

const SETTINGS_KEY = 'xynigoPurchaseAssistantSettings';
const SESSION_KEY = 'xynigoPurchaseAssistantSession';
const PURCHASE_ASSISTANT_API_PREFIX = '/api/purchase-assistant/v1';
const EXECUTOR_DISCOVERY_PORTS = Object.freeze(
  Array.from({ length: 10 }, (_value, index) => 8765 + index),
);
const EXECUTOR_DISCOVERY_HOSTS = Object.freeze([
  'xynigo.localhost',
  '127.0.0.1',
  'localhost',
]);
const DEFAULT_SETTINGS = Object.freeze({
  executorBaseUrl: '',
});

function isExtensionPage(sender) {
  const url = String(sender && sender.url ? sender.url : '');
  return url.startsWith('chrome-extension://' + chrome.runtime.id + '/');
}

function isAllowedSheinPage(sender) {
  const url = String(sender && sender.url ? sender.url : '');
  return Boolean(XynigoPurchaseCore.siteFromUrl(url));
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

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const legacy = stored[SETTINGS_KEY] || {};
  const checked = validateExecutorBaseUrl(legacy.executorBaseUrl);
  const settings = {
    ...DEFAULT_SETTINGS,
    executorBaseUrl: checked.ok ? checked.url : '',
  };
  if (legacy.personalSheetUrl || Object.keys(legacy).some(
    (key) => !Object.prototype.hasOwnProperty.call(settings, key))) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }
  return settings;
}

async function readSessionToken() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return String(stored[SESSION_KEY] || '');
}

async function storeSessionToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return { ok: false, error: '本地执行器返回的会话信息无效' };
  }
  await chrome.storage.session.set({ [SESSION_KEY]: token });
  return { ok: true, token };
}

function executorCandidateUrls(preferred, hostname) {
  const candidates = [];
  if (preferred) candidates.push(preferred);
  for (const port of EXECUTOR_DISCOVERY_PORTS) {
    candidates.push('http://' + hostname + ':' + port);
  }
  return [...new Set(candidates)];
}

async function rememberExecutorBaseUrl(url) {
  const settings = await readSettings();
  if (settings.executorBaseUrl === url) return;
  await chrome.storage.local.set({ [SETTINGS_KEY]: { executorBaseUrl: url } });
  await chrome.storage.session.remove(SESSION_KEY);
}

let recentExecutor = null;
async function discoverExecutorBaseUrl(force = false) {
  if(!force && recentExecutor && Date.now()-recentExecutor.at<5000) return recentExecutor.value;
  const settings = await readSettings();
  const preferred = force ? '' : settings.executorBaseUrl;
  if (preferred) {
    const health = await fetchExecutor(
      preferred + PURCHASE_ASSISTANT_API_PREFIX + '/health', '', false,
      { timeoutMs: 1200 },
    );
    if (health.ok && health.service === 'xynigo-sourcing') {
      const value={ ok: true, url: preferred, health };
      recentExecutor={at:Date.now(),value};return value;
    }
  }
  const preferredHost = preferred ? new URL(preferred).hostname : '';
  const hosts = preferredHost
    ? [preferredHost, ...EXECUTOR_DISCOVERY_HOSTS.filter((item) => item !== preferredHost)]
    : [...EXECUTOR_DISCOVERY_HOSTS];
  for (const hostname of hosts) {
    const candidates = executorCandidateUrls('', hostname)
      .filter((url) => url !== preferred);
    const probes = await Promise.all(candidates.map(async (url) => ({
      url,
      health: await fetchExecutor(
        url + PURCHASE_ASSISTANT_API_PREFIX + '/health', '', false,
        { timeoutMs: 1200 },
      ),
    })));
    const found = probes.find((item) => (
      item.health.ok && item.health.service === 'xynigo-sourcing'
    ));
    if (found) {
      await rememberExecutorBaseUrl(found.url);
      const value={ ok: true, url: found.url, health: found.health };
      recentExecutor={at:Date.now(),value};return value;
    }
  }
  return {
    ok: false,
    code: 'executor_unreachable',
    error: 'Xynigo 本地执行器未运行，已自动检查 8765–8774 端口',
  };
}

async function fetchExecutor(url, token, pairing, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(120000, Number(options.timeoutMs) || 12000)),
  );
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
  const discovered = await discoverExecutorBaseUrl(false);
  if (!discovered.ok) return discovered;
  const endpoint = discovered.url + PURCHASE_ASSISTANT_API_PREFIX + path;
  if (path === '/health') return discovered.health;

  let session = await ensureSessionToken(discovered.url, false);
  if (!session.ok) return session;
  let response = await fetchExecutor(endpoint, session.token, false, options);
  if (response.code === 'session_required') {
    session = await ensureSessionToken(discovered.url, true);
    if (!session.ok) return session;
    response = await fetchExecutor(endpoint, session.token, false, options);
  }
  if(response.code === 'executor_unreachable') recentExecutor=null;
  return response;
}

function sourceApiResponse(response) {
  if (response && response.code === 'not_found') {
    return {
      ok: false,
      code: 'source_api_unavailable',
      error: '当前 Xynigo 主执行器版本过旧，请先更新执行器',
    };
  }
  return response;
}

async function checkExecutorConnection() {
  const health = await requestExecutor('/health');
  if (!health.ok) return health;
  const desktopSupport = XynigoPurchaseCore.desktopDataSourceSupport(health);
  if (!desktopSupport.supported) {
    return {
      ok: false,
      executorReachable: true,
      code: desktopSupport.reasonCode,
      error: desktopSupport.message,
      version: health.version || '',
    };
  }
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
  if (!capabilities.ok) {
    return {
      ok: false,
      executorReachable: true,
      code: capabilities.code || 'executor_not_ready',
      error: capabilities.error || 'Xynigo 桌面客户端尚未就绪',
      version: health.version || '',
    };
  }
  const source = await requestExecutor('/data-source');
  if (!source.ok) {
    return {
      ok: false,
      executorReachable: true,
      code: source.code || 'data_source_unavailable',
      error: source.error || '当前采购员尚未配置收件信息数据源',
      settingsUrl: source.settingsUrl || health.settingsUrl || 'xynigo://settings',
      version: health.version || '',
    };
  }
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
    executorReachable: true,
    settingsUrl: health.settingsUrl || 'xynigo://settings',
    source: source.source,
    hubStudio: capabilities.hubStudio || {
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

function safeContainerCode(value) {
  return XynigoPurchaseCore.safeContainerCode(value);
}

function withContainerContext(path, value) {
  const containerCode = safeContainerCode(value);
  if (!containerCode) return path;
  return path + (path.includes('?') ? '&' : '?')
    + 'containerCode=' + encodeURIComponent(containerCode);
}

async function openDesktopSettings() {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: 'xynigo://settings' }, () => {
      if (!chrome.runtime.lastError) {
        resolve({ ok: true });
        return;
      }
      discoverExecutorBaseUrl(false).then((discovered) => {
        if (!discovered.ok) {
          resolve(discovered);
          return;
        }
        chrome.tabs.create({
          url: discovered.url + '/desktop/?view=sources',
        }, () => resolve(chrome.runtime.lastError
          ? { ok: false, error: '无法打开 Xynigo 桌面设置' }
          : { ok: true }));
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    const extensionPage = isExtensionPage(sender);
    const sheinPage = isAllowedSheinPage(sender);
    switch (message && message.type) {
      case 'REMEMBER_PURCHASE_TASK': {
        if (!sheinPage || !Number.isInteger(sender.tab?.id)) return {ok:false,error:'来源无效'};
        const task = message.task || {};
        if (!/^PT1-[0-9a-f]{64}$/.test(task.taskKey || '')) return {ok:false,error:'任务无效'};
        await chrome.storage.session.set({['purchaseTask:' + sender.tab.id]: {
          taskKey:task.taskKey,salesOrderNo:String(task.salesOrderNo || '').slice(0,100),
          origin:new URL(sender.url).origin,at:Date.now()}});
        return {ok:true};
      }
      case 'RESTORE_PURCHASE_TASK': {
        if (!sheinPage || !Number.isInteger(sender.tab?.id)) return {ok:false};
        const key = 'purchaseTask:' + sender.tab.id;
        const task = (await chrome.storage.session.get(key))[key];
        return {ok:true, task: task && task.origin === new URL(sender.url).origin && Date.now()-task.at<1800000 ? task : null};
      }
      case 'PURCHASE_DETAILS': {
        if (!sheinPage || !Number.isInteger(sender.tab?.id)) return {ok:false,error:'只能从采购页面操作'};
        if (!['read','submit','status','retry-image','retry-color'].includes(message.action)) return {ok:false,error:'操作无效'};
        const payload = {action:message.action};
        if(message.action === 'read') {
          if (!/^https:\/\/www\.shein\.com\.mx\/user\/orders\/detail\/[A-Za-z0-9-]+$/.test(sender.url)) return {ok:false,error:'首版仅支持墨西哥站订单详情'};
          Object.assign(payload,{taskKey:message.taskKey,identifier:String(message.identifier||'').slice(0,160),marker:message.marker,pageUrl:sender.url});
        } else Object.assign(payload,{captureId:message.captureId,confirmed:message.confirmed===true,reason:String(message.reason||'').slice(0,300)});
        if(message.async===true) payload.async=true;
        if(message.fillColor!==undefined){
          if(!['','#E2F0D9','#DDEBF7','#FFF2CC','#FCE4D6','#F4DCE6','#E4DFEC','#DDF2EF'].includes(message.fillColor)) return {ok:false,error:'填色无效'};
          payload.fillColor=message.fillColor;
        }
        return requestExecutor('/purchase-details',{method:'POST',payload,timeoutMs:message.action==='read'?105000:30000});
      }
      case 'GET_SETTINGS':
        if (!extensionPage) return { ok: false, error: '无权读取插件配置' };
        return { ok: true, settings: await readSettings(), hasSession: Boolean(await readSessionToken()) };
      case 'GET_DATA_SOURCE':
        if (!extensionPage && !sheinPage) return { ok: false, error: '无权读取数据源状态' };
        return sourceApiResponse(await requestExecutor(withContainerContext(
          '/data-source', message.containerCode,
        )));
      case 'OPEN_DESKTOP_SETTINGS':
        if (!extensionPage && !sheinPage) return { ok: false, error: '不支持的来源' };
        return openDesktopSettings();
      case 'EXECUTOR_HEALTH':
        if (!extensionPage && !sheinPage) return { ok: false, error: '不支持的来源' };
        return message.light ? requestExecutor('/health') : checkExecutorConnection();
      case 'LIST_TASKS': {
        if (!extensionPage && !sheinPage) return { ok: false, error: '不支持的来源' };
        const query = XynigoPurchaseCore.normalizeText(message.query).slice(0, 100);
        return requestExecutor(withContainerContext(
          '/tasks?query=' + encodeURIComponent(query), message.containerCode,
        ));
      }
      case 'GET_RECIPIENT': {
        if (!sheinPage) return { ok: false, error: '只能在 SHEIN 页面读取收件信息' };
        const key = XynigoPurchaseCore.safeTaskKey(message.taskKey);
        if (!key) return { ok: false, error: '采购任务标识无效' };
        return requestExecutor(withContainerContext(
          '/tasks/' + encodeURIComponent(key) + '/recipient',
          message.containerCode,
        ));
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
