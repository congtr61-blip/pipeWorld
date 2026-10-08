const test = require('node:test');
const assert = require('node:assert/strict');
const publishedCasesHandler = require('../api/cases.js');
const adminCasesHandler = require('../api/admin/cases.js');

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

test('public case endpoint reports missing Supabase configuration', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const res = makeRes();
    await publishedCasesHandler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.ok, false);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('case management API requires an admin session', async () => {
  const res = makeRes();
  await adminCasesHandler({
    method: 'GET',
    headers: {},
    url: '/api/admin/cases'
  }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
});
