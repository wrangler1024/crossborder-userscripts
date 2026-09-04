'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

const extensionDir = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(extensionDir, 'src', 'core.js'), 'utf8');
const importSource = fs.readFileSync(path.join(extensionDir, 'src', 'import.js'), 'utf8');
const templateSource = fs.readFileSync(path.join(extensionDir, 'src', 'template-data.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(extensionDir, 'src', 'content.js'), 'utf8');

function waitFor(predicate, timeoutMs = 6000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        if (predicate()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('等待浏览器冒烟测试状态超时'));
        return;
      }
      setTimeout(check, 25);
    };
    check();
  });
}

async function openBatchShipmentPreview(cases, shipmentHandler) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent" placeholder="多个订单号间用逗号或空格隔开，最多支持1000个">
      <button id="search-button" type="button">搜索</button>
    </section>
    <div id="result-count">第1-300条，共1000条记录</div>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="old"><td>OLD_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      const packageId = new URLSearchParams(options.body).get('orderId');
      const item = cases.find((candidate) => candidate.internalPackageId === packageId);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { dxmOrder: { orderId: item.orderNo, orderStatusName: '待发货', platform: 'shein' } },
        }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      const packageIds = new URLSearchParams(options.body).get('packageIds').split(',');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: packageIds.map((id) => ({ idStr: id, platform: 'shein' })),
            sheinProviders: [{ fProductCode: 'UPS', providerName: 'UPS' }],
          },
        }),
      };
    }
    if (url === '/api/package/withOutPrintShip.json') return shipmentHandler(url, options);
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#result-count').textContent = `第1-${cases.length}条，共${cases.length}条记录`;
    window.document.querySelector('#orders').innerHTML = cases.map((item) => (
      `<tr class="vxe-body--row" rowid="${item.internalPackageId}"><td>${item.orderNo}</td></tr>`
    )).join('');
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = cases.map((item) => (
    `${item.orderNo}\t${item.trackingNo}\tUPS`
  )).join('\n');
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);
  return { dom, window, root, requests };
}

test('imports a CSV template locally and only fills the existing input box', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  let requestCount = 0;
  window.fetch = async () => {
    requestCount += 1;
    throw new Error('上传文件时不应请求店小秘');
  };

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  const fileInput = root.querySelector('[data-role="import-file"]');
  const file = {
    name: '发货导入.csv',
    size: 128,
    text: async () => [
      '订单号,物流单号,物流商渠道',
      'GSH1TEST00001A,JMXTEST000000001,J&T Express',
      'GSH1TEST00002B,49400000000002,IMILE',
    ].join('\n'),
  };
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
  fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-feedback').textContent.includes('导入 2 个订单'));

  assert.equal(root.querySelector('#xynigo-dxm-logistics-input').value, [
    'GSH1TEST00001A\tJMXTEST000000001\tJ&T',
    'GSH1TEST00002B\t49400000000002\tiMile',
  ].join('\n'));
  assert.equal(requestCount, 0);
  assert.equal(root.querySelector('[data-stage="preview"]').hidden, true);
  assert.equal(root.querySelector('[data-action="execute"]').hidden, true);
  dom.window.close();
});

test('downloads the embedded xlsx template through a Blob URL without opening the blocked extension URL', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requestedUrls = [];
  window.fetch = async (url) => {
    requestedUrls.push(url);
    throw new Error(`模板下载不应访问 ${url}`);
  };
  let createdBlob = null;
  let downloadedHref = '';
  let downloadedName = '';
  window.URL.createObjectURL = (blob) => {
    createdBlob = blob;
    return 'blob:https://www.dianxiaomi.com/comet-safe-template';
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function clickDownload() {
    downloadedHref = this.href;
    downloadedName = this.download;
  };

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  const templateButton = root.querySelector('[data-action="download-template"]');
  templateButton.click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-feedback').textContent.includes('已交给 Comet 下载'));

  assert.equal(requestedUrls.length, 0);
  assert.ok(createdBlob);
  assert.equal(downloadedHref, 'blob:https://www.dianxiaomi.com/comet-safe-template');
  assert.equal(downloadedName, 'Xynigo店小秘物流助手导入模板.xlsx');
  assert.doesNotMatch(downloadedHref, /chrome-extension:/);
  dom.window.close();
});

test('searches, exact-matches, previews and submits one confirmed shipment', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <nav class="order-search-tabs"><span>筛选</span><span id="search-mode-tab">搜索</span></nav>
    <section class="search-section" hidden>
      <div><span>搜索类型</span><button id="order-number-type" type="button">订单号</button></div>
      <label>搜索内容 <input id="searchContent" placeholder="多个订单号间用逗号或空格隔开，最多支持1000个"></label>
      <button id="search-button" type="button">搜索</button>
    </section>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="noise-row"><td>OTHER_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };

  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            dxmOrder: { orderId: 'GSU1SAMPLE0001A', orderStatusName: '待发货', platform: 'shein' },
            parentOrder: { countryCN: '美国', countryCode: 'US' },
          },
        }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: [{ idStr: '987654321', platform: 'shein' }],
            sheinProviders: [{ fProductCode: 'UPS_CODE', providerName: 'UPS' }],
          },
        }),
      };
    }
    if (url === '/api/package/withOutPrintShip.json') {
      return { ok: true, status: 200, json: async () => ({ code: 0, msg: '发货成功' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  let searchModeClicks = 0;
  window.document.querySelector('#search-mode-tab').addEventListener('click', () => {
    searchModeClicks += 1;
    window.document.querySelector('.search-section').hidden = false;
  });
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#orders').innerHTML = [
      '<tr class="vxe-body--row" rowid="987654321"><td>GSU1SAMPLE0001A</td></tr>',
      '<tr class="vxe-body--row" rowid="987654321"><td>操作</td></tr>',
    ].join('');
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  const floatingEntry = window.document.querySelector('#xynigo-dxm-logistics-entry button');
  assert.ok(floatingEntry);
  assert.equal(floatingEntry.querySelector('b').textContent, '物流助手');
  assert.equal(floatingEntry.querySelector('img').src, 'chrome-extension://test/icons/icon48.png');
  floatingEntry.setPointerCapture = () => {};
  floatingEntry.releasePointerCapture = () => {};
  await waitFor(() => Boolean(floatingEntry.parentElement.style.top));
  const initialTop = parseFloat(floatingEntry.parentElement.style.top);
  const pointer = (type, values) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.entries(values).forEach(([key, value]) => {
      Object.defineProperty(event, key, { value });
    });
    floatingEntry.dispatchEvent(event);
  };
  pointer('pointerdown', { button: 0, pointerId: 7, clientY: 100 });
  pointer('pointermove', { button: 0, pointerId: 7, clientY: 180 });
  pointer('pointerup', { button: 0, pointerId: 7, clientY: 180 });
  assert.ok(parseFloat(floatingEntry.parentElement.style.top) > initialTop);
  floatingEntry.click();
  assert.equal(window.document.querySelector('#xynigo-dxm-logistics-root'), null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  floatingEntry.click();

  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSU1SAMPLE0001A\t1Z999AA10123456784';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);

  assert.equal(searchModeClicks, 1);
  assert.equal(window.document.querySelector('#searchContent').value, 'GSU1SAMPLE0001A');
  assert.equal(
    requests.filter((request) => request.url === '/api/order/detail.json').length,
    1,
  );

  const previewCells = Array.from(root.querySelectorAll('[data-stage="preview"] tbody td'))
    .map((cell) => cell.textContent);
  assert.ok(previewCells.includes('GSU1SAMPLE0001A'));
  assert.ok(previewCells.includes('1Z999AA10123456784'));
  assert.ok(previewCells.includes('987654321'));
  assert.ok(previewCells.includes('UPS'));

  const optionsRequest = requests.find(
    (request) => request.url === '/api/order/withOutPrintShippingList.json',
  );
  assert.ok(optionsRequest);
  assert.equal(new URLSearchParams(optionsRequest.options.body).get('packageIds'), '987654321');

  const confirmation = root.querySelector('.xynigo-dxm-logistics-confirm input');
  confirmation.checked = true;
  confirmation.dispatchEvent(new window.Event('change', { bubbles: true }));
  const execute = root.querySelector('[data-action="execute"]');
  assert.equal(execute.disabled, false);
  execute.click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-summary').textContent.includes('已受理 1'));

  const shipmentRequest = requests.find((request) => request.url === '/api/package/withOutPrintShip.json');
  assert.ok(shipmentRequest);
  const shipmentBody = new URLSearchParams(shipmentRequest.options.body);
  assert.equal(shipmentBody.get('packageIds'), '987654321');
  assert.equal(shipmentBody.get('tracingNumbers'), '1Z999AA10123456784');
  assert.equal(shipmentBody.get('providerNames'), 'UPS');
  assert.equal(shipmentBody.get('isShipStr'), '1');
  assert.match(root.querySelector('[data-stage="preview"] tbody td:last-child').textContent, /待平台确认/);

  window.dispatchEvent(new window.Event('pagehide'));
  dom.window.close();
});

test('maps and ships only ready child purchases from a partially ready split order', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent" placeholder="多个订单号间用逗号或空格隔开，最多支持1000个">
      <button id="search-button" type="button">搜索</button>
    </section>
    <div id="result-count">第1-300条，共900条记录</div>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="old"><td>OLD_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const packages = [
    { id: 'SPLIT-PKG-1', sku: 'SKU-BLACK-M', variant: 'Black / M' },
    { id: 'SPLIT-PKG-2', sku: 'SKU-BLACK-S', variant: 'Black / S' },
    { id: 'SPLIT-PKG-3', sku: 'SKU-BLACK-L', variant: 'Black / L' },
  ];
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      const packageId = new URLSearchParams(options.body).get('orderId');
      const item = packages.find((candidate) => candidate.id === packageId);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            dxmOrder: { orderId: 'GSH1SAMPLE0001A', orderStatusName: '待发货', platform: 'shein' },
            productList: [{
              sellerSku: item.sku,
              specification: item.variant,
              quantity: 1,
              imageUrl: `https://img.example.com/${item.id}.webp`,
            }],
          },
        }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      const packageIds = new URLSearchParams(options.body).get('packageIds').split(',');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: packageIds.map((id) => ({ idStr: id, platform: 'shein' })),
            sheinProviders: [{ fProductCode: 'IMILE', providerName: 'iMile' }],
          },
        }),
      };
    }
    if (url === '/api/package/withOutPrintShip.json') {
      return { ok: true, status: 200, json: async () => ({ code: 0, msg: 'accepted' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#result-count').textContent = '第1-3条，共3条记录';
    window.document.querySelector('#orders').innerHTML = packages.map((item) => (
      `<tr class="vxe-body--row" rowid="${item.id}"><td>GSH1SAMPLE0001A</td><td><img src="https://img.example.com/${item.id}.webp"></td></tr>`
    )).join('');
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  const splitMode = root.querySelector('input[name="xynigo-dxm-logistics-mode"][value="split"]');
  splitMode.checked = true;
  splitMode.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('#xynigo-dxm-logistics-input').value = [
    'GSH1SAMPLE0001A-1\tJMXREADY000000001\tiMile',
    'GSH1SAMPLE0001A-3\tJMXREADY000000003\tiMile',
  ].join('\n');
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="mapping"]').hidden === false);

  assert.equal(window.document.querySelector('#searchContent').value, 'GSH1SAMPLE0001A');
  assert.equal(root.querySelectorAll('[data-package-card-id]').length, 3);
  assert.match(root.querySelector('[data-role="mapping-summary"]').textContent, /本批只映射并发货 2/);
  assert.match(root.querySelector('[data-role="package-groups"]').textContent, /SKU-BLACK-M/);
  root.querySelector('[data-package-card-id="SPLIT-PKG-2"]').click();
  assert.match(root.querySelector('[data-purchase-sub-order-row="GSH1SAMPLE0001A-1"]').textContent, /SPLIT-PKG-2/);
  root.querySelector('[data-package-card-id="SPLIT-PKG-3"]').click();
  assert.match(root.querySelector('[data-package-card-id="SPLIT-PKG-3"] [data-role="package-card-badge"]').textContent, /0001A-3/);
  root.querySelector('[data-purchase-sub-order-row="GSH1SAMPLE0001A-1"] [data-action="clear-package-mapping"]').click();
  assert.match(root.querySelector('[data-role="mapping-feedback"]').textContent, /已匹配 1\/2/);
  root.querySelector('[data-package-card-id="SPLIT-PKG-2"]').click();
  root.querySelector('[data-action="continue-mapping"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);

  const previewText = root.querySelector('[data-stage="preview"]').textContent;
  assert.match(previewText, /GSH1SAMPLE0001A-1/);
  assert.match(previewText, /GSH1SAMPLE0001A-3/);
  assert.doesNotMatch(previewText, /SPLIT-PKG-1/);
  const confirmation = root.querySelector('.xynigo-dxm-logistics-confirm input');
  confirmation.checked = true;
  confirmation.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('[data-action="execute"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-summary').textContent.includes('已受理 2'));

  const shipmentRequests = requests.filter((request) => request.url === '/api/package/withOutPrintShip.json');
  assert.equal(shipmentRequests.length, 2);
  assert.deepEqual(shipmentRequests.map((request) => (
    new URLSearchParams(request.options.body).get('packageIds')
  )), ['SPLIT-PKG-2', 'SPLIT-PKG-3']);
  assert.equal(shipmentRequests.some((request) => request.options.body.includes('SPLIT-PKG-1')), false);
  dom.window.close();
});

test('requires an extra confirmation when only one split package remains visible', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section"><input id="searchContent"><button id="search-button" type="button">搜索</button></section>
    <div id="result-count">第1-10条，共600条记录</div>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="old"><td>OLD_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  let optionsRequestCount = 0;
  window.fetch = async (url, options = {}) => {
    if (url === '/api/order/detail.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            dxmOrder: { orderId: 'GSH1SAMPLE0009Z', orderStatusName: '待发货', platform: 'shein' },
            productList: [{ sellerSku: 'SKU-LAST', specification: 'Black / L', quantity: 1 }],
          },
        }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      optionsRequestCount += 1;
      assert.equal(new URLSearchParams(options.body).get('packageIds'), 'LAST-PKG-9');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: [{ idStr: 'LAST-PKG-9', platform: 'shein' }],
            sheinProviders: [{ fProductCode: 'IMILE', providerName: 'iMile' }],
          },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#result-count').textContent = '第1-1条，共1条记录';
    window.document.querySelector('#orders').innerHTML = '<tr class="vxe-body--row" rowid="LAST-PKG-9"><td>GSH1SAMPLE0009Z</td></tr>';
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  const splitMode = root.querySelector('input[name="xynigo-dxm-logistics-mode"][value="split"]');
  splitMode.checked = true;
  splitMode.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSH1SAMPLE0009Z-9\tJMXREADY000000009\tiMile';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="mapping"]').hidden === false);

  root.querySelector('[data-package-card-id="LAST-PKG-9"]').click();
  root.querySelector('[data-action="continue-mapping"]').click();
  assert.match(root.querySelector('[data-role="mapping-feedback"]').textContent, /请先去店小秘确认/);
  assert.equal(optionsRequestCount, 0);

  const extraConfirmation = root.querySelector('[data-role="single-package-confirm"] input');
  extraConfirmation.checked = true;
  root.querySelector('[data-action="continue-mapping"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);
  assert.equal(optionsRequestCount, 1);
  assert.match(root.querySelector('[data-stage="preview"]').textContent, /GSH1SAMPLE0009Z-9/);
  dom.window.close();
});

test('searches a five-order batch with comma-separated order numbers and reads only five details', async () => {
  const cases = [
    { orderNo: 'GSU1TEST00001', trackingNo: 'TRACK00001', provider: 'J&T', platformProvider: 'J&T' },
    { orderNo: 'GSU1TEST00002', trackingNo: 'TRACK00002', provider: 'iMile', platformProvider: 'iMile' },
    { orderNo: 'GSU1TEST00003', trackingNo: 'TRACK00003', provider: 'USPS', platformProvider: 'USPS' },
    { orderNo: 'GSU1TEST00004', trackingNo: 'TRACK00004', provider: 'GOFO', platformProvider: 'GOFO' },
    { orderNo: 'GSU1TEST00005', trackingNo: 'TRACK00005', provider: 'SpeedX', platformProvider: 'Speedx' },
  ].map((item, index) => ({ ...item, internalPackageId: String(700000 + index) }));
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent" placeholder="多个订单号间用逗号或空格隔开，最多支持1000个">
      <button id="search-button" type="button">搜索</button>
    </section>
    <div id="result-count">第1-300条，共1222条记录</div>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="old-row"><td>OLD_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      const packageId = new URLSearchParams(options.body).get('orderId');
      const item = cases.find((candidate) => candidate.internalPackageId === packageId);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { dxmOrder: { orderId: item.orderNo, platform: 'shein' } } }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: cases.map((item) => ({ idStr: item.internalPackageId, platform: 'shein' })),
            sheinProviders: [
              { fProductCode: 'WRONG_IMILE_CASE', providerName: 'imile' },
              ...cases.map((item, index) => ({
                fProductCode: `PROVIDER_${index}`,
                providerName: item.platformProvider,
              })),
            ],
          },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  let submittedSearch = '';
  window.document.querySelector('#search-button').addEventListener('click', () => {
    submittedSearch = window.document.querySelector('#searchContent').value;
    window.document.querySelector('#result-count').textContent = '第1-5条，共5条记录';
    const resultRows = cases.map((item) => (
      `<tr class="vxe-body--row" rowid="${item.internalPackageId}"><td>${item.orderNo}</td></tr>`
    ));
    const mirrorRows = cases.map((item, index) => (
      `<tr class="vxe-body--row" rowid="mirror-${index}"><td>固定操作列</td></tr>`
    ));
    window.document.querySelector('#orders').innerHTML = [...resultRows, ...mirrorRows].join('');
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = cases.map((item) => (
    `${item.orderNo}\t${item.trackingNo}\t${item.provider}`
  )).join('\n');
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);

  assert.equal(submittedSearch, cases.map((item) => item.orderNo).join(','));
  assert.equal(window.document.querySelectorAll('#orders tr').length, 10);
  assert.equal(root.querySelectorAll('[data-stage="preview"] tbody tr').length, 5);
  const previewRows = Array.from(root.querySelectorAll('[data-stage="preview"] tbody tr'));
  const imilePreview = previewRows.find((row) => row.textContent.includes('GSU1TEST00002'));
  assert.ok(imilePreview);
  assert.match(imilePreview.textContent, /iMile/);
  assert.doesNotMatch(imilePreview.textContent, /\bimile\b/);
  assert.equal(requests.filter((request) => request.url === '/api/order/detail.json').length, 5);
  assert.equal(requests.filter((request) => request.url === '/api/order/withOutPrintShippingList.json').length, 1);
  dom.window.close();
});

test('continues with the eligible subset and safely excludes orders missing from pending shipment', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent" placeholder="多个订单号间用逗号或空格隔开，最多支持1000个">
      <button id="search-button" type="button">搜索</button>
    </section>
    <div id="result-count">第1-300条，共1000条记录</div>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="old"><td>OLD_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const cases = [
    { orderNo: 'GSH1ELIGIBLE001A', trackingNo: 'TRACKELIGIBLE001', internalPackageId: 'ELIGIBLE-PKG-1' },
    { orderNo: 'GSH1EXCLUDED002B', trackingNo: 'TRACKEXCLUDED002', internalPackageId: '' },
    { orderNo: 'GSH1ELIGIBLE003C', trackingNo: 'TRACKELIGIBLE003', internalPackageId: 'ELIGIBLE-PKG-3' },
  ];
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      const packageId = new URLSearchParams(options.body).get('orderId');
      const item = cases.find((candidate) => candidate.internalPackageId === packageId);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { dxmOrder: { orderId: item.orderNo, orderStatusName: '待发货', platform: 'shein' } },
        }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      const packageIds = new URLSearchParams(options.body).get('packageIds').split(',');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: packageIds.map((id) => ({ idStr: id, platform: 'shein' })),
            sheinProviders: [{ fProductCode: 'IMILE', providerName: 'iMile' }],
          },
        }),
      };
    }
    if (url === '/api/package/withOutPrintShip.json') {
      return { ok: true, status: 200, json: async () => ({ code: 0, msg: 'accepted' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#result-count').textContent = '第1-2条，共2条记录';
    window.document.querySelector('#orders').innerHTML = cases.filter((item) => item.internalPackageId).map((item) => (
      `<tr class="vxe-body--row" rowid="${item.internalPackageId}"><td>${item.orderNo}</td></tr>`
    )).join('');
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = cases.map((item) => (
    `${item.orderNo}\t${item.trackingNo}\tiMile`
  )).join('\n');
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);

  assert.match(root.querySelector('.xynigo-dxm-logistics-summary').textContent, /导入 3 个订单：可发货 2 个，已安全排除 1 个/);
  assert.equal(root.querySelectorAll('[data-stage="preview"] tbody tr').length, 3);
  assert.equal(root.querySelectorAll('[data-stage="preview"] tbody tr[data-excluded="true"]').length, 1);
  assert.match(root.querySelector('tr[data-excluded="true"]').textContent, /GSH1EXCLUDED002B/);
  assert.match(root.querySelector('tr[data-excluded="true"]').textContent, /已排除/);
  assert.match(root.querySelector('.xynigo-dxm-logistics-confirm span').textContent, /只对可发货订单/);

  const confirmation = root.querySelector('.xynigo-dxm-logistics-confirm input');
  confirmation.checked = true;
  confirmation.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('[data-action="execute"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-summary').textContent.includes('已受理 2'));

  const shipmentRequests = requests.filter((request) => request.url === '/api/package/withOutPrintShip.json');
  assert.equal(shipmentRequests.length, 2);
  assert.deepEqual(shipmentRequests.map((request) => (
    new URLSearchParams(request.options.body).get('packageIds')
  )), ['ELIGIBLE-PKG-1', 'ELIGIBLE-PKG-3']);
  assert.match(root.querySelector('.xynigo-dxm-logistics-summary').textContent, /已排除 1 个状态已变化订单/);
  assert.equal(root.__xynigoResults.length, 3);
  assert.equal(root.__xynigoResults.filter((item) => item.state === 'skipped').length, 1);
  dom.window.close();
});

test('uses the selected concurrency and downgrades new dispatches to serial when Dianxiaomi is busy', async () => {
  const cases = Array.from({ length: 5 }, (_value, index) => ({
    orderNo: `GSU1PARALLEL00${index + 1}A`,
    trackingNo: `TRACKPARALLEL00${index + 1}`,
    internalPackageId: `PARALLEL-PKG-${index + 1}`,
  }));
  const events = [];
  const attempts = new Map();
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const shipmentHandler = async (_url, options) => {
    const packageId = new URLSearchParams(options.body).get('packageIds');
    const attempt = (attempts.get(packageId) || 0) + 1;
    attempts.set(packageId, attempt);
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    events.push(`start:${packageId}:${attempt}`);
    await delay(packageId === 'PARALLEL-PKG-1' && attempt === 1 ? 10 : 25);
    activeRequests -= 1;
    events.push(`end:${packageId}:${attempt}`);
    if (packageId === 'PARALLEL-PKG-1' && attempt === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: -1,
          msg: '正在执行移入运单号申请操作，请执行完操作后再重试',
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ code: 0, msg: 'accepted' }) };
  };
  const { dom, window, root, requests } = await openBatchShipmentPreview(cases, shipmentHandler);

  const concurrencyTwo = root.querySelector('input[name="xynigo-dxm-logistics-concurrency"][value="2"]');
  assert.equal(concurrencyTwo.checked, true);
  const concurrencyFour = root.querySelector('input[name="xynigo-dxm-logistics-concurrency"][value="4"]');
  concurrencyFour.checked = true;
  concurrencyFour.dispatchEvent(new window.Event('change', { bubbles: true }));
  const confirmation = root.querySelector('.xynigo-dxm-logistics-confirm input');
  confirmation.checked = true;
  confirmation.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('[data-action="execute"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-summary').textContent.includes('已受理 5'));

  assert.equal(maximumActiveRequests, 4);
  assert.deepEqual(events.filter((event) => event.startsWith('start:')), [
    'start:PARALLEL-PKG-1:1',
    'start:PARALLEL-PKG-2:1',
    'start:PARALLEL-PKG-3:1',
    'start:PARALLEL-PKG-4:1',
    'start:PARALLEL-PKG-1:2',
    'start:PARALLEL-PKG-5:1',
  ]);
  assert.ok(
    events.indexOf('start:PARALLEL-PKG-5:1') > events.indexOf('end:PARALLEL-PKG-1:2'),
  );
  assert.equal(
    requests.filter((request) => request.url === '/api/package/withOutPrintShip.json').length,
    6,
  );
  assert.match(root.querySelector('.xynigo-dxm-logistics-summary').textContent, /后续请求已自动降为串行/);
  dom.window.close();
});

test('stops dispatching new shipments after an unknown response and marks the remainder as paused', async () => {
  const cases = Array.from({ length: 5 }, (_value, index) => ({
    orderNo: `GSU1PAUSED000${index + 1}A`,
    trackingNo: `TRACKPAUSED000${index + 1}`,
    internalPackageId: `PAUSED-PKG-${index + 1}`,
  }));
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const shipmentHandler = async (_url, options) => {
    const packageId = new URLSearchParams(options.body).get('packageIds');
    await delay(packageId === 'PAUSED-PKG-1' ? 5 : 30);
    if (packageId === 'PAUSED-PKG-1') {
      return {
        ok: true,
        status: 200,
        json: async () => { throw new Error('invalid json'); },
      };
    }
    return { ok: true, status: 200, json: async () => ({ code: 0, msg: 'accepted' }) };
  };
  const { dom, window, root, requests } = await openBatchShipmentPreview(cases, shipmentHandler);

  const confirmation = root.querySelector('.xynigo-dxm-logistics-confirm input');
  confirmation.checked = true;
  confirmation.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('[data-action="execute"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-summary').textContent.includes('暂停未提交 3'));

  const shipmentRequests = requests.filter((request) => request.url === '/api/package/withOutPrintShip.json');
  assert.equal(shipmentRequests.length, 2);
  assert.equal(root.__xynigoResults.filter((item) => item.state === 'unknown').length, 1);
  assert.equal(root.__xynigoResults.filter((item) => item.state === 'submitted').length, 1);
  assert.equal(root.__xynigoResults.filter((item) => item.state === 'paused').length, 3);
  assert.equal(root.querySelectorAll('td[data-result="paused"]').length, 3);
  assert.match(root.querySelector('.xynigo-dxm-logistics-summary').textContent, /已停止派发剩余订单/);
  dom.window.close();
});

test('stops preflight before reading page rows when Dianxiaomi search mode is unavailable', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <table><tbody>
      <tr class="vxe-body--row" rowid="noise-1"><td>GSH1TEST00001A</td></tr>
      <tr class="vxe-body--row" rowid="noise-2"><td>OTHER_ORDER</td></tr>
    </tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    throw new Error(`unexpected fetch: ${url}`);
  };

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSH1TEST00001A\tJMXTEST000000001\tJ&T Express';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-feedback').textContent.includes('无法切换到店小秘“搜索”模式'));

  assert.equal(requests.length, 0);
  assert.equal(root.querySelector('[data-stage="preview"]').hidden, true);
  dom.window.close();
});

test('ignores a stale old paginator when the current search has converged to one target order', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent">
      <button id="search-button" type="button">搜索</button>
    </section>
    <div id="stale-result-count">第1-300条，共1381条记录</div>
    <div id="active-result-count">第1-300条，共1381条记录</div>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="before"><td>OLD_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { dxmOrder: { orderId: 'GSU1STALE0001A', orderStatusName: '待发货', platform: 'shein' } },
        }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: [{ idStr: '888001', platform: 'shein' }],
            sheinProviders: [{ fProductCode: 'IMILE', providerName: 'iMile' }],
          },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#active-result-count').textContent = '第1-1条，共1条记录';
    window.document.querySelector('#orders').innerHTML = (
      '<tr class="vxe-body--row" rowid="888001"><td>GSU1STALE0001A</td></tr>'
    );
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSU1STALE0001A\tTRACKSTALE0001\tiMile';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);

  assert.equal(root.querySelectorAll('[data-stage="preview"] tbody tr').length, 1);
  assert.equal(requests.filter((request) => request.url === '/api/order/detail.json').length, 1);
  assert.equal(requests.filter((request) => request.url === '/api/order/withOutPrintShippingList.json').length, 1);
  dom.window.close();
});

test('rejects a search result that still contains rows outside the requested batch', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent">
      <button id="search-button" type="button">搜索</button>
    </section>
    <div id="result-count">第1-300条，共1222条记录</div>
    <table><tbody id="orders"><tr class="vxe-body--row" rowid="before"><td>OLD_ORDER</td></tr></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#result-count').textContent = '第1-2条，共2条记录';
    window.document.querySelector('#orders').innerHTML = [
      '<tr class="vxe-body--row" rowid="target"><td>GSU1TEST00003C</td></tr>',
      '<tr class="vxe-body--row" rowid="unrelated"><td>UNRELATED_ORDER</td></tr>',
    ].join('');
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSU1TEST00003C\t9360000000000000000003\tUSPS';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-feedback').textContent.includes('搜索结果未收敛到本批订单'));

  assert.equal(requests.length, 0);
  assert.equal(root.querySelector('[data-stage="preview"]').hidden, true);
  dom.window.close();
});

test('blocks shipment when the requested carrier is absent from Dianxiaomi platform options', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent">
      <button id="search-button" type="button">搜索</button>
    </section>
    <table><tbody id="orders"></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/approved?go=m101',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            dxmOrder: { orderId: 'GSH1TEST00006F', orderStatusName: '待发货', platform: 'shein' },
            parentOrder: { countryCN: '美国', countryCode: 'US' },
          },
        }),
      };
    }
    if (url === '/api/order/withOutPrintShippingList.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: {
            orderList: [{ idStr: '987654321', platform: 'shein' }],
            sheinProviders: [{ fProductCode: 'DHL', providerName: 'DHL' }],
          },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#orders').innerHTML = '<tr class="vxe-body--row" rowid="987654321"><td>GSH1TEST00006F</td></tr>';
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-carrier').value = 'J&T';
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSH1TEST00006F\tJMXTEST000000006';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-feedback').textContent.includes('没有与“J&T”匹配'));

  assert.equal(root.querySelector('[data-stage="preview"]').hidden, true);
  assert.equal(
    requests.some((request) => request.url === '/api/package/withOutPrintShip.json'),
    false,
  );
  dom.window.close();
});

test('preflights and resubmits a failed order through commitPlatform without creating a new shipment', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section">
      <input id="searchContent">
      <button id="search-button" type="button">搜索</button>
    </section>
    <table><tbody id="orders"></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/shipped/fail?go=m10402',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            dxmOrder: {
              orderId: 'GSH1TEST00006F',
              orderStatusName: '发货失败',
              trackingNumber: 'JMXTEST000000006',
              agentProviderName: 'J&T Express Mexico',
              errorMsg: '物流方式不正确',
            },
          },
        }),
      };
    }
    if (url === '/api/package/commitPlatform.json') {
      return { ok: true, status: 200, json: async () => ({ code: 0, msg: '提交平台成功' }) };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#orders').innerHTML = '<tr class="vxe-body--row" rowid="987654321"><td>GSH1TEST00006F</td></tr>';
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  assert.equal(root.querySelector('input[name="xynigo-dxm-logistics-mode"]:checked').value, 'retry');
  assert.equal(root.querySelector('[data-action="preflight"]').textContent, '预检失败单');
  const shipMode = root.querySelector('input[name="xynigo-dxm-logistics-mode"][value="ship"]');
  shipMode.checked = true;
  shipMode.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('[data-action="preflight"]').click();
  assert.match(root.querySelector('.xynigo-dxm-logistics-feedback').textContent, /发货失败页禁止使用“首次发货”/);
  assert.equal(requests.length, 0);
  const retryMode = root.querySelector('input[name="xynigo-dxm-logistics-mode"][value="retry"]');
  retryMode.checked = true;
  retryMode.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('#xynigo-dxm-logistics-carrier').value = 'J&T';
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSH1TEST00006F\tJMXTEST000000006\tJ&T Express';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('[data-stage="preview"]').hidden === false);

  const previewText = root.querySelector('[data-stage="preview"]').textContent;
  assert.match(previewText, /J&T Express Mexico/);
  assert.match(previewText, /物流方式不正确/);
  assert.match(root.querySelector('[data-action="execute"]').textContent, /重新提交平台/);

  const confirmation = root.querySelector('.xynigo-dxm-logistics-confirm input');
  confirmation.checked = true;
  confirmation.dispatchEvent(new window.Event('change', { bubbles: true }));
  root.querySelector('[data-action="execute"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-summary').textContent.includes('重提完成：店小秘已受理 1'));

  const retryRequest = requests.find((request) => request.url === '/api/package/commitPlatform.json');
  assert.ok(retryRequest);
  assert.equal(new URLSearchParams(retryRequest.options.body).get('packageId'), '987654321');
  assert.equal(requests.some((request) => request.url === '/api/package/withOutPrintShip.json'), false);
  assert.equal(requests.some((request) => request.url === '/api/order/withOutPrintShippingList.json'), false);
  dom.window.close();
});

test('blocks failed-order resubmission when the entered tracking number differs from Dianxiaomi', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section"><input id="searchContent"><button id="search-button">搜索</button></section>
    <table><tbody id="orders"></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/shipped/fail?go=m10402',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            dxmOrder: {
              orderId: 'GSH1TEST00006F',
              trackingNumber: 'JMXTEST000000006',
              agentProviderName: 'J&T Express',
            },
          },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#orders').innerHTML = '<tr class="vxe-body--row" rowid="987654321"><td>GSH1TEST00006F</td></tr>';
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-carrier').value = 'J&T';
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSH1TEST00006F\tJMXTEST000000999\tJ&T';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-feedback').textContent.includes('与店小秘现有物流单号'));

  assert.equal(root.querySelector('[data-stage="preview"]').hidden, true);
  assert.equal(requests.some((request) => request.url === '/api/package/commitPlatform.json'), false);
  dom.window.close();
});

test('blocks iMile failed-order resubmission while Dianxiaomi still stores lowercase imile', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="search-section"><input id="searchContent"><button id="search-button">搜索</button></section>
    <table><tbody id="orders"></tbody></table>
  </body></html>`, {
    url: 'https://www.dianxiaomi.com/web/order/shipped/fail?go=m10402',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.chrome = { runtime: { getURL: (resource) => `chrome-extension://test/${resource}` } };
  window.HTMLElement.prototype.getBoundingClientRect = function getRect() {
    return { width: 120, height: 32, top: 10, left: 10, right: 130, bottom: 42 };
  };
  const requests = [];
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/order/detail.json') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            dxmOrder: {
              orderId: 'GSH1TESTIMILE',
              trackingNumber: 'TRACKIMILE001',
              agentProviderName: 'imile',
            },
          },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.document.querySelector('#search-button').addEventListener('click', () => {
    window.document.querySelector('#orders').innerHTML = '<tr class="vxe-body--row" rowid="987654321"><td>GSH1TESTIMILE</td></tr>';
  });

  window.eval(coreSource);
  window.eval(importSource);
  window.eval(templateSource);
  window.eval(contentSource);
  window.document.querySelector('#xynigo-dxm-logistics-entry button').click();
  const root = window.document.querySelector('#xynigo-dxm-logistics-root');
  root.querySelector('#xynigo-dxm-logistics-input').value = 'GSH1TESTIMILE\tTRACKIMILE001\tIMILE';
  root.querySelector('[data-action="preflight"]').click();
  await waitFor(() => root.querySelector('.xynigo-dxm-logistics-feedback').textContent.includes('与店小秘现有承运商 imile 不一致'));

  assert.equal(requests.some((request) => request.url === '/api/package/commitPlatform.json'), false);
  assert.equal(root.querySelector('[data-stage="preview"]').hidden, true);
  dom.window.close();
});
