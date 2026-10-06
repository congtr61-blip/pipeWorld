const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const COOKIE_NAME = 'pipeworld_admin';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const dataFilePath = path.join(__dirname, '..', '..', 'data', 'inquiries.json');

const ensureDataFile = () => {
  const dir = path.dirname(dataFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dataFilePath)) fs.writeFileSync(dataFilePath, '[]', 'utf8');
};

const readLocalInquiries = () => {
  ensureDataFile();
  const raw = fs.readFileSync(dataFilePath, 'utf8');
  const parsed = JSON.parse(raw || '[]');
  return Array.isArray(parsed) ? parsed : [];
};

const readInquiries = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    const { data, error } = await supabase
      .from('inquiries')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return { inquiries: data, storage: 'supabase' };
  }

  return { inquiries: readLocalInquiries(), storage: 'local' };
};

const parseBody = async (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body;
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const sessionSecret = () => process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;

const sign = (value) => crypto
  .createHmac('sha256', sessionSecret())
  .update(value)
  .digest('base64url');

const createSession = (username) => {
  const payload = Buffer.from(JSON.stringify({
    username,
    expiresAt: Date.now() + SESSION_DURATION_SECONDS * 1000
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
};

const readCookie = (req, name) => {
  const cookieHeader = req.headers?.cookie || '';
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : '';
};

const hasValidSession = (req) => {
  const token = readCookie(req, COOKIE_NAME);
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !sessionSecret()) return false;
  if (!safeEqual(signature, sign(payload))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.username === process.env.ADMIN_USERNAME
      && Number.isFinite(session.expiresAt)
      && session.expiresAt > Date.now();
  } catch {
    return false;
  }
};

const sessionCookie = (value, req) => {
  const secure = process.env.VERCEL === '1' || req.headers?.['x-forwarded-proto'] === 'https'
    ? '; Secure'
    : '';
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}${secure}`;
};

const clearSessionCookie = (req) => {
  const secure = process.env.VERCEL === '1' || req.headers?.['x-forwarded-proto'] === 'https'
    ? '; Secure'
    : '';
  return `${COOKIE_NAME}=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
};

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const username = process.env.ADMIN_USERNAME;
      const password = process.env.ADMIN_PASSWORD;
      if (!username || !password) {
        console.error('Admin credentials are not configured.');
        return res.status(503).json({ ok: false, message: 'Admin login is not configured.' });
      }

      if (!safeEqual(body.username, username) || !safeEqual(body.password, password)) {
        return res.status(401).json({ ok: false, message: 'Invalid admin credentials.' });
      }

      const { inquiries, storage } = await readInquiries();
      res.setHeader('Set-Cookie', sessionCookie(createSession(username), req));
      return res.status(200).json({ ok: true, inquiries, storage });
    } catch (error) {
      console.error('Admin login error:', error);
      return res.status(500).json({ ok: false, message: 'Login failed.' });
    }
  }

  if (req.method === 'GET') {
    if (!hasValidSession(req)) {
      return res.status(401).json({ ok: false, message: 'Authentication required.' });
    }

    try {
      const { inquiries, storage } = await readInquiries();
      return res.status(200).json({ ok: true, inquiries, storage });
    } catch (error) {
      console.error('Admin inquiry read error:', error);
      return res.status(500).json({ ok: false, message: 'Unable to load enquiries.' });
    }
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ ok: false, message: 'Method not allowed' });
};
