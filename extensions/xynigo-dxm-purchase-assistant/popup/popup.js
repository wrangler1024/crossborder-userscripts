(function initPopup() {
  'use strict';

  const SETTINGS_KEY = 'xynigoDxmPurchaseSettings';
  const RECORD_PREFIX = 'xynigoDxmPurchaseRecord:';
  const defaults = { gateEnabled: false, autoOpenRemark: true };
  const gateEnabled = document.getElementById('gateEnabled');
  const autoOpenRemark = document.getElementById('autoOpenRemark');
  const recordCount = document.getElementById('recordCount');
  const statusText = document.getElementById('statusText');
  const exportRecords = document.getElementById('exportRecords');
  const clearRecords = document.getElementById('clearRecords');
  const versionText = document.getElementById('versionText');

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(keys, (values) => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve(values || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(values, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async function refresh() {
    const values = await storageGet(null);
    const settings = { ...defaults, ...(values[SETTINGS_KEY] || {}) };
    gateEnabled.checked = Boolean(settings.gateEnabled);
    autoOpenRemark.checked = Boolean(settings.autoOpenRemark);
    recordCount.textContent = String(Object.keys(values).filter((key) => key.startsWith(RECORD_PREFIX)).length);
    const manifest = chrome.runtime.getManifest();
    versionText.textContent = `${manifest.version_name || manifest.version} · 独立扩展`;
  }

  async function saveSettings() {
    await storageSet({
      [SETTINGS_KEY]: {
        gateEnabled: gateEnabled.checked,
        autoOpenRemark: autoOpenRemark.checked,
      },
    });
    statusText.textContent = gateEnabled.checked
      ? '审核门禁已启用：未录采购单时将拦截审核。'
      : '观察模式：助手可录单，但不会拦截原生审核。';
  }

  gateEnabled.addEventListener('change', () => saveSettings().catch((error) => {
    statusText.textContent = `保存失败：${error.message}`;
  }));
  autoOpenRemark.addEventListener('change', () => saveSettings().catch((error) => {
    statusText.textContent = `保存失败：${error.message}`;
  }));

  exportRecords.addEventListener('click', async () => {
    const values = await storageGet(null);
    const records = Object.entries(values)
      .filter(([key]) => key.startsWith(RECORD_PREFIX))
      .map(([, record]) => record);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `xynigo-purchase-dev-records-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    statusText.textContent = `已导出 ${records.length} 条脱敏测试记录。`;
  });

  clearRecords.addEventListener('click', async () => {
    if (!confirm('仅清除本扩展保存在浏览器中的本地测试采购单。确认继续？')) return;
    const values = await storageGet(null);
    const keys = Object.keys(values).filter((key) => key.startsWith(RECORD_PREFIX));
    await storageRemove(keys);
    statusText.textContent = `已清除 ${keys.length} 条本地测试记录。`;
    await refresh();
  });

  refresh().catch((error) => {
    statusText.textContent = `读取设置失败：${error.message}`;
  });
})();
