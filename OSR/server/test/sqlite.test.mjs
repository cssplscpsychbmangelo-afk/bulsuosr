import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../db/init.js';
import { seedFromFrontend } from '../db/seed.js';
import { createApp } from '../app.js';

test('local SQLite initialization, seed and async rollback still work', async () => {
  // Standalone mode: no ADMIN_PASSWORD env needed
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osr-local-test-'));
  let db;
  try {
    db = await initDb(path.join(dir, 'local.db'));
    await seedFromFrontend(db);
    assert.ok(db.prepare('SELECT COUNT(*) AS c FROM calendar_events').get().c > 0);
    await assert.rejects(db.transaction(async () => {
      db.prepare('DELETE FROM admins').run();
      throw new Error('rollback');
    })());
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM admins').get().c, 0);

    const app = createApp(db);
    const server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const port = server.address().port;
      for (const route of ['/admin', '/admin/', '/admin/login', '/admin/login.html']) {
        const response = await fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'manual' });
        assert.equal(response.status, 200, `${route} must render the single admin page`);
        assert.match(await response.text(), /<title>OSR Content Administration<\/title>/);
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally { db?.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
