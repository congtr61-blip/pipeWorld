const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataPath = path.join(os.tmpdir(), `pipeworld-contact-test-${process.pid}.json`);
process.env.INQUIRIES_FILE = dataPath;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const handler = require('../api/contact.js');

const makeReq = (body, address = '192.0.2.10') => ({
  method: 'POST',
  body,
  headers: { 'x-forwarded-for': address }
});

const makeRes = () => {
  const res = {
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
  };
  return res;
};

const validPayload = {
  name: 'Alice',
  email: 'alice@example.com',
  phone: '+123',
  type: 'product',
  subject: 'HDPE pipe',
  message: 'Need more information'
};

test.after(() => {
  fs.rmSync(dataPath, { force: true });
});

test('rejects missing and invalid required fields', async () => {
  const missingRes = makeRes();
  await handler(makeReq({ name: 'Alice' }), missingRes);
  assert.equal(missingRes.statusCode, 400);
  assert.match(missingRes.payload.message, /required/i);

  const invalidEmailRes = makeRes();
  await handler(makeReq({ ...validPayload, email: 'not-an-email' }), invalidEmailRes);
  assert.equal(invalidEmailRes.statusCode, 400);
  assert.match(invalidEmailRes.payload.message, /valid email/i);

  const invalidTypeRes = makeRes();
  await handler(makeReq({ ...validPayload, type: 'admin' }), invalidTypeRes);
  assert.equal(invalidTypeRes.statusCode, 400);
  assert.match(invalidTypeRes.payload.message, /enquiry type/i);
});

test('honeypot submissions are acknowledged but never stored', async () => {
  const res = makeRes();
  await handler(makeReq({ ...validPayload, website: 'spam link' }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(fs.existsSync(dataPath), false);
});

test('stores valid inquiries and limits a client to five submissions per 15 minutes', async () => {
  const firstRes = makeRes();
  await handler(makeReq(validPayload, '192.0.2.11'), firstRes);
  assert.equal(firstRes.statusCode, 200);
  assert.equal(firstRes.payload.ok, true);
  assert.equal(firstRes.payload.inquiry.status, 'new');
  assert.equal(firstRes.payload.emailNotificationSent, false);

  for (let index = 1; index < 5; index += 1) {
    const res = makeRes();
    await handler(makeReq({ ...validPayload, email: `alice${index}@example.com` }, '192.0.2.11'), res);
    assert.equal(res.statusCode, 200);
  }

  const limitedRes = makeRes();
  await handler(makeReq(validPayload, '192.0.2.11'), limitedRes);
  assert.equal(limitedRes.statusCode, 429);
  assert.ok(Number(limitedRes.headers['Retry-After']) > 0);

  const savedEntries = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  assert.equal(savedEntries.length, 5);
});
