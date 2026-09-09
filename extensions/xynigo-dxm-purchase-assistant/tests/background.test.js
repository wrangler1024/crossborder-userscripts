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
    ? { ...authState, sessionExpiresAt: new Date(Date.now() + 8 * 3600000).toISOString() }
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
      sessionExpiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
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

function expiringChrome() {
  return chromeWithAuthState({ sessionToken: SESSION_TOKEN, identity: IDENTITY,
    sessionExpiresAt: new Date(Date.now() + 30 * 60000).toISOString() });
}

function renewal() {
  return { renewed: true,
    sessionExpiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
    sessionAbsoluteExpiresAt: new Date(Date.now() + 7 * 24 * 3600000).toISOString(),
    sessionRefreshAfter: new Date(Date.now() + 4 * 3600000).toISOString() };
}

test('renews before submitting and does not replay the business mutation', async () => {
  const chromeApi = expiringChrome();
  const updated = renewal();
  const paths = [];
  await Background.submit(chromeApi, async (url, options) => {
    paths.push(new URL(url).pathname);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, `Bearer ${SESSION_TOKEN}`);
    return url.endsWith('/refresh') ? jsonResponse(updated) : jsonResponse({ data: { saved: true } });
  }, { orderKey: 'TEST-ORDER' });
  assert.deepEqual(paths, ['/v1/auth/session/refresh', '/v1/purchase-orders/submit']);
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionExpiresAt, updated.sessionExpiresAt);
});

test('status preserves renewed expiry instead of overwriting it with a stale snapshot', async () => {
  const chromeApi = expiringChrome();
  const updated = renewal();
  const result = await Background.status(chromeApi, async (url) => (
    jsonResponse(url.endsWith('/refresh') ? updated : IDENTITY)
  ));
  assert.equal(result.authenticated, true);
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionExpiresAt, updated.sessionExpiresAt);
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionAbsoluteExpiresAt, updated.sessionAbsoluteExpiresAt);
});

test('concurrent requests share one in-flight renewal', async () => {
  const chromeApi = expiringChrome();
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let count = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/refresh')) {
      count += 1;
      started();
      await blocked;
      return jsonResponse(renewal());
    }
    return jsonResponse({ data: { found: true } });
  };
  const first = Background.getOrder(chromeApi, fetchImpl, 'TEST-ONE');
  await entered;
  const second = Background.getOrder(chromeApi, fetchImpl, 'TEST-TWO');
  release();
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('temporary renewal failure retains current expiry and backs off without losing login', async () => {
  const chromeApi = expiringChrome();
  const previousExpiry = chromeApi.__stored[Background.AUTH_STATE_KEY].sessionExpiresAt;
  let refreshes = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/refresh')) { refreshes += 1; return jsonResponse({}, 503); }
    return jsonResponse(IDENTITY);
  };
  assert.equal((await Background.status(chromeApi, fetchImpl)).authenticated, true);
  assert.equal((await Background.status(chromeApi, fetchImpl)).authenticated, true);
  assert.equal(refreshes, 1);
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionExpiresAt, previousExpiry);
  assert.ok(Date.parse(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionRefreshAfter) > Date.now());
});

test('revoked renewal clears login before any procurement request', async () => {
  const chromeApi = expiringChrome();
  let count = 0;
  await assert.rejects(Background.getOrder(chromeApi, async (url) => {
    count += 1;
    assert.ok(url.endsWith('/refresh'));
    return jsonResponse({ detail: { code: 'session_invalid' } }, 401);
  }, 'TEST-ORDER'), error => error.status === 401);
  assert.equal(count, 1);
  assert.deepEqual(chromeApi.__stored[Background.AUTH_STATE_KEY], {});
});

test('a renewal response arriving after logout cannot restore credentials or submit', async () => {
  const chromeApi = expiringChrome();
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const response = new Promise(resolve => { release = resolve; });
  let businessRequests = 0;
  const pending = Background.submit(chromeApi, async (url) => {
    if (url.endsWith('/refresh')) { started(); return response; }
    businessRequests += 1;
    return jsonResponse({ data: {} });
  }, { orderKey: 'TEST-ORDER' });
  const rejected = assert.rejects(pending, error => error.status === 401);
  await entered;
  await Background.logout(chromeApi, async (url) => {
    assert.ok(url.endsWith('/logout'));
    return jsonResponse({}, 204);
  });
  release(jsonResponse(renewal()));
  await rejected;
  assert.equal(businessRequests, 0);
  assert.deepEqual(chromeApi.__stored[Background.AUTH_STATE_KEY], {});
});

test('failure from an older request does not clear a newer login', async () => {
  const chromeApi = expiringChrome();
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const response = new Promise(resolve => { release = resolve; });
  const pending = Background.getOrder(chromeApi, async () => { started(); return response; }, 'TEST-ORDER');
  const rejected = assert.rejects(pending, error => error.status === 401);
  await entered;
  const newer = { sessionToken: 'new_synthetic_session_token_1234567890',
    sessionExpiresAt: new Date(Date.now() + 8 * 3600000).toISOString(), identity: IDENTITY };
  chromeApi.__stored[Background.AUTH_STATE_KEY] = newer;
  release(jsonResponse({ detail: { code: 'session_invalid' } }, 401));
  await rejected;
  assert.deepEqual(chromeApi.__stored[Background.AUTH_STATE_KEY], newer);
});

test('absolute expiry and malformed renewal responses never extend a local login', async () => {
  const chromeApi = expiringChrome();
  const expiry = chromeApi.__stored[Background.AUTH_STATE_KEY].sessionExpiresAt;
  await Background.status(chromeApi, async (url) => jsonResponse(
    url.endsWith('/refresh') ? { ...renewal(), sessionAbsoluteExpiresAt: 'invalid' } : IDENTITY,
  ));
  assert.equal(chromeApi.__stored[Background.AUTH_STATE_KEY].sessionExpiresAt, expiry);
  chromeApi.__stored[Background.AUTH_STATE_KEY].sessionAbsoluteExpiresAt = new Date(Date.now() - 1).toISOString();
  const status = await Background.status(chromeApi, async () => { throw new Error('must not fetch'); });
  assert.equal(status.authenticated, false);
  assert.deepEqual(chromeApi.__stored[Background.AUTH_STATE_KEY], {});
});
