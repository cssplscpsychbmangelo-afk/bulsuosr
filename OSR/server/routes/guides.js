import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
function log(db,a,act,id){ try{db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'guide_step',id);}catch{} }
router.get('/public',(req,res)=>{
  const db=req.app.locals.db;
  res.json(db.prepare('SELECT * FROM guide_steps WHERE is_enabled=1 ORDER BY page, step_number').all());
});
router.get('/',authRequired,(req,res)=>{
  const db=req.app.locals.db;
  res.json(db.prepare('SELECT * FROM guide_steps ORDER BY page, step_number').all());
});
router.get('/:id',(req,res)=>{
  const db=req.app.locals.db;
  const row=db.prepare('SELECT * FROM guide_steps WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});
router.post('/',authRequired,(req,res)=>{
  const db=req.app.locals.db;
  const { id, page, target_selector, title, description, step_number, is_enabled, auto_open, first_visit_only, button_label }=req.body;
  if(!page||!target_selector||!title) return res.status(400).json({error:'page, target_selector, title required'});
  const newId=id||`g-${Date.now()}`;
  // validate selector not breaking - try query check (we don't have DOM, just check it's non-empty)
  if(!target_selector.trim()) return res.status(400).json({error:'Invalid selector'});
  db.prepare('INSERT INTO guide_steps (id, page, target_selector, title, description, step_number, is_enabled, auto_open, first_visit_only, button_label) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(newId, page, target_selector, title, description||'', step_number||0, is_enabled?1:0, auto_open?1:0, first_visit_only?1:0, button_label||'Next');
  log(db,req.admin,`Created guide step: ${title} [${page}]`,newId);
  res.json({ok:true,id:newId});
});
router.patch('/:id',authRequired,(req,res)=>{
  const db=req.app.locals.db;
  const ex=db.prepare('SELECT * FROM guide_steps WHERE id=?').get(req.params.id);
  if(!ex) return res.status(404).json({error:'Not found'});
  const fields=['page','target_selector','title','description','step_number','is_enabled','auto_open','first_visit_only','button_label'];
  const u=[]; const p=[];
  for(const f of fields) if(req.body[f]!==undefined){u.push(`${f}=?`); p.push(req.body[f]);}
  if(!u.length) return res.status(400).json({error:'No fields'});
  u.push("updated_at=datetime('now')");
  p.push(req.params.id);
  // validate selector if provided
  if(req.body.target_selector!==undefined && !req.body.target_selector.trim()) return res.status(400).json({error:'Invalid selector'});
  db.prepare(`UPDATE guide_steps SET ${u.join(',')} WHERE id=?`).run(...p);
  log(db,req.admin,`Updated guide step: ${req.body.title||ex.title}`,req.params.id);
  res.json({ok:true});
});
router.delete('/:id',authRequired,(req,res)=>{
  const db=req.app.locals.db;
  const row=db.prepare('SELECT * FROM guide_steps WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Not found'});
  db.prepare('DELETE FROM guide_steps WHERE id=?').run(req.params.id);
  log(db,req.admin,`Deleted guide step: ${row.title}`,req.params.id);
  res.json({ok:true});
});
export default router;
