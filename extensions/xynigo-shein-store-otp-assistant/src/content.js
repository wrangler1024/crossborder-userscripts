'use strict';

(() => {
  const OTP_INPUT_SELECTORS = [
    'input#verifyCode',
    'input[placeholder*="短信验证码"]',
    'input[autocomplete="one-time-code"]',
  ];
  const GET_CODE_LABELS = [
    '获取验证码',
    '获取驗證碼',
    'get verification code',
    'get code',
    'send code',
  ];

  const state = {
    activeInput: null,
    autoTriggeredInputs: new WeakSet(),
    baselineReady: false,
    baselineCode: null,
    lastSeenCode: null,
    primePromise: null,
    sessionId: 0,
    widget: null,
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

  function normalizeLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function findOtpInput() {
    for (const selector of OTP_INPUT_SELECTORS) {
      const inputs = [...document.querySelectorAll(selector)];
      const visibleInput = inputs.find((input) => input instanceof HTMLInputElement && isVisible(input));
      if (visibleInput) return visibleInput;
    }
    return null;
  }

  function getOtpDialogScope(input) {
    return (
      input.closest('.soui-dialog, [role="dialog"], [aria-modal="true"], [class*="modal"]') ||
      input.parentElement?.parentElement?.parentElement?.parentElement ||
      document.body
    );
  }

  function getDispatchEvidence(input) {
    const scope = getOtpDialogScope(input);
    const scopeButtons = [...scope.querySelectorAll('button')];
    const getCodeButtonVisible = scopeButtons.some((button) => {
      const label = normalizeLabel(button.textContent);
      return isVisible(button) && GET_CODE_LABELS.some((candidate) => label === candidate || label.includes(candidate));
    });
    const scopeState = SheinOtpPageState.detectDispatchState({
      text: scope.innerText || scope.textContent || '',
      getCodeButtonVisible,
    });
    if (scopeState.autoSent) return scopeState;

    const pageState = SheinOtpPageState.detectDispatchState({
      text: document.body?.innerText || '',
      getCodeButtonVisible,
    });
    return pageState.hasSentMarker ? pageState : scopeState;
  }

  function ensureWidget() {
    if (state.widget && state.widget.isConnected) return state.widget;
    const host = document.createElement('div');
    host.id = 'shein-otp-assistant-root';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .notice {
          align-items: center;
          background: #111827;
          border: 1px solid rgba(255,255,255,.16);
          border-radius: 10px;
          box-shadow: 0 12px 30px rgba(15,23,42,.24);
          color: #fff;
          display: flex;
          font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          gap: 9px;
          max-width: 360px;
          min-height: 20px;
          padding: 10px 13px;
        }
        .dot { background: #60a5fa; border-radius: 999px; height: 8px; width: 8px; flex: 0 0 auto; }
        .notice[data-tone="success"] .dot { background: #34d399; }
        .notice[data-tone="warning"] .dot { background: #fbbf24; }
        .notice[data-tone="error"] .dot { background: #fb7185; }
      </style>
      <div class="notice" data-tone="info" role="status" aria-live="polite">
        <span class="dot"></span><span class="text">SHEIN 接码助手已加载</span>
      </div>`;
    (document.documentElement || document.body).appendChild(host);
    state.widget = host;
    return host;
  }

  function setStatus(text, tone = 'info') {
    const widget = ensureWidget();
    const notice = widget.shadowRoot.querySelector('.notice');
    notice.dataset.tone = tone;
    widget.shadowRoot.querySelector('.text').textContent = text;
  }

  function setNativeInputValue(input, value) {
    const ownSetter = Object.getOwnPropertyDescriptor(input, 'value')?.set;
    const prototypeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (prototypeSetter && ownSetter !== prototypeSetter) prototypeSetter.call(input, value);
    else if (ownSetter) ownSetter.call(input, value);
    else input.value = value;

    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }),
    );
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    input.focus({ preventScroll: true });
  }

  async function primeBaseline({ announce = false } = {}) {
    if (state.baselineReady) {
      if (announce) setStatus('已就绪，等待 SHEIN 发送验证码');
      return;
    }
    if (state.primePromise) return state.primePromise;
    state.primePromise = (async () => {
      const status = await sendMessage({ type: 'GET_STATUS' });
      if (!status.ok || !status.configured) {
        state.baselineReady = false;
        if (announce) setStatus('未配置接码链接，请点击插件图标配置', 'warning');
        return;
      }

      const snapshot = await sendMessage({ type: 'FETCH_OTP' });
      if (snapshot.ok) {
        state.baselineReady = true;
        state.baselineCode = snapshot.found ? snapshot.code : null;
        state.lastSeenCode = state.baselineCode;
        if (announce) setStatus('已就绪，等待 SHEIN 发送验证码');
      } else if (announce) {
        setStatus(`${snapshot.error || '接码接口异常'}，可继续尝试`, 'warning');
      }
    })().finally(() => {
      state.primePromise = null;
    });
    return state.primePromise;
  }

  async function pollForOtp(input, { trigger = 'manual' } = {}) {
    const sessionId = ++state.sessionId;
    const status = await sendMessage({ type: 'GET_STATUS' });
    if (!status.ok || !status.configured) {
      setStatus('未配置接码链接，请点击插件图标配置', 'warning');
      return;
    }

    if (state.primePromise) await state.primePromise;
    if (sessionId !== state.sessionId) return;

    if (!state.baselineReady) {
      const baseline = await sendMessage({ type: 'FETCH_OTP' });
      if (sessionId !== state.sessionId) return;
      if (baseline.ok) {
        state.baselineReady = true;
        state.baselineCode = baseline.found ? baseline.code : null;
        state.lastSeenCode = state.baselineCode;
      }
    }

    const baselineCode = state.lastSeenCode || state.baselineCode || null;
    const startedAt = Date.now();
    const timeoutMs = Number(status.timeoutMs) || 120000;
    const intervalMs = Number(status.pollIntervalMs) || 2500;
    let failures = 0;

    setStatus(
      trigger === 'automatic'
        ? '检测到 SHEIN 已自动发送验证码，正在自动接码…'
        : '已检测到“获取验证码”，正在等待新短信…',
    );
    await new Promise((resolve) => window.setTimeout(resolve, 900));

    while (sessionId === state.sessionId && Date.now() - startedAt < timeoutMs) {
      if (!input.isConnected || !isVisible(input)) {
        setStatus('验证码窗口已关闭，已停止接码', 'warning');
        return;
      }

      const snapshot = await sendMessage({ type: 'FETCH_OTP' });
      if (sessionId !== state.sessionId) return;

      if (snapshot.ok) {
        failures = 0;
        if (snapshot.found) {
          state.lastSeenCode = snapshot.code;
          if (!baselineCode || snapshot.code !== baselineCode) {
            setNativeInputValue(input, snapshot.code);
            state.baselineCode = snapshot.code;
            state.baselineReady = true;
            setStatus(`已自动填入 ${snapshot.digits} 位验证码，请手动点击“确认”`, 'success');
            return;
          }
        }
        const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        setStatus(`正在等待新短信… ${seconds} 秒`);
      } else {
        failures += 1;
        setStatus(`${snapshot.error || '接码接口异常'}，正在重试`, failures >= 3 ? 'error' : 'warning');
      }

      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }

    if (sessionId === state.sessionId) {
      setStatus('120 秒内未收到新验证码，可重新点击“获取验证码”', 'error');
    }
  }

  function inspectPage() {
    const input = findOtpInput();
    if (!input) {
      if (state.activeInput && !state.activeInput.isConnected) {
        state.sessionId += 1;
        state.activeInput = null;
      }
      return;
    }

    const inputChanged = state.activeInput !== input;
    if (state.activeInput !== input) {
      state.sessionId += 1;
      state.activeInput = input;
    }

    const dispatchEvidence = getDispatchEvidence(input);
    if (dispatchEvidence.autoSent && !state.autoTriggeredInputs.has(input)) {
      state.autoTriggeredInputs.add(input);
      void pollForOtp(input, { trigger: 'automatic' });
      return;
    }

    if (inputChanged) void primeBaseline({ announce: true });
  }

  document.addEventListener(
    'click',
    (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button) return;
      const label = normalizeLabel(button.textContent);
      if (!GET_CODE_LABELS.some((candidate) => label === candidate || label.includes(candidate))) return;
      const input = findOtpInput();
      if (!input) return;
      state.activeInput = input;
      state.autoTriggeredInputs.add(input);
      void pollForOtp(input, { trigger: 'manual' });
    },
    true,
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.sheinOtpAssistantSettings) return;
    state.sessionId += 1;
    state.baselineReady = false;
    state.baselineCode = null;
    state.lastSeenCode = null;
    const input = findOtpInput();
    if (input) {
      state.activeInput = input;
      void inspectPage();
    } else {
      void primeBaseline({ announce: false });
    }
  });

  const observer = new MutationObserver(inspectPage);
  function startObserver() {
    if (!document.documentElement) {
      window.setTimeout(startObserver, 0);
      return;
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    void primeBaseline({ announce: false });
    inspectPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inspectPage, { once: true });
  }
  startObserver();
})();
