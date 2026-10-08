import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router = express.Router();

// The public About page ("About the Office of the Student Regent") is an office
// profile in three parts: the mandate, the Office and the people designated to
// it, and a compact reference to the university. Everything the page can show is
// stored here as one JSON document in site_settings and edited from Admin →
// About OSR, so this schema is exactly the page — a field nobody renders is not
// a field an administrator is asked to fill in. The Student Regent fields also
// feed the card beside the homepage masthead, which is why they stay.
//
// The earlier page carried a vision and mission band, core values, featured
// programme cards, an office-information table, a contact card, a link
// directory, directors and college representatives. Those keys are no longer
// read: they are dropped on the next save (unknown keys are never stored), and
// an existing document that still holds them simply does not render them.
const ABOUT_KEY = 'about_content';

// Single-line / paragraph fields: key → maximum characters.
const ABOUT_TEXT_FIELDS = {
  eyebrow: 80,
  title: 160,
  intro: 400,
  mandate_heading: 160,
  mandate_lede: 400,
  office_heading: 160,
  office_lede: 400,
  staff_heading: 160,
  sr_name: 200,
  sr_meta: 200,
  sr_note: 400,
  sr_photo: 400
};

// One-item-per-line fields: key → { max items, max characters per item }.
const ABOUT_LINE_FIELDS = {
  mandate_items: { max: 8, length: 300 }
};

// Repeatable rows: key → { max rows, columns }. The Office is a list of names,
// so a row carries a name, a position, an optional photo and one optional line
// about the person — and nothing else to fill in.
const ABOUT_LIST_FIELDS = {
  staff: {
    max: 24,
    required: 'name',
    fields: {
      name: { max: 160 },
      role: { max: 160 },
      note: { max: 300 },
      photo: { max: 400, photo: true }
    }
  }
};

// Photos: an uploaded file on this site (/uploads/...) or an https:// image URL.
function isSafePhoto(value) {
  const link = String(value || '').trim();
  if (!link) return true;
  if (link.startsWith('/') && !link.startsWith('//')) return true;
  return /^https:\/\/\S+$/i.test(link);
}

// Returns { error } for a rejected payload, or { content } with a clean copy.
export function sanitizeAboutContent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send the About page content as an object.' };
  }
  const content = {};

  for (const [key, max] of Object.entries(ABOUT_TEXT_FIELDS)) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === undefined || value === '') { content[key] = ''; continue; }
    if (typeof value !== 'string') return { error: `"${key}" must be text.` };
    const text = value.trim();
    if (text.length > max) return { error: `"${key}" is too long — ${text.length} characters, the limit is ${max}.` };
    content[key] = text;
  }
  if (content.sr_photo && !isSafePhoto(content.sr_photo)) return { error: '"sr_photo" must be an https:// image link or a file from the media library.' };

  for (const [key, rule] of Object.entries(ABOUT_LINE_FIELDS)) {
    if (!(key in body)) continue;
    const raw = body[key];
    const items = Array.isArray(raw)
      ? raw.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
      : typeof raw === 'string'
        ? raw.split('\n').map(line => line.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim()).filter(Boolean)
        : null;
    if (!items) return { error: `"${key}" must be a list of lines.` };
    if (items.length > rule.max) return { error: `"${key}" accepts at most ${rule.max} lines.` };
    const tooLong = items.find(item => item.length > rule.length);
    if (tooLong) return { error: `A line in "${key}" is too long — ${tooLong.length} characters, the limit is ${rule.length}.` };
    content[key] = items;
  }

  for (const [key, rule] of Object.entries(ABOUT_LIST_FIELDS)) {
    if (!(key in body)) continue;
    const rows = body[key];
    if (!Array.isArray(rows)) return { error: `"${key}" must be a list of rows.` };
    if (rows.length > rule.max) return { error: `"${key}" accepts at most ${rule.max} rows.` };
    const cleaned = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: `Every "${key}" row must be an object.` };
      const entry = {};
      let filled = false;
      for (const [field, column] of Object.entries(rule.fields)) {
        const value = row[field];
        if (value === null || value === undefined || value === '') { entry[field] = ''; continue; }
        if (typeof value !== 'string') return { error: `"${field}" must be text.` };
        const text = value.trim();
        if (text.length > column.max) return { error: `"${field}" is too long — ${text.length} characters, the limit is ${column.max}.` };
        entry[field] = text;
        if (text) filled = true;
        if (column.photo && !isSafePhoto(text)) return { error: `"${field}" must be an https:// image link or a file from the media library.` };
        if (column.email && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: `"${text}" is not a valid email address.` };
      }
      // A row where nothing was typed is not a row, and a row without the one
      // field the list is built from is not a person: both are dropped, so the
      // public page can never print a nameless officer.
      if (filled && (!rule.required || entry[rule.required])) cleaned.push(entry);
    }
    content[key] = cleaned;
  }

  // Unknown keys are ignored rather than stored: the schema above is the contract.
  return { content };
}

async function readAbout(db) {
  try {
    const row = (await db.prepare('SELECT value FROM site_settings WHERE key=?').get(ABOUT_KEY));
    if (!row || !row.value) return {};
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {}; // a corrupted value must never break the public About page
  }
}

async function writeAbout(db, content) {
  await db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')")
    .run(ABOUT_KEY, JSON.stringify(content));
}

// Public: the website reads the stored About content here. An empty object means
// "show the wording built into the site", which is what a fresh install gets.
router.get('/public', async (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json(await readAbout(req.app.locals.db));
});

// Admin read: same document, behind the session, for the About editor.
router.get('/', authRequired, async (req, res) => {
  res.json(await readAbout(req.app.locals.db));
});

// Admin write: any signed-in OSR administrator, like the contact details —
// these are the office facts staff are asked about, not site-wide copy.
router.patch('/', authRequired, async (req, res) => {
  const { error, content } = sanitizeAboutContent(req.body);
  if (error) return res.status(400).json({ error });
  const db = req.app.locals.db;
  await writeAbout(db, content);
  try {
    await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type) VALUES (?,?,?,?)')
      .run(req.admin.id, req.admin.email, 'Updated the About OSR page', 'settings');
  } catch {}
  res.json({ ok: true, content });
});

export default router;
