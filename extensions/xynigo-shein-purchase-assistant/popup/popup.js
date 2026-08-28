'use strict';

const baseUrlInput = document.getElementById('executorBaseUrl');
const statusNode = document.getElementById('status');
const messageNode = document.getElementById('message');
const shortcutValueNode = document.getElementById('shortcutValue');
const hubStatusNode = document.getElementById('hubStatus');

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: '插件后台暂不可用' });
        return;
      }
      resolve(response || { ok: false, error: '插件后台无响应' });
    });
  });
}

function showMessage(text, error) {
  messageNode.textContent = text || '';
  messageNode.classList.toggle('error', Boolean(error));
}

async function refreshHealth() {
  const response = await sendMessage({ type: 'EXECUTOR_HEALTH' });
  statusNode.classList.toggle('ok', Boolean(response.ok));
  statusNode.querySelector('span').textContent = response.ok
    ? 'localhost 执行器已连接 · 自动配对完成'
    : 'localhost 执行器未连接';
  const hub = response.hubStudio || {
    available: false,
    message: response.error || 'Xynigo 主执行器未运行',
  };
  hubStatusNode.dataset.tone = hub && hub.available ? 'success' : 'warning';
  hubStatusNode.textContent = hub && hub.available
    ? 'HubStudio Local API 已就绪'
    : 'HubStudio 自动化暂不可用，不影响当前页面填写'
      + (hub && hub.message ? '：' + hub.message : '');
  return response;
}

function refreshShortcut() {
  chrome.commands.getAll((commands) => {
    if (chrome.runtime.lastError) {
      shortcutValueNode.textContent = '无法读取';
      return;
    }
    const command = (commands || []).find((item) => item.name === 'open-purchase-assistant');
    shortcutValueNode.textContent = command && command.shortcut ? command.shortcut : '未设置';
  });
}

async function load() {
  const response = await sendMessage({ type: 'GET_SETTINGS' });
  if (response.ok) {
    baseUrlInput.value = response.settings.executorBaseUrl;
  }
  refreshShortcut();
  await refreshHealth();
}

document.getElementById('openShortcutSettings').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }, () => {
    if (chrome.runtime.lastError) {
      showMessage('请在扩展管理的“快捷键”页面设置', true);
      return;
    }
    window.close();
  });
});

document.getElementById('save').addEventListener('click', async () => {
  showMessage('正在保存…');
  const settings = await sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
      executorBaseUrl: baseUrlInput.value,
    },
  });
  if (!settings.ok) {
    showMessage(settings.error || '配置保存失败', true);
    return;
  }
  const health = await refreshHealth();
  showMessage(
    health.ok ? '已自动配对，请回到 SHEIN 地址页刷新任务' : (health.error || '本地执行器连接失败'),
    !health.ok,
  );
});

load();
