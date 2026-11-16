'use strict';

const CHECK_STORAGE_KEY = 'lingxingVineCheckV1';
const elements = {
  openButton: document.querySelector('#openButton'),
  message: document.querySelector('#message'),
  statusDetail: document.querySelector('#statusDetail'),
  statusDot: document.querySelector('#statusDot'),
  statusTitle: document.querySelector('#statusTitle'),
};

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (values) => resolve(values || {}));
  });
}

function showMessage(text) {
  elements.message.textContent = text;
  elements.message.classList.add('show');
}

function shortTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function loadStatus() {
  const values = await storageGet(CHECK_STORAGE_KEY);
  const lastCheck = values[CHECK_STORAGE_KEY];
  if (!lastCheck) {
    elements.statusTitle.textContent = '尚未完成只读检查';
    elements.statusDetail.textContent = '打开领星销售订单列表后使用助手。';
    return;
  }
  const pending = Number(lastCheck.pendingCount) || 0;
  elements.statusTitle.textContent = pending ? `${pending} 笔 Vine 待标` : '上次检查无 Vine 待标';
  elements.statusDetail.textContent = `近 ${lastCheck.rangeDays || 30} 天 · Vine ${lastCheck.vineCount || 0} 笔 · ${shortTime(lastCheck.checkedAt)}`;
  elements.statusDot.classList.add(pending ? 'warn' : 'ready');
}

elements.openButton.addEventListener('click', async () => {
  elements.message.classList.remove('show');
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    showMessage('没有找到当前标签页。');
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'vine-promotion:open' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      showMessage(chrome.runtime.lastError
        ? '请先打开领星「销售 → 平台订单 → 订单列表」，并刷新页面。'
        : response?.error || '助手尚未加载，请刷新领星页面。');
      return;
    }
    window.close();
  });
});

void loadStatus();
