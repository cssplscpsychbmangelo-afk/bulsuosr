import express from 'express';
import crypto from 'node:crypto';
import { authRequired } from '../middleware/auth.js';

// The leadership archive behind the public About page: two primary figures and a
// directorate of eight, each one a record the office can write, publish or
// withdraw, and drag into order without touching the frontend.
//
// Two rules shape the API. The archive is deliberately small — ten faces is an
// office, forty is a directory nobody reads — so the per-category limits are
// enforced here rather than left to the dashboard. And nothing is invented: a
// record without a name is refused, an unsafe photograph is refused, and the ten
// sample rows the dashboard can insert are marked `is_sample` so they can be
// removed in one call and can never be mistaken for records the office wrote.
export const leadershipRouter = express.Router();

export const LEADERSHIP_CATEGORIES = ['primary', 'director'];
export const LEADERSHIP_LIMITS = { primary: 2, director: 8 };

// Single-line and paragraph fields: column → maximum characters.
const TEXT_FIELDS = {
  name: 120,
  position: 140,
  number: 12,
  photo: 400,
  short_bio: 240,
  quote: 340,
  biography: 3000,
  facebook: 300,
  instagram: 300,
  email: 160
};

// One-item-per-line fields: column → { max items, max characters per item }.
const LINE_FIELDS = {
  responsibilities: { max: 14, length: 180 },
  previous_positions: { max: 14, length: 180 },
  projects: { max: 14, length: 180 }
};

// A photograph is a file this site serves or an https:// image. A social link is
// https:// or nothing — the archive is not a place for a javascript: URL.
const isSafePhoto = value => {
  const link = String(value || '').trim();
  if (!link) return true;
  if (link.startsWith('/') && !link.startsWith('//')) return true;
  return /^https:\/\/\S+$/i.test(link);
};
const isSafeLink = value => {
  const link = String(value || '').trim();
  return !link || /^https:\/\/\S+$/i.test(link);
};
const isEmail = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// Accepts the array the API returns or the textarea the dashboard edits, and
// always produces clean lines: bullets, dashes and leading numbers stripped.
export function toLines(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split('\n');
  return raw
    .map(line => String(line).replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

// Returns { error } for a rejected payload, or { profile } with a clean copy.
export function sanitizeProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send a profile as an object.' };
  }
  const profile = {};

  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === undefined || value === '') { profile[key] = ''; continue; }
    if (typeof value !== 'string' && typeof value !== 'number') return { error: `"${key}" must be text.` };
    const text = String(value).trim();
    if (text.length > max) return { error: `"${key}" is too long — ${text.length} characters, the limit is ${max}.` };
    profile[key] = text;
  }
  if ('name' in body && !profile.name) return { error: 'A profile needs a name. An unnamed seat is not a record.' };
  if (profile.photo && !isSafePhoto(profile.photo)) return { error: '"photo" must be an https:// image link, a Google Drive link, or a file from the media library.' };
  for (const key of ['facebook', 'instagram']) {
    if (profile[key] && !isSafeLink(profile[key])) return { error: `"${key}" must be an https:// link.` };
  }
  if (profile.email && !isEmail(profile.email)) return { error: `"${profile.email}" is not a valid email address.` };

  for (const [key, rule] of Object.entries(LINE_FIELDS)) {
    if (!(key in body)) continue;
    const items = toLines(body[key]);
    if (items.length > rule.max) return { error: `"${key}" accepts at most ${rule.max} lines.` };
    const tooLong = items.find(item => item.length > rule.length);
    if (tooLong) return { error: `A line in "${key}" is too long — ${tooLong.length} characters, the limit is ${rule.length}.` };
    profile[key] = items.join('\n');
  }

  if ('category' in body) {
    const category = String(body.category || '').trim();
    if (!LEADERSHIP_CATEGORIES.includes(category)) return { error: `"${category}" is not a category. Use ${LEADERSHIP_CATEGORIES.join(' or ')}.` };
    profile.category = category;
  }
  if ('order_index' in body) {
    const order = Number(body.order_index);
    if (!Number.isFinite(order)) return { error: '"order_index" must be a number.' };
    profile.order_index = Math.max(0, Math.trunc(order));
  }
  if ('is_published' in body) {
    profile.is_published = body.is_published && body.is_published !== 'false' && body.is_published !== '0' ? 1 : 0;
  }

  return { profile };
}

// Primary figures first, then the directorate, each in the order the dashboard
// left them. One query, so the sequence the admin drags is the sequence printed.
const ORDER = "ORDER BY CASE category WHEN 'primary' THEN 0 ELSE 1 END, order_index, created_at";

async function readAll(db) {
  return db.prepare(`SELECT * FROM leadership_profiles ${ORDER}`).all();
}

/* The printed number. `number` is an editorial override; when it is empty the
   sequence comes from the order, so dragging a card renumbers it instead of
   leaving the archive reading 03D, 01D, 02D.

   Only published records are counted. A withdrawn one is still a record in the
   dashboard, but it has no place in the printed sequence — counting it would
   leave the public page reading 01D, 02D, 03D, 05D, which looks like a mistake
   rather than like an archive. */
function withDisplayNumbers(rows) {
  const seen = { primary: 0, director: 0 };
  return rows.map(row => {
    const published = Number(row.is_published) === 1;
    if (published) seen[row.category] = (seen[row.category] || 0) + 1;
    const override = String(row.number || '').trim();
    const sequence = published ? String(seen[row.category]).padStart(2, '0') : '';
    const derived = sequence ? (row.category === 'primary' ? sequence : `${sequence}D`) : '';
    return { ...row, display_number: override || derived };
  });
}

function publicRow(row) {
  const out = { ...row };
  delete out.is_sample; // an admin fact, not a public one
  for (const key of Object.keys(LINE_FIELDS)) out[key] = toLines(row[key]);
  return out;
}

async function log(db, admin, action, id) {
  try {
    await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)')
      .run(admin?.id || null, admin?.email || 'system', action, 'leadership', id || null);
  } catch { /* the log must never be the reason a save failed */ }
}

// Public: the archive as the About page renders it.
leadershipRouter.get('/public', async (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const rows = withDisplayNumbers(await readAll(req.app.locals.db)).filter(row => Number(row.is_published) === 1);
  res.json(rows.map(publicRow));
});

// Admin: every record, published or not, with the sample flag the dashboard uses
// to offer "Remove samples".
leadershipRouter.get('/', authRequired, async (req, res) => {
  const rows = withDisplayNumbers(await readAll(req.app.locals.db));
  res.json(rows.map(row => ({ ...row, ...Object.fromEntries(Object.keys(LINE_FIELDS).map(key => [key, toLines(row[key])])) })));
});

leadershipRouter.post('/', authRequired, async (req, res) => {
  const { error, profile } = sanitizeProfile({ category: 'director', is_published: 1, ...req.body });
  if (error) return res.status(400).json({ error });
  if (!profile.name) return res.status(400).json({ error: 'A profile needs a name. An unnamed seat is not a record.' });

  const db = req.app.locals.db;
  const category = profile.category || 'director';
  const limit = LEADERSHIP_LIMITS[category];
  const held = (await db.prepare('SELECT COUNT(*) AS c FROM leadership_profiles WHERE category=?').get(category)).c;
  if (held >= limit) {
    return res.status(400).json({ error: `The archive holds ${limit} ${category === 'primary' ? 'primary leaders' : 'directors'}. Publish or remove one before adding another.` });
  }
  const last = (await db.prepare('SELECT MAX(order_index) AS m FROM leadership_profiles WHERE category=?').get(category)).m;

  const id = `ld-${crypto.randomBytes(6).toString('hex')}`;
  await db.prepare(`INSERT INTO leadership_profiles
    (id, category, name, position, number, photo, short_bio, quote, biography, responsibilities, previous_positions, projects, facebook, instagram, email, order_index, is_published, is_sample, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,datetime('now'),datetime('now'))`)
    .run(
      id, category, profile.name, profile.position || '', profile.number || '', profile.photo || '',
      profile.short_bio || '', profile.quote || '', profile.biography || '',
      profile.responsibilities || '', profile.previous_positions || '', profile.projects || '',
      profile.facebook || '', profile.instagram || '', profile.email || '',
      'order_index' in profile ? profile.order_index : (last || 0) + 1,
      'is_published' in profile ? profile.is_published : 1
    );

  await log(db, req.admin, `Added ${category === 'primary' ? 'primary leader' : 'director'}: ${profile.name}`, id);
  res.json({ ok: true, id, profile: publicRow(withDisplayNumbers(await readAll(db)).find(row => row.id === id)) });
});

/* ── The sample archive ───────────────────────────────────────────────────────
   Ten records that exist so the layout and the blur-to-clear interaction can be
   checked before the office has entered anybody. Every field says what it is,
   no photograph is attached (so the numbered plate shows), and each row carries
   is_sample=1 — which is what "Remove samples" deletes, and only that. Nothing
   here claims to be a real person or a real directorate. */
const SAMPLE_NOTE = 'Sample record. It exists so the archive can be checked before real records are entered — replace it from Admin → Leadership, or remove every sample in one click.';
const SAMPLE_LINES = ['Sample line — replace with the first real entry', 'Sample line — replace with the second real entry', 'Sample line — replace with the third real entry'];
export const LEADERSHIP_SAMPLES = [
  { category: 'primary', name: 'Sample Student Regent', position: 'Student Regent', short_bio: 'Sample short description — one line that appears when the card opens.', quote: 'Sample quotation, in the person\u2019s own words.', biography: SAMPLE_NOTE },
  { category: 'primary', name: 'Sample Executive Director', position: 'Executive Director', short_bio: 'Sample short description — one line that appears when the card opens.', quote: 'Sample quotation, in the person\u2019s own words.', biography: SAMPLE_NOTE },
  ...Array.from({ length: 8 }, (_, index) => ({
    category: 'director',
    name: `Sample Director ${String(index + 1).padStart(2, '0')}`,
    position: `Director, Portfolio ${String(index + 1).padStart(2, '0')}`,
    short_bio: 'Sample one-line description for a narrow card.',
    quote: index % 2 ? 'Sample quotation, shown in the record.' : '',
    biography: SAMPLE_NOTE
  }))
].map(profile => ({ ...profile, responsibilities: SAMPLE_LINES, previous_positions: SAMPLE_LINES.slice(0, 2), projects: SAMPLE_LINES.slice(0, 2) }));

leadershipRouter.post('/samples', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const samples = (await db.prepare('SELECT id FROM leadership_profiles WHERE is_sample=1').all()).map(row => row.id);
  const room = { ...LEADERSHIP_LIMITS };
  for (const row of await db.prepare('SELECT category, COUNT(*) AS c FROM leadership_profiles GROUP BY category').all()) {
    room[row.category] = Math.max(0, (LEADERSHIP_LIMITS[row.category] || 0) - row.c);
  }

  /* The loader fills the room that is left and nothing more: with one real
     primary figure already in the archive it brings one sample regent and eight
     sample directors, so the layout can be checked at full size without pushing
     the archive past the limits it enforces on the office. Ids are fixed per
     slot, so loading twice tops up rather than doubles. */
  const wanted = [];
  for (const [index, sample] of LEADERSHIP_SAMPLES.entries()) {
    const id = `ld-sample-${index + 1}`;
    if (samples.includes(id) || room[sample.category] <= 0) continue;
    room[sample.category] -= 1;
    wanted.push({ id, sample });
  }
  if (!wanted.length) return res.json({ ok: true, inserted: 0, existing: samples.length, full: true });

  const counters = { primary: 0, director: 0 };
  for (const row of await db.prepare("SELECT category, MAX(order_index) AS m FROM leadership_profiles GROUP BY category").all()) {
    counters[row.category] = row.m || 0;
  }
  for (const { id, sample } of wanted) {
    counters[sample.category] += 1;
    await db.prepare(`INSERT INTO leadership_profiles
      (id, category, name, position, number, photo, short_bio, quote, biography, responsibilities, previous_positions, projects, facebook, instagram, email, order_index, is_published, is_sample, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,datetime('now'),datetime('now'))`)
      .run(
        id, sample.category, sample.name, sample.position || '', '', '',
        sample.short_bio || '', sample.quote || '', sample.biography || '',
        (sample.responsibilities || []).join('\n'), (sample.previous_positions || []).join('\n'), (sample.projects || []).join('\n'),
        '', '', '', counters[sample.category]
      );
  }
  await log(db, req.admin, `Loaded ${wanted.length} sample leadership records`, 'samples');
  res.json({ ok: true, inserted: wanted.length, existing: samples.length + wanted.length });
});

leadershipRouter.delete('/samples', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const held = (await db.prepare('SELECT COUNT(*) AS c FROM leadership_profiles WHERE is_sample=1').get()).c;
  await db.prepare('DELETE FROM leadership_profiles WHERE is_sample=1').run();
  await log(db, req.admin, `Removed ${held} sample leadership records`, 'samples');
  res.json({ ok: true, removed: held });
});

leadershipRouter.patch('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const existing = (await db.prepare('SELECT * FROM leadership_profiles WHERE id=?').get(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { error, profile } = sanitizeProfile(req.body);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(profile);
  if (!keys.length) return res.status(400).json({ error: 'No fields to update.' });
  if ('name' in profile && !profile.name) return res.status(400).json({ error: 'A profile needs a name. An unnamed seat is not a record.' });

  // Moving a record between the two shelves has to respect the limit on the
  // shelf it is moving to, not just the one it is leaving.
  if (profile.category && profile.category !== existing.category) {
    const limit = LEADERSHIP_LIMITS[profile.category];
    const held = (await db.prepare('SELECT COUNT(*) AS c FROM leadership_profiles WHERE category=?').get(profile.category)).c;
    if (held >= limit) {
      return res.status(400).json({ error: `The archive holds ${limit} ${profile.category === 'primary' ? 'primary leaders' : 'directors'}. Publish or remove one before moving another across.` });
    }
  }

  const sets = keys.map(key => `${key}=?`);
  sets.push("updated_at=datetime('now')");
  await db.prepare(`UPDATE leadership_profiles SET ${sets.join(',')} WHERE id=?`)
    .run(...keys.map(key => profile[key]), req.params.id);

  await log(db, req.admin, `Updated ${profile.name || existing.name}`, req.params.id);
  res.json({ ok: true });
});

// Drag-and-drop and the ↑/↓ buttons both end up here: one array of ids in the
// new order, written per category so the two shelves stay independent.
leadershipRouter.post('/reorder', authRequired, async (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order) || !order.length) return res.status(400).json({ error: 'order array required' });
  const db = req.app.locals.db;
  const statement = db.prepare('UPDATE leadership_profiles SET order_index=?, updated_at=datetime(\'now\') WHERE id=?');
  const counters = { primary: 0, director: 0 };
  for (const id of order) {
    const row = (await db.prepare('SELECT category FROM leadership_profiles WHERE id=?').get(String(id)));
    if (!row) continue;
    counters[row.category] += 1;
    await statement.run(counters[row.category], String(id));
  }
  await log(db, req.admin, 'Reordered the leadership archive', 'bulk');
  res.json({ ok: true });
});

leadershipRouter.delete('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const row = (await db.prepare('SELECT * FROM leadership_profiles WHERE id=?').get(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  await db.prepare('DELETE FROM leadership_profiles WHERE id=?').run(req.params.id);
  await log(db, req.admin, `Removed ${row.name} from the archive`, req.params.id);
  res.json({ ok: true });
});

export default leadershipRouter;
