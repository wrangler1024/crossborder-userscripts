(function initPopup() {
  'use strict';

  const RECORD_PREFIX = 'xynigoDxmPurchaseRecord:';
  const STATUS_MESSAGE = 'xynigo-dxm:status';
  const connectionCard = document.getElementById('connectionCard');
  const connectionTitle = document.getElementById('connectionTitle');
  const connectionDetail = document.getElementById('connectionDetail');
  const identitySummary = document.getElementById('identitySummary');
  const identityName = document.getElementById('identityName');
  const tenantName = document.getElementById('tenantName');
  const permissionState = document.getElementById('permissionState');
  const connectXynigo = document.getElementById('connectXynigo');
  const refreshStatus = document.getElementById('refreshStatus');
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

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(error);
        else resolve();
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error?.message || 'Xynigo 请求失败'));
          return;
        }
        resolve(response.data || {});
      });
    });
  }

  function renderDisconnected(message) {
    connectionCard.dataset.state = 'error';
    connectionTitle.textContent = 'Xynigo 云端连接失败';
    connectionDetail.textContent = message || '请检查网络后重试';
    identitySummary.hidden = true;
    connectXynigo.disabled = false;
    connectXynigo.textContent = '使用飞书登录';
  }

  function renderConnection(connection) {
    if (!connection.authenticated || !connection.identity) {
      connectionCard.dataset.state = connection.loginPending ? 'loading' : 'error';
      connectionTitle.textContent = connection.loginPending ? '飞书登录待完成' : '尚未登录';
      connectionDetail.textContent = connection.message || (
        connection.loginPending ? '完成飞书授权后刷新状态' : '无需运行 Xynigo 本机服务'
      );
      identitySummary.hidden = true;
      connectXynigo.disabled = false;
      connectXynigo.textContent = connection.loginPending ? '继续飞书登录' : '使用飞书登录';
      return;
    }
    const permissions = new Set(connection.identity.permissions || []);
    const canSave = permissions.has('procurement.request.save');
    const canSubmit = permissions.has('procurement.request.submit');
    connectionCard.dataset.state = canSave && canSubmit ? 'connected' : 'error';
    connectionTitle.textContent = canSave && canSubmit ? 'Xynigo 云端已登录' : '已登录，但缺少提单权限';
    connectionDetail.textContent = connection.apiBaseUrl;
    identityName.textContent = connection.identity.user?.name || '—';
    tenantName.textContent = connection.identity.tenant?.name || '—';
    permissionState.textContent = canSave && canSubmit ? '允许保存与提交' : '请管理员分配运营提单权限';
    identitySummary.hidden = false;
    connectXynigo.disabled = true;
    connectXynigo.textContent = '飞书已登录';
  }

  async function refreshConnection() {
    connectionCard.dataset.state = 'loading';
    connectionTitle.textContent = '正在检查 Xynigo…';
    connectionDetail.textContent = '正在验证插件云端会话';
    try {
      const connection = await sendRuntimeMessage({ type: STATUS_MESSAGE });
      renderConnection(connection);
      statusText.textContent = connection.authenticated
        ? '当前操作将按 Xynigo 登录成员记入审计。'
        : '请直接使用飞书登录插件。';
    } catch (error) {
      renderDisconnected(error.message);
      statusText.textContent = '插件不保存飞书令牌；Xynigo 短期会话仅保留在当前浏览器会话。';
    }
  }

  async function refresh() {
    const values = await storageGet(null);
    recordCount.textContent = String(Object.keys(values).filter((key) => key.startsWith(RECORD_PREFIX)).length);
    const manifest = chrome.runtime.getManifest();
    versionText.textContent = `${manifest.version_name || manifest.version} · 独立扩展`;
    await refreshConnection();
  }

  connectXynigo.addEventListener('click', async () => {
    statusText.textContent = '正在打开插件飞书登录页…';
    chrome.tabs.create({ url: chrome.runtime.getURL('login/login.html') });
  });

  refreshStatus.addEventListener('click', () => refreshConnection().catch((error) => {
    renderDisconnected(error.message);
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
    anchor.download = `xynigo-purchase-cache-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    statusText.textContent = `已导出 ${records.length} 条脱敏本地缓存。`;
  });

  clearRecords.addEventListener('click', async () => {
    if (!confirm('仅清除本扩展的脱敏本地缓存，不删除 Xynigo 或飞书记录。确认继续？')) return;
    const values = await storageGet(null);
    const keys = Object.keys(values).filter((key) => key.startsWith(RECORD_PREFIX));
    await storageRemove(keys);
    statusText.textContent = `已清除 ${keys.length} 条本地缓存，远端记录未变更。`;
    recordCount.textContent = '0';
  });

  refresh().catch((error) => {
    renderDisconnected(error.message);
    statusText.textContent = `读取状态失败：${error.message}`;
  });
})();
