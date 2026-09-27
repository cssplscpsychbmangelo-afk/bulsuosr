import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
router.get('/', async (req,res)=>{
  const db=req.app.locals.db;
  const rows=(await db.prepare('SELECT * FROM site_settings').all());
  const obj={}; rows.forEach(r=> {
    if(r.key==='jwt_secret') return; // never expose secret, even to admin API
    obj[r.key]=r.value;
  });
  res.json(obj);
});
router.get('/public', async (req,res)=>{
  const db=req.app.locals.db;
  const rows=(await db.prepare('SELECT * FROM site_settings').all());
  const obj={}; rows.forEach(r=> obj[r.key]=r.value);
  // only expose public keys
  const pub={};
  ['site_title','footer_text','contact_email','contact_phone','office_line1','office_line2','office_city','office_address','office_hours','office_hours_short','official_page','footer_credit'].forEach(k=>{ if(obj[k]) pub[k]=obj[k]; });
  res.json(pub);
});
router.patch('/', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  for(const [k,v] of Object.entries(req.body)){
    if(k==='jwt_secret') continue; // protected, managed internally
    (await db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(k, String(v)));
  }
  try{ (await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type) VALUES (?,?,?,?)').run(req.admin.id, req.admin.email, 'Updated site settings', 'settings')); }catch{}
  res.json({ok:true});
});
export default router;
