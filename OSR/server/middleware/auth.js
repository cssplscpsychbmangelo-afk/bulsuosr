import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

// Admin login must never hard-fail just because JWT_SECRET was not configured.
// Without a secret, jsonwebtoken throws on sign() and the login page "does
// nothing" when credentials are entered. Generate a temporary secret instead
// and warn loudly. Set JWT_SECRET in OSR/server/.env to keep sessions valid
// across server restarts.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[OSR CMS] JWT_SECRET is not set — using a temporary generated secret. Add JWT_SECRET to OSR/server/.env so admin sessions survive restarts.');
}

export function authRequired(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

export function signToken(admin) {
  return jwt.sign({ id: admin.id, email: admin.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
}
