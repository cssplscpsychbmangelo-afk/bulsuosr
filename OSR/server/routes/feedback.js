import express from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { authRequired } from '../middleware/auth.js';

// Student concerns (with a public tracking code) and "Rate the OSR" service
// ratings. Both are written by students without an account and managed from
// Admin → Concerns / Service ratings.
export const concernsRouter = express.Router();
export const ratingsRouter = express.Router();

export const CONCERN_STATUSES = ['Received', 'In review', 'Responded', 'Closed'];
export const RATING_SERVICES = [
  'Free Printing Services',
  'Scholarships / Endorsements',
  'Medical Mission / Dialogues',
  'Consultation Caravan',
  'Board Updates / Advisories',
  'Concern handling',
  'Other OSR service'
];
const CAMPUSES = ['Main - Malolos', 'Bustos', 'Sarmiento', 'Meneses', 'San Rafael', 'Hagonoy', 'Other', ''];

const ready = new WeakSet();
async function ensureTables(db) {
  if (ready.has(db)) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS student_concerns (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      anonymous INTEGER DEFAULT 0,
      name TEXT,
      student_number TEXT,
      email TEXT,
      campus TEXT,
      category TEXT,
      concern TEXT NOT NULL,
      outcome TEXT,
      status TEXT NOT NULL DEFAULT 'Received',
      response TEXT,
      responded_by TEXT,
      responded_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS service_ratings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      student_number TEXT NOT NULL,
      campus TEXT,
      service TEXT NOT NULL,
      rating INTEGER NOT NULL,
      feedback TEXT,
      email TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  ready.add(db);
}

async function log(db, admin, action, type, id) {
  try {
    await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)')
      .run(admin?.id || null, admin?.email || 'system', action, type, id);
  } catch {}
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// BulSU student numbers look like 2021-123456 / 2021123456; accept digits with an optional dash.
export const STUDENT_NO = /^\d{4}-?\d{4,7}$/;

// The code a student is given and the only thing they need to track a concern:
// "BulSU - OSR - 4827". Four digits is short enough to read over the phone or
// copy by hand, which is the point — and short enough that two submissions can
// collide, so the code column carries a UNIQUE constraint and `freshCode` below
// simply draws again when the database says the number is taken. There are 9,000
// of them; the office's volume sits far below that, and if it ever did not, the
// student gets a clear "try again" rather than a duplicated code.
function trackingCode() {
  return `BulSU - OSR - ${crypto.randomInt(1000, 10000)}`;
}

// Accepts the code in any shape a student types or pastes it — with the spaces,
// without them, lower case, or the four digits on their own — and also the
// legacy "OSR-ABCD-2345" codes already stored, so nothing issued before this
// format stops working. Returns the exact string the row is stored under, or ''.
export function canonicalCode(value) {
  const raw = text(value, 60).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const modern = raw.match(/^(?:BULSU)?OSR(\d{4})$/) || raw.match(/^(\d{4})$/);
  if (modern) return `BulSU - OSR - ${modern[1]}`;
  const legacy = raw.replace(/^BULSU/, '').replace(/^OSR/, '');
  if (/^[A-Z0-9]{8}$/.test(legacy)) return `OSR-${legacy.slice(0, 4)}-${legacy.slice(4)}`;
  return '';
}

// Netlify Functions may not populate req.ip; fall back to the edge's client headers.
const clientKey = req => String(req.get('x-nf-client-connection-ip') || (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip || 'anon');
const publicLimiter = rateLimit({
  keyGenerator: clientKey,
  validate: false,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this connection. Please try again in a few minutes.' }
});
const trackLimiter = rateLimit({ keyGenerator: clientKey, validate: false, windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many lookups. Try again shortly.' } });

/* ── Concerns ─────────────────────────────────────────────────────────────── */

concernsRouter.post('/', publicLimiter, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  const body = req.body || {};
  const anonymous = body.anonymous === true || body.anonymous === '1' || body.anonymous === 1;
  const entry = {
    name: anonymous ? '' : text(body.name, 160),
    student_number: anonymous ? '' : text(body.studentNumber ?? body.student_number, 20),
    email: text(body.email, 200),
    campus: text(body.campus, 60),
    category: text(body.category, 80),
    concern: text(body.concern, 4000),
    outcome: text(body.outcome, 600)
  };
  if (!entry.concern || entry.concern.length < 10) return res.status(400).json({ error: 'Describe your concern in at least a sentence.' });
  if (!anonymous && !entry.name) return res.status(400).json({ error: 'Enter your name, or choose to submit anonymously.' });
  if (!anonymous && !entry.email) return res.status(400).json({ error: 'Enter your email, or choose to submit anonymously.' });
  if (entry.email && !EMAIL.test(entry.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (entry.student_number && !STUDENT_NO.test(entry.student_number)) return res.status(400).json({ error: 'Student number should look like 2021-123456.' });
  if (!CAMPUSES.includes(entry.campus)) entry.campus = 'Other';
  // The form gates on this checkbox; the server does not trust that it was ticked.
  const privacy = body.privacy === true || body.privacy === '1' || body.privacy === 1 || body.privacyConsent === 'on';
  if (!privacy) return res.status(400).json({ error: 'Please agree to the privacy notice before submitting.' });

  const id = `concern-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  let code = trackingCode();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await db.prepare(`INSERT INTO student_concerns (id, code, anonymous, name, student_number, email, campus, category, concern, outcome, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, code, anonymous ? 1 : 0, entry.name, entry.student_number, entry.email, entry.campus, entry.category, entry.concern, entry.outcome, 'Received');
      return res.status(201).json({ ok: true, code, status: 'Received' });
    } catch (error) {
      if (!/unique|duplicate/i.test(String(error.message))) throw error;
      code = trackingCode();
    }
  }
  res.status(500).json({ error: 'Could not create a tracking code. Please try again in a moment.' });
});

// Public: look up one concern by tracking code. Never returns personal details.
concernsRouter.get('/track/:code', trackLimiter, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  const code = canonicalCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'Tracking codes look like BulSU - OSR - 4827.' });
  const row = await db.prepare('SELECT code, campus, category, status, response, responded_at, created_at, updated_at FROM student_concerns WHERE code=?').get(code);
  if (!row) return res.status(404).json({ error: 'No concern matches that tracking code. Check the code and try again.' });
  res.set('Cache-Control', 'no-store');
  res.json({
    code: row.code,
    campus: row.campus || '',
    category: row.category || '',
    status: row.status,
    responded: Boolean(row.response),
    response: row.response || '',
    responded_at: row.responded_at || null,
    submitted_at: row.created_at,
    updated_at: row.updated_at
  });
});

concernsRouter.get('/', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  res.json(await db.prepare('SELECT * FROM student_concerns ORDER BY created_at DESC').all());
});

concernsRouter.patch('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  const current = await db.prepare('SELECT * FROM student_concerns WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Concern not found' });
  const status = req.body?.status ?? current.status;
  if (!CONCERN_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
  const response = req.body?.response === undefined ? (current.response || '') : text(req.body.response, 4000);
  const changedResponse = response !== (current.response || '');
  const nextStatus = changedResponse && response && status === 'Received' ? 'Responded' : status;
  await db.prepare(`UPDATE student_concerns SET status=?, response=?, responded_by=?, responded_at=?, updated_at=datetime('now') WHERE id=?`)
    .run(nextStatus, response, changedResponse ? (req.admin?.email || '') : current.responded_by, changedResponse ? new Date().toISOString().slice(0, 19).replace('T', ' ') : current.responded_at, current.id);
  await log(db, req.admin, `Concern ${current.code} → ${nextStatus}${changedResponse ? ' (response updated)' : ''}`, 'concern', current.id);
  res.json(await db.prepare('SELECT * FROM student_concerns WHERE id=?').get(current.id));
});

concernsRouter.delete('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  const current = await db.prepare('SELECT code FROM student_concerns WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Concern not found' });
  await db.prepare('DELETE FROM student_concerns WHERE id=?').run(req.params.id);
  await log(db, req.admin, `Deleted concern ${current.code}`, 'concern', req.params.id);
  res.json({ ok: true });
});

/* ── Service ratings ──────────────────────────────────────────────────────── */

ratingsRouter.get('/services', (req, res) => res.json(RATING_SERVICES));

ratingsRouter.post('/', publicLimiter, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  const body = req.body || {};
  const entry = {
    name: text(body.name, 160),
    student_number: text(body.studentNumber ?? body.student_number, 20),
    campus: text(body.campus, 60),
    service: text(body.service, 120),
    rating: Number(body.rating),
    feedback: text(body.feedback, 2000),
    email: text(body.email, 200)
  };
  if (entry.name.length < 2) return res.status(400).json({ error: 'Your full name is required to rate OSR services.' });
  if (!entry.student_number) return res.status(400).json({ error: 'Your student number is required to rate OSR services.' });
  if (!STUDENT_NO.test(entry.student_number)) return res.status(400).json({ error: 'Student number should look like 2021-123456.' });
  if (!RATING_SERVICES.includes(entry.service)) return res.status(400).json({ error: 'Choose the OSR service you are rating.' });
  if (!Number.isInteger(entry.rating) || entry.rating < 1 || entry.rating > 5) return res.status(400).json({ error: 'Choose a rating from 1 to 5.' });
  if (entry.email && !EMAIL.test(entry.email)) return res.status(400).json({ error: 'Enter a valid email address or leave it blank.' });
  if (!CAMPUSES.includes(entry.campus)) entry.campus = 'Other';
  const privacy = body.privacy === true || body.privacy === '1' || body.privacy === 1 || body.privacyConsent === 'on';
  if (!privacy) return res.status(400).json({ error: 'Please agree to the privacy notice before sending your rating.' });
  const id = `rating-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  await db.prepare('INSERT INTO service_ratings (id, name, student_number, campus, service, rating, feedback, email) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, entry.name, entry.student_number, entry.campus, entry.service, entry.rating, entry.feedback, entry.email);
  res.status(201).json({ ok: true });
});

ratingsRouter.get('/', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  res.json(await db.prepare('SELECT * FROM service_ratings ORDER BY created_at DESC').all());
});

ratingsRouter.delete('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTables(db);
  const result = await db.prepare('DELETE FROM service_ratings WHERE id=?').run(req.params.id);
  if (!result?.changes) return res.status(404).json({ error: 'Rating not found' });
  await log(db, req.admin, 'Deleted a service rating', 'rating', req.params.id);
  res.json({ ok: true });
});
