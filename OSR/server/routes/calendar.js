import { randomUUID } from 'node:crypto';
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { validateContent } from '../middleware/content.js';
const router=express.Router();
async function log(db,a,act,id){ try{(await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'calendar_event',id));}catch{} }
router.get('/public',async (req,res)=>{
  const db=req.app.locals.db;
  res.json((await db.prepare("SELECT * FROM calendar_events WHERE status='Published' ORDER BY iso ASC").all()));
});
router.get('/',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const {q}=req.query;
  let sql='SELECT * FROM calendar_events WHERE 1=1'; const p=[];
  if(q){ sql+=' AND (activity LIKE ? OR category LIKE ? OR iso LIKE ?)'; p.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY iso ASC';
  res.json((await db.prepare(sql).all(...p)));
});
router.get('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});
router.post('/',authRequired,validateContent,async (req,res)=>{
  const db=req.app.locals.db;
  const {id,title,activity,date,day,month,category,iso,start_time,end_time,location,description,link,status}=req.body;
  const act = activity||title;
  if(!act) return res.status(400).json({error:'Activity required'});
  const newId=`cal-${randomUUID()}`;
  (await db.prepare('INSERT INTO calendar_events (id, title, activity, date, day, month, category, iso, start_time, end_time, location, description, link, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId, act, act, date||'', day||'', month||'', category||'', iso||'', start_time||'', end_time||'', location||'', description||'', link||'', status||'Draft', req.admin.id));
  (await log(db,req.admin,`Created calendar event: ${act}`,newId));
  res.json({ok:true,id:newId});
});
router.patch('/:id',authRequired,validateContent,async (req,res)=>{
  const db=req.app.locals.db;
  const ex=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!ex) return res.status(404).json({error:'Not found'});
  const fields=['title','activity','date','day','month','category','iso','start_time','end_time','location','description','link','status'];
  const u=[]; const p=[];
  for(const f of fields) if(req.body[f]!==undefined){u.push(`${f}=?`); p.push(req.body[f]);}
  if(!u.length) return res.status(400).json({error:'No fields'});
  u.push("updated_at=datetime('now')");
  p.push(req.params.id);
  (await db.prepare(`UPDATE calendar_events SET ${u.join(',')} WHERE id=?`).run(...p));
  (await log(db,req.admin,`Updated calendar event: ${req.body.activity||ex.activity}`,req.params.id));
  res.json({ok:true});
});
router.post('/:id/duplicate',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const ex=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!ex) return res.status(404).json({error:'Not found'});
  const newId=`cal-${Date.now()}`;
  (await db.prepare('INSERT INTO calendar_events (id, title, activity, date, day, month, category, iso, start_time, end_time, location, description, link, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId, ex.title+' (copy)', ex.activity, ex.date, ex.day, ex.month, ex.category, ex.iso, ex.start_time, ex.end_time, ex.location, ex.description, ex.link, 'Draft', req.admin.id));
  (await log(db,req.admin,`Duplicated calendar event: ${ex.activity}`,newId));
  res.json({ok:true,id:newId});
});
router.delete('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare("UPDATE calendar_events SET status='Archived', updated_at=datetime('now') WHERE id=?").run(req.params.id));
  (await log(db,req.admin,`Deleted calendar event: ${row.activity}`,req.params.id));
  res.json({ok:true});
});
export default router;
