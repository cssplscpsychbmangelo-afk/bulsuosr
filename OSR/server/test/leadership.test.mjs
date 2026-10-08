import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PostgresDatabase, migrateDatabase } from '../db/postgres.js';
import { createApp } from '../app.js';
import { LEADERSHIP_LIMITS, LEADERSHIP_SAMPLES } from '../routes/leadership.js';

// The leadership archive: two primary figures and a directorate of eight, held
// in the database and edited from the dashboard, so the public About page never
// carries a hardcoded person. What is under test here is the part a visitor
// cannot see and cannot check for themselves — that the limits hold, that an
// unnamed seat is refused rather than printed, that the sequence the dashboard
// drags is the sequence the page prints, and that the ten sample records used to
// check the layout can be removed without touching a real one.
process.env.JWT_SECRET = 'test-only-session-secret-with-at-least-32-characters';
delete process.env.DATABASE_URL;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;

const sourcePath = new URL('../../osr-website/index.html', import.meta.url).pathname;

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
const app = createApp(db, {});
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// A response body can only be read once, and an assertion message wants the text
// of the body it is complaining about — so every check goes through here.
async function read(response) {
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: () => JSON.parse(text) };
}
const json = (path, options = {}) => fetch(base + path, {
  ...options,
  headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  body: options.body === undefined ? undefined : JSON.stringify(options.body),
});
let cookie = '';
const authed = (path, options = {}) => json(path, { ...options, headers: { ...(options.headers || {}), cookie } });
const publicArchive = async () => (await read(await json('/api/leadership/public'))).json();
const adminArchive = async () => (await read(await authed('/api/leadership'))).json();
const add = async profile => read(await authed('/api/leadership', { method: 'POST', body: profile }));

test('the leadership archive', async t => {
  t.after(async () => { server.close(); await db.close(); });

  await migrateDatabase(db, sourcePath);
  await json('/api/auth/setup', {
    method: 'POST',
    body: { name: 'Test Admin', email: 'admin@osr.bulsu.edu.ph', password: 'Admin123456789!' },
  });
  const login = await read(await json('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@osr.bulsu.edu.ph', password: 'Admin123456789!' },
  }));
  assert.equal(login.status, 200, login.text);
  cookie = (login.headers.getSetCookie()[0] || '').split(';')[0];
  assert.ok(cookie.startsWith('token='), 'writing the archive needs an administrator session');

  await t.test('a fresh install publishes nobody', async () => {
    const rows = await publicArchive();
    assert.deepEqual(rows, [], 'the About page shows its empty state instead of an invented office');
    const anonymous = await read(await json('/api/leadership'));
    assert.equal(anonymous.status, 401, 'and the full list is not readable without signing in');
  });

  await t.test('an unnamed seat is refused, not printed', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { position: 'Student Regent' }]) {
      const response = await add(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.match(response.json().error, /needs a name/, response.text);
    }
    assert.deepEqual(await publicArchive(), [], 'nothing reached the page');
  });

  await t.test('the two shelves hold two and eight, and say so when they are full', async () => {
    const first = await add({ category: 'primary', name: 'Ana Reyes', position: 'Student Regent' });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json().profile.display_number, '01', 'the first primary figure is 01');
    assert.equal(first.json().profile.category, 'primary');

    const second = await add({ category: 'primary', name: 'Ben Santos', position: 'Executive Director' });
    assert.equal(second.json().profile.display_number, '02');
    const third = await add({ category: 'primary', name: 'Third Person', position: 'Deputy' });
    assert.equal(third.status, 400, third.text);
    assert.match(third.json().error, /holds 2 primary leaders/, 'the limit is stated, not just enforced');

    for (let index = 1; index <= LEADERSHIP_LIMITS.director; index += 1) {
      const created = await add({ category: 'director', name: `Director ${index}`, position: `Portfolio ${index}` });
      assert.equal(created.status, 200, created.text);
      assert.equal(created.json().profile.display_number, `${String(index).padStart(2, '0')}D`, 'directors are numbered 01D upwards');
    }
    const overflow = await add({ category: 'director', name: 'Ninth Director' });
    assert.equal(overflow.status, 400);
    assert.match(overflow.json().error, /holds 8 directors/);
  });

  await t.test('the order the dashboard drags is the order the page prints', async () => {
    const before = await publicArchive();
    const directors = before.filter(row => row.category === 'director');
    assert.equal(directors.length, 8);
    assert.deepEqual(directors.map(row => row.display_number), ['01D', '02D', '03D', '04D', '05D', '06D', '07D', '08D']);

    // Drag the last director to the front of the directorate.
    const reordered = [...before.filter(row => row.category === 'primary').map(row => row.id), directors[7].id, ...directors.slice(0, 7).map(row => row.id)];
    const response = await read(await authed('/api/leadership/reorder', { method: 'POST', body: { order: reordered } }));
    assert.equal(response.status, 200, response.text);

    const after = (await publicArchive()).filter(row => row.category === 'director');
    assert.equal(after[0].id, directors[7].id, 'the dragged record is first');
    assert.deepEqual(after.map(row => row.display_number), ['01D', '02D', '03D', '04D', '05D', '06D', '07D', '08D'],
      'and the numbers follow the order, so the archive never reads 03D, 01D, 02D');
    assert.equal(after[0].name, 'Director 8');
  });

  await t.test('a typed number overrides the sequence', async () => {
    const rows = await publicArchive();
    const target = rows.find(row => row.name === 'Director 8');
    const response = await read(await authed(`/api/leadership/${target.id}`, { method: 'PATCH', body: { number: '09D' } }));
    assert.equal(response.status, 200, response.text);
    const after = (await publicArchive()).find(row => row.id === target.id);
    assert.equal(after.display_number, '09D', 'the office can print its own numbering');
    assert.equal(after.number, '09D');
    await authed(`/api/leadership/${target.id}`, { method: 'PATCH', body: { number: '' } });
    assert.equal((await publicArchive()).find(row => row.id === target.id).display_number, '01D', 'and clearing it hands the sequence back');
  });

  await t.test('multi-line fields arrive as lines, from either shape', async () => {
    const rows = await publicArchive();
    const target = rows.find(row => row.category === 'primary');
    await authed(`/api/leadership/${target.id}`, {
      method: 'PATCH',
      body: { responsibilities: '- Carries the seat\n1. Serves the record\n\n   \nThird line', projects: ['One', 'Two'] },
    });
    const after = (await publicArchive()).find(row => row.id === target.id);
    assert.deepEqual(after.responsibilities, ['Carries the seat', 'Serves the record', 'Third line'],
      'bullets, numbers and blank lines are cleaned, and the page never splits a string itself');
    assert.deepEqual(after.projects, ['One', 'Two'], 'an array is accepted as an array');

    const tooMany = await read(await authed(`/api/leadership/${target.id}`, {
      method: 'PATCH',
      body: { responsibilities: Array.from({ length: 15 }, (_, index) => `Line ${index + 1}`).join('\n') },
    }));
    assert.equal(tooMany.status, 400);
    assert.match(tooMany.json().error, /at most 14 lines/);

    const tooLong = await read(await authed(`/api/leadership/${target.id}`, { method: 'PATCH', body: { quote: 'q'.repeat(341) } }));
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.json().error, /"quote" is too long — 341 characters, the limit is 340\./);
  });

  await t.test('an unsafe photograph or link is refused', async () => {
    const target = (await publicArchive())[0];
    for (const [field, value] of [['photo', 'javascript:alert(1)'], ['photo', '//evil.test/x.jpg'], ['facebook', 'http://facebook.com/x'], ['instagram', 'not a link'], ['email', 'not-an-email']]) {
      const response = await read(await authed(`/api/leadership/${target.id}`, { method: 'PATCH', body: { [field]: value } }));
      assert.equal(response.status, 400, `${field}=${value}: ${response.text}`);
    }
    const allowed = await read(await authed(`/api/leadership/${target.id}`, { method: 'PATCH', body: { photo: '/uploads/regent.jpg', facebook: 'https://www.facebook.com/BulSUSG1983/', email: 'osr@bulsu.edu.ph' } }));
    assert.equal(allowed.status, 200, allowed.text);
    const stored = (await publicArchive())[0];
    assert.equal(stored.photo, '/uploads/regent.jpg', 'a file this site serves is a photograph');
    assert.equal(stored.email, 'osr@bulsu.edu.ph');
  });

  await t.test('withdrawing a record takes it off the page and keeps it in the dashboard', async () => {
    const target = (await publicArchive()).find(row => row.name === 'Director 3');
    await authed(`/api/leadership/${target.id}`, { method: 'PATCH', body: { is_published: false } });
    assert.ok(!(await publicArchive()).some(row => row.id === target.id), 'the page no longer shows it');
    const admin = await adminArchive();
    assert.ok(admin.some(row => row.id === target.id), 'the dashboard still holds it');
    assert.equal(admin.find(row => row.id === target.id).is_published, 0);

    const shelved = (await publicArchive()).filter(row => row.category === 'director');
    assert.deepEqual(shelved.map(row => row.display_number), ['01D', '02D', '03D', '04D', '05D', '06D', '07D'],
      'and the printed sequence closes up rather than skipping a number');
    await authed(`/api/leadership/${target.id}`, { method: 'PATCH', body: { is_published: true } });
  });

  await t.test('moving a record across respects the shelf it is moving to', async () => {
    const director = (await publicArchive()).find(row => row.category === 'director');
    const response = await read(await authed(`/api/leadership/${director.id}`, { method: 'PATCH', body: { category: 'primary' } }));
    assert.equal(response.status, 400, response.text);
    assert.match(response.json().error, /holds 2 primary leaders/);
    assert.equal((await publicArchive()).find(row => row.id === director.id).category, 'director', 'and it did not move');
  });

  await t.test('removing a record removes it', async () => {
    const rows = await publicArchive();
    const target = rows[rows.length - 1];
    const response = await read(await authed(`/api/leadership/${target.id}`, { method: 'DELETE' }));
    assert.equal(response.status, 200, response.text);
    assert.ok(!(await publicArchive()).some(row => row.id === target.id));
    const missing = await read(await authed(`/api/leadership/${target.id}`, { method: 'DELETE' }));
    assert.equal(missing.status, 404);
  });

  await t.test('the sample archive loads once, is marked, and leaves in one call', async () => {
    // Everything real is cleared first, so "remove samples" can be proven to
    // touch only the rows it inserted.
    for (const row of await adminArchive()) await authed(`/api/leadership/${row.id}`, { method: 'DELETE' });
    const keeper = await add({ category: 'primary', name: 'Real Record', position: 'Student Regent' });
    assert.equal(keeper.status, 200, keeper.text);
    const keeperId = keeper.json().id;

    const loaded = await read(await authed('/api/leadership/samples', { method: 'POST' }));
    assert.equal(loaded.status, 200, loaded.text);
    // The real record already holds one of the two primary slots, so the loader
    // brings one sample regent and the full directorate — it tops up the room it
    // has rather than pushing the archive past its own limits.
    assert.equal(loaded.json().inserted, LEADERSHIP_SAMPLES.length - 1, 'every seat that was free is filled');

    const again = await read(await authed('/api/leadership/samples', { method: 'POST' }));
    assert.equal(again.json().inserted, 0, 'loading twice does not double the archive');
    assert.equal(again.json().existing, LEADERSHIP_SAMPLES.length - 1);
    assert.equal(again.json().full, true, 'and it says the archive is full rather than failing quietly');

    const rows = await publicArchive();
    assert.equal(rows.length, LEADERSHIP_SAMPLES.length, 'the samples publish, so the layout can be checked at full size');
    assert.equal(rows.filter(row => row.category === 'primary').length, LEADERSHIP_LIMITS.primary);
    assert.equal(rows.filter(row => row.category === 'director').length, LEADERSHIP_LIMITS.director);
    for (const row of rows) {
      assert.equal(row.is_sample, undefined, 'an admin fact is not published to the page');
      assert.ok(row.photo === '' || row.photo === undefined, 'a sample carries no photograph, so the numbered plate shows');
    }
    // A sample has to be recognisable as one on the page it is standing in for.
    assert.equal(rows.filter(row => row.name.startsWith('Sample ')).length, LEADERSHIP_SAMPLES.length - 1,
      'every sample announces itself in its own name');
    assert.ok(rows.some(row => row.name === 'Real Record'), 'and the record the office wrote sits among them unchanged');
    const samples = (await adminArchive()).filter(row => Number(row.is_sample) === 1);
    assert.equal(samples.length, LEADERSHIP_SAMPLES.length - 1, 'and the dashboard can see which rows they are');
    for (const row of samples) {
      assert.match(`${row.biography} ${row.name}`, /[Ss]ample/, 'every sample says what it is');
    }

    const removed = await read(await authed('/api/leadership/samples', { method: 'DELETE' }));
    assert.equal(removed.json().removed, LEADERSHIP_SAMPLES.length - 1);
    const left = await publicArchive();
    assert.deepEqual(left.map(row => row.id), [keeperId], 'only the samples went');
    assert.equal(left[0].name, 'Real Record');
  });

  await t.test('the archive is not writable without a session', async () => {
    for (const request of [
      json('/api/leadership', { method: 'POST', body: { name: 'Intruder' } }),
      json('/api/leadership/reorder', { method: 'POST', body: { order: ['x'] } }),
      json('/api/leadership/samples', { method: 'POST' }),
      json('/api/leadership/samples', { method: 'DELETE' }),
    ]) {
      const response = await read(await request);
      assert.equal(response.status, 401, response.text);
    }
    assert.deepEqual((await publicArchive()).map(row => row.name), ['Real Record'], 'and nothing was written');
  });
});
