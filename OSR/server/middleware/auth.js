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

export function authRequired(req, res, next) {
  const authorization = req.headers.authorization || '';
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
  const token = req.cookies?.token || bearerToken;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    req.admin = jwt.verify(token, getJwtSecret());
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

export function signToken(admin, remember = false) {
  return jwt.sign(
    { id: admin.id, email: admin.email },
    getJwtSecret(),
    { expiresIn: remember ? '30d' : '8h' }
  );
}
