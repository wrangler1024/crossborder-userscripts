(function exposeLingxingVineUserscriptRuntime(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LingxingVineUserscriptRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntime() {
  'use strict';

  function createChromeShim(root = globalThis, options = {}) {
    const prefix = options.prefix || 'xynigo:lingxing-vine:';
    const memory = new Map();

    function storage() {
      try {
        return root.localStorage || null;
      } catch (_error) {
        return null;
      }
    }

    function allKeys() {
      const keys = new Set(memory.keys());
      const localStorage = storage();
      if (localStorage) {
        try {
          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(prefix)) keys.add(key.slice(prefix.length));
          }
        } catch (_error) {
          // Memory storage remains available when site storage is blocked.
        }
      }
      return [...keys];
    }

    function read(key) {
      const localStorage = storage();
      if (localStorage) {
        try {
          const raw = localStorage.getItem(prefix + key);
          if (raw !== null) return JSON.parse(raw);
        } catch (_error) {
          // Fall through to the in-memory value.
        }
      }
      return memory.get(key);
    }

    function write(key, value) {
      memory.set(key, value);
      const localStorage = storage();
      if (!localStorage) return;
      try {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      } catch (_error) {
        // Keep the in-memory value when quota or privacy settings reject persistence.
      }
    }

    function remove(key) {
      memory.delete(key);
      const localStorage = storage();
      if (!localStorage) return;
      try {
        localStorage.removeItem(prefix + key);
      } catch (_error) {
        // Memory value is already removed.
      }
    }

    function resolveKeys(keys) {
      if (keys === null || keys === undefined) {
        return { names: allKeys(), defaults: {} };
      }
      if (typeof keys === 'string') {
        return { names: [keys], defaults: {} };
      }
      if (Array.isArray(keys)) {
        return { names: keys.map(String), defaults: {} };
      }
      if (typeof keys === 'object') {
        return { names: Object.keys(keys), defaults: keys };
      }
      return { names: [], defaults: {} };
    }

    function get(keys, callback = () => {}) {
      const { names, defaults } = resolveKeys(keys);
      const result = {};
      for (const key of names) {
        const value = read(key);
        if (value !== undefined) result[key] = value;
        else if (Object.prototype.hasOwnProperty.call(defaults, key)) result[key] = defaults[key];
      }
      queueMicrotask(() => callback(result));
    }

    function set(values, callback = () => {}) {
      for (const [key, value] of Object.entries(values || {})) write(key, value);
      queueMicrotask(() => callback());
    }

    function clear(callback = () => {}) {
      for (const key of allKeys()) remove(key);
      queueMicrotask(() => callback());
    }

    return {
      storage: {
        local: {
          get,
          set,
          remove(keys, callback = () => {}) {
            const { names } = resolveKeys(keys);
            for (const key of names) remove(key);
            queueMicrotask(() => callback());
          },
          clear,
        },
        onChanged: {
          addListener() {},
          removeListener() {},
        },
      },
      runtime: {
        lastError: null,
        getURL(value) {
          return String(value || '');
        },
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
    };
  }

  return { createChromeShim };
});
