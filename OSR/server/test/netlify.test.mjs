import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PostgresDatabase, migrateDatabase, postgresSQL, allowLogin } from '../db/postgres.js';

process.env.NODE_ENV = 'production';
// Standalone mode: admin is seeded from DB, not env. JWT_SECRET is auto-persisted.
// For tests we still set a JWT secret to make assertions deterministic, but production
// no longer requires it.
process.env.JWT_SECRET = 'test-only-session-secret-with-at-least-32-characters';
// A non-routable test value. Tests never use a real Neon connection or credential.
process.env.DATABASE_URL = 'postgresql://test.invalid/test';
const { createHandler } = await import('../netlify/cms.mjs');
const sourcePath = new URL('../../osr-website/index.html', import.meta.url).pathname;

// Real PostgreSQL engine (WASM), with a pg-compatible single-connection pool.
// Serialize its pool operations; transactional clients hold the lock until release.
const engine = new PGlite();
let queue = Promise.resolve();
async function lock() {
  const prior = queue;
  let release;
  queue = new Promise(resolve => { release = resolve; });
  await prior;
  return release;
}
async function query(sql, values = []) {
  const results = values.length ? [await engine.query(sql, values)] : await engine.exec(sql);
  const result = results.at(-1);
  return { rows: result?.rows || [], rowCount: result?.affectedRows || 0 };
}
const pool = {
  async query(sql, values) { const release = await lock(); try { return await query(sql, values); } finally { release(); } },
  async connect() { const release = await lock(); return { query, release }; },
  end: () => engine.close(),
};
const db = new PostgresDatabase(pool);
const media = new Map();
const mediaStore = {
  async set(key, data, options) { media.set(key, { data, ...options }); },
  async delete(key) { media.delete(key); },
};
const makeHandler = () => createHandler({ database: async () => db, mediaStore: () => mediaStore });
let handler = makeHandler();
function request(path, method = 'GET', body, cookie, extraHeaders = {}) {
  const url = new URL(path, 'https://osr.netlify.app');
  return handler({ path: url.pathname, httpMethod: method, headers: { host: 'osr.netlify.app', 'content-type': 'application/json', 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : null, isBase64Encoded: false, queryStringParameters: Object.fromEntries(url.searchParams), requestContext: { identity: { sourceIp: '192.0.2.1' } } }, {});
}
let cookie;
async function ok(path, method = 'GET', body, auth = cookie) {
  const response = await request(path, method, body, auth);
  assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${path}: ${response.statusCode} ${response.body}`);
  return JSON.parse(response.body);
}

test('PostgreSQL-backed Netlify CMS', async t => {
  t.after(() => db.close());
  await t.test('schema and content initialize atomically, once', async () => {
    await migrateDatabase(db, sourcePath);
    await migrateDatabase(db, sourcePath);
    assert.equal((await db.prepare('SELECT COUNT(*) AS c FROM admins').get()).c, 0);
    assert.equal((await ok('/api/auth/setup-status')).needsSetup,true);
    await ok('/api/auth/setup','POST',{name:'Test Admin',email:'admin@osr.bulsu.edu.ph',password:'Admin123456789!'},null);
    assert.ok((await db.prepare('SELECT COUNT(*) AS c FROM calendar_events').get()).c > 0);
    assert.equal((await request('/api/health')).statusCode, 200);
  });
  await t.test('unauthenticated mutations and bad credentials are blocked', async () => {
    assert.equal((await request('/api/announcements', 'POST', { title: 'No' })).statusCode, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'admin@osr.bulsu.edu.ph', password: 'wrong' })).statusCode, 401);
  });
  await t.test('login issues an HttpOnly secure cookie', async () => {
    const res = await request('/api/auth/login', 'POST', { email: 'admin@osr.bulsu.edu.ph', password: 'Admin123456789!' });
    assert.equal(res.statusCode, 200, res.body);
    const value = res.multiValueHeaders?.['set-cookie']?.[0] || res.headers['set-cookie'];
    assert.match(value, /HttpOnly/);
    assert.match(value, /Secure/);
    cookie = value.split(';')[0];
  });
  await t.test('new function instance reads the same account', async () => {
    handler = makeHandler();
    assert.equal((await ok('/.netlify/functions/cms/auth/me')).email, 'admin@osr.bulsu.edu.ph');
  });
  await t.test('all admin sections and public endpoints execute PostgreSQL queries', async () => {
    for (const route of ['dashboard','announcements','board-meetings','initiatives','resources','calendar','guides','navigation','pages','media','activity','settings','pulse','pulse?view=yearly','pulse?view=all-time','pulse/export']) await ok('/api/'+route);
    for (const route of ['announcements','board-meetings','initiatives','resources','calendar','guides','navigation','pulse-aggregates']) await ok('/api/public/'+route, 'GET', null, null);
  });
  await t.test('CRUD persists, supports quoted text, and only publishes selected records', async () => {
    for (const [route, body, patch] of [
      ['announcements', { title: "What's new?", status: 'Draft' }, { status: 'Published' }],
      ['board-meetings', { title: 'Meeting', related_documents: [] }, { status: 'Published' }],
      ['initiatives', { title: 'Initiative', links: [] }, { status_public: 'Published' }],
      ['resources', { title: 'Resource' }, { status: 'Published' }],
      ['calendar', { activity: 'Event', iso: '2026-10-01' }, { status: 'Published' }],
      ['guides', { page: 'home', target_selector: '#home', title: 'Guide' }, { is_enabled: 1 }],
    ]) {
      const { id } = await ok('/api/'+route, 'POST', body);
      const record = await ok(`/api/${route}/${id}`);
      assert.equal(record.id, id);
      if (route === 'announcements') assert.ok(!(await ok('/api/public/announcements')).some(row => row.id === id));
      await ok(`/api/${route}/${id}`, 'PATCH', patch);
      assert.ok((await ok('/api/public/'+route)).some(row => row.id === id));
      await ok(`/api/${route}/${id}`, 'DELETE');
      if(route==='guides') assert.equal((await request(`/api/${route}/${id}`, 'GET', null, cookie)).statusCode,404);
      else { assert.equal((await ok(`/api/${route}/${id}`))[route==='initiatives'?'status_public':'status'],'Archived'); assert.ok(!(await ok('/api/public/'+route)).some(row=>row.id===id)); }
    }
  });
  await t.test('navigation identity IDs, reorder, settings upsert, and pages', async () => {
    const { id } = await ok('/api/navigation', 'POST', { label: 'Test', href: '#test', is_visible: true });
    assert.equal(typeof id, 'number');
    await ok('/api/navigation/reorder', 'POST', { order: [id] });
    assert.equal((await ok('/api/navigation')).find(row => row.id === id).order_index, 1);
    await ok('/api/navigation/'+id, 'PATCH', { is_visible: false });
    await ok('/api/navigation/'+id, 'DELETE');
    await ok('/api/settings', 'PATCH', { site_title: 'New title' });
    assert.equal((await ok('/api/settings/public')).site_title, 'New title');
    await ok('/api/pages', 'POST', { slug: 'test', title: 'Page' });
    await ok('/api/pages/test', 'PATCH', { content: 'Updated' });
    assert.equal((await ok('/api/pages/test')).content, 'Updated');
  });
  await t.test('parallel submissions use atomic PostgreSQL transactions', async () => {
    const body = { allocation: { learning: 4, campus: 1, mobility: 1, connectivity: 1, wellbeing: 1, cultureCommunity: 1, studentVoice: 1 } };
    await Promise.all([ok('/api/pulse/submit', 'POST', body, null), ok('/api/pulse/submit', 'POST', body, null)]);
    const aggregate = await ok('/api/pulse/aggregates', 'GET', null, null);
    assert.equal(aggregate.totalResponses, 2);
    assert.equal(aggregate.totalPoints, 20);
    await assert.rejects(db.transaction(async () => {
      await db.prepare('DELETE FROM pulse_submissions').run();
      throw new Error('rollback test');
    })());
    assert.equal((await ok('/api/pulse/aggregates')).totalResponses, 2);
    await ok('/api/pulse/reset', 'DELETE');
    assert.equal((await ok('/api/pulse/aggregates')).totalResponses, 0);
  });
  await t.test('upload metadata persists in Postgres; files live in Netlify storage', async () => {
    const boundary = 'osr-test-boundary';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\nHello OSR\r\n--${boundary}--\r\n`;
    const response = await handler({ path: '/api/media/upload', httpMethod: 'POST', headers: { host: 'osr.netlify.app', cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, body, isBase64Encoded: false }, {});
    assert.equal(response.statusCode, 200, response.body);
    const file = JSON.parse(response.body);
    assert.equal(media.get(file.filename).data.toString(), 'Hello OSR');
    assert.ok((await ok('/api/media')).some(row => row.id === file.id));
    await ok('/api/media/'+file.id, 'DELETE');
    assert.equal(media.has(file.filename), true); // archived media is retained for existing references
  });
  await t.test('CSRF, persistent throttling, and missing environment config', async () => {
    assert.equal((await request('/api/announcements', 'POST', { title: 'CSRF' }, cookie, { origin: 'https://evil.example' })).statusCode, 403);
    for (let i=0; i<20; i++) assert.equal(await allowLogin(db, 'throttle-test'), true);
    assert.equal(await allowLogin(db, 'throttle-test'), false);
    // Standalone mode: only DATABASE_URL is required. JWT_SECRET is auto-generated/persisted.
    const oldDb = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
    assert.equal((await request('/api/health')).statusCode, 503);
    process.env.DATABASE_URL = oldDb;
    // JWT_SECRET missing should NOT cause 503 anymore (standalone)
    const oldJwt = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
    // Health should still be 200 because secret will be auto-generated from DB
    const healthWithoutJwt = await request('/api/health');
    assert.equal(healthWithoutJwt.statusCode, 200);
    process.env.JWT_SECRET = oldJwt;
  });
  await t.test('SQL parameters cannot become identifiers or interpolate user content', () => {
    assert.equal(postgresSQL("SELECT '?' FROM announcements WHERE title=? -- ?"), "SELECT '?' FROM osr.announcements WHERE title=$1 -- ?");
    assert.match(postgresSQL('INSERT OR IGNORE INTO site_settings (key,value) VALUES (?,?)'), /osr.site_settings.*\$1,\$2.*ON CONFLICT DO NOTHING/);
  });
  await t.test('a database migrated before the archive gains the table, keeping its records', async () => {
    // The live installation was migrated to version 2 before the leadership
    // archive existed: no table and no version 3. It still has to be able to
    // publish profiles, so the additive migration recreates the table from the
    // same definition a fresh install uses (schema.js LEADERSHIP_DDL) and leaves
    // every record that is already there alone.
    await engine.exec('DROP TABLE osr.leadership_profiles');
    await engine.exec('DELETE FROM osr.schema_migrations WHERE version=3');
    await engine.exec(`INSERT INTO osr.announcements (id, title, status) VALUES ('pre-archive', 'Written before the archive', 'Published')`);
    await migrateDatabase(db, sourcePath);
    assert.equal((await db.prepare('SELECT COUNT(*) AS c FROM leadership_profiles').get()).c, 0, 'the table is back, empty');
    assert.equal((await db.prepare(`SELECT title FROM announcements WHERE id='pre-archive'`).get()).title, 'Written before the archive');
    assert.ok(await db.prepare('SELECT version FROM osr.schema_migrations WHERE version=3').get(), 'version 3 is recorded');
    // A cold start runs this again; the second pass must be as quiet as the first.
    await migrateDatabase(db, sourcePath);
    assert.equal((await db.prepare('SELECT COUNT(*) AS c FROM leadership_profiles').get()).c, 0);
    await engine.exec(`DELETE FROM osr.announcements WHERE id='pre-archive'`);
  });
  await t.test('build publishes the standalone admin page on its unguessable path only', () => {
    const redirects = fs.readFileSync(new URL('../../osr-website/_redirects', import.meta.url), 'utf8');
    // The dashboard moved off /admin: that address must not be served at all.
    assert.match(redirects, /\/OSRAdminControl2026\s+\/OSRAdminControl2026\/index\.html\s+200!/);
    assert.doesNotMatch(redirects, /^\/admin\b/m, 'the old /admin address must not be routed');
    assert.doesNotMatch(redirects, /login\.html/);
    assert.doesNotMatch(redirects, /onrender|unavailable/);
  });
});
