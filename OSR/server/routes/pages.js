import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
router.get('/', (req,res)=>{
  const db=req.app.locals.db;
  res.json(db.prepare('SELECT * FROM pages').all());
});
router.get('/:slug', (req,res)=>{
  const db=req.app.locals.db;
  const row=db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if(!row) return res.status(404).json({error:'Not found'});
  try{ row.data=JSON.parse(row.data)}catch{}
  res.json(row);
});
router.post('/', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  const { slug, title, content, data }=req.body;
  if(!slug) return res.status(400).json({error:'slug required'});
  db.prepare('INSERT INTO pages (id, slug, title, content, data) VALUES (?,?,?,?,?)').run(slug, slug, title||'', content||'', JSON.stringify(data||{}));
  res.json({ok:true});
});
router.patch('/:slug', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  const ex=db.prepare('SELECT * FROM pages WHERE slug=?').get(req.params.slug);
  if(!ex) return res.status(404).json({error:'Not found'});
  const { title, content, data }=req.body;
  const u=[]; const p=[];
  if(title!==undefined){u.push('title=?'); p.push(title);}
  if(content!==undefined){u.push('content=?'); p.push(content);}
  if(data!==undefined){u.push('data=?'); p.push(JSON.stringify(data));}
  if(!u.length) return res.status(400).json({error:'No fields'});
  u.push("updated_at=datetime('now')");
  p.push(req.params.slug);
  db.prepare(`UPDATE pages SET ${u.join(',')} WHERE slug=?`).run(...p);
  try{ db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(req.admin.id, req.admin.email, `Updated page: ${req.params.slug}`, 'page', req.params.slug);}catch{}
  res.json({ok:true});
});
export default router;
