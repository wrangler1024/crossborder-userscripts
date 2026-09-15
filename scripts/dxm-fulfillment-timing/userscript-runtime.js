'use strict';

// 店小秘履约时效助手 · 篡改猴运行时适配层。
// 扩展源码只依赖两个扩展 API:chrome.runtime.getManifest(版本)与
// chrome.storage.local(阈值/口径偏好)。本运行时在油猴沙箱内补齐最小等价物,
// 并把扩展的主世界桥接脚本(inject.js)以页面 <script> 注入,保证 XHR 钩子
// 与页面自身请求同世界执行。桥接两侧通过 document 上的 CustomEvent 通信,
// detail 恒为 JSON 字符串,可安全跨越沙箱边界。

(function exposeXftUserscriptRuntime(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.XftFulfillmentUserscriptRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXftUserscriptRuntime() {
  'use strict';

  function asPromise(value) {
    return value && typeof value.then === 'function' ? value : Promise.resolve(value);
  }

  // 安装 chrome.runtime + chrome.storage.local 垫片(仅在缺失时;绝不覆盖扩展真身)
  function installChromeShim(root, adapters, version) {
    const existing = root.chrome;
    const hasStorage = !!(existing && existing.storage && existing.storage.local &&
        typeof existing.storage.local.get === 'function');
    const hasRuntime = !!(existing && existing.runtime && typeof existing.runtime.getManifest === 'function');
    if (hasStorage && hasRuntime) return existing;

    const listeners = new Set();

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
        if (callback) callback(value);
      }).catch(() => {
        if (callback) callback(fallback);
      });
    }

    function notifyStorage(changes) {
      listeners.forEach((listener) => {
        try {
          listener(changes, 'local');
        } catch (e) { /* 单个监听器异常不阻断其他监听器 */ }
      });
    }

    const local = {
      get(keys, callback) { finish(read(keys), callback, {}); },
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

    const shimRuntime = {
      __xftUserscript: true,
      getManifest() {
        return {
          name: 'Xynigo 店小秘履约时效助手',
          version,
          version_name: version + '-tampermonkey',
        };
      },
    };

    root.chrome = {
      ...(existing || {}),
      storage: hasStorage ? existing.storage : {
        local,
        onChanged: {
          addListener(listener) { listeners.add(listener); },
          removeListener(listener) { listeners.delete(listener); },
        },
      },
      runtime: hasRuntime ? existing.runtime : shimRuntime,
    };
    return root.chrome;
  }

  function injectCss(root, css) {
    const doc = root.document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const style = doc.createElement('style');
    style.id = 'xft-userscript-style';
    style.textContent = css;
    (doc.head || doc.documentElement).appendChild(style);
    return style;
  }

  // 把扩展的主世界桥接脚本注入页面:与扩展的 MAIN world inject.js 代码一致,
  // 页面级守卫 window.__xftBridgeInstalled 保证扩展与油猴同时启用时只装一次。
  function injectMainWorldBridge(root, source) {
    const doc = root.document;
    if (!doc || typeof doc.createElement !== 'function') return null;
    const script = doc.createElement('script');
    script.id = 'xft-userscript-bridge';
    script.textContent = source;
    (doc.head || doc.documentElement).appendChild(script);
    return script;
  }

  function boot(root, options, adapters) {
    if (root.__xftUserscriptBooted) return null;
    root.__xftUserscriptBooted = true;
    installChromeShim(root, adapters, options.version);
    injectMainWorldBridge(root, options.injectSource);
    injectCss(root, options.css);
    return root.chrome;
  }

  function browserAdapters() {
    return {
      getValue(key, fallback) { return GM_getValue(key, fallback); },
      setValue(key, value) { return GM_setValue(key, value); },
      deleteValue(key) { return GM_deleteValue(key); },
      listValues() { return GM_listValues(); },
    };
  }

  return {
    installChromeShim,
    injectCss,
    injectMainWorldBridge,
    boot,
    browserAdapters,
  };
});
