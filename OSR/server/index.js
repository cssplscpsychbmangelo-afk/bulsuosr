import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Database from 'better-sqlite3';
import { initDb } from './db/init.js';
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

// DB
const db = initDb();
app.locals.db = db;

// Seed content from frontend if empty
import { seedFromFrontend } from './db/seed.js';
seedFromFrontend(db);

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limit for login is inside authRoutes

// Static: public website + admin
const publicDir = path.join(__dirname, '../osr-website');
const adminDir = path.join(__dirname, '../admin');
app.use(express.static(publicDir));
if (fs.existsSync(adminDir)) app.use('/admin', express.static(path.join(__dirname, '../admin')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads dir
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health
app.get('/api/health', (req,res)=> res.json({ ok:true, time: new Date().toISOString() }));

// Fallback for SPA admin
app.get('/admin/*', (req,res)=>{
  const p = path.join(__dirname, '../admin/index.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).send('Admin not found');
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`[OSR CMS] Backend running on http://0.0.0.0:${PORT}`);
  console.log(`[OSR CMS] Public site: http://localhost:${PORT}/`);
  console.log(`[OSR CMS] Admin: http://localhost:${PORT}/admin/login.html`);
});
