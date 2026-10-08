const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');
const adminHandler = require('./index');

const BUCKET = 'pipeworld-cases';
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
const ALLOWED_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REQUIRED_FIELDS = [
  'title_en',
  'title_zh',
  'location_en',
  'location_zh',
  'category_en',
  'category_zh',
  'summary_en',
  'summary_zh',
  'details_en',
  'details_zh'
];
const FIELD_LIMITS = {
  title_en: 120,
  title_zh: 120,
  location_en: 120,
  location_zh: 120,
  category_en: 80,
  category_zh: 80,
  summary_en: 280,
  summary_zh: 280,
  details_en: 4000,
  details_zh: 4000
};

class InputError extends Error {}

const getClient = () => {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
  if (!url || !serviceKey) throw new Error('Supabase case storage is not configured.');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

const parseBody = async (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      throw new InputError('Request body must be valid JSON.');
    }
  }
  return req.body;
};

const normalizeCase = (body) => {
  const result = {};
  for (const [field, maxLength] of Object.entries(FIELD_LIMITS)) {
    result[field] = String(body[field] || '').trim();
    if (result[field].length > maxLength) {
      return { error: `${field} must be ${maxLength} characters or fewer.` };
    }
  }

  if (REQUIRED_FIELDS.some((field) => !result[field])) {
    return { error: 'Complete all English and Chinese case fields before saving.' };
  }

  if (!['draft', 'published'].includes(body.status)) {
    return { error: 'Select draft or published status.' };
  }

  result.status = body.status;
  return { value: result };
};

const uploadCover = async (supabase, image) => {
  if (!image) return null;
  if (!ALLOWED_IMAGES.has(image.type)) {
    throw new InputError('Cover image must be a JPG, PNG or WebP file.');
  }
  if (typeof image.data !== 'string' || !image.data.startsWith('data:')) {
    throw new InputError('Cover image data is invalid.');
  }

  const base64 = image.data.slice(image.data.indexOf(',') + 1);
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new InputError('Cover image must be no larger than 2.5 MB.');
  }
  const isJpeg = image.type === 'image/jpeg' && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = image.type === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const isWebp = image.type === 'image/webp'
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    throw new InputError('Cover image content does not match its file type.');
  }

  const extension = image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1];
  const imagePath = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(imagePath, buffer, {
    contentType: image.type,
    upsert: false
  });
  if (error) throw error;

  return {
    path: imagePath,
    url: supabase.storage.from(BUCKET).getPublicUrl(imagePath).data.publicUrl
  };
};

const deleteCover = async (supabase, imagePath) => {
  if (!imagePath) return;
  const { error } = await supabase.storage.from(BUCKET).remove([imagePath]);
  if (error) throw error;
};

const listCases = async (supabase) => {
  const { data, error } = await supabase
    .from('project_cases')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
};

const saveCase = async (req, supabase) => {
  const body = await parseBody(req);
  const normalized = normalizeCase(body);
  if (normalized.error) return { error: normalized.error };

  let existing = null;
  if (body.id) {
    const id = String(body.id).trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Invalid case ID.' };
    const { data, error } = await supabase
      .from('project_cases')
      .select('cover_url,cover_path,published_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { error: 'Case study not found.' };
    existing = data;
  }

  const now = new Date().toISOString();
  const row = {
    ...normalized.value,
    updated_at: now,
    published_at: normalized.value.status === 'published'
      ? existing?.published_at || now
      : null
  };
  const uploadedCover = await uploadCover(supabase, body.cover_image);
  if (uploadedCover) {
    row.cover_url = uploadedCover.url;
    row.cover_path = uploadedCover.path;
  }

  if (body.id) {
    const id = String(body.id).trim();
    if (!uploadedCover) {
      row.cover_url = existing.cover_url || '';
      row.cover_path = existing.cover_path || '';
    }
    let data;
    try {
      const result = await supabase
        .from('project_cases')
        .update(row)
        .eq('id', id)
        .select('*')
        .single();
      if (result.error) throw result.error;
      data = result.data;
    } catch (error) {
      if (uploadedCover) {
        try {
          await deleteCover(supabase, uploadedCover.path);
        } catch (cleanupError) {
          console.error('Unable to clean up unused case image:', cleanupError);
        }
      }
      throw error;
    }
    if (uploadedCover && existing.cover_path) await deleteCover(supabase, existing.cover_path);
    return { value: data };
  }

  let data;
  try {
    const result = await supabase
      .from('project_cases')
      .insert(row)
      .select('*')
      .single();
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    if (uploadedCover) {
      try {
        await deleteCover(supabase, uploadedCover.path);
      } catch (cleanupError) {
        console.error('Unable to clean up unused case image:', cleanupError);
      }
    }
    throw error;
  }
  return { value: data };
};

module.exports = async function handler(req, res) {
  if (!adminHandler.isAuthenticated(req)) {
    return res.status(401).json({ ok: false, message: 'Authentication required.' });
  }

  try {
    const supabase = getClient();
    if (req.method === 'GET') {
      return res.status(200).json({ ok: true, cases: await listCases(supabase) });
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      const result = await saveCase(req, supabase);
      if (result.error) return res.status(400).json({ ok: false, message: result.error });
      return res.status(200).json({ ok: true, case: result.value });
    }

    if (req.method === 'DELETE') {
      const body = await parseBody(req);
      const id = String(body.id || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ ok: false, message: 'Invalid case ID.' });
      }

      const { data: existing, error: readError } = await supabase
        .from('project_cases')
        .select('cover_path')
        .eq('id', id)
        .maybeSingle();
      if (readError) throw readError;
      if (!existing) return res.status(404).json({ ok: false, message: 'Case study not found.' });

      const { error } = await supabase.from('project_cases').delete().eq('id', id);
      if (error) throw error;
      if (existing.cover_path) await deleteCover(supabase, existing.cover_path);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ ok: false, message: 'Method not allowed.' });
  } catch (error) {
    if (error instanceof InputError) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    console.error('Admin case management error:', error);
    return res.status(500).json({
      ok: false,
      message: 'Unable to manage case studies. Check the Supabase case table and image bucket setup.'
    });
  }
};
