import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { authRequired, superAdminRequired } from '../middleware/auth.js';
const router=express.Router();
router.use(authRequired, superAdminRequired);
router.get('/', async (req,res)=>res.json(await req.app.locals.db.prepare('SELECT id, name, email, role, active, created_at, last_login FROM admins ORDER BY created_at').all()));
router.post('/', async (req,res)=>{
  const {name,email,role}=req.body;
  if(typeof name!=='string'||!name.trim()||name.length>100||typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['admin','super_admin'].includes(role)) return res.status(400).json({error:'Name, valid email and role required'});
  const temporaryPassword=randomBytes(18).toString('base64url');
  try {
    await req.app.locals.db.prepare('INSERT INTO admins (name,email,role,password_hash) VALUES (?,?,?,?)').run(name.trim(),email.trim().toLowerCase(),role,bcrypt.hashSync(temporaryPassword,12));
    const record=await req.app.locals.db.prepare('SELECT id,name,email,role,active,created_at,last_login FROM admins WHERE email=?').get(email.trim().toLowerCase());
    res.json({record,temporaryPassword}); // shown once to the super admin, never persisted in plaintext
  } catch(e){if(e.code==='23505'||/unique/i.test(e.message)) return res.status(409).json({error:'Email already in use'});throw e;}
});
router.patch('/:id', async (req,res)=>{
  const db=req.app.locals.db;
  const row=await db.prepare('SELECT * FROM admins WHERE id=?').get(req.params.id);
  if(!row) return res.status(404).json({error:'Admin not found'});
  const {name,email,role,active}=req.body;
  if((name!==undefined&&(typeof name!=='string'||!name.trim()||name.length>100))||(email!==undefined&&(typeof email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))||(role!==undefined&&!['admin','super_admin'].includes(role))||(active!==undefined&&![0,1].includes(active))) return res.status(400).json({error:'Invalid admin details'});
  if(Number(req.params.id)===req.admin.id && (active===0||role==='admin')) return res.status(400).json({error:'Cannot remove your own super admin access'});
  try {
    await db.prepare("UPDATE admins SET name=?,email=?,role=?,active=?,session_version=?,updated_at=datetime('now') WHERE id=?").run(name?.trim()||row.name,email?.trim().toLowerCase()||row.email,role||row.role,active??row.active,row.session_version+1,row.id);
    res.json(await db.prepare('SELECT id,name,email,role,active,created_at,last_login FROM admins WHERE id=?').get(row.id));
  }catch(e){if(e.code==='23505'||/unique/i.test(e.message)) return res.status(409).json({error:'Email already in use'});throw e;}
});
export default router;
