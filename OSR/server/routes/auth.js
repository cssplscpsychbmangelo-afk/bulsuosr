import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { authRequired, signToken } from '../middleware/auth.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', loginLimiter, (req, res) => {
  const db = req.app.locals.db;
  const { email, password, remember } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const admin = db.prepare('SELECT * FROM admins WHERE email=?').get(email.trim().toLowerCase());
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = bcrypt.compareSync(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = signToken(admin);
  const maxAge = remember ? 30*24*60*60*1000 : 8*60*60*1000;
  res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge, path: '/' });
  // log activity
  try { db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type) VALUES (?,?,?,?)').run(admin.id, admin.email, 'Login', 'auth'); } catch {}
  res.json({ ok: true, admin: { id: admin.id, email: admin.email, name: admin.name }, token });
});

router.post('/logout', (req,res)=>{
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', authRequired, (req,res)=>{
  const db = req.app.locals.db;
  const admin = db.prepare('SELECT id, email, name, created_at FROM admins WHERE id=?').get(req.admin.id);
  if (!admin) return res.status(401).json({ error: 'Not found' });
  res.json(admin);
});

router.patch('/account', authRequired, (req,res)=>{
  const db = req.app.locals.db;
  const admin = db.prepare('SELECT * FROM admins WHERE id=?').get(req.admin.id);
  if (!admin) return res.status(401).json({ error: 'Not found' });
  const { currentPassword, newEmail, confirmEmail, newPassword, confirmPassword } = req.body;

  // Verify current password for any change
  if ((newEmail || newPassword) && !currentPassword) {
    return res.status(400).json({ error: 'Current password required' });
  }
  if ((newEmail || newPassword) && !bcrypt.compareSync(currentPassword, admin.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }

  let email = admin.email;
  let password_hash = admin.password_hash;
  let changed = [];

  if (newEmail) {
    if (newEmail !== confirmEmail) return res.status(400).json({ error: 'Emails do not match' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.status(400).json({ error: 'Invalid email' });
    const exists = db.prepare('SELECT id FROM admins WHERE email=? AND id != ?').get(newEmail.toLowerCase(), admin.id);
    if (exists) return res.status(409).json({ error: 'Email already in use' });
    email = newEmail.toLowerCase();
    changed.push('email');
  }

  if (newPassword) {
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) return res.status(400).json({ error: 'Password must include uppercase and number' });
    password_hash = bcrypt.hashSync(newPassword, 10);
    changed.push('password');
  }

  if (changed.length === 0) return res.status(400).json({ error: 'No changes' });

  db.prepare("UPDATE admins SET email=?, password_hash=?, updated_at=datetime('now') WHERE id=?").run(email, password_hash, admin.id);
  try { db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, details) VALUES (?,?,?,?,?)').run(admin.id, admin.email, `Updated account: ${changed.join(', ')}`, 'admin', JSON.stringify({ newEmail: email })); } catch {}

  // Issue new token if email changed
  const newToken = jwt.sign({ id: admin.id, email }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('token', newToken, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 8*60*60*1000, path: '/' });

  res.json({ ok: true, email, changed });
});

router.post('/forgot', (req,res)=>{
  // Placeholder: In production, send reset email
  res.json({ ok: true, message: 'If the email exists, a reset link will be sent (demo: contact system admin).' });
});

export default router;
