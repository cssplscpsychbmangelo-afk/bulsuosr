import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) return process.env.JWT_SECRET.trim();

  // Standalone mode: if no JWT_SECRET env var, generate an ephemeral one.
  // In production with Neon, the persistent secret is loaded from site_settings
  // by schema.js / postgres.js before this is called, so this path only runs
  // when that load hasn't happened yet (e.g., very first cold start race).
  // Sessions survive because the secret is persisted in DB after first generation.
  const generated = crypto.randomBytes(48).toString('hex');
  process.env.JWT_SECRET = generated;
  if (process.env.NODE_ENV === 'production' || !!process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.warn('[OSR CMS] JWT_SECRET not set — using generated ephemeral secret (will be persisted to site_settings on next DB init). For stronger persistence set JWT_SECRET in Netlify env, but not required.');
  } else {
    console.warn('[OSR CMS] JWT_SECRET is not set; using an ephemeral development secret. Set JWT_SECRET in OSR/server/.env to keep local sessions across restarts.');
  }
  return process.env.JWT_SECRET;
}

export async function authRequired(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const admin = await req.app.locals.db.prepare('SELECT id, email, name, role, active, session_version FROM admins WHERE id=?').get(payload.id);
    if (!admin || !admin.active || admin.session_version !== payload.version || admin.email !== payload.email)
      return res.status(401).json({ error: 'Session expired. Sign in again.' });
    req.admin = admin;
    next();
  } catch { return res.status(401).json({ error: 'Session expired. Sign in again.' }); }
}

export function superAdminRequired(req, res, next) {
  if (req.admin?.role !== 'super_admin') return res.status(403).json({ error: 'Super admin access required' });
  next();
}

export function signToken(admin, remember = false) {
  return jwt.sign(
    { id: admin.id, email: admin.email, version: admin.session_version },
    getJwtSecret(),
    { expiresIn: remember ? '30d' : '8h' }
  );
}
