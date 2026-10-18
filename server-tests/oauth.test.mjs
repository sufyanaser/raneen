import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/google/[action].js';

function createMockReqRes({ method = 'GET', url = '/api/google/start', headers = {}, body = null } = {}) {
  const req = {
    method,
    url,
    headers: { ...headers },
    body,
  };

  let statusCode = 200;
  const resHeaders = {};
  let responseData = '';
  let ended = false;

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code) {
      statusCode = code;
    },
    setHeader(key, val) {
      resHeaders[key.toLowerCase()] = val;
    },
    getHeader(key) {
      return resHeaders[key.toLowerCase()];
    },
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      statusCode = statusCode || 200;
      resHeaders['content-type'] = 'application/json';
      responseData = JSON.stringify(data);
      ended = true;
      return res;
    },
    end(data) {
      if (data) responseData = data;
      ended = true;
      return res;
    },
    get ended() {
      return ended;
    },
    get responseData() {
      return responseData;
    },
    get headers() {
      return resHeaders;
    },
  };

  return { req, res };
}

test('returns 404 for unknown google action', async () => {
  const { req, res } = createMockReqRes({ url: '/api/google/unknown' });
  await handler(req, res);
  assert.equal(res.statusCode, 404);
});

test('enforces same-origin policy on session and logout', async () => {
  const { req: sReq, res: sRes } = createMockReqRes({
    method: 'POST',
    url: '/api/google/session',
    headers: { origin: 'https://evil.com' },
  });
  await handler(sReq, sRes);
  assert.equal(sRes.statusCode, 403);

  const { req: lReq, res: lRes } = createMockReqRes({
    method: 'POST',
    url: '/api/google/logout',
    headers: { origin: 'https://evil.com' },
  });
  await handler(lReq, lRes);
  assert.equal(lRes.statusCode, 403);
});

test('rejects disallowed methods for start and callback', async () => {
  const { req, res } = createMockReqRes({ method: 'POST', url: '/api/google/start' });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('returns 503 when OAuth environment variables are missing', async () => {
  const oldClientId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    const { req, res } = createMockReqRes({
      method: 'GET',
      url: '/api/google/start',
    });
    await handler(req, res);
    assert.equal(res.statusCode, 503);
  } finally {
    if (oldClientId) process.env.GOOGLE_CLIENT_ID = oldClientId;
  }
});

test('initiates OAuth PKCE redirect when credentials are configured', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.OAUTH_COOKIE_SECRET = 'this-is-a-very-long-secret-password-with-at-least-32-chars';

  const { req, res } = createMockReqRes({
    method: 'GET',
    url: '/api/google/start',
  });

  await handler(req, res);
  assert.equal(res.statusCode, 303);
  const location = res.getHeader('location');
  assert.ok(location);
  assert.ok(location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
  assert.ok(location.includes('client_id=test-client-id.apps.googleusercontent.com'));
  assert.ok(location.includes('code_challenge='));
  assert.ok(location.includes('code_challenge_method=S256'));
});
