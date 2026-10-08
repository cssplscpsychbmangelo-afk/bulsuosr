import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PostgresDatabase, migrateDatabase } from '../db/postgres.js';
import { createApp } from '../app.js';
import { canonicalCode, CONCERN_STATUSES, RATING_SERVICES } from '../routes/feedback.js';
import { SUBMISSION_TOPICS, SUBMISSION_STATUSES } from '../routes/submissions.js';

// The two forms students fill in without an account, and the one their council
// fills in with a signed document attached. All three are public, so all three
// are guarded here: consent is enforced on the server and not only in the page,
// and the document is never reachable without signing in.
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

// Stands in for Netlify Blobs: the same interface the media library writes to.
const blobs = new Map();
const mediaStore = {
  async set(key, data, options) { blobs.set(key, { data, ...options }); },
  async get(key, options) { return blobs.has(key) ? blobs.get(key).data : null; },
  async delete(key) { blobs.delete(key); },
};

const app = createApp(db, { mediaStore });
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// A response body can only be read once, and an assertion message wants the
// text of the body it is complaining about — so every check goes through here.
async function read(response) {
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, json: () => JSON.parse(text) };
}
// The public forms are rate limited per connection (20 concerns and 12 filings
// per 15 minutes). These tests send more than a student would, so each request
// arrives from its own address: the limiter is real, it is just not what is
// under test here.
let client = 0;
const fromAnotherStudent = () => ({ 'x-forwarded-for': `192.0.2.${(client = (client % 250) + 1)}` });

const json = (path, options = {}) => fetch(base + path, {
  ...options,
  headers: { 'content-type': 'application/json', ...fromAnotherStudent(), ...(options.headers || {}) },
  body: options.body === undefined ? undefined : JSON.stringify(options.body),
});
const upload = (path, form) => fetch(base + path, { method: 'POST', headers: fromAnotherStudent(), body: form });
let cookie = '';
const authed = (path, options = {}) => json(path, { ...options, headers: { ...(options.headers || {}), cookie } });

test('concerns, ratings and organization submissions', async t => {
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
  assert.ok(cookie.startsWith('token='), 'an administrator session is needed to read submissions');

  await t.test('a concern is issued a BulSU - OSR - 0000 code and nothing else', async () => {
    const response = await json('/api/concerns', {
      method: 'POST',
      body: {
        name: 'Ana Reyes', email: 'ana@bulsu.edu.ph', studentNumber: '2021-123456',
        campus: 'Main - Malolos', category: 'Facilities', concern: 'The library has no power outlets on the second floor.',
        privacy: true,
      },
    });
    const created = await read(response);
    assert.equal(created.status, 201, created.text);
    const { code, status } = created.json();
    assert.match(code, /^BulSU - OSR - \d{4}$/, 'the code a student is given reads BulSU - OSR - 4827');
    assert.equal(status, 'Received');
    // No internal identifier travels with it: the code is the whole reference.
    const body = await read(await json('/api/concerns', { method: 'POST', body: { concern: 'Another concern that is long enough.', anonymous: true, privacy: true } }));
    assert.deepEqual(Object.keys(body.json()).sort(), ['code', 'ok', 'status']);

    for (const typed of [code, code.toLowerCase(), code.replace(/ - /g, '-'), code.replace(/[^0-9]/g, ''), ` ${code} `]) {
      const found = await read(await json(`/api/concerns/track/${encodeURIComponent(typed)}`));
      assert.equal(found.status, 200, `${typed}: ${found.status} ${found.text}`);
      const tracked = found.json();
      assert.equal(tracked.code, code, 'however the student types it, the same concern comes back');
      assert.equal(tracked.status, 'Received');
      assert.equal(tracked.responded, false);
      assert.equal(tracked.name, undefined, 'a lookup never hands back personal details');
    }
    // Eight characters that are not a code still read as an old-format one, so
    // they are answered with "no concern matches this". Something that cannot be
    // a code at all is refused before it is looked up.
    assert.equal((await json('/api/concerns/track/nonsense-value')).status, 400);
    assert.equal((await json('/api/concerns/track/NOTACODE')).status, 404);
    assert.equal((await json(`/api/concerns/track/${encodeURIComponent('BulSU - OSR - 9999')}`)).status, 404);
  });

  await t.test('codes already issued in the old format still track', async () => {
    assert.equal(canonicalCode('OSR-ABCD-2345'), 'OSR-ABCD-2345');
    assert.equal(canonicalCode('osrabcd2345'), 'OSR-ABCD-2345');
    await db.prepare(`INSERT INTO student_concerns (id, code, anonymous, name, email, concern, status) VALUES (?,?,?,?,?,?,?)`)
      .run('concern-legacy', 'OSR-ABCD-2345', 0, 'Legacy Student', 'legacy@bulsu.edu.ph', 'Filed before the code changed shape.', 'In review');
    const response = await read(await json('/api/concerns/track/OSR-ABCD-2345'));
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json().status, 'In review');
  });

  await t.test('every code drawn is a different one, and the column refuses a repeat', async () => {
    const drawn = new Set();
    for (let i = 0; i < 60; i += 1) {
      const response = await json('/api/concerns', {
        method: 'POST',
        body: { concern: `Uniqueness check number ${i} — long enough to be accepted.`, anonymous: true, privacy: true },
      });
      const created = await read(response);
      assert.equal(created.status, 201, created.text);
      drawn.add(created.json().code);
    }
    assert.ok(drawn.size > 1, 'codes are drawn at random, not handed out in order');
    const stored = await db.prepare('SELECT code FROM student_concerns').all();
    assert.equal(new Set(stored.map(row => row.code)).size, stored.length, 'no two concerns share a code');
  });

  await t.test('both public forms refuse to record anything without consent', async () => {
    const concern = await json('/api/concerns', {
      method: 'POST',
      body: { name: 'Ana Reyes', email: 'ana@bulsu.edu.ph', concern: 'A concern filed without agreeing to the notice.', privacy: false },
    });
    assert.equal(concern.status, 400);
    assert.match((await read(concern)).json().error, /privacy notice/i);

    const rating = await json('/api/ratings', {
      method: 'POST',
      body: { name: 'Ana Reyes', studentNumber: '2021-123456', service: RATING_SERVICES[0], rating: 5, feedback: 'Good' },
    });
    assert.equal(rating.status, 400);
    assert.match((await read(rating)).json().error, /privacy notice/i);

    const before = await db.prepare('SELECT COUNT(*) AS c FROM service_ratings').get();
    const accepted = await json('/api/ratings', {
      method: 'POST',
      body: { name: 'Ana Reyes', studentNumber: '2021-123456', service: RATING_SERVICES[0], rating: 5, feedback: 'Good', privacy: true },
    });
    assert.equal(accepted.status, 201, (await read(accepted)).text);
    const after = await db.prepare('SELECT COUNT(*) AS c FROM service_ratings').get();
    assert.equal(after.c, before.c + 1, 'only the rating given with consent was written');
  });

  await t.test('a council files a signed document and the office can open it', async () => {
    const form = new FormData();
    form.set('organization', 'College of Engineering Student Council');
    form.set('campus', 'Main - Malolos');
    form.set('topic', SUBMISSION_TOPICS[1]);
    form.set('title', 'Resolution on extended library hours');
    form.set('email', 'cesc@bulsu.edu.ph');
    form.set('privacyConsent', 'on');
    form.set('document', new Blob(['%PDF-1.4 signed resolution'], { type: 'application/pdf' }), 'resolution.pdf');

    const filed = await read(await fetch(`${base}/api/submissions`, { method: 'POST', body: form }));
    assert.equal(filed.status, 201, filed.text);
    const { id, status } = filed.json();
    assert.equal(status, 'Received');

    // The file went to the same store the media library uses, under a name
    // nobody can guess, and it is not on a public path.
    const stored = [...blobs.keys()].filter(key => key.startsWith('osr-submission-'));
    assert.equal(stored.length, 1, 'the document is kept in the site file store');
    assert.equal((await fetch(`${base}/uploads/${stored[0]}`)).status, 404, 'not served as a public upload');
    assert.equal((await fetch(`${base}/api/submissions/${id}/file`)).status, 401, 'and not without signing in');

    const list = await read(await authed('/api/submissions'));
    assert.equal(list.status, 200, list.text);
    const rows = list.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].organization, 'College of Engineering Student Council');
    assert.equal(rows[0].topic, 'Resolution');
    assert.equal(rows[0].original_name, 'resolution.pdf');

    const file = await authed(`/api/submissions/${id}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'application/pdf');
    assert.match(file.headers.get('content-disposition'), /inline; filename="resolution.pdf"/);
    assert.equal(await file.text(), '%PDF-1.4 signed resolution');

    const updated = await read(await authed(`/api/submissions/${id}`, { method: 'PATCH', body: { status: SUBMISSION_STATUSES[2], note: 'Endorsed to SPDO.' } }));
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.json().status, 'Endorsed');
    assert.equal((await authed(`/api/submissions/${id}`, { method: 'PATCH', body: { status: 'Approved' } })).status, 400, 'only the office’s own states are accepted');

    assert.equal((await authed(`/api/submissions/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal(blobs.size, 0, 'deleting the filing deletes the document with it');
    assert.equal((await read(await authed('/api/submissions'))).json().length, 0);
  });

  await t.test('a filing is checked before anything is stored', async () => {
    const send = async fields => {
      const form = new FormData();
      form.set('organization', 'College of Engineering Student Council');
      form.set('campus', 'Main - Malolos');
      form.set('topic', SUBMISSION_TOPICS[0]);
      form.set('title', 'Position on shuttle schedules');
      form.set('email', 'cesc@bulsu.edu.ph');
      form.set('privacyConsent', 'on');
      form.set('document', new Blob(['signed'], { type: 'application/pdf' }), 'position.pdf');
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      return upload('/api/submissions', form);
    };

    assert.equal((await send({})).status, 201, 'a complete filing is accepted');
    const refused = async fields => (await read(await send(fields))).json().error;
    assert.match(await refused({ privacyConsent: '' }), /privacy notice/i);
    assert.match(await refused({ organization: 'x' }), /organization/i);
    assert.match(await refused({ topic: 'Manifesto' }), /position, resolution, request/i);
    assert.match(await refused({ title: '' }), /title/i);
    assert.match(await refused({ email: 'not-an-email' }), /email/i);
    // A campus the form does not list is recorded as Other rather than refused.
    const oddCampus = await read(await send({ campus: 'Nowhere' }));
    assert.equal(oddCampus.status, 201, oddCampus.text);
    const filedCampus = (await read(await authed('/api/submissions'))).json().find(row => row.id === oddCampus.json().id);
    assert.equal(filedCampus.campus, 'Other');

    const noFile = new FormData();
    noFile.set('organization', 'College of Engineering Student Council');
    noFile.set('topic', SUBMISSION_TOPICS[2]);
    noFile.set('title', 'Request for a consultation caravan');
    noFile.set('email', 'cesc@bulsu.edu.ph');
    noFile.set('privacyConsent', 'on');
    const missing = await read(await upload('/api/submissions', noFile));
    assert.equal(missing.status, 400);
    assert.match(missing.json().error, /signed document/i);

    const wrongType = new FormData();
    wrongType.set('organization', 'College of Engineering Student Council');
    wrongType.set('topic', SUBMISSION_TOPICS[2]);
    wrongType.set('title', 'Request for a consultation caravan');
    wrongType.set('email', 'cesc@bulsu.edu.ph');
    wrongType.set('privacyConsent', 'on');
    wrongType.set('document', new Blob(['#!/bin/sh'], { type: 'application/x-sh' }), 'script.sh');
    const rejected = await read(await upload('/api/submissions', wrongType));
    assert.equal(rejected.status, 400);
    assert.match(rejected.json().error, /file type/i);

    const listed = (await read(await authed('/api/submissions'))).json();
    assert.equal(listed.length, 2, 'only the two valid filings were written');
  });

  await t.test('the public page offers the categories and states it advertises', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(sourcePath, 'utf8');
    assert.match(html, /<option value="Proposals">Proposals<\/option>/, 'Proposals is a category on the projects page');
    assert.match(html, /const PROPOSAL_STATUSES = \["Submitted","Under review","Approved","Returned"\]/);
    assert.match(html, /id="orgForm"/, 'the council form is on the public page');
    for (const topic of SUBMISSION_TOPICS) {
      if (topic === 'Other organizational document') continue;
      assert.ok(html.includes(`<option>${topic}</option>`), `${topic} must be one of the choices a council is given`);
    }
    assert.match(html, /BulSU - OSR - 4827/, 'the tracking page shows the code in the shape it is issued');
    assert.doesNotMatch(html, /OSR-ABCD-2345/, 'and no longer asks for the old shape');
    assert.equal(CONCERN_STATUSES.length, 4);
  });
});
