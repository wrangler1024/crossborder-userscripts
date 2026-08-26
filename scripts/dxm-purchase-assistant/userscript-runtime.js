(function exposeXynigoDxmUserscriptRuntime(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XynigoDxmUserscriptRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUserscriptRuntime() {
  'use strict';

  const RECORD_PREFIX = 'xynigoDxmPurchaseRecord:';
  const STATUS_MESSAGE = 'xynigo-dxm:status';
  const AUTH_START_MESSAGE = 'xynigo-dxm:auth-start';
  const AUTH_POLL_MESSAGE = 'xynigo-dxm:auth-poll';
  const AUTH_LOGOUT_MESSAGE = 'xynigo-dxm:auth-logout';
  const POLL_INTERVAL_MS = 1200;

  function asPromise(value) {
    return value && typeof value.then === 'function' ? value : Promise.resolve(value);
  }

  function installStorageBridge(root, adapters, version = '') {
    const storageListeners = new Set();
    const messageListeners = new Set();
    const runtime = {
      ...(root.chrome?.runtime || {}),
      __xynigoDxmRuntime: 'userscript',
      lastError: null,
      getManifest: () => ({
        name: 'Xynigo 店小秘运营采购助手',
        version,
        version_name: `${version}-tampermonkey-cloud-login`,
      }),
      onMessage: {
        addListener(listener) { messageListeners.add(listener); },
        removeListener(listener) { messageListeners.delete(listener); },
      },
    };

    async function readAll() {
      const keys = await asPromise(adapters.listValues());
      const entries = await Promise.all((keys || []).map(async (key) => [
        key,
        await asPromise(adapters.getValue(key)),
      ]));
      return Object.fromEntries(entries);
    }

    async function read(keys) {
      if (keys === null || keys === undefined) return readAll();
      if (typeof keys === 'string') return { [keys]: await asPromise(adapters.getValue(keys)) };
      if (Array.isArray(keys)) {
        const entries = await Promise.all(keys.map(async (key) => [key, await asPromise(adapters.getValue(key))]));
        return Object.fromEntries(entries);
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

    function finish(promise, callback, fallback) {
      promise.then((value) => {
        runtime.lastError = null;
        callback?.(value);
      }).catch((error) => {
        runtime.lastError = error;
        callback?.(fallback);
        runtime.lastError = null;
      });
    }

    function notifyStorage(changes) {
      storageListeners.forEach((listener) => {
        try {
          listener(changes, 'local');
        } catch (_error) {
          // One listener must not prevent the others from receiving storage changes.
        }
      });
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
          if (Object.keys(changes).length) notifyStorage(changes);
        })(), callback);
      },
      remove(keys, callback) {
        const list = Array.isArray(keys) ? keys : [keys];
        finish((async () => {
          const changes = {};
          for (const key of list.filter(Boolean)) {
            const oldValue = await asPromise(adapters.getValue(key));
            await asPromise(adapters.deleteValue(key));
            changes[key] = { oldValue, newValue: undefined };
          }
          if (Object.keys(changes).length) notifyStorage(changes);
        })(), callback);
      },
    };

    runtime.sendMessage = (message, callback) => {
      let answered = false;
      let waiting = false;
      const sendResponse = (response) => {
        if (answered) return;
        answered = true;
        runtime.lastError = null;
        callback?.(response);
      };
      for (const listener of messageListeners) {
        try {
          waiting = listener(message, { id: 'tampermonkey-userscript' }, sendResponse) === true || waiting;
        } catch (error) {
          runtime.lastError = error;
          callback?.();
          runtime.lastError = null;
          return;
        }
        if (answered) return;
      }
      if (!waiting && !answered) {
        runtime.lastError = new Error('Xynigo 油猴云端运行桥未就绪');
        callback?.();
        runtime.lastError = null;
      }
    };

    const storage = {
      local,
      // Tampermonkey has no browser-session storage. The cloud expiry timestamp is
      // persisted with the short bearer and enforced before every request.
      session: local,
      onChanged: {
        addListener(listener) { storageListeners.add(listener); },
        removeListener(listener) { storageListeners.delete(listener); },
      },
    };
    const chromeBridge = { ...(root.chrome || {}), runtime, storage };
    try {
      root.chrome = chromeBridge;
    } catch (_error) {
      Object.defineProperty(root, 'chrome', { configurable: true, value: chromeBridge });
    }
    return { chrome: chromeBridge, local, storage, runtime, readAll };
  }

  function storageGet(local, keys) {
    return new Promise((resolve) => local.get(keys, (values) => resolve(values || {})));
  }

  function storageRemove(local, keys) {
    return new Promise((resolve) => local.remove(keys, resolve));
  }

  function injectCss(root, css, addStyle) {
    if (typeof addStyle === 'function') {
      addStyle(css);
      return;
    }
    const style = root.document?.createElement?.('style');
    if (!style) return;
    style.dataset.xynigoDxmUserscriptStyle = 'true';
    style.textContent = css;
    (root.document.head || root.document.documentElement)?.appendChild(style);
  }

  function downloadJson(root, filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function createGmFetch(request) {
    return function gmFetch(url, options = {}) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let handle;
        const fail = (message, name = 'Error') => {
          if (settled) return;
          settled = true;
          const error = new Error(message);
          error.name = name;
          reject(error);
        };
        const complete = (response) => {
          if (settled) return;
          settled = true;
          const status = Number(response?.status || 0);
          const responseText = String(response?.responseText || '');
          resolve({
            ok: status >= 200 && status < 300,
            status,
            async json() {
              if (!responseText && status === 204) return {};
              return JSON.parse(responseText);
            },
          });
        };
        try {
          handle = request({
            method: String(options.method || 'GET').toUpperCase(),
            url: String(url),
            headers: { ...(options.headers || {}) },
            data: options.body === undefined ? undefined : String(options.body),
            anonymous: true,
            timeout: 20000,
            onload: complete,
            onerror: () => fail('无法连接 Xynigo 云端服务'),
            ontimeout: () => fail('Xynigo 云端请求超时', 'AbortError'),
            onabort: () => fail('Xynigo 云端请求已取消', 'AbortError'),
          });
        } catch (_error) {
          fail('无法发起 Xynigo 云端请求');
          return;
        }
        if (options.signal) {
          const abort = () => {
            try { handle?.abort?.(); } catch (_error) { /* noop */ }
            fail('Xynigo 云端请求已取消', 'AbortError');
          };
          if (options.signal.aborted) abort();
          else options.signal.addEventListener('abort', abort, { once: true });
        }
      });
    };
  }

  function runtimeMessage(runtime, message) {
    return new Promise((resolve, reject) => {
      runtime.sendMessage(message, (response) => {
        const transportError = runtime.lastError;
        if (transportError) {
          reject(new Error(transportError.message || String(transportError)));
          return;
        }
        if (!response?.ok) {
          const error = new Error(response?.error?.message || 'Xynigo 云端请求失败');
          error.code = response?.error?.code || 'XYNIGO_CLOUD_ERROR';
          reject(error);
          return;
        }
        resolve(response.data || {});
      });
    });
  }

  function showNotice(root, adapters, text, title = 'Xynigo 运营采购助手') {
    if (typeof adapters.notify === 'function') {
      adapters.notify({ title, text, timeout: 8000 });
      return;
    }
    root.alert?.(text);
  }

  async function loginWithFeishu(root, runtime, adapters) {
    const started = await runtimeMessage(runtime, { type: AUTH_START_MESSAGE });
    const expiresIn = Math.max(60, Math.min(600, Number(started.expiresIn) || 300));
    if (typeof adapters.openInTab !== 'function') throw new Error('当前 Tampermonkey 不支持打开飞书登录页');
    adapters.openInTab(started.loginUrl, { active: true, insert: true, setParent: true });
    const deadline = Date.now() + (expiresIn * 1000);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const result = await runtimeMessage(runtime, { type: AUTH_POLL_MESSAGE });
      if (result.status === 'authenticated') return result.identity;
    }
    throw new Error('飞书登录请求已超时，请重新发起');
  }

  async function registerMenus(root, bridge, adapters) {
    const registerMenuCommand = adapters.registerMenuCommand;
    if (typeof registerMenuCommand !== 'function') return;
    let loginPromise = null;
    registerMenuCommand('使用飞书登录 Xynigo', () => {
      if (loginPromise) {
        showNotice(root, adapters, '飞书登录正在进行，请在已打开的页面完成授权。');
        return;
      }
      showNotice(root, adapters, '已开始飞书登录，请在新页面完成授权；授权结果会自动回传。');
      loginPromise = loginWithFeishu(root, bridge.runtime, adapters)
        .then((identity) => showNotice(root, adapters, `登录成功：${identity?.user?.name || '已认证'}。会话有效期由 Xynigo 云端控制。`))
        .catch((error) => showNotice(root, adapters, `飞书登录失败：${error.message || '请重试'}`))
        .finally(() => { loginPromise = null; });
    });
    registerMenuCommand('查看 Xynigo 登录状态', async () => {
      try {
        const state = await runtimeMessage(bridge.runtime, { type: STATUS_MESSAGE });
        if (!state.authenticated) {
          showNotice(root, adapters, state.message || '尚未登录，请使用飞书登录。');
          return;
        }
        showNotice(root, adapters, `已登录：${state.identity?.user?.name || '—'}\n组织：${state.identity?.tenant?.name || '—'}`);
      } catch (error) {
        showNotice(root, adapters, `状态检查失败：${error.message || '请稍后重试'}`);
      }
    });
    registerMenuCommand('退出 Xynigo 登录', async () => {
      if (!root.confirm?.('退出当前油猴版 Xynigo 登录？本地采购记录不会删除。')) return;
      try {
        await runtimeMessage(bridge.runtime, { type: AUTH_LOGOUT_MESSAGE });
        showNotice(root, adapters, '已退出 Xynigo 登录，短期会话已清除。');
      } catch (error) {
        showNotice(root, adapters, `退出失败：${error.message || '请稍后重试'}`);
      }
    });
    registerMenuCommand('导出本地采购记录', async () => {
      const allValues = await storageGet(bridge.local, null);
      const records = Object.entries(allValues)
        .filter(([key]) => key.startsWith(RECORD_PREFIX))
        .map(([, record]) => record);
      downloadJson(root, `xynigo-purchase-records-${new Date().toISOString().slice(0, 10)}.json`, {
        exportedAt: new Date().toISOString(),
        records,
      });
    });
    registerMenuCommand('清除本地采购记录', async () => {
      if (!root.confirm?.('仅清除本脚本保存在浏览器中的本地采购记录，不删除 Xynigo 云端记录。确认继续？')) return;
      const allValues = await storageGet(bridge.local, null);
      const keys = Object.keys(allValues).filter((key) => key.startsWith(RECORD_PREFIX));
      await storageRemove(bridge.local, keys);
      showNotice(root, adapters, `已清除 ${keys.length} 条本地采购记录。`);
    });
  }

  function boot(root, css, version, adapters, cloudApi) {
    const bridge = installStorageBridge(root, adapters, version);
    if (!cloudApi || typeof cloudApi.install !== 'function') {
      throw new Error('Xynigo 油猴云端模块未加载');
    }
    cloudApi.install(bridge.chrome, adapters.fetch);
    injectCss(root, css, adapters.addStyle);
    registerMenus(root, bridge, adapters).catch((error) => {
      root.console?.warn?.('[Xynigo] 注册 Tampermonkey 菜单失败', error);
    });
    return bridge;
  }

  function browserAdapters() {
    return {
      getValue: (...args) => GM_getValue(...args),
      setValue: (...args) => GM_setValue(...args),
      deleteValue: (...args) => GM_deleteValue(...args),
      listValues: (...args) => GM_listValues(...args),
      addStyle: (...args) => GM_addStyle(...args),
      registerMenuCommand: (...args) => GM_registerMenuCommand(...args),
      openInTab: (...args) => GM_openInTab(...args),
      notify: (...args) => GM_notification(...args),
      fetch: createGmFetch((...args) => GM_xmlhttpRequest(...args)),
    };
  }

  return {
    AUTH_LOGOUT_MESSAGE,
    AUTH_POLL_MESSAGE,
    AUTH_START_MESSAGE,
    POLL_INTERVAL_MS,
    RECORD_PREFIX,
    STATUS_MESSAGE,
    browserAdapters,
    boot,
    createGmFetch,
    injectCss,
    installStorageBridge,
    loginWithFeishu,
    registerMenus,
    runtimeMessage,
  };
});
