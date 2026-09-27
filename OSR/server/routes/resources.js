import { randomUUID } from 'node:crypto';
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { validateContent } from '../middleware/content.js';
const router=express.Router();
async function log(db,a,act,id){ try{(await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'resource',id));}catch{} }
router.get('/public',async (req,res)=>{
  const db=req.app.locals.db;
  res.json((await db.prepare("SELECT * FROM resources WHERE status='Published' ORDER BY created_at DESC").all()));
});
router.get('/',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const {q, status, category}=req.query;
  let sql='SELECT * FROM resources WHERE 1=1'; const p=[];
  if(status&&status!=='all'){ sql+=' AND status=?'; p.push(status); }
  if(category&&category!=='all'){ sql+=' AND category=?'; p.push(category); }
  if(q){ sql+=' AND (title LIKE ? OR description LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY created_at DESC';
  res.json((await db.prepare(sql).all(...p)));
});
router.get('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});
router.post('/',authRequired,validateContent,async (req,res)=>{
  const db=req.app.locals.db;
  const {id,title,description,category,file_url,external_link,status}=req.body;
  if(!title) return res.status(400).json({error:'Title required'});
  const newId=`res-${randomUUID()}`;
  (await db.prepare('INSERT INTO resources (id, title, description, category, file_url, external_link, status, created_by) VALUES (?,?,?,?,?,?,?,?)')
    .run(newId,title,description||'',category||'',file_url||'',external_link||'',status||'Draft',req.admin.id));
  (await log(db,req.admin,`Created resource: ${title}`,newId));
  res.json({ok:true,id:newId});
});
router.patch('/:id',authRequired,validateContent,async (req,res)=>{
  const db=req.app.locals.db;
  const ex=(await db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id));
  if(!ex) return res.status(404).json({error:'Not found'});
  const fields=['title','description','category','file_url','external_link','status'];
  const u=[]; const p=[];
  for(const f of fields) if(req.body[f]!==undefined){u.push(`${f}=?`); p.push(req.body[f]);}
  if(!u.length) return res.status(400).json({error:'No fields'});
  u.push("updated_at=datetime('now')");
  p.push(req.params.id);
  (await db.prepare(`UPDATE resources SET ${u.join(',')} WHERE id=?`).run(...p));
  (await log(db,req.admin,`Updated resource: ${req.body.title||ex.title}`,req.params.id));
  res.json({ok:true});
});
router.delete('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare("UPDATE resources SET status='Archived', updated_at=datetime('now') WHERE id=?").run(req.params.id));
  (await log(db,req.admin,`Deleted resource: ${row.title}`,req.params.id));
  res.json({ok:true});
});
export default router;
