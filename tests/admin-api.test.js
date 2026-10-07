const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataPath = path.join(os.tmpdir(), `pipeworld-admin-test-${process.pid}.json`);
process.env.INQUIRIES_FILE = dataPath;
process.env.ADMIN_USERNAME = 'test-admin';
process.env.ADMIN_PASSWORD = 'test-password';
delete process.env.ADMIN_SESSION_SECRET;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  },
  send(payload) {
    this.payload = payload;
    return this;
  }
});

const inquiries = Array.from({ length: 12 }, (_, index) => ({
  id: `inquiry-${index + 1}`,
  name: index === 0 ? '=2+2' : `Customer ${index + 1}`,
  email: `customer${index + 1}@example.com`,
  phone: '',
  type: index % 2 === 0 ? 'product' : 'general',
  subject: `Pipe request ${index + 1}`,
  message: 'Please provide a quotation.',
  status: index === 0 ? 'new' : 'in_progress',
  admin_notes: '',
  created_at: new Date(Date.now() - index * 1000).toISOString()
}));

const login = async () => {
  const res = makeRes();
  await handler({
    method: 'POST',
    url: '/api/admin',
    headers: {},
    body: { username: 'test-admin', password: 'test-password' }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.storage, 'local');
  assert.match(res.headers['Set-Cookie'], /HttpOnly/);
  return res.headers['Set-Cookie'].split(';')[0];
};

test.before(() => {
  fs.writeFileSync(dataPath, JSON.stringify(inquiries, null, 2));
});

test.after(() => {
  fs.rmSync(dataPath, { force: true });
});

test('does not expose enquiries without an authenticated session', async () => {
  const res = makeRes();
  await handler({ method: 'GET', url: '/api/admin', headers: {} }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.ok, false);
});

test('logs in and paginates filtered inquiries', async () => {
  const cookie = await login();
  const res = makeRes();
  await handler({
    method: 'GET',
    url: '/api/admin?status=in_progress&type=product&search=customer&page=2&pageSize=10',
    headers: { cookie }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.storage, 'local');
  assert.equal(res.payload.total, 5);
  assert.equal(res.payload.page, 2);
  assert.equal(res.payload.inquiries.length, 0);
});

test('updates inquiry status and internal notes', async () => {
  const cookie = await login();
  const res = makeRes();
  await handler({
    method: 'PATCH',
    url: '/api/admin',
    headers: { cookie },
    body: {
      id: 'inquiry-1',
      status: 'replied',
      admin_notes: 'Sent quotation.'
    }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.inquiry.status, 'replied');
  assert.equal(res.payload.inquiry.admin_notes, 'Sent quotation.');
});

test('exports filtered CSV with spreadsheet formula protection', async () => {
  const cookie = await login();
  const res = makeRes();
  await handler({
    method: 'GET',
    url: '/api/admin?search=2%2B2&export=csv',
    headers: { cookie }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.match(res.payload, /'=2\+2/);
  assert.match(res.payload, /Admin notes/);
});

test('rejects an invalid inquiry status', async () => {
  const cookie = await login();
  const res = makeRes();
  await handler({
    method: 'PATCH',
    url: '/api/admin',
    headers: { cookie },
    body: { id: 'inquiry-1', status: 'unknown' }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.payload.message, /valid enquiry status/i);
});
