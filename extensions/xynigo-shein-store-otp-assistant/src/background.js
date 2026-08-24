'use strict';

importScripts('otp-core.js');

const SETTINGS_KEY = 'sheinOtpAssistantSettings';
const DEFAULT_SETTINGS = Object.freeze({
  receiverUrl: '',
  pollIntervalMs: 2500,
  timeoutMs: 120000,
});

function isExtensionPage(sender) {
  return String(sender && sender.url ? sender.url : '').startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

async function saveSettings(receiverUrl) {
  const validation = SheinOtpCore.validateReceiverUrl(receiverUrl);
  if (!validation.ok) return validation;
  const nextSettings = { ...DEFAULT_SETTINGS, receiverUrl: validation.url };
  await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
  return { ok: true };
}

async function fetchOtpSnapshot(explicitUrl) {
  const settings = await readSettings();
  const validation = SheinOtpCore.validateReceiverUrl(explicitUrl || settings.receiverUrl);
  if (!validation.ok) return validation;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(validation.url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,text/html;q=0.9,*/*;q=0.8',
      },
    });
    if (!response.ok) {
      return { ok: false, error: `接码接口返回 HTTP ${response.status}`, retryable: response.status >= 500 };
    }
    const rawText = await response.text();
    if (rawText.length > 500000) {
      return { ok: false, error: '接码接口返回内容过大', retryable: false };
    }
    const parsed = SheinOtpCore.parseReceiverResponse(rawText, response.headers.get('content-type'));
    return {
      ok: true,
      found: parsed.found,
      code: parsed.code,
      digits: parsed.digits,
      fingerprint: parsed.fingerprint,
      format: parsed.format,
    };
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return {
      ok: false,
      error: timedOut ? '请求接码接口超时' : '无法访问接码接口',
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message && message.type) {
      case 'GET_STATUS': {
        const settings = await readSettings();
        return {
          ok: true,
          configured: Boolean(settings.receiverUrl),
          pollIntervalMs: settings.pollIntervalMs,
          timeoutMs: settings.timeoutMs,
        };
      }
      case 'GET_CONFIG': {
        if (!isExtensionPage(sender)) return { ok: false, error: '无权读取插件配置' };
        const settings = await readSettings();
        return { ok: true, receiverUrl: settings.receiverUrl };
      }
      case 'SAVE_CONFIG': {
        if (!isExtensionPage(sender)) return { ok: false, error: '无权修改插件配置' };
        return saveSettings(message.receiverUrl);
      }
      case 'CLEAR_CONFIG': {
        if (!isExtensionPage(sender)) return { ok: false, error: '无权修改插件配置' };
        await chrome.storage.local.remove(SETTINGS_KEY);
        return { ok: true };
      }
      case 'TEST_RECEIVER': {
        if (!isExtensionPage(sender)) return { ok: false, error: '无权测试接码链接' };
        const snapshot = await fetchOtpSnapshot(message.receiverUrl);
        if (!snapshot.ok) return snapshot;
        return { ok: true, found: snapshot.found, digits: snapshot.digits, format: snapshot.format };
      }
      case 'FETCH_OTP':
        return fetchOtpSnapshot();
      default:
        return { ok: false, error: '不支持的操作' };
    }
  };

  run()
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: '插件内部异常' }));
  return true;
});
