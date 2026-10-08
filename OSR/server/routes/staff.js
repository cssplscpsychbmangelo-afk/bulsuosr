import express from 'express';
import crypto from 'node:crypto';
import { authRequired } from '../middleware/auth.js';

export const staffRouter = express.Router();

function sanitizeStaff(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send staff record as an object.' };
  }
  const staff = {};
  const allowed = ['name', 'role', 'photo', 'email', 'bio', 'is_published', 'order_index'];
  for (const key of allowed) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === undefined || value === '') {
      staff[key] = key === 'is_published' ? 1 : (key === 'order_index' ? 0 : '');
      continue;
    }
    if (key === 'is_published') {
      staff[key] = value && value !== 'false' && value !== '0' ? 1 : 0;
      continue;
    }
    if (key === 'order_index') {
      const num = Number(value);
      staff[key] = Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
      continue;
    }
    if (typeof value !== 'string') return { error: `"${key}" must be text.` };
    const text = value.trim();
    if (key === 'name' && !text) return { error: 'A staff record needs a name.' };
    if (key === 'name' && text.length > 120) return { error: `"name" is too long — ${text.length} characters.` };
    if (key === 'role' && text.length > 200) return { error: `"role" is too long.` };
    if (key === 'bio' && text.length > 600) return { error: `"bio" is too long.` };
    if (key === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: `"email" is not valid.` };
    if (key === 'photo' && text) {
      if (!(text.startsWith('/') && !text.startsWith('//')) && !/^https:\/\/\S+$/i.test(text)) {
        return { error: '"photo" must be an https:// image link or a local file path.' };
      }
    }
    staff[key] = text;
  }
  if (body && 'name' in body && !staff.name) return { error: 'A staff record needs a name.' };
  return { staff };
}

staffRouter.get('/', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const rows = await db.prepare('SELECT * FROM staff ORDER BY order_index, created_at').all();
  res.json(rows);
});

staffRouter.get('/public', async (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = req.app.locals.db;
  const rows = await db.prepare('SELECT id, name, role, photo, email, bio FROM staff WHERE is_published = 1 ORDER BY order_index, created_at').all();
  res.json(rows);
});

staffRouter.post('/', authRequired, async (req, res) => {
  const { error, staff } = sanitizeStaff(req.body);
  if (error) return res.status(400).json({ error });
  const db = req.app.locals.db;
  const id = `st-${crypto.randomBytes(6).toString('hex')}`;
  await db.prepare('INSERT INTO staff (id, name, role, photo, email, bio, is_published, order_index, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,datetime(\'now\'),datetime(\'now\'))').run(
    id, staff.name, staff.role || '', staff.photo || '', staff.email || '', staff.bio || '', staff.is_published ?? 1, staff.order_index ?? 0
  );
  await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(req.admin?.id || null, req.admin?.email || 'system', `Added staff: ${staff.name}`, 'staff', id);
  const created = await db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  res.json({ ok: true, id, staff: created });
});

staffRouter.patch('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const existing = await db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { error, staff } = sanitizeStaff(req.body);
  if (error) return res.status(400).json({ error });
  const keys = Object.keys(staff);
  if (!keys.length) return res.status(400).json({ error: 'No fields to update.' });
  const sets = keys.map(k => `${k} = ?`);
  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map(k => staff[k]), req.params.id);
  await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(req.admin?.id || null, req.admin?.email || 'system', `Updated staff: ${staff.name || existing.name}`, 'staff', req.params.id);
  res.json({ ok: true });
});

staffRouter.delete('/:id', authRequired, async (req, res) => {
  const db = req.app.locals.db;
  const existing = await db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
  await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(req.admin?.id || null, req.admin?.email || 'system', `Removed staff: ${existing.name}`, 'staff', req.params.id);
  res.json({ ok: true });
});

export default staffRouter;
