import express from 'express';
import { authRequired, superAdminRequired } from '../middleware/auth.js';
const router=express.Router();
router.get('/', authRequired, superAdminRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const rows=(await db.prepare('SELECT * FROM site_settings').all());
  const obj={}; rows.forEach(r=> {
    if(r.key==='jwt_secret') return; // never expose secret, even to admin API
    obj[r.key]=r.value;
  });
  res.json(obj);
});
router.get('/public', async (req,res)=>{
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db=req.app.locals.db;
  const rows=(await db.prepare('SELECT * FROM site_settings').all());
  const obj={}; rows.forEach(r=>{ if(r.key !== 'jwt_secret') obj[r.key]=r.value; });
  // only expose public keys
  const pub={};
  ['site_title','site_description','social_facebook','social_instagram','homepage_intro','footer_text','contact_email','contact_phone','office_line1','office_line2','office_city','office_address','office_hours','office_hours_short','official_page','footer_credit'].forEach(k=>{ if(obj[k]) pub[k]=obj[k]; });
  res.json(pub);
});
router.patch('/', authRequired, superAdminRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const allowed = new Set(['site_title','site_description','contact_email','contact_phone','office_address','office_line1','office_line2','office_city','office_hours','office_hours_short','official_page','footer_credit','footer_text','social_facebook','social_instagram','homepage_intro']);
  for(const [k,v] of Object.entries(req.body)){
    if (!allowed.has(k) || typeof v !== 'string' || v.length > 2000) return res.status(400).json({error:'Invalid setting: '+k});
  }
  for(const [k,v] of Object.entries(req.body)){
    (await db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(k, String(v)));
  }
  try{ (await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type) VALUES (?,?,?,?)').run(req.admin.id, req.admin.email, 'Updated site settings', 'settings')); }catch{}
  res.json({ok:true});
});
export default router;
