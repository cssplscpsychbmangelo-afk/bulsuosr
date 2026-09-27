import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if ((process.env.NODE_ENV === 'production' || !!process.env.AWS_LAMBDA_FUNCTION_NAME)) {
    throw new Error('JWT_SECRET must be configured in production.');
  }

  // Local development convenience only. Production startup rejects this path.
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[OSR CMS] JWT_SECRET is not set; using an ephemeral development secret. Set JWT_SECRET in OSR/server/.env to keep local sessions across restarts.');
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
