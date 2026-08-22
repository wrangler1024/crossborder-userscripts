(function exposeXynigoDxmUserscriptRuntime(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XynigoDxmUserscriptRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUserscriptRuntime() {
  'use strict';

  const SETTINGS_KEY = 'xynigoDxmPurchaseSettings';
  const RECORD_PREFIX = 'xynigoDxmPurchaseRecord:';
  const DEFAULT_SETTINGS = Object.freeze({ gateEnabled: false, autoOpenRemark: true });

  function asPromise(value) {
    return value && typeof value.then === 'function' ? value : Promise.resolve(value);
  }

  function installStorageBridge(root, adapters, version = '') {
    const listeners = new Set();
    const runtime = {
      ...(root.chrome?.runtime || {}),
      lastError: null,
      getManifest: () => ({
        name: 'Xynigo 店小秘运营采购助手',
        version,
        version_name: `${version}-tampermonkey`,
      }),
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

    function notify(changes) {
      listeners.forEach((listener) => {
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
          if (Object.keys(changes).length) notify(changes);
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
    const chromeBridge = { ...(root.chrome || {}), runtime, storage };
    try {
      root.chrome = chromeBridge;
    } catch (_error) {
      Object.defineProperty(root, 'chrome', { configurable: true, value: chromeBridge });
    }
    return { local, storage, runtime, readAll };
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

  async function registerMenus(root, local, registerMenuCommand) {
    if (typeof registerMenuCommand !== 'function') return;
    const values = await storageGet(local, null);
    const currentSettings = { ...DEFAULT_SETTINGS, ...(values[SETTINGS_KEY] || {}) };

    registerMenuCommand(
      `审核门禁：${currentSettings.gateEnabled ? '已开启' : '已关闭'}（点击切换）`,
      async () => {
        const latest = await storageGet(local, SETTINGS_KEY);
        const next = { ...DEFAULT_SETTINGS, ...(latest[SETTINGS_KEY] || {}) };
        next.gateEnabled = !next.gateEnabled;
        await storageSet(local, { [SETTINGS_KEY]: next });
        root.alert?.(`审核门禁已${next.gateEnabled ? '开启' : '关闭'}。菜单名称将在刷新页面后更新。`);
      },
    );
    registerMenuCommand(
      `自动打开备注：${currentSettings.autoOpenRemark ? '已开启' : '已关闭'}（点击切换）`,
      async () => {
        const latest = await storageGet(local, SETTINGS_KEY);
        const next = { ...DEFAULT_SETTINGS, ...(latest[SETTINGS_KEY] || {}) };
        next.autoOpenRemark = !next.autoOpenRemark;
        await storageSet(local, { [SETTINGS_KEY]: next });
        root.alert?.(`自动打开备注已${next.autoOpenRemark ? '开启' : '关闭'}。菜单名称将在刷新页面后更新。`);
      },
    );
    registerMenuCommand('导出本地采购记录', async () => {
      const allValues = await storageGet(local, null);
      const records = Object.entries(allValues)
        .filter(([key]) => key.startsWith(RECORD_PREFIX))
        .map(([, record]) => record);
      downloadJson(root, `xynigo-purchase-records-${new Date().toISOString().slice(0, 10)}.json`, {
        exportedAt: new Date().toISOString(),
        records,
      });
    });
    registerMenuCommand('清除本地采购记录', async () => {
      if (!root.confirm?.('仅清除本脚本保存在浏览器中的本地采购记录。确认继续？')) return;
      const allValues = await storageGet(local, null);
      const keys = Object.keys(allValues).filter((key) => key.startsWith(RECORD_PREFIX));
      await storageRemove(local, keys);
      root.alert?.(`已清除 ${keys.length} 条本地采购记录。`);
    });
  }

  function boot(root, css, version, adapters) {
    const bridge = installStorageBridge(root, adapters, version);
    injectCss(root, css, adapters.addStyle);
    registerMenus(root, bridge.local, adapters.registerMenuCommand).catch((error) => {
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
    };
  }

  return {
    SETTINGS_KEY,
    RECORD_PREFIX,
    DEFAULT_SETTINGS,
    installStorageBridge,
    injectCss,
    registerMenus,
    browserAdapters,
    boot,
  };
});
