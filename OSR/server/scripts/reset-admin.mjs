// OSR CMS — local admin recovery helper.
//
// Clears the `admins` table so the NEXT server startup re-creates the initial
// admin from ADMIN_EMAIL / ADMIN_PASSWORD in OSR/server/.env. Content tables
// (announcements, calendar, media records, settings, …) are left untouched.
//
// Usage, from OSR/server:
//   npm run reset:admin -- --confirm
//   npm start   # then log in with ADMIN_EMAIL + ADMIN_PASSWORD from .env
//
// The script never prints or changes passwords itself; it only removes the
// stored hashes so the normal first-startup seed can run again.
import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--confirm')) {
  console.log('This clears ALL admin accounts in the local CMS database so the');
  console.log('initial admin can be re-created from ADMIN_EMAIL / ADMIN_PASSWORD.');
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
  console.log('[reset:admin] Start the server once with ADMIN_PASSWORD set to create the first admin.');
  process.exit(0);
}

const db = new Database(dbPath);
try {
  const row = db.prepare("SELECT COUNT(*) AS c FROM admins").get();
  db.prepare("DELETE FROM admins").run();
  console.log(`[reset:admin] Removed ${row.c} admin account(s) from ${dbPath}. Content was kept.`);
  console.log('[reset:admin] Next step: set ADMIN_PASSWORD (12+ characters) in OSR/server/.env,');
  console.log('[reset:admin] then run `npm start` and log in with ADMIN_EMAIL + ADMIN_PASSWORD.');
} finally {
  db.close();
}
