import { randomUUID } from 'node:crypto';
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { validateContent } from '../middleware/content.js';
const router = express.Router();
async function log(db, admin, action, id){ try{ (await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(admin?.id||null, admin?.email||'system', action, 'board_meeting', id));}catch{} }

router.get('/public', async (req,res)=>{
  const db=req.app.locals.db;
  const rows=(await db.prepare("SELECT * FROM board_meetings WHERE status='Published' ORDER BY date DESC").all()).map(r=>{ try{ r.related_documents=JSON.parse(r.related_documents)}catch{} return r; });
  res.json(rows);
});
router.get('/', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const {q, status}=req.query;
  let sql='SELECT * FROM board_meetings WHERE 1=1'; const p=[];
  if(status && status!=='all'){ sql+=' AND status=?'; p.push(status); }
  if(q){ sql+=' AND (title LIKE ? OR meeting_number LIKE ? OR description LIKE ?)'; p.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY date DESC';
  const rows=(await db.prepare(sql).all(...p)).map(r=>{ try{ r.related_documents=JSON.parse(r.related_documents)}catch{} return r; });
  res.json(rows);
});
router.get('/:id', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM board_meetings WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  try{ row.related_documents=JSON.parse(row.related_documents)}catch{}
  res.json(row);
});
router.post('/', authRequired, validateContent, async (req,res)=>{
  const db=req.app.locals.db;
  const { id, meeting_number, date, title, description, type, academic_year, status, minutes_link, related_documents }= req.body;
  if(!title) return res.status(400).json({error:'Title required'});
  const newId=`bm-${randomUUID()}`;
  (await db.prepare('INSERT INTO board_meetings (id, meeting_number, date, title, description, type, academic_year, status, minutes_link, related_documents, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId, meeting_number||'', date||new Date().toISOString().slice(0,10), title, description||'', type||'', academic_year||'', status||'Draft', minutes_link||'', JSON.stringify(related_documents||[]), req.admin.id));
  (await log(db, req.admin, `Created board meeting: ${title}`, newId));
  res.json({ok:true, id:newId});
});
router.patch('/:id', authRequired, validateContent, async (req,res)=>{
  const db=req.app.locals.db;
  const existing=(await db.prepare('SELECT * FROM board_meetings WHERE id=?').get(req.params.id));
  if(!existing) return res.status(404).json({error:'Not found'});
  const fields=['meeting_number','date','title','description','type','academic_year','status','minutes_link'];
  const updates=[]; const params=[];
  for(const f of fields) if(req.body[f]!==undefined){ updates.push(`${f}=?`); params.push(req.body[f]); }
  if(req.body.related_documents!==undefined){ updates.push('related_documents=?'); params.push(JSON.stringify(req.body.related_documents)); }
  if(!updates.length) return res.status(400).json({error:'No fields'});
  updates.push("updated_at=datetime('now')");
  params.push(req.params.id);
  (await db.prepare(`UPDATE board_meetings SET ${updates.join(',')} WHERE id=?`).run(...params));
  (await log(db, req.admin, `Updated board meeting: ${req.body.title||existing.title}`, req.params.id));
  res.json({ok:true});
});
router.delete('/:id', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM board_meetings WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare("UPDATE board_meetings SET status='Archived', updated_at=datetime('now') WHERE id=?").run(req.params.id));
  (await log(db, req.admin, `Deleted board meeting: ${row.title}`, req.params.id));
  res.json({ok:true});
});
export default router;
