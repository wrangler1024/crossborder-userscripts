'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function waitFor(check, timeoutMs = 6000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        const result = check();
        if (result) {
          clearInterval(timer);
          resolve(result);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error('等待 Tampermonkey 自动填码超时'));
        }
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    }, 25);
  });
}

async function main() {
  const scriptDir = __dirname;
  const userscript = fs.readFileSync(
    path.join(scriptDir, 'xynigo_shein_store_otp_assistant.user.js'),
    'utf8',
  );
  const dom = new JSDOM(`
    <!doctype html>
    <html><head></head><body>
      <div class="soui-dialog" role="dialog">
        <h2>手机号码验证</h2>
        <input id="verifyCode" placeholder="请输入短信验证码">
        <span>55s</span>
        <p>已发送验证码，请查看</p>
        <button id="confirm">确认</button>
      </div>
    </body></html>
  `, {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'https://sellerhub.shein.com/',
  });

  try {
    const { window } = dom;
    const values = new Map([
      ['sheinOtpAssistantSettings', {
        receiverUrl: 'https://api.68sms.com/api/sms/get?key=test-key',
        pollIntervalMs: 20,
        timeoutMs: 3000,
      }],
    ]);
    let requestCount = 0;
    let confirmClicks = 0;
    const menus = [];

    window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 30 }];
    window.document.querySelector('#confirm').addEventListener('click', () => { confirmClicks += 1; });
    window.GM_getValue = (key, fallback) => (values.has(key) ? values.get(key) : fallback);
    window.GM_setValue = (key, value) => values.set(key, value);
    window.GM_deleteValue = (key) => values.delete(key);
    window.GM_addStyle = (css) => {
      const style = window.document.createElement('style');
      style.textContent = css;
      window.document.head.appendChild(style);
    };
    window.GM_registerMenuCommand = (label, callback) => menus.push({ label, callback });
    window.GM_xmlhttpRequest = (options) => {
      requestCount += 1;
      const code = requestCount === 1 ? '111111' : '222222';
      window.setTimeout(() => options.onload({
        status: 200,
        responseHeaders: 'content-type: application/json',
        responseText: JSON.stringify({
          code: 200,
          msg: 'OK',
          data: `[SHEIN] Login verification code: ${code}`,
        }),
      }), 10);
      return { abort() {} };
    };

    window.eval(userscript);
    await waitFor(() => window.document.querySelector('#verifyCode')?.value === '222222');

    const result = {
      value: window.document.querySelector('#verifyCode')?.value,
      status: window.document
        .querySelector('#shein-otp-assistant-root')
        ?.shadowRoot?.querySelector('.text')?.textContent,
      menus: menus.map(({ label }) => label),
      confirmClicks,
      version: window.chrome.runtime.getManifest().version,
    };

    if (result.value !== '222222') throw new Error('Tampermonkey 版未自动填入新验证码');
    if (!result.status?.includes('已自动填入 6 位验证码')) throw new Error('Tampermonkey 版未显示填码成功状态');
    if (result.menus.length !== 3) throw new Error('Tampermonkey 配置菜单不完整');
    if (result.confirmClicks !== 0) throw new Error('Tampermonkey 版不应自动点击确认');

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    // The content script intentionally keeps a MutationObserver for SPA navigation.
    // Let Node dispose the jsdom window at process exit; closing it here creates a
    // teardown-only mutation after document internals have already been released.
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
