import 'dotenv/config';
import { createApp } from './app.js';
import { initDb } from './db/init.js';
import { seedFromFrontend } from './db/seed.js';

const db = process.env.DATABASE_URL
  ? await (await import('./db/postgres.js')).getDatabase()
  : await initDb();
if (!process.env.DATABASE_URL) await seedFromFrontend(db);
const app = createApp(db);
const port = process.env.PORT || 4000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[OSR CMS] Listening on port ${port}; admin: /admin`);
});
function shutdown() { server.close(() => db.close()); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
