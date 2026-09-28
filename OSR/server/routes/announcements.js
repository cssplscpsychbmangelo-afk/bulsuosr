import { randomUUID } from 'node:crypto';
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { validateContent } from '../middleware/content.js';
const router = express.Router();

async function logActivity(db, admin, action, id, details='') {
  try { (await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id, details) VALUES (?,?,?,?,?,?)').run(admin?.id||null, admin?.email||'system', action, 'announcement', id, details)); } catch {}
}

// Public list (published only)
router.get('/public', async (req,res)=>{
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db = req.app.locals.db;
  const rows = (await db.prepare("SELECT * FROM announcements WHERE status='Published' ORDER BY date DESC").all());
  res.json(rows);
});

// Admin list (all)
router.get('/', authRequired, async (req,res)=>{
  const db = req.app.locals.db;
  const { status, q } = req.query;
  let sql = 'SELECT * FROM announcements WHERE 1=1';
  const params = [];
  if (status && status !== 'all') { sql += ' AND status=?'; params.push(status); }
  if (q) { sql += ' AND (title LIKE ? OR summary LIKE ? OR category LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  sql += ' ORDER BY date DESC';
  res.json((await db.prepare(sql).all(...params)));
});

router.get('/:id', authRequired, async (req,res)=>{
  const db = req.app.locals.db;
  const row = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});

router.post('/', authRequired, validateContent, async (req,res)=>{
  const db = req.app.locals.db;
  const { id, title, category, date, summary, content, external_link, image, status } = req.body;
  if (!title) return res.status(400).json({error:'Title required'});
  const newId = id || `ann-${Date.now()}`;
  const st = status || 'Draft';
  try {
    (await db.prepare('INSERT INTO announcements (id, title, category, date, summary, content, external_link, image, status, created_by, published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(newId, title, category||'', date||new Date().toISOString().slice(0,10), summary||'', content||'', external_link||'', image||'', st, req.admin.id, st==='Published'? new Date().toISOString(): null));
    (await logActivity(db, req.admin, `Created announcement: ${title}`, newId));
    res.json({ ok:true, id:newId });
  } catch(e){ res.status(400).json({error:e.message}); }
});

router.patch('/:id', authRequired, validateContent, async (req,res)=>{
  const db = req.app.locals.db;
  const existing = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!existing) return res.status(404).json({error:'Not found'});
  const fields = ['title','category','date','summary','content','external_link','image','status'];
  const updates = [];
  const params = [];
  for (const f of fields) if (req.body[f] !== undefined) { updates.push(`${f}=?`); params.push(req.body[f]); }
  if (updates.length===0) return res.status(400).json({error:'No fields'});
  updates.push("updated_at=datetime('now')");
  if (req.body.status==='Published') updates.push("published_at=datetime('now')");
  params.push(req.params.id);
  (await db.prepare(`UPDATE announcements SET ${updates.join(', ')} WHERE id=?`).run(...params));
  (await logActivity(db, req.admin, `Updated announcement: ${req.body.title || existing.title}`, req.params.id));
  res.json({ ok:true });
});

router.delete('/:id', authRequired, async (req,res)=>{
  const db = req.app.locals.db;
  const row = (await db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id));
  if (!row) return res.status(404).json({error:'Not found'});
  (await db.prepare("UPDATE announcements SET status='Archived', updated_at=datetime('now') WHERE id=?").run(req.params.id));
  (await logActivity(db, req.admin, `Deleted announcement: ${row.title}`, req.params.id));
  res.json({ ok:true });
});

export default router;
