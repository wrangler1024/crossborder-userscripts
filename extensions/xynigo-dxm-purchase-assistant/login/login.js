(() => {
  'use strict';

  const AUTH_START_MESSAGE = 'xynigo-dxm:auth-start';
  const AUTH_POLL_MESSAGE = 'xynigo-dxm:auth-poll';
  const STATUS_MESSAGE = 'xynigo-dxm:status';
  const startLogin = document.getElementById('startLogin');
  const status = document.getElementById('status');
  const SUCCESS_CLOSE_DELAY_MS = 900;
  let pollTimer = null;
  let deadline = 0;

  function setStatus(message, tone = '') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response?.ok) reject(new Error(response?.error?.message || 'Xynigo 登录请求失败'));
        else resolve(response.data || {});
      });
    });
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function closeCurrentLoginPage() {
    setTimeout(() => {
      const fallbackClose = () => {
        window.close();
        setTimeout(() => {
          if (!document.hidden) {
            setStatus('登录成功。浏览器未自动关闭此页面，请手动关闭。', 'success');
          }
        }, 250);
      };
      try {
        chrome.tabs.getCurrent((tab) => {
          const error = chrome.runtime.lastError;
          if (error || !Number.isInteger(tab?.id)) {
            fallbackClose();
            return;
          }
          chrome.tabs.remove(tab.id, () => {
            if (chrome.runtime.lastError) fallbackClose();
          });
        });
      } catch (_error) {
        fallbackClose();
      }
    }, SUCCESS_CLOSE_DELAY_MS);
  }

  function finishLogin(identity) {
    stopPolling();
    startLogin.disabled = true;
    startLogin.textContent = '登录成功';
    setStatus(`登录成功：${identity?.user?.name || '已认证'}。正在自动关闭此页面…`, 'success');
    closeCurrentLoginPage();
  }

  async function poll() {
    if (Date.now() >= deadline) {
      stopPolling();
      startLogin.disabled = false;
      setStatus('飞书登录请求已超时，请重新发起。', 'error');
      return;
    }
    try {
      const result = await sendRuntimeMessage({ type: AUTH_POLL_MESSAGE });
      if (result.status === 'authenticated') {
        finishLogin(result.identity);
        return;
      }
      setStatus('等待飞书授权完成…');
    } catch (error) {
      if (!/local_login_invalid|登录请求无效/.test(error.message || '')) {
        stopPolling();
        startLogin.disabled = false;
        setStatus(error.message || '飞书登录失败，请重试。', 'error');
        return;
      }
    }
    pollTimer = setTimeout(poll, 1200);
  }

  async function beginLogin() {
    stopPolling();
    startLogin.disabled = true;
    setStatus('正在由 Xynigo 云端创建飞书登录请求…');
    try {
      const result = await sendRuntimeMessage({ type: AUTH_START_MESSAGE });
      const expiresIn = Math.max(30, Number(result.expiresIn) || 300);
      deadline = Date.now() + (expiresIn * 1000);
      const authWindow = window.open(result.loginUrl, 'xynigo-feishu-login', 'popup=yes,width=560,height=760');
      if (!authWindow) {
        throw new Error('浏览器拦截了飞书登录窗口，请允许弹出窗口后重试');
      }
      setStatus('已打开飞书授权窗口，正在等待登录结果…');
      poll();
    } catch (error) {
      startLogin.disabled = false;
      setStatus(error.message || '无法发起飞书登录。', 'error');
    }
  }

  startLogin.addEventListener('click', beginLogin);
  sendRuntimeMessage({ type: STATUS_MESSAGE }).then((connection) => {
    if (connection.authenticated) {
      finishLogin(connection.identity);
    }
  }).catch((error) => setStatus(error.message || '无法连接 Xynigo 云端，请检查网络后重试。', 'error'));
})();
