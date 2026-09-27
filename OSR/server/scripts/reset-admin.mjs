// OSR CMS — local admin recovery helper (standalone mode).
//
// Clears the `admins` table so the NEXT server startup re-creates the default
// admin (admin@osr.bulsu.edu.ph / Admin123456!) or lets you use the /admin
// setup form. Content tables (announcements, calendar, media, settings, …) are untouched.
// For Neon (production), use the /api/auth/setup endpoint or delete admins via SQL.
//
// Usage, from OSR/server:
//   npm run reset:admin -- --confirm
//   npm start   # then log in with default or create via setup form
//
import 'dotenv/config';
import Database from '../db/sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--confirm')) {
  console.log('This clears ALL admin accounts in the local CMS database so the');
  console.log('default admin can be re-created on next startup (standalone mode).');
  console.log('');
  console.log('To proceed, run:  npm run reset:admin -- --confirm');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.join(here, '..', 'db', 'osr.db');

if (!fs.existsSync(dbPath)) {
  console.log(`[reset:admin] No database file at ${dbPath} — nothing to clear.`);
  console.log('[reset:admin] Start the server — default admin will be seeded automatically (standalone, Neon-only).');
  process.exit(0);
}

const db = new Database(dbPath);
try {
  const row = db.prepare("SELECT COUNT(*) AS c FROM admins").get();
  db.prepare("DELETE FROM admins").run();
  console.log(`[reset:admin] Removed ${row.c} admin account(s) from ${dbPath}. Content was kept.`);
  console.log('[reset:admin] Next step: run `npm start` and log in with admin@osr.bulsu.edu.ph / Admin123456!');
  console.log('[reset:admin] Or open /admin and use the setup form to create a new admin.');
} finally {
  db.close();
}
