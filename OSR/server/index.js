import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initDb } from './db/init.js';
import { seedFromFrontend } from './db/seed.js';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;
const isProduction = process.env.NODE_ENV === 'production';
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));

function validateProductionConfig() {
  if (!isProduction) return;
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || secret !== secret.trim()) {
    throw new Error('Production requires JWT_SECRET to be a persistent random value of at least 32 characters.');
  }
}

validateProductionConfig();

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
// Render terminates TLS at its proxy; trust one hop in production so secure
// cookies and the login rate limiter use the original request properties.
if (isProduction) app.set('trust proxy', 1);

// DB
const db = initDb();
app.locals.db = db;

// Seed content from frontend if empty
seedFromFrontend(db);

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

// Static: public website + admin. Uploads live on Render's mounted disk in
// production, and in OSR/server/uploads when running locally.
const publicDir = path.join(__dirname, '../osr-website');
const adminDir = path.join(__dirname, '../admin');
fs.mkdirSync(uploadDir, { recursive: true });
app.use(express.static(publicDir));
if (fs.existsSync(adminDir)) app.use('/admin', express.static(adminDir));
app.use('/uploads', express.static(uploadDir));

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
app.get('/api/public/:type', (req, res) => {
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
      rows = db.prepare('SELECT * FROM navigation_items WHERE is_visible=1 ORDER BY order_index').all();
    } else if (table === 'guide_steps') {
      rows = db.prepare('SELECT * FROM guide_steps WHERE is_enabled=1 ORDER BY page, step_number').all();
    } else if (table === 'pulse_aggregates') {
      rows = db.prepare('SELECT * FROM pulse_aggregates ORDER BY period DESC, category').all();
    } else {
      // only published for public
      rows = db.prepare(`SELECT * FROM ${table} WHERE status='Published' ORDER BY created_at DESC`).all();
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
app.get('/admin/*', (req, res) => {
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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OSR CMS] Backend listening on port ${PORT}`);
  console.log(`[OSR CMS] Admin login: /admin/login.html`);
});

function shutdown() {
  server.close(() => {
    try { db.close(); } catch (error) { console.error('[OSR CMS] Database close failed:', error.message); }
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
