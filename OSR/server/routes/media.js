import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadDir } from '../paths.js';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits:{ fileSize: 3*1024*1024 },
  fileFilter:(req,file,cb)=>{
    const ok=['image/jpeg','image/png','image/webp','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'];
    if(!ok.includes(file.mimetype)) return cb(new Error('Invalid file type'));
    cb(null,true);
  }
});

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
router.post('/upload', authRequired, upload.single('file'), async (req,res,next)=>{
  try {
  const db=req.app.locals.db;
  if(!req.file) return res.status(400).json({error:'No file'});
  const ext = ({'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf','application/msword':'.doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','text/plain':'.txt'})[req.file.mimetype];
  req.file.filename = `${crypto.randomUUID()}${ext}`;
  if (req.app.locals.mediaStore) {
    await req.app.locals.mediaStore.set(req.file.filename, req.file.buffer, { metadata: { type: req.file.mimetype } });
  } else {
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, req.file.filename), req.file.buffer);
  }
  const id=`media-${crypto.randomUUID()}`;
  const url=`/uploads/${req.file.filename}`;
  (await db.prepare('INSERT INTO media (id, filename, original_name, file_type, size, url, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url, req.admin.id));
  (await log(db,req.admin,`Uploaded media: ${req.file.originalname}`,id));
  res.json({ok:true, id, url, filename:req.file.filename});
  } catch(error) { next(error); }
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
