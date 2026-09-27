import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadDir, { recursive:true });

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, uploadDir),
  filename: (req,file,cb)=>{
    const ext=path.extname(file.originalname);
    const name=`${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`;
    cb(null,name);
  }
});
const upload = multer({
  storage,
  limits:{ fileSize: 10*1024*1024 },
  fileFilter:(req,file,cb)=>{
    const ok=['image/jpeg','image/png','image/webp','image/svg+xml','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'];
    if(!ok.includes(file.mimetype) && !file.mimetype.startsWith('image/')) return cb(new Error('Invalid file type'));
    cb(null,true);
  }
});

function log(db,a,act,id){ try{db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'media',id);}catch{} }

router.get('/', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  const {q}=req.query;
  let sql='SELECT * FROM media WHERE 1=1'; const p=[];
  if(q){ sql+=' AND (filename LIKE ? OR original_name LIKE ?)'; p.push(`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...p));
});
router.post('/upload', authRequired, upload.single('file'), (req,res)=>{
  const db=req.app.locals.db;
  if(!req.file) return res.status(400).json({error:'No file'});
  const id=`media-${Date.now()}`;
  const url=`/uploads/${req.file.filename}`;
  db.prepare('INSERT INTO media (id, filename, original_name, file_type, size, url, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url, req.admin.id);
  log(db,req.admin,`Uploaded media: ${req.file.originalname}`,id);
  res.json({ok:true, id, url, filename:req.file.filename});
});
router.delete('/:id', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  const row=db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Not found'});
  try{ fs.unlinkSync(path.join(uploadDir, row.filename)); }catch{}
  db.prepare('DELETE FROM media WHERE id=?').run(req.params.id);
  log(db,req.admin,`Deleted media: ${row.original_name}`,req.params.id);
  res.json({ok:true});
});
router.get('/:id/preview', (req,res)=>{
  const db=req.app.locals.db;
  const row=db.prepare('SELECT * FROM media WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});

export default router;
