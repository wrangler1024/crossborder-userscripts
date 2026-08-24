'use strict';

const elements = {
  clearButton: document.querySelector('#clearButton'),
  configForm: document.querySelector('#configForm'),
  configStatus: document.querySelector('#configStatus'),
  message: document.querySelector('#message'),
  receiverUrl: document.querySelector('#receiverUrl'),
  statusDot: document.querySelector('#statusDot'),
  testButton: document.querySelector('#testButton'),
  toggleVisibility: document.querySelector('#toggleVisibility'),
};

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: '插件通信失败' });
        return;
      }
      resolve(response || { ok: false, error: '插件未返回结果' });
    });
  });
}

function showMessage(text, tone = 'info') {
  elements.message.textContent = text;
  elements.message.className = `message show ${tone}`;
}

function clearMessage() {
  elements.message.textContent = '';
  elements.message.className = 'message';
}

function setConfigured(configured) {
  elements.configStatus.textContent = configured ? '当前 Hub 环境已配置' : '当前 Hub 环境尚未配置';
  elements.statusDot.classList.toggle('ready', configured);
}

function setBusy(busy) {
  elements.configForm.querySelectorAll('button').forEach((button) => {
    button.disabled = busy;
  });
}

async function loadConfig() {
  const result = await sendMessage({ type: 'GET_CONFIG' });
  if (!result.ok) {
    showMessage(result.error, 'error');
    return;
  }
  elements.receiverUrl.value = result.receiverUrl || '';
  setConfigured(Boolean(result.receiverUrl));
}

elements.toggleVisibility.addEventListener('click', () => {
  const reveal = elements.receiverUrl.type === 'password';
  elements.receiverUrl.type = reveal ? 'text' : 'password';
  elements.toggleVisibility.textContent = reveal ? '隐藏' : '显示';
});

elements.configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  setBusy(true);
  const result = await sendMessage({ type: 'SAVE_CONFIG', receiverUrl: elements.receiverUrl.value });
  setBusy(false);
  if (!result.ok) {
    showMessage(result.error, 'error');
    return;
  }
  setConfigured(true);
  showMessage('已保存。现在返回 SHEIN 登录页，手动点击“获取验证码”。', 'success');
});

elements.testButton.addEventListener('click', async () => {
  clearMessage();
  setBusy(true);
  const result = await sendMessage({ type: 'TEST_RECEIVER', receiverUrl: elements.receiverUrl.value });
  setBusy(false);
  if (!result.ok) {
    showMessage(result.error, 'error');
    return;
  }
  showMessage(
    result.found
      ? `链接可访问，当前返回中检测到 ${result.digits} 位数字验证码。`
      : '链接可访问，当前尚未检测到验证码。',
    'success',
  );
});

elements.clearButton.addEventListener('click', async () => {
  clearMessage();
  setBusy(true);
  const result = await sendMessage({ type: 'CLEAR_CONFIG' });
  setBusy(false);
  if (!result.ok) {
    showMessage(result.error, 'error');
    return;
  }
  elements.receiverUrl.value = '';
  setConfigured(false);
  showMessage('已清除当前 Hub 环境的接码配置。', 'info');
});

void loadConfig();
