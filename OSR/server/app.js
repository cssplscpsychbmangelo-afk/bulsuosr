import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { publicDir, adminDir, uploadDir } from './paths.js';
import fs from 'fs';
import authRoutes from './routes/auth.js';
import announcementsRoutes from './routes/announcements.js';
import boardRoutes from './routes/board.js';
import initiativesRoutes from './routes/initiatives.js';
import resourcesRoutes from './routes/resources.js';
import calendarRoutes from './routes/calendar.js';
import guideRoutes from './routes/guides.js';
import navRoutes from './routes/navigation.js';
import mediaRoutes from './routes/media.js';
import pulseRoutes from './routes/pulse.js';
import activityRoutes from './routes/activity.js';
import settingsRoutes from './routes/settings.js';
import pagesRoutes from './routes/pages.js';
import dashboardRoutes from './routes/dashboard.js';

export function createApp(db, { mediaStore } = {}) {
const app = express();
const isProduction = (process.env.NODE_ENV === 'production' || !!process.env.AWS_LAMBDA_FUNCTION_NAME);

function ensureJwtSecret() {
  // Standalone mode: JWT_SECRET is optional. If missing, schema.js already
  // tried to load/persist it from site_settings. As final fallback, generate.
  // (Actual generation is done in middleware/auth.js which uses ESM crypto)
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 16) {
    // Intentionally left empty — auth middleware will generate and warn.
    // We keep this function for future DB persistence hooks.
  }
}

ensureJwtSecret();

const normalizeOrigin = origin => {
  if (!origin) return '';
  try { return new URL(origin).origin; } catch { return origin.trim(); }
};
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean)
);
if (!isProduction) {
  allowedOrigins.add('http://localhost:4000');
  allowedOrigins.add('http://127.0.0.1:4000');
}

app.disable('x-powered-by');
// Netlify (or a local reverse proxy) terminates TLS; trust one hop in production so secure
// cookies and the login rate limiter use the original request properties.
if (isProduction) app.set('trust proxy', 1);

// DB
app.locals.db = db;
app.locals.mediaStore = mediaStore;



app.use(cors({
  origin(origin, callback) {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!origin || allowedOrigins.has(normalizedOrigin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 204,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS controls whether browsers can read a response; also reject untrusted
// Origin headers on state-changing API requests to prevent cookie-based CSRF.
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  if (safeMethods.has(req.method)) return next();
  const requestOrigin = normalizeOrigin(`${req.protocol}://${req.get('host')}`);
  const sourceOrigin = normalizeOrigin(req.get('Origin'));
  if (!sourceOrigin || sourceOrigin === requestOrigin || allowedOrigins.has(sourceOrigin)) return next();
  return res.status(403).json({ error: 'Origin not allowed' });
});

// Rate limit for login is inside authRoutes

// Static files for local development; Netlify publishes the frontend directly.
if (!mediaStore) fs.mkdirSync(uploadDir, { recursive: true });
if (!mediaStore) {
  // The admin page contains both the sign-in/setup view and the dashboard.
  // Serving login.html here would bounce /admin ↔ /admin/ because that legacy
  // file redirects back to the admin root.
  const sendAdmin = (req, res) => res.sendFile(path.join(adminDir, 'index.html'));
  app.get(['/admin', '/admin/', '/admin/login', '/admin/login.html'], sendAdmin);
  app.use(express.static(publicDir));
  if (fs.existsSync(adminDir)) app.use('/admin', express.static(adminDir, { index: false, redirect: false }));
}
if (!mediaStore) app.use('/uploads', express.static(uploadDir));

// API
app.use('/api/auth', authRoutes);
app.use('/api/announcements', announcementsRoutes);
app.use('/api/board-meetings', boardRoutes);
app.use('/api/initiatives', initiativesRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/guides', guideRoutes);
app.use('/api/navigation', navRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/pulse', pulseRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Public aggregated endpoint
app.get('/api/public/:type', async (req, res) => {
  const type = req.params.type;
  if (type === 'pulse-aggregates') res.set('Cache-Control', 'no-store');
  const map = {
    'announcements': 'announcements',
    'board-meetings': 'board_meetings',
    'initiatives': 'initiatives',
    'resources': 'resources',
    'calendar': 'calendar_events',
    'guides': 'guide_steps',
    'navigation': 'navigation_items',
    'pulse-aggregates': 'pulse_aggregates'
  };
  const table = map[type];
  if (!table) return res.status(404).json({ error: 'Not found' });
  try {
    let rows;
    if (table === 'navigation_items') {
      rows = (await db.prepare('SELECT * FROM navigation_items WHERE is_visible=1 ORDER BY order_index').all());
    } else if (table === 'guide_steps') {
      rows = (await db.prepare('SELECT * FROM guide_steps WHERE is_enabled=1 ORDER BY page, step_number').all());
    } else if (table === 'pulse_aggregates') {
      rows = (await db.prepare('SELECT * FROM pulse_aggregates ORDER BY period DESC, category').all());
    } else {
      // only published for public
      rows = (await db.prepare(`SELECT * FROM ${table} WHERE ${table === 'initiatives' ? 'status_public' : 'status'}='Published' ORDER BY created_at DESC`).all());
      // parse JSON fields
      rows = rows.map(r => {
        if (r.related_documents) try { r.related_documents = JSON.parse(r.related_documents); } catch {}
        if (r.links) try { r.links = JSON.parse(r.links); } catch {}
        if (r.allocation) try { r.allocation = JSON.parse(r.allocation); } catch {}
        return r;
      });
    }
    res.json(rows);
  } catch (error) {
    console.error('[OSR CMS] Failed to load public content:', error.message);
    res.status(500).json({ error: 'Unable to load content' });
  }
});

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

// Fallback for SPA admin
app.get('/admin/{*path}', (req, res) => {
  const adminPage = path.join(adminDir, 'index.html');
  if (fs.existsSync(adminPage)) return res.sendFile(adminPage);
  res.status(404).send('Admin not found');
});

// Keep API errors in JSON and avoid returning stack traces or internal details.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  let status = error.status || error.statusCode || 500;
  if (error.name === 'MulterError') status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  if (error.message === 'Invalid file type') status = 400;
  if (status >= 500) console.error('[OSR CMS] Request failed:', error.message);
  const message = status >= 500 ? 'Internal server error' : error.message;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: message });
  return res.status(status).send(message);
});

return app;
}
