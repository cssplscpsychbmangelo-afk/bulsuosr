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
