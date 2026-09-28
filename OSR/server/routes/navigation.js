import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
async function log(db,a,act,id){ try{(await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'navigation',id));}catch{} }
router.get('/', async (req,res)=>{
  const db=req.app.locals.db;
  res.json((await db.prepare('SELECT * FROM navigation_items ORDER BY order_index').all()));
});
router.get('/public', async (req,res)=>{
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db=req.app.locals.db;
  res.json((await db.prepare('SELECT * FROM navigation_items WHERE is_visible=1 ORDER BY order_index').all()));
});
router.post('/', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const {label, href, order_index, is_visible}=req.body;
  if(!label||!href) return res.status(400).json({error:'label and href required'});
  if(!href.startsWith('#') && !href.startsWith('/') && !href.startsWith('http')) return res.status(400).json({error:'Invalid href'});
  const info=(await db.prepare('INSERT INTO navigation_items (label, href, order_index, is_visible) VALUES (?,?,?,?)').run(label, href, order_index||0, is_visible?1:0));
  (await log(db,req.admin,`Created nav: ${label}`,String(info.lastInsertRowid)));
  res.json({ok:true,id:info.lastInsertRowid});
});
router.patch('/:id', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const ex=(await db.prepare('SELECT * FROM navigation_items WHERE id=?').get(req.params.id));
  if(!ex) return res.status(404).json({error:'Not found'});
  const fields=['label','href','order_index','is_visible'];
  const u=[]; const p=[];
  for(const f of fields) if(req.body[f]!==undefined){u.push(`${f}=?`); p.push(req.body[f]);}
  if(!u.length) return res.status(400).json({error:'No fields'});
  u.push("updated_at=datetime('now')");
  p.push(req.params.id);
  if(req.body.href && !req.body.href.startsWith('#') && !req.body.href.startsWith('/') && !req.body.href.startsWith('http')) return res.status(400).json({error:'Invalid href'});
  (await db.prepare(`UPDATE navigation_items SET ${u.join(',')} WHERE id=?`).run(...p));
  (await log(db,req.admin,`Updated nav: ${req.body.label||ex.label}`,req.params.id));
  res.json({ok:true});
});
router.post('/reorder', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const {order}=req.body; // array of ids
  if(!Array.isArray(order)) return res.status(400).json({error:'order array required'});
  const stmt=db.prepare('UPDATE navigation_items SET order_index=? WHERE id=?');
  for (const [idx, id] of order.entries()) (await stmt.run(idx+1, id));
  (await log(db,req.admin,`Reordered navigation`, 'bulk'));
  res.json({ok:true});
});
router.delete('/:id', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM navigation_items WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare('DELETE FROM navigation_items WHERE id=?').run(req.params.id));
  (await log(db,req.admin,`Deleted nav: ${row.label}`,req.params.id));
  res.json({ok:true});
});
export default router;
