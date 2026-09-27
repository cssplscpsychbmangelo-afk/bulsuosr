import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
async function log(db,a,act,id){ try{(await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'initiative',id));}catch{} }
router.get('/public',async (req,res)=>{
  const db=req.app.locals.db;
  const rows=(await db.prepare("SELECT * FROM initiatives WHERE status_public='Published' ORDER BY date DESC").all()).map(r=>{try{r.links=JSON.parse(r.links)}catch{} return r;});
  res.json(rows);
});
router.get('/',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const {q,status}=req.query;
  let sql='SELECT * FROM initiatives WHERE 1=1'; const p=[];
  if(status&&status!=='all'){ sql+=' AND status=?'; p.push(status); }
  if(q){ sql+=' AND (title LIKE ? OR description LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY date DESC';
  const rows=(await db.prepare(sql).all(...p)).map(r=>{try{r.links=JSON.parse(r.links)}catch{} return r;});
  res.json(rows);
});
router.get('/:id',async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM initiatives WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  try{row.links=JSON.parse(row.links)}catch{}
  res.json(row);
});
router.post('/',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const {id,title,description,purpose,status,date,category,image,links,status_public}=req.body;
  if(!title) return res.status(400).json({error:'Title required'});
  const newId=id||`init-${Date.now()}`;
  (await db.prepare('INSERT INTO initiatives (id, title, description, purpose, status, date, category, image, links, status_public, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId,title,description||'',purpose||'',status||'ONGOING',date||new Date().toISOString().slice(0,10),category||'',image||'',JSON.stringify(links||[]),status_public||'Draft', req.admin.id));
  (await log(db,req.admin,`Created initiative: ${title}`,newId));
  res.json({ok:true,id:newId});
});
router.patch('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const ex=(await db.prepare('SELECT * FROM initiatives WHERE id=?').get(req.params.id));
  if(!ex) return res.status(404).json({error:'Not found'});
  const fields=['title','description','purpose','status','date','category','image','status_public'];
  const u=[]; const p=[];
  for(const f of fields) if(req.body[f]!==undefined){u.push(`${f}=?`); p.push(req.body[f]);}
  if(req.body.links!==undefined){u.push('links=?'); p.push(JSON.stringify(req.body.links));}
  if(!u.length) return res.status(400).json({error:'No fields'});
  u.push("updated_at=datetime('now')");
  p.push(req.params.id);
  (await db.prepare(`UPDATE initiatives SET ${u.join(',')} WHERE id=?`).run(...p));
  (await log(db,req.admin,`Updated initiative: ${req.body.title||ex.title}`,req.params.id));
  res.json({ok:true});
});
router.delete('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM initiatives WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare('DELETE FROM initiatives WHERE id=?').run(req.params.id));
  (await log(db,req.admin,`Deleted initiative: ${row.title}`,req.params.id));
  res.json({ok:true});
});
export default router;
