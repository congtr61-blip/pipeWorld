const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/admin/index.js');

const makeRes = () => ({
  headers: {},
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(name, value) {
    this.headers[name] = value;
  },
  json(payload) {
    this.payload = payload;
    return this;
  }
});

test('does not expose enquiries without an authenticated session', async () => {
  const res = makeRes();
  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
});

test('login issues an HTTP-only cookie accepted by the dashboard endpoint', async () => {
  const previousUsername = process.env.ADMIN_USERNAME;
  const previousPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_USERNAME = 'test-admin';
  process.env.ADMIN_PASSWORD = 'test-password';

  try {
    const loginRes = makeRes();
    await handler({
      method: 'POST',
      headers: {},
      body: { username: 'test-admin', password: 'test-password' }
    }, loginRes);

    assert.equal(loginRes.statusCode, 200);
    assert.match(loginRes.headers['Set-Cookie'], /HttpOnly/);
    const cookie = loginRes.headers['Set-Cookie'].split(';')[0];
    const dashboardRes = makeRes();
    await handler({ method: 'GET', headers: { cookie } }, dashboardRes);

    assert.equal(dashboardRes.statusCode, 200);
    assert.equal(dashboardRes.payload.ok, true);
  } finally {
    if (previousUsername === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
  }
});
