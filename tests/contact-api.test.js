const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/contact.js');

const makeReq = (body) => ({
  method: 'POST',
  body,
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

test('returns validation error for missing required fields', async () => {
  const req = makeReq({ name: 'Alice' });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.match(res.payload.message, /required/i);
});

test('accepts valid contact payload', async () => {
  const req = makeReq({
    name: 'Alice',
    email: 'alice@example.com',
    phone: '+123',
    type: 'Product enquiry',
    subject: 'HDPE pipe',
    message: 'Need more information'
  });
  const res = makeRes();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.ok(res.payload.inquiry);

  const fs = require('node:fs');
  const path = require('node:path');
  const dataPath = path.join(__dirname, '..', 'data', 'inquiries.json');
  const savedEntries = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  fs.writeFileSync(
    dataPath,
    JSON.stringify(savedEntries.filter((entry) => entry.id !== res.payload.inquiry.id), null, 2)
  );
});
