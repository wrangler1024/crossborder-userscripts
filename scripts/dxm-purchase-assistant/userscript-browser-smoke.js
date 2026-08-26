'use strict';

const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const scriptDir = __dirname;
  const fixturePath = path.resolve(
    scriptDir,
    '..',
    '..',
    'extensions',
    'xynigo-dxm-purchase-assistant',
    'tests',
    'fixtures',
    'order-detail.html',
  );
  const userscriptPath = path.join(scriptDir, 'xynigo_dxm_purchase_assistant.user.js');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });

  try {
    await context.addInitScript(() => {
      const values = new Map();
      globalThis.__xynigoMenus = [];
      globalThis.GM_getValue = (key, fallback) => (values.has(key) ? values.get(key) : fallback);
      globalThis.GM_setValue = (key, value) => values.set(key, value);
      globalThis.GM_deleteValue = (key) => values.delete(key);
      globalThis.GM_listValues = () => [...values.keys()];
      globalThis.GM_addStyle = (css) => {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
        return style;
      };
      globalThis.GM_registerMenuCommand = (label, callback) => {
        globalThis.__xynigoMenus.push({ label, callback });
      };
      globalThis.GM_openInTab = () => ({ close() {} });
      globalThis.GM_notification = () => {};
      globalThis.GM_xmlhttpRequest = () => ({ abort() {} });
    });

    const page = await context.newPage();
    page.on('console', (message) => console.error(`[browser:${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => console.error(`[browser:pageerror] ${error.stack || error.message}`));
    await page.goto(`file://${fixturePath}`);
    await page.addScriptTag({ path: userscriptPath });
    await page.waitForSelector('.mock-tabs > .xynigo-dxm-purchase-tab', { timeout: 8000 });
    await page.waitForSelector('.mock-content > .xynigo-dxm-embedded-host', { timeout: 8000 });
    await page.waitForFunction(() => globalThis.__xynigoMenus.length === 5);

    const result = await page.evaluate(() => ({
      tabText: document.querySelector('.xynigo-dxm-purchase-tab')?.textContent.trim(),
      formVisible: Boolean(document.querySelector('.xynigo-dxm-embedded-host .xynigo-dxm-drawer')),
      styleApplied: getComputedStyle(document.querySelector('.xynigo-dxm-drawer')).backgroundColor,
      menuLabels: globalThis.__xynigoMenus.map(({ label }) => label),
      runtimeVersion: chrome.runtime.getManifest().version,
    }));

    if (result.tabText !== '采购明细') throw new Error('油猴版未注入采购明细页签');
    if (!result.formVisible) throw new Error('油猴版未渲染采购明细表单');
    if (result.styleApplied !== 'rgb(237, 248, 248)') throw new Error('油猴版未加载共享样式');
    if (result.menuLabels.length !== 5) throw new Error('油猴版菜单数量错误');
    if (!result.menuLabels.includes('使用飞书登录 Xynigo')
      || !result.menuLabels.includes('查看 Xynigo 登录状态')
      || !result.menuLabels.includes('退出 Xynigo 登录')
      || !result.menuLabels.includes('导出本地采购记录')
      || !result.menuLabels.includes('清除本地采购记录')) {
      throw new Error('油猴版菜单项不完整');
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
