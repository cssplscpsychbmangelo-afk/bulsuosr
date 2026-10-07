import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import rateLimit from 'express-rate-limit';
import { uploadDir } from '../paths.js';
import { authRequired } from '../middleware/auth.js';

// Organization and council submissions: a student council, college council or
// recognized student organization files an official, signed document — a
// position, a resolution, a request, a statement, or a proposal endorsed to the
// Student Policy Development Office (SPDO). This is deliberately a separate
// mechanism from `student_concerns`: that one is a single student describing a
// problem, this one is an organization putting a document on the record.
//
// It reuses what the site already has — multer in memory, the same file store
// the media library writes to (Netlify Blobs in production, ./uploads locally),
// the same public rate limiter, and the same prepare/get/all/run db surface.
export const submissionsRouter = express.Router();

export const SUBMISSION_STATUSES = ['Received', 'Under review', 'Endorsed', 'Published', 'Returned'];
export const SUBMISSION_TOPICS = [
  'Position',
  'Resolution',
  'Request',
  'Official statement',
  'Proposal endorsed to SPDO',
  'Other organizational document'
];
const CAMPUSES = ['Main - Malolos', 'Bustos', 'Sarmiento', 'Meneses', 'San Rafael', 'Hagonoy', 'Other'];
export const SUBMISSION_FILE_LIMIT = 3 * 1024 * 1024;
const EXTENSION = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/png': '.png',
  'image/jpeg': '.jpg'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SUBMISSION_FILE_LIMIT, files: 1 },
  fileFilter: (req, file, cb) => {
    // Only the types the public form advertises. Mimetype comes from the
    // browser, so the extension is derived from it and never from the filename.
    if (!EXTENSION[file.mimetype]) return cb(new Error('Invalid file type'));
    cb(null, true);
  }
});

const ready = new WeakSet();
async function ensureTable(db) {
  if (ready.has(db)) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS org_submissions (
      id TEXT PRIMARY KEY,
      organization TEXT NOT NULL,
      campus TEXT,
      topic TEXT NOT NULL,
      title TEXT NOT NULL,
      email TEXT NOT NULL,
      filename TEXT,
      original_name TEXT,
      file_type TEXT,
      size INTEGER,
      status TEXT NOT NULL DEFAULT 'Received',
      note TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  ready.add(db);
}

async function log(db, admin, action, id) {
  try {
    await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)')
      .run(admin?.id || null, admin?.email || 'system', action, 'submission', id);
  } catch {}
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Netlify Functions may not populate req.ip; fall back to the edge's client headers.
const clientKey = req => String(req.get('x-nf-client-connection-ip') || (req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip || 'anon');
const publicLimiter = rateLimit({
  keyGenerator: clientKey,
  validate: false,
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this connection. Please try again in a few minutes.' }
});

/* ── Where a signed document lives ──────────────────────────────────────────
   One flat, unguessable filename either way. Locally it is kept in its own
   `submissions` folder so it is not served by the public /uploads static
   mount; on Netlify it goes into the same blob store the media library uses,
   and is only ever handed back through the authenticated route below. */
const storeName = filename => `osr-submission-${filename}`;

async function saveFile(app, filename, buffer, type) {
  if (app.locals.mediaStore) {
    await app.locals.mediaStore.set(storeName(filename), buffer, { metadata: { type } });
    return;
  }
  const dir = path.join(uploadDir, 'submissions');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
}

async function readFile(app, filename) {
  if (app.locals.mediaStore) {
    const file = await app.locals.mediaStore.get(storeName(filename), { type: 'arrayBuffer' });
    return file ? Buffer.from(file) : null;
  }
  try { return await fs.readFile(path.join(uploadDir, 'submissions', filename)); }
  catch { return null; }
}

async function deleteFile(app, filename) {
  if (!filename) return;
  try {
    if (app.locals.mediaStore) await app.locals.mediaStore.delete(storeName(filename));
    else await fs.unlink(path.join(uploadDir, 'submissions', filename));
  } catch {}
}

/* ── Public: file a document ─────────────────────────────────────────────── */
submissionsRouter.post('/', publicLimiter, upload.single('document'), async (req, res, next) => {
  try {
    const db = req.app.locals.db;
    await ensureTable(db);
    const body = req.body || {};
    const entry = {
      organization: text(body.organization, 160),
      campus: text(body.campus, 60),
      topic: text(body.topic, 80),
      title: text(body.title, 200),
      email: text(body.email, 200)
    };
    // The public form gates on this checkbox; the server does not trust that it
    // was clicked. A filing without consent to the privacy notice is refused.
    const privacy = body.privacyConsent === 'on' || body.privacy === true || body.privacy === '1' || body.privacy === 1;
    if (!privacy) return res.status(400).json({ error: 'Please agree to the privacy notice before submitting.' });
    if (entry.organization.length < 3) return res.status(400).json({ error: 'Enter the name of your organization or council.' });
    if (!SUBMISSION_TOPICS.includes(entry.topic)) return res.status(400).json({ error: 'Choose what you are filing: a position, resolution, request, or statement.' });
    if (entry.title.length < 3) return res.status(400).json({ error: 'Give the document a title so the office can record it.' });
    if (!EMAIL.test(entry.email)) return res.status(400).json({ error: 'Enter a contact email so the OSR can reply to your organization.' });
    if (!CAMPUSES.includes(entry.campus)) entry.campus = 'Other';
    if (!req.file) return res.status(400).json({ error: 'Attach the signed document.' });

    const id = `submission-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const filename = `${crypto.randomUUID()}${EXTENSION[req.file.mimetype]}`;
    await saveFile(req.app, filename, req.file.buffer, req.file.mimetype);
    await db.prepare(`INSERT INTO org_submissions (id, organization, campus, topic, title, email, filename, original_name, file_type, size, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, entry.organization, entry.campus, entry.topic, entry.title, entry.email, filename, req.file.originalname.slice(0, 200), req.file.mimetype, req.file.size, 'Received');
    res.status(201).json({ ok: true, id, status: 'Received' });
  } catch (error) { next(error); }
});

/* ── Admin: read, move along, open the document, delete ──────────────────── */
submissionsRouter.get('/', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTable(db);
  res.json(await db.prepare('SELECT * FROM org_submissions ORDER BY created_at DESC').all());
});

submissionsRouter.patch('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTable(db);
  const current = await db.prepare('SELECT * FROM org_submissions WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Submission not found' });
  const status = req.body?.status ?? current.status;
  if (!SUBMISSION_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });
  const note = req.body?.note === undefined ? (current.note || '') : text(req.body.note, 2000);
  await db.prepare(`UPDATE org_submissions SET status=?, note=?, reviewed_by=?, reviewed_at=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, note, req.admin?.email || '', new Date().toISOString().slice(0, 19).replace('T', ' '), current.id);
  await log(db, req.admin, `Submission “${current.title}” → ${status}`, current.id);
  res.json(await db.prepare('SELECT * FROM org_submissions WHERE id=?').get(current.id));
});

// The signed document is never on a public path: it is streamed to a signed-in
// administrator, with a content-disposition so a browser shows rather than runs it.
submissionsRouter.get('/:id/file', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTable(db);
  const row = await db.prepare('SELECT * FROM org_submissions WHERE id=?').get(req.params.id);
  if (!row?.filename) return res.status(404).json({ error: 'Document not found' });
  const buffer = await readFile(req.app, row.filename);
  if (!buffer) return res.status(404).json({ error: 'Document not found' });
  await log(db, req.admin, `Opened the document filed with “${row.title}”`, row.id);
  res.set('Content-Type', row.file_type || 'application/octet-stream');
  res.set('Content-Disposition', `inline; filename="${(row.original_name || row.filename).replace(/["\\\r\n]/g, '')}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(buffer);
});

submissionsRouter.delete('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  await ensureTable(db);
  const current = await db.prepare('SELECT * FROM org_submissions WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Submission not found' });
  await db.prepare('DELETE FROM org_submissions WHERE id=?').run(current.id);
  await deleteFile(req.app, current.filename);
  await log(db, req.admin, `Deleted submission “${current.title}”`, current.id);
  res.json({ ok: true });
});
