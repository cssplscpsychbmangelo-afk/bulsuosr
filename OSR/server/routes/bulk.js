// Mass actions for the admin panel: publish, unpublish, archive, restore, and
// permanently delete many records at once. Every module is declared here with
// its table and publication column, so a typo in the request can never reach
// SQL: the module name is a key lookup, never an interpolated identifier.
import express from 'express';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();

const MODULES = {
  announcements: { table: 'announcements', statusColumn: 'status', label: 'announcements', itemLabel: 'announcement', logType: 'announcement' },
  board: { table: 'board_meetings', statusColumn: 'status', label: 'board meetings', itemLabel: 'board meeting', logType: 'board_meeting' },
  initiatives: { table: 'initiatives', statusColumn: 'status_public', label: 'initiatives', itemLabel: 'initiative', logType: 'initiative' },
  resources: { table: 'resources', statusColumn: 'status', label: 'resources', itemLabel: 'resource', logType: 'resource' },
  calendar: { table: 'calendar_events', statusColumn: 'status', label: 'calendar events', itemLabel: 'calendar event', logType: 'calendar_event' },
  media: { table: 'media', statusColumn: 'status', label: 'media items', itemLabel: 'media item', logType: 'media' }
};

const ACTIONS = {
  publish: { status: 'Published', verb: 'published' },
  draft: { status: 'Draft', verb: 'moved to draft' },
  archive: { status: 'Archived', verb: 'archived' },
  restore: { status: 'Published', verb: 'restored' },
  delete: { status: null, verb: 'deleted permanently' }
};

const MAX_IDS = 500;

function normalizeIds(raw) {
  if (!Array.isArray(raw)) return null;
  const ids = [];
  const seen = new Set();
  for (const value of raw) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const id = String(value).trim();
    if (!id || id.length > 120 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length > MAX_IDS) return null;
  }
  return ids;
}

async function log(db, admin, action, contentType, contentId, details) {
  try {
    await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id, details) VALUES (?,?,?,?,?,?)')
      .run(admin?.id || null, admin?.email || 'system', action, contentType, contentId, details);
  } catch {}
}

async function deleteMediaFiles(req, rows) {
  const store = req.app.locals.mediaStore;
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { uploadDir } = await import('../paths.js');
  for (const row of rows) {
    const filename = String(row.filename || '');
    if (!/^[A-Za-z0-9._-]+$/.test(filename)) continue;
    try {
      if (store) await store.delete(filename);
      else await fs.unlink(path.join(uploadDir, filename));
    } catch {}
  }
}

// Counts per module and status power the Bulk tools panel.
router.get('/summary', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const summary = {};
  for (const [key, module] of Object.entries(MODULES)) {
    const rows = await db.prepare(`SELECT ${module.statusColumn} AS status, COUNT(*) AS count FROM ${module.table} GROUP BY ${module.statusColumn}`).all();
    const counts = { total: 0, Published: 0, Draft: 0, Archived: 0 };
    for (const row of rows) {
      const status = ['Published', 'Draft', 'Archived'].includes(row.status) ? row.status : 'Draft';
      counts[status] += Number(row.count) || 0;
      counts.total += Number(row.count) || 0;
    }
    summary[key] = { ...counts, label: module.label, itemLabel: module.itemLabel };
  }
  res.set('Cache-Control', 'no-store');
  res.json(summary);
});

// Run one action over many ids. Returns how many records actually changed.
router.post('/', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const moduleKey = String(req.body?.module || '');
  const actionKey = String(req.body?.action || '');
  const module = MODULES[moduleKey];
  const action = ACTIONS[actionKey];
  if (!module || !action) return res.status(400).json({ error: 'Choose a valid section and action.' });

  const ids = normalizeIds(req.body?.ids);
  if (!ids) return res.status(400).json({ error: `Select between 1 and ${MAX_IDS} records.` });
  if (!ids.length) return res.json({ ok: true, affected: 0, module: moduleKey, action: actionKey });

  const placeholders = ids.map(() => '?').join(',');
  let affected = 0;
  let rows = [];

  if (actionKey === 'delete') {
    if (moduleKey === 'media') rows = await db.prepare(`SELECT id, filename FROM media WHERE id IN (${placeholders})`).all(...ids);
    else rows = await db.prepare(`SELECT id FROM ${module.table} WHERE id IN (${placeholders})`).all(...ids);
    const found = rows.map(row => row.id);
    if (found.length) {
      const foundPlaceholders = found.map(() => '?').join(',');
      const result = await db.prepare(`DELETE FROM ${module.table} WHERE id IN (${foundPlaceholders})`).run(...found);
      affected = Number(result.changes) || found.length;
      if (moduleKey === 'media') await deleteMediaFiles(req, rows);
    }
  } else {
    const result = await db.prepare(
      `UPDATE ${module.table} SET ${module.statusColumn}=?, updated_at=datetime('now') WHERE id IN (${placeholders})`
    ).run(action.status, ...ids);
    affected = Number(result.changes) || 0;
  }

  await log(
    db,
    req.admin,
    `Bulk ${action.verb} ${affected} ${affected === 1 ? module.itemLabel : module.label}`,
    module.logType,
    'bulk',
    JSON.stringify({ module: moduleKey, action: actionKey, requested: ids.length, affected })
  );

  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, affected, module: moduleKey, action: actionKey, verb: action.verb });
});

export default router;
export { MODULES as BULK_MODULES, ACTIONS as BULK_ACTIONS };
