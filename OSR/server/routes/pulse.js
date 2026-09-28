import express from 'express';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();
const PULSE_CATEGORIES = [
  'learning',
  'campus',
  'mobility',
  'connectivity',
  'wellbeing',
  'cultureCommunity',
  'studentVoice'
];

async function log(db, admin, action, id) {
  try {
    (await db.prepare(
      'INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)'
    ).run(admin?.id || null, admin?.email || 'system', action, 'pulse', id));
  } catch {}
}

function currentPeriod() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(new Date());
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  return `${year}-${month}`;
}

async function countSubmissions(db, period) {
  if (!period || period === 'all' || period === 'all-time') {
    return (await db.prepare('SELECT COUNT(*) AS count FROM pulse_submissions').get()).count;
  }
  return (await db.prepare('SELECT COUNT(*) AS count FROM pulse_submissions WHERE period=?').get(period)).count;
}

// Public: submit one anonymous, exactly ten-point allocation.
router.post('/submit', async (req, res) => {
  const db = req.app.locals.db;
  const allocation = req.body?.allocation;
  if (!allocation || typeof allocation !== 'object' || Array.isArray(allocation)) {
    return res.status(400).json({ error: 'Allocation required' });
  }

  const keys = Object.keys(allocation);
  if (keys.length !== PULSE_CATEGORIES.length || !PULSE_CATEGORIES.every(key => Object.hasOwn(allocation, key))) {
    return res.status(400).json({ error: 'Allocation must include all seven Pulse categories' });
  }
  if (PULSE_CATEGORIES.some(key => !Number.isInteger(allocation[key]) || allocation[key] < 0 || allocation[key] > 10)) {
    return res.status(400).json({ error: 'Each category must receive a whole number from 0 to 10' });
  }

  const total = PULSE_CATEGORIES.reduce((sum, key) => sum + allocation[key], 0);
  if (total !== 10) return res.status(400).json({ error: 'Must distribute exactly 10 points' });

  const id = `pulse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const period = currentPeriod();
  const insertSubmission = db.prepare(
    'INSERT INTO pulse_submissions (id, allocation, total_points, period) VALUES (?,?,?,?)'
  );
  const updateMonthly = db.prepare(`
    INSERT INTO pulse_aggregates (period, category, total_points, response_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(period, category) DO UPDATE SET
      total_points = pulse_aggregates.total_points + excluded.total_points,
      response_count = pulse_aggregates.response_count + 1,
      updated_at = datetime('now')
  `);
  const updateAllTime = db.prepare(`
    INSERT INTO pulse_aggregates (period, category, total_points, response_count)
    VALUES ('all-time', ?, ?, 1)
    ON CONFLICT(period, category) DO UPDATE SET
      total_points = pulse_aggregates.total_points + excluded.total_points,
      response_count = pulse_aggregates.response_count + 1,
      updated_at = datetime('now')
  `);

  (await db.transaction(async () => {
    (await insertSubmission.run(id, JSON.stringify(allocation), total, period));
    for (const category of PULSE_CATEGORIES) {
      (await updateMonthly.run(period, category, allocation[category]));
      (await updateAllTime.run(category, allocation[category]));
    }
  })());

  res.set('Cache-Control', 'no-store');
  res.status(201).json({ ok: true, id });
});

// Public: return real aggregates only. An empty result stays empty.
router.get('/aggregates', async (req, res) => {
  const db = req.app.locals.db;
  const { period = 'all-time' } = req.query;
  let rows;

  if (period === 'all') {
    rows = (await db.prepare("SELECT * FROM pulse_aggregates WHERE period!='all-time' ORDER BY period DESC, total_points DESC").all());
  } else {
    rows = (await db.prepare('SELECT * FROM pulse_aggregates WHERE period=? ORDER BY total_points DESC').all(period));
  }

  const totalResponses = (await countSubmissions(db, period));
  const totalPoints = rows.reduce((sum, row) => sum + row.total_points, 0);
  const categories = rows.map(row => ({
    ...row,
    percentage: totalPoints ? Math.round((row.total_points / totalPoints) * 100) : 0
  }));

  res.set('Cache-Control', 'no-store');
  res.json({ period, totalResponses, totalPoints, categories });
});

// Admin: aggregates and submission counts only; individual builds stay private.
router.get('/', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const { period, view = 'monthly' } = req.query;
  let rows;

  if (view === 'all-time' || period === 'all-time') {
    rows = (await db.prepare("SELECT * FROM pulse_aggregates WHERE period='all-time' ORDER BY total_points DESC").all());
  } else if (view === 'yearly') {
    const year = period || currentPeriod().slice(0, 4);
    rows = (await db.prepare(`
      SELECT category, SUM(total_points) AS total_points, SUM(response_count) AS response_count
      FROM pulse_aggregates
      WHERE period LIKE ? AND period!='all-time'
      GROUP BY category
      ORDER BY total_points DESC
    `).all(`${year}%`));
  } else {
    const selectedPeriod = period || currentPeriod();
    rows = (await db.prepare('SELECT * FROM pulse_aggregates WHERE period=? ORDER BY total_points DESC').all(selectedPeriod));
  }

  const totalResponses = (await countSubmissions(db));
  const monthly = (await db.prepare(
    'SELECT period, COUNT(*) AS count FROM pulse_submissions GROUP BY period ORDER BY period DESC LIMIT 12'
  ).all());
  const yearly = (await db.prepare(
    'SELECT substr(period,1,4) AS year, COUNT(*) AS count FROM pulse_submissions GROUP BY year ORDER BY year DESC'
  ).all());

  res.set('Cache-Control', 'no-store');
  res.json({ aggregates: rows, totalResponses, monthly, yearly, hasData: totalResponses > 0 });
});

// Admin: export aggregate records only.
router.get('/export', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const rows = (await db.prepare('SELECT * FROM pulse_aggregates ORDER BY period, total_points DESC').all());
  res.set('Cache-Control', 'no-store');
  res.json(rows);
});

// Admin: the data reviewer. Every period that has submissions, with counts so
// the OSR can examine (and then wipe) exactly the dates it means to.
router.get('/data', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const { from = '', to = '', sort = 'desc' } = req.query;
  const ascending = String(sort).toLowerCase() === 'asc';

  let submissions = await db.prepare('SELECT allocation, total_points, period, created_at FROM pulse_submissions ORDER BY created_at').all();
  submissions = submissions.filter(row => {
    const day = String(row.created_at || '').slice(0, 10);
    if (from && day && day < from) return false;
    if (to && day && day > to) return false;
    return true;
  });

  const buckets = new Map();
  for (const row of submissions) {
    const period = String(row.period || String(row.created_at || '').slice(0, 7) || 'unknown');
    if (!buckets.has(period)) {
      buckets.set(period, { period, responses: 0, points: 0, firstAt: row.created_at || '', lastAt: row.created_at || '', categories: {} });
    }
    const bucket = buckets.get(period);
    bucket.responses += 1;
    bucket.points += Number(row.total_points) || 0;
    bucket.lastAt = row.created_at || bucket.lastAt;
    if (!bucket.firstAt) bucket.firstAt = row.created_at || '';
    let allocation = {};
    try { allocation = JSON.parse(row.allocation || '{}'); } catch {}
    for (const [key, value] of Object.entries(allocation)) {
      bucket.categories[key] = (bucket.categories[key] || 0) + (Number(value) || 0);
    }
  }

  const rows = [...buckets.values()].map(bucket => {
    const top = Object.entries(bucket.categories).sort((a, b) => b[1] - a[1])[0];
    return {
      period: bucket.period,
      responses: bucket.responses,
      points: bucket.points,
      averagePoints: bucket.responses ? Math.round((bucket.points / bucket.responses) * 10) / 10 : 0,
      topCategory: top ? top[0] : '',
      topPoints: top ? top[1] : 0,
      firstAt: bucket.firstAt,
      lastAt: bucket.lastAt
    };
  });
  rows.sort((a, b) => (ascending ? 1 : -1) * String(a.period).localeCompare(String(b.period)));

  const totals = rows.reduce((accumulator, row) => ({
    responses: accumulator.responses + row.responses,
    points: accumulator.points + row.points
  }), { responses: 0, points: 0 });

  res.set('Cache-Control', 'no-store');
  res.json({ rows, totals, range: { from, to }, sort: ascending ? 'asc' : 'desc' });
});

// Admin: wipe Pulse data. `scope` is all, range (from/to dates) or periods
// (explicit `periods` array). Aggregate tables are always rebuilt from what
// remains, so the public Pulse never shows a deleted submission.
router.post('/purge', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const scope = String(req.body?.scope || '');
  const confirm = String(req.body?.confirm || '');
  if (!['all', 'range', 'periods'].includes(scope)) return res.status(400).json({ error: 'Choose what to wipe: all, range, or periods.' });
  if (scope === 'all' && confirm !== 'WIPE') return res.status(400).json({ error: 'Type WIPE to confirm deleting every BulSU Pulse record.' });

  const before = (await db.prepare('SELECT COUNT(*) AS c FROM pulse_submissions').get()).c;
  let removed = 0;
  let description = 'all records';

  await db.transaction(async () => {
    if (scope === 'all') {
      (await db.exec('DELETE FROM pulse_submissions'));
    } else if (scope === 'periods') {
      const periods = Array.isArray(req.body?.periods) ? req.body.periods.filter(value => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}$/.test(value)).slice(0, 120) : [];
      if (!periods.length) return; // nothing to do; handled below
      const statement = db.prepare('DELETE FROM pulse_submissions WHERE period=?');
      for (const period of periods) (await statement.run(period));
      description = periods.join(', ');
    } else {
      const from = typeof req.body?.from === 'string' ? req.body.from.slice(0, 10) : '';
      const to = typeof req.body?.to === 'string' ? req.body.to.slice(0, 10) : '';
      if (!from && !to) return;
      const sql = `DELETE FROM pulse_submissions WHERE substr(created_at,1,10) >= ? AND substr(created_at,1,10) <= ?`;
      (await db.prepare(sql).run(from || '0000-00-00', to || '9999-99-99'));
      description = `${from || 'the beginning'} to ${to || 'today'}`;
    }
    await rebuildAggregates(db);
  })();

  const after = (await db.prepare('SELECT COUNT(*) AS c FROM pulse_submissions').get()).c;
  removed = Number(before) - Number(after);
  (await log(db, req.admin, `Wiped BulSU Pulse data (${description}): ${removed} submissions`, 'wipe'));
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, removed, remaining: Number(after) });
});

// Rebuild every aggregate row from the submissions that still exist.
async function rebuildAggregates(db) {
  const rows = await db.prepare('SELECT period, allocation, total_points FROM pulse_submissions').all();
  const monthly = new Map();
  const allTime = new Map();
  for (const row of rows) {
    let allocation = {};
    try { allocation = JSON.parse(row.allocation || '{}'); } catch {}
    for (const category of PULSE_CATEGORIES) {
      const points = Number(allocation[category]) || 0;
      if (!monthly.has(row.period)) monthly.set(row.period, new Map());
      const bucket = monthly.get(row.period);
      bucket.set(category, (bucket.get(category) || 0) + points);
      allTime.set(category, (allTime.get(category) || 0) + points);
    }
  }
  (await db.exec('DELETE FROM pulse_aggregates'));
  const insert = db.prepare('INSERT INTO pulse_aggregates (period, category, total_points, response_count) VALUES (?,?,?,?) ON CONFLICT(period, category) DO UPDATE SET total_points=excluded.total_points, response_count=excluded.response_count, updated_at=datetime(\'now\')');
  const countPerPeriod = new Map();
  const counts = await db.prepare('SELECT period, COUNT(*) AS count FROM pulse_submissions GROUP BY period').all();
  for (const row of counts) countPerPeriod.set(row.period, Number(row.count) || 0);
  for (const [period, categories] of monthly) {
    for (const [category, points] of categories) {
      if (!points) continue;
      (await insert.run(period, category, points, countPerPeriod.get(period) || 0));
    }
  }
  const total = rows.length;
  for (const [category, points] of allTime) {
    if (!points) continue;
    (await insert.run('all-time', category, points, total));
  }
}

// Admin: atomically clear submissions and derived aggregates.
router.delete('/reset', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  (await db.transaction(async () => {
    (await db.exec('DELETE FROM pulse_submissions; DELETE FROM pulse_aggregates;'));
  })());
  (await log(db, req.admin, 'Reset BulSU Pulse data', 'reset'));
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

export default router;
