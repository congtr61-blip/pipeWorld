const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const dataFilePath = path.join(__dirname, '..', 'data', 'inquiries.json');
const ensureDataFile = () => {
  const dir = path.dirname(dataFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dataFilePath)) fs.writeFileSync(dataFilePath, '[]', 'utf8');
};

const readLocalInquiries = () => {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalInquiries = (entries) => {
  ensureDataFile();
  fs.writeFileSync(dataFilePath, JSON.stringify(entries, null, 2), 'utf8');
};

const parseBody = async (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
};

const normalizePayload = (raw) => {
  const payload = raw || {};
  return {
    name: String(payload.name || '').trim(),
    email: String(payload.email || '').trim(),
    phone: String(payload.phone || '').trim(),
    type: String(payload.type || '').trim(),
    subject: String(payload.subject || '').trim(),
    message: String(payload.message || '').trim()
  };
};

const isMissingRequiredField = (payload) => {
  return !payload.name || !payload.email || !payload.type || !payload.message;
};

const sanitizeText = (value) => String(value || '').replace(/[\r\n]+/g, '\n').slice(0, 2000);
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const saveInquiry = async (payload) => {
  const inquiry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    name: sanitizeText(payload.name),
    email: sanitizeText(payload.email),
    phone: sanitizeText(payload.phone),
    type: sanitizeText(payload.type),
    subject: sanitizeText(payload.subject),
    message: sanitizeText(payload.message),
    created_at: new Date().toISOString()
  };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false }
    });
    const { error } = await supabase.from('inquiries').insert({ ...inquiry, id: inquiry.id });
    if (error) {
      console.error('Supabase insert error:', error.message);
      throw error;
    }
  } else {
    const entries = readLocalInquiries();
    entries.unshift(inquiry);
    writeLocalInquiries(entries);
  }

  return inquiry;
};

const sendEmail = async (inquiry) => {
  const resendApiKey = process.env.RESEND_API_KEY;
  const targetEmail = process.env.FORWARD_EMAIL;

  if (!resendApiKey || !targetEmail) {
    return { sent: false };
  }

  const resend = new Resend(resendApiKey);
  const subject = 'New Pipe World enquiry';
  const html = `
    <h2>New Pipe World enquiry</h2>
    <p><strong>Name:</strong> ${escapeHtml(inquiry.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(inquiry.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(inquiry.phone || '-')}</p>
    <p><strong>Type:</strong> ${escapeHtml(inquiry.type)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(inquiry.subject || '-')}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(inquiry.message).replace(/\n/g, '<br />')}</p>
  `;

  try {
    const response = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Pipe World <onboarding@resend.dev>',
      to: [targetEmail],
      replyTo: inquiry.email,
      subject,
      html
    });

    if (response.error) {
      console.error('Resend delivery error:', response.error.message);
      return { sent: false };
    }

    return { sent: true };
  } catch (error) {
    console.error('Resend request error:', error);
    return { sent: false };
  }
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const payload = normalizePayload(await parseBody(req));

    if (isMissingRequiredField(payload)) {
      return res.status(400).json({
        ok: false,
        message: 'Name, email, enquiry type and message are required.'
      });
    }

    const inquiry = await saveInquiry(payload);
    const emailResult = await sendEmail(inquiry);

    return res.status(200).json({
      ok: true,
      message: emailResult.sent
        ? 'Thank you. Your enquiry has been received.'
        : 'Your enquiry has been saved, but email notification could not be sent.',
      inquiry,
      emailNotificationSent: emailResult.sent
    });
  } catch (error) {
    console.error('Contact API error:', error);
    return res.status(500).json({
      ok: false,
      message: 'There was a problem sending your enquiry. Please try again later.'
    });
  }
};
