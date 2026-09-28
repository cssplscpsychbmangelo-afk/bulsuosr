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
// Contact and site details the public website is allowed to read.
export const PUBLIC_SETTING_KEYS = [
  'site_title','site_description','social_facebook','social_instagram','homepage_intro','footer_text',
  'contact_email','contact_email_secondary','contact_phone','contact_phone_secondary','contact_person','contact_role',
  'office_line1','office_line2','office_city','office_address','office_room','office_hours','office_hours_short','office_hours_note',
  'office_map_url','official_page','footer_credit'
];
// Contact and office details any OSR administrator may keep current: these are
// the figures printed on the public website, so the office staff who answer the
// phone should never need a super administrator to change them.
export const CONTACT_SETTING_KEYS = [
  'contact_email','contact_email_secondary','contact_phone','contact_phone_secondary','contact_person','contact_role',
  'office_line1','office_line2','office_city','office_address','office_room','office_postal','office_country',
  'office_hours','office_hours_short','office_hours_note','office_map_url','official_page',
  'social_facebook','social_instagram','footer_credit'
];
// Keys the Settings screen may write. Everything else is rejected.
export const WRITABLE_SETTING_KEYS = new Set([
  ...PUBLIC_SETTING_KEYS,
  'site_tagline','office_postal','office_country','admissions_note','emergency_note'
]);
router.get('/public', async (req,res)=>{
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db=req.app.locals.db;
  const rows=(await db.prepare('SELECT * FROM site_settings').all());
  const obj={}; rows.forEach(r=>{ if(r.key !== 'jwt_secret') obj[r.key]=r.value; });
  // only expose public keys
  const pub={};
  PUBLIC_SETTING_KEYS.forEach(k=>{ if(obj[k]) pub[k]=obj[k]; });
  res.json(pub);
});
// OSR staff route: only the contact/office keys above, any signed-in admin.
router.patch('/contact', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const allowed=new Set(CONTACT_SETTING_KEYS);
  const entries=Object.entries(req.body||{});
  if(!entries.length) return res.status(400).json({error:'No contact details were sent.'});
  for(const [k,v] of entries){
    if (!allowed.has(k) || typeof v !== 'string' || v.length > 2000) return res.status(400).json({error:'Invalid setting: '+k});
  }
  for(const [k,v] of entries){
    (await db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')").run(k, String(v)));
  }
  try{ (await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type) VALUES (?,?,?,?)').run(req.admin.id, req.admin.email, 'Updated public contact details', 'settings')); }catch{}
  res.json({ok:true});
});
router.patch('/', authRequired, superAdminRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const allowed = WRITABLE_SETTING_KEYS;
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
