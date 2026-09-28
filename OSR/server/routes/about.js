import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router = express.Router();

// The public About page ("About the Office of the Student Regent") is structured
// office information: mandate, Student Regent, directors, vision and mission,
// office information, featured programs and official links. It used to be
// hard-coded in the website, so an administrator had no way to keep it current.
// Everything the page can show is stored here as one JSON document in
// site_settings and edited from Admin → About OSR.
const ABOUT_KEY = 'about_content';

// Single-line / paragraph fields: key → maximum characters.
const ABOUT_TEXT_FIELDS = {
  eyebrow: 80,
  title: 160,
  intro: 400,
  badge: 80,
  office_heading: 160,
  office_p1: 1200,
  office_p2: 1200,
  mandate_heading: 160,
  mandate_note: 400,
  sr_heading: 160,
  sr_label: 160,
  sr_name: 200,
  sr_meta: 200,
  sr_note: 400,
  dir_heading: 160,
  dir_intro: 400,
  dir_exec_name: 200,
  dir_exec_tag: 80,
  dir_names: 300,
  dir_tag: 80,
  college_title: 160,
  college_desc: 400,
  vm_heading: 160,
  vision: 1200,
  mission: 1200,
  values_note: 400,
  info_heading: 160,
  info_note: 400,
  contact_heading: 160,
  response_time: 200,
  featured_heading: 160,
  featured_intro: 400,
  featured_note: 400,
  links_heading: 160,
  links_note: 400
};

// One-item-per-line fields: key → { max items, max characters per item }.
const ABOUT_LINE_FIELDS = {
  mandate_items: { max: 12, length: 300 },
  values: { max: 8, length: 160 },
  college_rows: { max: 12, length: 300 }
};

// Repeatable rows: key → { max rows, columns }.
const ABOUT_LIST_FIELDS = {
  info: {
    max: 10,
    fields: { label: { max: 80 }, value: { max: 300 } }
  },
  featured: {
    max: 8,
    fields: {
      title: { max: 160 },
      tag: { max: 80 },
      description: { max: 500 },
      link_label: { max: 80 },
      link_href: { max: 400, link: true }
    }
  },
  links: {
    max: 12,
    fields: { label: { max: 160 }, href: { max: 400, link: true } }
  }
};

// Internal anchors (#board-meetings) and absolute https URLs only.
function isSafeLink(value) {
  if (typeof value !== 'string') return false;
  const link = value.trim();
  if (!link) return true; // empty means "keep the built-in link"
  if (link.startsWith('#')) return true;
  return /^https?:\/\/\S+$/i.test(link);
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
        if (column.link && !isSafeLink(text)) return { error: `"${field}" must start with https:// or be a #section of this site.` };
      }
      if (filled) cleaned.push(entry); // drop rows where nothing was typed
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
