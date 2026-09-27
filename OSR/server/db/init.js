import Database from './sqlite.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from './schema.js';

export async function initDb(filename) {
  const dbPath = filename || (process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : fileURLToPath(new URL('osr.db', import.meta.url)));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try { await initializeDatabase(db); return db; }
  catch (error) { db.close(); throw error; }
}
