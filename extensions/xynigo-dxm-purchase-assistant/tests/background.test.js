'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const Background = require('../src/background.js');

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const BRIDGE_TOKEN = 'synthetic_bridge_token_1234567890_abcd';

function chromeWithSettings(settings) {
  const stored = { xynigoDxmPurchaseSettings: settings };
  return {
    runtime: {
      id: EXTENSION_ID,
      lastError: null,
      getManifest() { return { version: '0.11.0' }; },
    },
    storage: {
      local: {
        get(_keys, callback) { callback({ ...stored }); },
        set(values, callback) {
          Object.assign(stored, values);
          callback();
        },
      },
    },
    __stored: stored,
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async json() { return data; },
  };
}

test('only accepts an explicit loopback HTTP API origin', () => {
  assert.equal(Background.normalizeApiBaseUrl('http://127.0.0.1:8766/'), 'http://127.0.0.1:8766');
  assert.throws(() => Background.normalizeApiBaseUrl('https://127.0.0.1:8765'), /127\.0\.0\.1/);
  assert.throws(() => Background.normalizeApiBaseUrl('http://localhost:8765'), /127\.0\.0\.1/);
  assert.throws(() => Background.normalizeApiBaseUrl('http://127.0.0.1:8765/proxy'), /127\.0\.0\.1/);
  assert.throws(() => Background.normalizeApiBaseUrl('http://example.com:8765'), /127\.0\.0\.1/);
});

test('sends a draft through the Xynigo bridge without exposing credentials in the URL', async () => {
  const requests = [];
  const draft = {
    orderKey: '测试店铺|GSH-DEMO-REMOTE|XMWU-DEMO-REMOTE',
    submissionStatus: 'draft',
  };
  const result = await Background.saveDraft(
    chromeWithSettings({ apiBaseUrl: 'http://127.0.0.1:8765', bridgeToken: BRIDGE_TOKEN }),
    async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        ok: true,
        data: {
          orderKey: draft.orderKey,
          submissionStatus: 'draft',
          syncStatus: 'pending',
          draftRevision: 1,
          draft,
        },
      });
    },
    draft,
  );

  assert.equal(result.syncStatus, 'pending');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:8765/api/extension/v1/purchase-orders/draft');
  assert.doesNotMatch(requests[0].url, /synthetic_bridge/);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['Content-Type'], 'text/plain;charset=UTF-8');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    clientId: EXTENSION_ID,
    bridgeToken: BRIDGE_TOKEN,
    draft,
  });
});

test('uses a distinct formal-submit endpoint', async () => {
  const requests = [];
  const draft = { orderKey: '测试店铺|GSH-DEMO|XMWU-DEMO' };
  const result = await Background.submit(
    chromeWithSettings({ apiBaseUrl: 'http://127.0.0.1:8765', bridgeToken: BRIDGE_TOKEN }),
    async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({ ok: true, data: { orderKey: draft.orderKey, submissionStatus: 'submitted' } });
    },
    draft,
  );

  assert.equal(result.submissionStatus, 'submitted');
  assert.equal(requests[0].url, 'http://127.0.0.1:8765/api/extension/v1/purchase-orders/submit');
  assert.equal(requests[0].body.clientId, EXTENSION_ID);
});

test('fails closed when the user-approved bridge token is not configured', async () => {
  await assert.rejects(
    Background.saveDraft(
      chromeWithSettings({ apiBaseUrl: 'http://127.0.0.1:8765', bridgeToken: '' }),
      async () => { throw new Error('fetch should not run'); },
      { orderKey: '测试店铺|GSH-DEMO|XMWU-DEMO' },
    ),
    /重新连接 Xynigo/,
  );
});

test('discovers Xynigo and returns a same-origin user approval URL', async () => {
  const chromeApi = chromeWithSettings({});
  const attempts = [];
  const result = await Background.connect(chromeApi, async (url) => {
    attempts.push(url);
    if (url !== 'http://127.0.0.1:8767/api/extension/v1/pair/request') {
      throw new TypeError('connection refused');
    }
    return jsonResponse({
      ok: true,
      service: 'xynigo-sourcing',
      apiVersion: 1,
      status: 'approval-required',
      approvalUrl: `http://127.0.0.1:8767/extension-connect?client_id=${EXTENSION_ID}`,
    });
  });

  assert.equal(result.apiBaseUrl, 'http://127.0.0.1:8767');
  assert.match(result.approvalUrl, /extension-connect/);
  assert.equal(attempts.length, 3);
});

test('stores a bridge approval only after verifying it with the same Xynigo origin', async () => {
  const chromeApi = chromeWithSettings({});
  let externalListener;
  chromeApi.runtime.onMessage = { addListener() {} };
  chromeApi.runtime.onMessageExternal = {
    addListener(listener) { externalListener = listener; },
  };
  Background.install(chromeApi, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8767/api/extension/v1/status');
    assert.equal(JSON.parse(options.body).bridgeToken, BRIDGE_TOKEN);
    return jsonResponse({
      ok: true,
      service: 'xynigo-sourcing',
      apiVersion: 1,
      authenticated: true,
      identity: { user: { name: '合成运营' } },
    });
  });

  const response = await new Promise((resolve) => {
    const asynchronous = externalListener({
      type: Background.BRIDGE_APPROVED_MESSAGE,
      apiBaseUrl: 'http://127.0.0.1:8767',
      bridgeToken: BRIDGE_TOKEN,
    }, {
      url: `http://127.0.0.1:8767/extension-connect?clientId=${EXTENSION_ID}`,
    }, resolve);
    assert.equal(asynchronous, true);
  });

  assert.equal(response.ok, true);
  assert.deepEqual(chromeApi.__stored.xynigoDxmPurchaseSettings, {
    apiBaseUrl: 'http://127.0.0.1:8767',
    bridgeToken: BRIDGE_TOKEN,
  });
});

test('reports HTTP status and content type when the local response is not JSON', async () => {
  await assert.rejects(
    Background.status(
      chromeWithSettings({ apiBaseUrl: 'http://127.0.0.1:8766', bridgeToken: BRIDGE_TOKEN }),
      async () => ({
        ok: true,
        status: 204,
        headers: { get: () => 'text/plain' },
        async json() { throw new SyntaxError('empty response'); },
      }),
    ),
    /HTTP 204，text\/plain/,
  );
});
