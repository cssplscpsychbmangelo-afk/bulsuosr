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
router.delete('/:id', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare('DELETE FROM media WHERE id=?').run(req.params.id));
  if (req.app.locals.mediaStore) {
    await req.app.locals.mediaStore.delete(row.filename).catch(() => console.error('[CMS] Media cleanup failed'));
  } else { try{ fs.unlinkSync(path.join(uploadDir, row.filename)); }catch{} }
  (await log(db,req.admin,`Deleted media: ${row.original_name}`,req.params.id));
  res.json({ok:true});
});
router.get('/:id/preview', async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});

export default router;
