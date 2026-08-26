'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const Background = require('../src/background.js');

const SESSION_TOKEN = 'synthetic_session_token_1234567890_abcd';
const POLL_TOKEN = 'synthetic_poll_token_1234567890_abcdef';
const IDENTITY = {
  user: { id: 'user-id', name: '合成运营', avatarUrl: '', status: 'active' },
  tenant: { id: 'tenant-id', name: '测试组织' },
  roles: ['operator'],
  permissions: ['procurement.request.read', 'procurement.request.save', 'procurement.request.submit'],
};

function chromeWithAuthState(authState = {}) {
  const normalizedAuthState = authState.sessionToken && !authState.sessionExpiresAt
    ? { ...authState, sessionExpiresAt: new Date(Date.now() + 3600000).toISOString() }
    : authState;
  const stored = { [Background.AUTH_STATE_KEY]: normalizedAuthState };
  return {
    runtime: { lastError: null },
    storage: {
      session: {
        get(_keys, callback) { callback({ ...stored }); },
        set(values, callback) { Object.assign(stored, values); callback(); },
      },
    },
    __stored: stored,
  };
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data; },
  };
}

function invalidJsonResponse(status = 500) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { throw new SyntaxError('not json'); },
  };
}

test('reports signed-out state without requiring the Xynigo local service', async () => {
  const connection = await Background.status(
    chromeWithAuthState(),
    async () => { throw new Error('fetch should not run'); },
  );
  assert.equal(connection.apiBaseUrl, 'https://xynigo.samforo.icu');
  assert.equal(connection.authenticated, false);
  assert.equal(connection.code, 'authentication_required');
});

test('starts Feishu login directly through Xynigo cloud and keeps poll token in session storage only', async () => {
  const chromeApi = chromeWithAuthState();
  const requests = [];
  const result = await Background.startAuth(chromeApi, async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({
      loginUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=synthetic',
      pollToken: POLL_TOKEN,
      expiresIn: 300,
    });
  });

  assert.equal(result.expiresIn, 300);
  assert.equal(requests[0].url, 'https://xynigo.samforo.icu/v1/auth/local/start');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].pending.pollToken, POLL_TOKEN);
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionToken, undefined);
});

test('polls Feishu login, stores the short Xynigo session, and verifies the member', async () => {
  const chromeApi = chromeWithAuthState({
    pending: { pollToken: POLL_TOKEN, expiresAt: Date.now() + 300000 },
  });
  const polled = await Background.pollAuth(chromeApi, async (url, options) => {
    assert.equal(url, 'https://xynigo.samforo.icu/v1/auth/local/poll');
    assert.deepEqual(JSON.parse(options.body), { pollToken: POLL_TOKEN });
    return jsonResponse({
      status: 'authenticated',
      sessionToken: SESSION_TOKEN,
      sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      identity: IDENTITY,
    });
  });
  assert.equal(polled.status, 'authenticated');
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionToken, SESSION_TOKEN);
  assert.match(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].pending, null);

  const status = await Background.status(chromeApi, async (url, options) => {
    assert.equal(url, 'https://xynigo.samforo.icu/v1/auth/me');
    assert.equal(options.headers.Authorization, `Bearer ${SESSION_TOKEN}`);
    return jsonResponse(IDENTITY);
  });
  assert.equal(status.authenticated, true);
  assert.equal(status.identity.user.name, '合成运营');
});

test('submits procurement data directly to cloud with the session token', async () => {
  const chromeApi = chromeWithAuthState({ sessionToken: SESSION_TOKEN, identity: IDENTITY });
  const draft = {
    orderKey: '测试店铺|GSH-DEMO|XMWU-DEMO',
    estimatedMetrics: { currency: 'MXN', estimatedProfit: 108.27, profitMargin: 51.99 },
  };
  const result = await Background.submit(chromeApi, async (url, options) => {
    assert.equal(url, 'https://xynigo.samforo.icu/v1/purchase-orders/submit');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, `Bearer ${SESSION_TOKEN}`);
    assert.deepEqual(JSON.parse(options.body), draft);
    return jsonResponse({ ok: true, data: { orderKey: draft.orderKey, submissionStatus: 'submitted' } });
  }, draft);
  assert.equal(result.submissionStatus, 'submitted');
});

test('reads the authoritative cloud order for post-reload reconciliation', async () => {
  const chromeApi = chromeWithAuthState({ sessionToken: SESSION_TOKEN, identity: IDENTITY });
  const orderKey = '测试店铺|GSH-DEMO|XMWU-DEMO';
  const result = await Background.getOrder(chromeApi, async (url, options) => {
    assert.equal(url, 'https://xynigo.samforo.icu/v1/purchase-orders/get');
    assert.equal(options.headers.Authorization, `Bearer ${SESSION_TOKEN}`);
    assert.deepEqual(JSON.parse(options.body), { orderKey });
    return jsonResponse({
      ok: true,
      data: { orderKey, submissionStatus: 'submitted', draftRevision: 1 },
    });
  }, orderKey);
  assert.equal(result.submissionStatus, 'submitted');
});

test('clears the browser-session credential after a cloud 401', async () => {
  const chromeApi = chromeWithAuthState({ sessionToken: SESSION_TOKEN, identity: IDENTITY });
  await assert.rejects(
    Background.saveDraft(chromeApi, async () => jsonResponse({
      detail: { code: 'session_invalid', message: '登录已失效' },
    }, 401), { orderKey: '测试店铺|GSH-DEMO|XMWU-DEMO' }),
    /登录已失效/,
  );
  assert.deepEqual(chromeApi.__stored[Background.AUTH_STATE_KEY], {});
});

test('clears an expired persisted session before any cloud request', async () => {
  const chromeApi = chromeWithAuthState({
    sessionToken: SESSION_TOKEN,
    sessionExpiresAt: new Date(Date.now() - 1000).toISOString(),
    identity: IDENTITY,
  });
  await assert.rejects(
    Background.getOrder(chromeApi, async () => { throw new Error('fetch should not run'); }, 'ORDER-DEMO'),
    /登录已失效/,
  );
  assert.deepEqual(chromeApi.__stored[Background.AUTH_STATE_KEY], {});
});

test('revokes the cloud session and clears local auth state on logout', async () => {
  const chromeApi = chromeWithAuthState({ sessionToken: SESSION_TOKEN, identity: IDENTITY });
  const result = await Background.logout(chromeApi, async (url, options) => {
    assert.equal(url, 'https://xynigo.samforo.icu/v1/auth/logout');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${SESSION_TOKEN}`);
    return { ok: true, status: 204, async json() { throw new Error('204 has no body'); } };
  });
  assert.deepEqual(result, { authenticated: false });
  assert.deepEqual(chromeApi.__stored[Background.AUTH_STATE_KEY], {});
});

test('reports a non-JSON HTTP 500 as a cloud service failure', async () => {
  const chromeApi = chromeWithAuthState({ sessionToken: SESSION_TOKEN, identity: IDENTITY });
  await assert.rejects(
    Background.submit(
      chromeApi,
      async () => invalidJsonResponse(500),
      { orderKey: '测试店铺|GSH-DEMO|XMWU-DEMO' },
    ),
    (error) => error.code === 'cloud_http_error'
      && error.status === 500
      && error.message === 'Xynigo 云端服务异常（HTTP 500）',
  );
});

test('rejects an untrusted login URL returned by cloud', async () => {
  await assert.rejects(
    Background.startAuth(chromeWithAuthState(), async () => jsonResponse({
      loginUrl: 'https://accounts.feishu.cn.evil.test/authorize',
      pollToken: POLL_TOKEN,
      expiresIn: 300,
    })),
    /不可信/,
  );
});
