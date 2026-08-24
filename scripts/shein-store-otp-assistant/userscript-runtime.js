'use strict';

(function exposeXynigoSheinOtpUserscriptRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XynigoSheinOtpUserscriptRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUserscriptRuntime() {
  'use strict';

  const SETTINGS_KEY = 'sheinOtpAssistantSettings';
  const DEFAULT_SETTINGS = Object.freeze({
    receiverUrl: '',
    pollIntervalMs: 2500,
    timeoutMs: 120000,
  });

  function asPromise(value) {
    return value && typeof value.then === 'function' ? value : Promise.resolve(value);
  }

  function storageGet(local, keys) {
    return new Promise((resolve) => local.get(keys, (values) => resolve(values || {})));
  }

  function storageSet(local, values) {
    return new Promise((resolve) => local.set(values, resolve));
  }

  function storageRemove(local, keys) {
    return new Promise((resolve) => local.remove(keys, resolve));
  }

  function installStorageBridge(root, adapters) {
    const listeners = new Set();

    async function read(keys) {
      if (keys === null || keys === undefined) {
        const value = await asPromise(adapters.getValue(SETTINGS_KEY));
        return value === undefined ? {} : { [SETTINGS_KEY]: value };
      }
      if (typeof keys === 'string') {
        const value = await asPromise(adapters.getValue(keys));
        return value === undefined ? {} : { [keys]: value };
      }
      if (Array.isArray(keys)) {
        const entries = await Promise.all(keys.map(async (key) => [key, await asPromise(adapters.getValue(key))]));
        return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
      }
      if (typeof keys === 'object') {
        const entries = await Promise.all(Object.entries(keys).map(async ([key, fallback]) => [
          key,
          await asPromise(adapters.getValue(key, fallback)),
        ]));
        return Object.fromEntries(entries);
      }
      return {};
    }

    function notify(changes) {
      listeners.forEach((listener) => {
        try {
          listener(changes, 'local');
        } catch (_error) {
          // A faulty listener must not block the content script.
        }
      });
    }

    function finish(promise, callback, fallback) {
      promise.then((value) => callback?.(value)).catch(() => callback?.(fallback));
    }

    const local = {
      get(keys, callback) {
        finish(read(keys), callback, {});
      },
      set(values, callback) {
        finish((async () => {
          const changes = {};
          for (const [key, newValue] of Object.entries(values || {})) {
            const oldValue = await asPromise(adapters.getValue(key));
            await asPromise(adapters.setValue(key, newValue));
            changes[key] = { oldValue, newValue };
          }
          if (Object.keys(changes).length) notify(changes);
        })(), callback);
      },
      remove(keys, callback) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        finish((async () => {
          const changes = {};
          for (const key of keyList.filter(Boolean)) {
            const oldValue = await asPromise(adapters.getValue(key));
            await asPromise(adapters.deleteValue(key));
            changes[key] = { oldValue, newValue: undefined };
          }
          if (Object.keys(changes).length) notify(changes);
        })(), callback);
      },
    };

    const storage = {
      local,
      onChanged: {
        addListener(listener) { listeners.add(listener); },
        removeListener(listener) { listeners.delete(listener); },
      },
    };

    return { local, storage };
  }

  async function readSettings(local) {
    const values = await storageGet(local, SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(values[SETTINGS_KEY] || {}) };
  }

  function responseContentType(rawHeaders) {
    return String(rawHeaders || '').match(/^content-type\s*:\s*([^\r\n]+)/im)?.[1]?.trim() || '';
  }

  function requestReceiver(adapters, url) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        adapters.xmlHttpRequest({
          method: 'GET',
          url,
          timeout: 12000,
          anonymous: true,
          headers: {
            Accept: 'application/json,text/plain,text/html;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache',
          },
          onload(response) {
            const status = Number(response?.status) || 0;
            if (status < 200 || status >= 300) {
              finish({ ok: false, error: `接码接口返回 HTTP ${status || '未知'}`, retryable: status >= 500 });
              return;
            }
            const rawText = String(response?.responseText || '');
            if (rawText.length > 500000) {
              finish({ ok: false, error: '接码接口返回内容过大', retryable: false });
              return;
            }
            finish({ ok: true, rawText, contentType: responseContentType(response?.responseHeaders) });
          },
          ontimeout() {
            finish({ ok: false, error: '请求接码接口超时', retryable: true });
          },
          onerror() {
            finish({ ok: false, error: '无法访问接码接口', retryable: true });
          },
          onabort() {
            finish({ ok: false, error: '接码接口请求已取消', retryable: true });
          },
        });
      } catch (_error) {
        finish({ ok: false, error: '无法访问接码接口', retryable: true });
      }
    });
  }

  async function fetchOtpSnapshot(core, local, adapters, explicitUrl) {
    const settings = await readSettings(local);
    const validation = core.validateReceiverUrl(explicitUrl || settings.receiverUrl);
    if (!validation.ok) return validation;

    const response = await requestReceiver(adapters, validation.url);
    if (!response.ok) return response;
    const parsed = core.parseReceiverResponse(response.rawText, response.contentType);
    return {
      ok: true,
      found: parsed.found,
      code: parsed.code,
      digits: parsed.digits,
      fingerprint: parsed.fingerprint,
      format: parsed.format,
    };
  }

  function installChromeBridge(root, adapters, core, version = '') {
    const bridge = installStorageBridge(root, adapters);
    const runtime = {
      ...(root.chrome?.runtime || {}),
      lastError: null,
      getManifest: () => ({
        name: 'Xynigo SHEIN 店铺接码助手',
        version,
        version_name: `${version}-tampermonkey`,
      }),
      sendMessage(message, callback) {
        const run = async () => {
          switch (message?.type) {
            case 'GET_STATUS': {
              const settings = await readSettings(bridge.local);
              return {
                ok: true,
                configured: Boolean(settings.receiverUrl),
                pollIntervalMs: settings.pollIntervalMs,
                timeoutMs: settings.timeoutMs,
              };
            }
            case 'GET_CONFIG': {
              const settings = await readSettings(bridge.local);
              return { ok: true, receiverUrl: settings.receiverUrl };
            }
            case 'SAVE_CONFIG': {
              const validation = core.validateReceiverUrl(message.receiverUrl);
              if (!validation.ok) return validation;
              await storageSet(bridge.local, {
                [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, receiverUrl: validation.url },
              });
              return { ok: true };
            }
            case 'CLEAR_CONFIG':
              await storageRemove(bridge.local, SETTINGS_KEY);
              return { ok: true };
            case 'TEST_RECEIVER': {
              const snapshot = await fetchOtpSnapshot(core, bridge.local, adapters, message.receiverUrl);
              if (!snapshot.ok) return snapshot;
              return { ok: true, found: snapshot.found, digits: snapshot.digits, format: snapshot.format };
            }
            case 'FETCH_OTP':
              return fetchOtpSnapshot(core, bridge.local, adapters);
            default:
              return { ok: false, error: '不支持的操作' };
          }
        };

        run().then((response) => callback?.(response)).catch(() => {
          callback?.({ ok: false, error: '接码助手内部异常' });
        });
      },
    };

    const chromeBridge = { ...(root.chrome || {}), runtime, storage: bridge.storage };
    try {
      root.chrome = chromeBridge;
    } catch (_error) {
      Object.defineProperty(root, 'chrome', { configurable: true, value: chromeBridge });
    }
    return { ...bridge, runtime };
  }

  function injectCss(root, css, addStyle) {
    if (typeof addStyle === 'function') {
      addStyle(css);
      return;
    }
    const style = root.document?.createElement?.('style');
    if (!style) return;
    style.textContent = css;
    (root.document.head || root.document.documentElement)?.appendChild(style);
  }

  function sendRuntimeMessage(runtime, message) {
    return new Promise((resolve) => runtime.sendMessage(message, (response) => resolve(response || {})));
  }

  function registerMenus(root, runtime, adapters) {
    if (typeof adapters.registerMenuCommand !== 'function') return;

    adapters.registerMenuCommand('配置 SHEIN 接码链接', async () => {
      const receiverUrl = root.prompt?.(
        '请粘贴当前店铺的完整接码链接。为保护私密 key，已有配置不会显示；取消可保留原配置。',
        '',
      );
      if (receiverUrl === null || !String(receiverUrl).trim()) return;
      const result = await sendRuntimeMessage(runtime, { type: 'SAVE_CONFIG', receiverUrl });
      root.alert?.(result.ok ? '接码链接已保存。' : result.error || '接码链接保存失败。');
    });

    adapters.registerMenuCommand('测试 SHEIN 接码链接', async () => {
      const result = await sendRuntimeMessage(runtime, { type: 'TEST_RECEIVER' });
      if (!result.ok) {
        root.alert?.(result.error || '接码链接测试失败。');
        return;
      }
      root.alert?.(
        result.found
          ? `链接可访问，已识别 ${result.digits} 位验证码（验证码内容不显示）。`
          : '链接可访问，当前尚未检测到验证码。',
      );
    });

    adapters.registerMenuCommand('清除 SHEIN 接码链接', async () => {
      if (!root.confirm?.('确认清除当前浏览器环境保存的接码链接？')) return;
      await sendRuntimeMessage(runtime, { type: 'CLEAR_CONFIG' });
      root.alert?.('接码链接已清除。');
    });
  }

  function browserAdapters() {
    return {
      getValue: (...args) => GM_getValue(...args),
      setValue: (...args) => GM_setValue(...args),
      deleteValue: (...args) => GM_deleteValue(...args),
      addStyle: (...args) => GM_addStyle(...args),
      registerMenuCommand: (...args) => GM_registerMenuCommand(...args),
      xmlHttpRequest: (...args) => GM_xmlhttpRequest(...args),
    };
  }

  function boot(root, css, version, adapters) {
    const bridge = installChromeBridge(root, adapters, root.SheinOtpCore, version);
    injectCss(root, css, adapters.addStyle);
    registerMenus(root, bridge.runtime, adapters);
    return bridge;
  }

  return {
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    asPromise,
    browserAdapters,
    fetchOtpSnapshot,
    installChromeBridge,
    installStorageBridge,
    registerMenus,
    requestReceiver,
    responseContentType,
    boot,
  };
});
