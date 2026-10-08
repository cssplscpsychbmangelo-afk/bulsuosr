import crypto from 'node:crypto';
import express from 'express';
import { authRequired } from '../middleware/auth.js';
// The library holds externally hosted images, filed as links. There is no
// upload endpoint; /uploads keeps serving files that older records reference.
const router=express.Router();

async function log(db,a,act,id){ try{(await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'media',id));}catch{} }

router.get('/public', async (req,res)=>{
  res.json(await req.app.locals.db.prepare("SELECT id,title,caption,category,url,created_at FROM media WHERE status='Published' AND file_type LIKE 'image/%' ORDER BY created_at DESC LIMIT 100").all());
});
router.get('/', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const {q}=req.query;
  let sql='SELECT * FROM media WHERE 1=1'; const p=[];
  if(q){ sql+=' AND (filename LIKE ? OR original_name LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY created_at DESC';
  res.json((await db.prepare(sql).all(...p)));
});
router.post('/link', authRequired, async (req,res)=>{
  const {url,title,caption,category,status}=req.body;
  if(typeof caption!=='string'||caption.length>1000||typeof category!=='string'||category.length>100) return res.status(400).json({error:'Invalid caption or category'});
  if(typeof url!=='string'||!/^https:\/\//i.test(url)||typeof title!=='string'||!title.trim()||title.length>200||!['Draft','Published','Archived'].includes(status)) return res.status(400).json({error:'HTTPS image URL, title and status required'});
  const id=`media-${crypto.randomUUID()}`;
  await req.app.locals.db.prepare('INSERT INTO media (id,filename,original_name,file_type,size,url,title,caption,category,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,id,title,'image/url',0,url,title,caption||'',category||'',status,req.admin.id);
  res.json({ok:true,id});
});
router.patch('/:id', authRequired, async (req,res)=>{
  const {title,caption,category,status}=req.body;
  if(typeof title!=='string'||!title.trim()||title.length>200||![caption,category].every(v=>typeof v==='string'&&v.length<=1000)||!['Draft','Published','Archived'].includes(status)) return res.status(400).json({error:'Invalid media details'});
  const result=await req.app.locals.db.prepare("UPDATE media SET title=?,caption=?,category=?,status=?,updated_at=datetime('now') WHERE id=?").run(title,caption,category,status,req.params.id);
  if(!result.changes) return res.status(404).json({error:'Not found'});
  res.json({ok:true});
});
router.delete('/:id', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare("UPDATE media SET status='Archived',updated_at=datetime('now') WHERE id=?").run(req.params.id));
  (await log(db,req.admin,`Deleted media: ${row.original_name}`,req.params.id));
  res.json({ok:true});
});
router.get('/:id/preview', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});

export default router;
