const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const COOKIE_NAME = 'pipeworld_admin';
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const PAGE_SIZE_OPTIONS = new Set([10, 25, 50]);
const INQUIRY_STATUSES = new Set(['new', 'in_progress', 'replied', 'completed']);
const dataFilePath = process.env.INQUIRIES_FILE || path.join(__dirname, '..', '..', 'data', 'inquiries.json');

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

const writeLocalInquiries = (entries) => {
  ensureDataFile();
  fs.writeFileSync(dataFilePath, JSON.stringify(entries, null, 2), 'utf8');
};

const parseBody = async (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body;
};

const parseQuery = (req) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1);
  const requestedPageSize = Number.parseInt(url.searchParams.get('pageSize'), 10) || 25;
  const pageSize = PAGE_SIZE_OPTIONS.has(requestedPageSize) ? requestedPageSize : 25;
  const status = url.searchParams.get('status') || '';
  const type = url.searchParams.get('type') || '';
  const search = (url.searchParams.get('search') || '')
    .replace(/[^\p{L}\p{N}\s@.+-]/gu, ' ')
    .trim()
    .slice(0, 100);

  return { page, pageSize, status, type, search, exportCsv: url.searchParams.get('export') === 'csv' };
};

const matchesFilters = (inquiry, filters) => {
  if (filters.status && (inquiry.status || 'new') !== filters.status) return false;
  if (filters.type && inquiry.type !== filters.type) return false;
  if (filters.search) {
    const search = filters.search.toLocaleLowerCase();
    const searchable = [inquiry.name, inquiry.email, inquiry.subject, inquiry.message]
      .join(' ')
      .toLocaleLowerCase();
    if (!searchable.includes(search)) return false;
  }
  return true;
};

const applySupabaseFilters = (query, filters) => {
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or([
      `name.ilike.${term}`,
      `email.ilike.${term}`,
      `subject.ilike.${term}`,
      `message.ilike.${term}`
    ].join(','));
  }
  return query;
};

const readInquiries = async (filters) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    let query = supabase
      .from('inquiries')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    query = applySupabaseFilters(query, filters);

    if (filters.exportCsv) {
      const inquiries = [];
      let from = 0;
      while (true) {
        const { data, error } = await query.range(from, from + 999);
        if (error) throw error;
        inquiries.push(...data);
        if (data.length < 1000) break;
        from += 1000;
      }
      return { inquiries, total: inquiries.length, storage: 'supabase' };
    }

    const from = (filters.page - 1) * filters.pageSize;
    const { data, count, error } = await query.range(from, from + filters.pageSize - 1);
    if (error) throw error;
    return { inquiries: data, total: count || 0, storage: 'supabase' };
  }

  const allInquiries = readLocalInquiries()
    .map((inquiry) => ({ status: 'new', admin_notes: '', ...inquiry }))
    .filter((inquiry) => matchesFilters(inquiry, filters))
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
  const start = (filters.page - 1) * filters.pageSize;
  const inquiries = filters.exportCsv
    ? allInquiries
    : allInquiries.slice(start, start + filters.pageSize);
  return { inquiries, total: allInquiries.length, storage: 'local' };
};

const updateInquiry = async (body) => {
  const id = String(body.id || '').trim();
  const status = String(body.status || '').trim();
  const adminNotes = String(body.admin_notes || '').trim();

  if (!id || id.length > 100) {
    return { error: 'A valid enquiry ID is required.' };
  }
  if (!INQUIRY_STATUSES.has(status)) {
    return { error: 'Select a valid enquiry status.' };
  }
  if (adminNotes.length > 4000) {
    return { error: 'Notes must be 4000 characters or fewer.' };
  }

  const updatedAt = new Date().toISOString();
  const update = { status, admin_notes: adminNotes, updated_at: updatedAt };
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    const { data, error } = await supabase
      .from('inquiries')
      .update(update)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: 'Enquiry not found.' };
    return { inquiry: { id, ...update }, storage: 'supabase' };
  }

  const inquiries = readLocalInquiries();
  const index = inquiries.findIndex((inquiry) => inquiry.id === id);
  if (index < 0) return { error: 'Enquiry not found.' };
  inquiries[index] = { ...inquiries[index], ...update };
  writeLocalInquiries(inquiries);
  return { inquiry: inquiries[index], storage: 'local' };
};

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const createCsv = (inquiries) => {
  const columns = [
    ['Submitted', 'created_at'],
    ['Name', 'name'],
    ['Email', 'email'],
    ['Phone', 'phone'],
    ['Type', 'type'],
    ['Subject', 'subject'],
    ['Status', 'status'],
    ['Admin notes', 'admin_notes'],
    ['Message', 'message']
  ];
  return [
    columns.map(([label]) => csvCell(label)).join(','),
    ...inquiries.map((inquiry) => columns.map(([, key]) => csvCell(inquiry[key])).join(','))
  ].join('\r\n');
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

const sendInquiries = async (req, res) => {
  const filters = parseQuery(req);
  const result = await readInquiries(filters);

  if (filters.exportCsv) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pipe-world-enquiries.csv"');
    return res.status(200).send(`\uFEFF${createCsv(result.inquiries)}`);
  }

  return res.status(200).json({
    ok: true,
    ...result,
    page: filters.page,
    pageSize: filters.pageSize
  });
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

      const { storage } = await readInquiries({ page: 1, pageSize: 1 });
      res.setHeader('Set-Cookie', sessionCookie(createSession(username), req));
      return res.status(200).json({ ok: true, storage });
    } catch (error) {
      console.error('Admin login error:', error);
      return res.status(500).json({ ok: false, message: 'Login failed.' });
    }
  }

  if (req.method === 'GET' || req.method === 'PATCH') {
    if (!hasValidSession(req)) {
      return res.status(401).json({ ok: false, message: 'Authentication required.' });
    }

    try {
      if (req.method === 'PATCH') {
        const result = await updateInquiry(await parseBody(req));
        if (result.error) return res.status(400).json({ ok: false, message: result.error });
        return res.status(200).json({ ok: true, ...result });
      }
      return await sendInquiries(req, res);
    } catch (error) {
      console.error(`Admin ${req.method.toLowerCase()} error:`, error);
      return res.status(500).json({
        ok: false,
        message: req.method === 'PATCH' ? 'Unable to update enquiry.' : 'Unable to load enquiries.'
      });
    }
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie(req));
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ ok: false, message: 'Method not allowed' });
};

module.exports.isAuthenticated = hasValidSession;
