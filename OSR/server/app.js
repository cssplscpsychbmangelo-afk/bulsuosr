import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
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
import { concernsRouter, ratingsRouter } from './routes/feedback.js';
import { submissionsRouter } from './routes/submissions.js';
import { leadershipRouter, publicLeadership } from './routes/leadership.js';
import { readPublicSettings } from './routes/settings.js';
import { readAbout } from './routes/about.js';
import { publicReadLimiter } from './middleware/rateLimit.js';
import staffRoutes from './routes/staff.js';
import aboutRoutes from './routes/about.js';
import pagesRoutes from './routes/pages.js';
import dashboardRoutes from './routes/dashboard.js';
import adminUsersRoutes from './routes/admin-users.js';
import bulkRoutes from './routes/bulk.js';

// The admin dashboard lives on a single unguessable path. Set ADMIN_PATH to
// change it; the Netlify build writes the same value into _redirects.
export const ADMIN_PATH = (process.env.ADMIN_PATH || '/OSRAdminControl2026').replace(/\/+$/, '') || '/OSRAdminControl2026';

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
// JSON shrinks about nine times over the wire, and the monthly allowance is
// measured in bytes served, so compress every response the client asks for.
// Static files keep their own long cache; they are cheap to repeat.
app.use(compression({ threshold: 1024 }));
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
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: true }));

// CORS controls whether browsers can read a response; also reject untrusted
// Origin headers on state-changing API requests to prevent cookie-based CSRF.
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  if (safeMethods.has(req.method)) return next();
  const sourceOrigin = normalizeOrigin(req.get('Origin'));
  if (!sourceOrigin || allowedOrigins.has(sourceOrigin)) return next();

  // Same-site requests are always allowed. Compare the HOST (scheme-agnostic):
  // behind a TLS-terminating proxy (Netlify, previews, tunnels) the browser
  // sends https://… while req.protocol can still be http, which used to make
  // same-origin logins fail with "Origin not allowed".
  const requestHost = (req.get('host') || '').toLowerCase();
  let sourceHost = '';
  try { sourceHost = new URL(sourceOrigin).host.toLowerCase(); } catch { sourceHost = ''; }
  if (sourceHost && requestHost && sourceHost === requestHost) return next();

  return res.status(403).json({ error: 'Origin not allowed' });
});

// Rate limit for login is inside authRoutes

// Static files for local development; Netlify publishes the frontend directly.
if (!mediaStore) fs.mkdirSync(uploadDir, { recursive: true });
if (!mediaStore) {
  // The admin page contains both the sign-in/setup view and the dashboard.
  // It is served under ADMIN_PATH (/OSRAdminControl2026 by default) so the
  // dashboard is not sitting on an address anyone can guess; the old /admin
  // address is gone, and nothing in the public site links to the new one.
  // Serving login.html here would bounce the admin root around, so the single
  // index.html answers every admin URL.
  const sendAdmin = (req, res) => res.sendFile(path.join(adminDir, 'index.html'));
  app.get([ADMIN_PATH, `${ADMIN_PATH}/`, `${ADMIN_PATH}/login`, `${ADMIN_PATH}/login.html`], sendAdmin);
  app.use(express.static(publicDir));
  if (fs.existsSync(adminDir)) app.use(ADMIN_PATH, express.static(adminDir, { index: false, redirect: false }));
}
if (!mediaStore) app.use('/uploads', express.static(uploadDir));

// API
// The three public reads that live inside authenticated routers are throttled
// and cached like the sections below: a visitor can reach them without a
// session, so they can be looped like any other public endpoint. It has to be
// mounted before the routers, or the router answers first and the throttle
// never runs.
app.use(['/api/leadership/public', '/api/settings/public', '/api/about/public'], publicReadLimiter);

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
app.use('/api/about', aboutRoutes);
app.use('/api/concerns', concernsRouter);
app.use('/api/ratings', ratingsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/leadership', leadershipRouter);
app.use('/api/staff', staffRoutes);
app.use('/api/pages', pagesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin-users', adminUsersRoutes);
app.use('/api/bulk', bulkRoutes);

/* ── Public read endpoints ───────────────────────────────────────────────────
   Everything below is what a visitor downloads, so it is written against the
   two things that decide whether this site stays inside Netlify's free tier:

   1. **One request, not eleven.** `/api/public/bootstrap` returns every section
      in a single document. Each public request is a Function invocation and the
      free tier allows 125,000 a month, so eleven per page load is a ceiling of
      about 11,000 visits — a busy enrolment week would end it.
   2. **A bounded response.** Every section is capped. A content mistake, or a
      script pointed at one endpoint, cannot turn a single page load into a
      megabyte. The caps sit far above what the office publishes; when one is
      reached the response is cut and says so on the wire, rather than growing
      quietly until the site is expensive.

   The responses are cacheable for a minute. The office publishes deliberately,
   and a minute of staleness costs nothing next to a CDN that never calls the
   function at all — which is also what stops a loop from reaching it. */
const PUBLIC_SECTIONS = {
  'announcements': 'announcements',
  'board-meetings': 'board_meetings',
  'initiatives': 'initiatives',
  'resources': 'resources',
  'calendar': 'calendar_events',
  'media': 'media',
  'guides': 'guide_steps',
  'navigation': 'navigation_items',
  'pulse-aggregates': 'pulse_aggregates'
};

// Rows a public response will carry before it is cut. Read per request so the
// tests can lower every cap at once and prove the cut happens.
const PUBLIC_CAPS = {
  announcements: 200,
  board_meetings: 200,
  initiatives: 100,
  resources: 300,
  calendar_events: 800,
  media: 100,
  guide_steps: 100,
  navigation_items: 60,
  pulse_aggregates: 600
};
const publicCap = table => Number(process.env.PUBLIC_ROW_CAP || PUBLIC_CAPS[table] || 200);

const publicCache = res => res.set('Cache-Control', 'public, max-age=60');

// One section, capped. `truncated` is the caller's signal that the office has
// published more than the public page will carry, which is a thing somebody
// needs to hear about rather than discover in the bandwidth bill.
async function loadPublicSection(db, type) {
  const table = PUBLIC_SECTIONS[type];
  if (!table) return null;
  let rows;
  if (table === 'navigation_items') {
    rows = (await db.prepare('SELECT * FROM navigation_items WHERE is_visible=1 ORDER BY order_index').all());
  } else if (table === 'guide_steps') {
    rows = (await db.prepare('SELECT * FROM guide_steps WHERE is_enabled=1 ORDER BY page, step_number').all());
  } else if (table === 'media') {
    rows = (await db.prepare("SELECT id,title,caption,category,url,created_at FROM media WHERE status='Published' AND file_type LIKE 'image/%' ORDER BY created_at DESC LIMIT 100").all());
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
  const cap = publicCap(table);
  if (rows.length > cap) {
    console.warn(`[OSR CMS] Public ${type} holds ${rows.length} rows; serving ${cap}. Raise the cap or archive old records.`);
    return { rows: rows.slice(0, cap), truncated: true };
  }
  return { rows, truncated: false };
}

// The whole public site in one request.
app.get('/api/public/bootstrap', publicReadLimiter, async (req, res) => {
  const db = req.app.locals.db;
  publicCache(res);
  try {
    const body = { generated_at: new Date().toISOString() };
    const cut = [];
    for (const type of Object.keys(PUBLIC_SECTIONS)) {
      const section = await loadPublicSection(db, type);
      body[type] = section.rows;
      if (section.truncated) cut.push(type);
    }
    body.leadership = await publicLeadership(db);
    body.settings = await readPublicSettings(db);
    body.about = await readAbout(db);
    if (cut.length) res.set('X-OSR-Truncated', cut.join(','));
    res.json(body);
  } catch (error) {
    console.error('[OSR CMS] Failed to build the public bootstrap:', error.message);
    res.status(500).json({ error: 'Unable to load content' });
  }
});

// Public aggregated endpoint — one section at a time. Kept for the admin
// previews and anything else that wants a single list; the site itself asks
// for the bootstrap above.
app.get('/api/public/:type', publicReadLimiter, async (req, res) => {
  publicCache(res);
  const type = req.params.type;
  if (!PUBLIC_SECTIONS[type]) return res.status(404).json({ error: 'Not found' });
  try {
    const section = await loadPublicSection(req.app.locals.db, type);
    if (section.truncated) res.set('X-OSR-Truncated', type);
    res.json(section.rows);
  } catch (error) {
    console.error('[OSR CMS] Failed to load public content:', error.message);
    res.status(500).json({ error: 'Unable to load content' });
  }
});

// Health
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));

// Fallback for the single-page admin: every sub-path loads the admin page so
// the dashboard's client-side routing keeps working on refresh.
app.get(`${ADMIN_PATH}/{*path}`, (req, res) => {
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
