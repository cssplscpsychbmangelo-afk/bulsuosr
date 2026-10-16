// OSR CMS — local admin recovery helper (standalone mode).
//
// Clears the `admins` table so the next visit to /OSRAdminControl2026 offers the
// setup form again and a new first administrator can be created. Content tables
// (announcements, calendar, media, settings, …) are untouched.
//
// There is no default account to fall back on. The site ships no known
// credentials: the first administrator is whoever the setup form creates, so a
// password that was never typed is never one an attacker can guess either.
// For Neon (production), use the /api/auth/setup endpoint or delete admins via SQL.
//
// Usage, from OSR/server:
//   npm run reset:admin -- --confirm
//   npm start   # then open /OSRAdminControl2026 and create the first admin
//
import 'dotenv/config';
import Database from '../db/sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--confirm')) {
  console.log('This clears ALL admin accounts in the local CMS database so the');
  console.log('setup form is offered again on the next start (standalone mode).');
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
  console.log('[reset:admin] Start the server, then open /OSRAdminControl2026 and create the first administrator.');
  process.exit(0);
}

const db = new Database(dbPath);
try {
  const row = db.prepare("SELECT COUNT(*) AS c FROM admins").get();
  db.prepare("DELETE FROM admins").run();
  console.log(`[reset:admin] Removed ${row.c} admin account(s) from ${dbPath}. Content was kept.`);
  console.log('[reset:admin] Next step: run `npm start`, open /OSRAdminControl2026 and use the setup form');
  console.log('[reset:admin] to create the first administrator. No default account is seeded.');
} finally {
  db.close();
}
