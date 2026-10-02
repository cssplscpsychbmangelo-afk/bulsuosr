import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../db/init.js';
import { seedFromFrontend } from '../db/seed.js';
import { createApp } from '../app.js';
import { sanitizeAboutContent } from '../routes/about.js';

// The public About page used to be hard-coded HTML, so the office could not
// update the Student Regent, the mandate or the official links without a
// deploy. Admin → About OSR now writes one JSON document that the website reads.
test('About OSR page content is editable by any administrator and readable by the public', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osr-about-test-'));
  let db;
  try {
    db = await initDb(path.join(dir, 'about.db'));
    await seedFromFrontend(db);
    const app = createApp(db);
    const server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = async (route, method = 'GET', body, cookie) => {
        const res = await fetch(base + route, {
          method,
          headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
          body: body ? JSON.stringify(body) : undefined
        });
        return { status: res.status, body: await res.json().catch(() => ({})), cookie: res.headers.get('set-cookie')?.split(';')[0] };
      };

      // A fresh install stores nothing, so the public page shows its built-in wording.
      assert.deepEqual((await call('/api/about/public')).body, {});

      // Saving requires a session.
      assert.equal((await call('/api/about', 'PATCH', { title: 'Nope' })).status, 401);
      assert.equal((await call('/api/about')).status, 401);

      const owner = await call('/api/auth/setup', 'POST', { name: 'Owner', email: 'owner@example.org', password: 'SecureOwner123!' });
      assert.equal(owner.status, 200);
      const login = await call('/api/auth/login', 'POST', { email: 'owner@example.org', password: 'SecureOwner123!' });
      assert.ok(login.cookie, 'sign-in must issue a session cookie');
      const cookie = login.cookie;

      const content = {
        eyebrow: 'The Office',
        title: 'About the Office of the Student Regent',
        intro: 'Structured information, easy to update.',
        badge: 'Easy to update',
        office_heading: 'Office of the Student Regent',
        office_p1: 'The Office is the student representation arm within the Board of Regents.',
        mandate_heading: 'Role and mandate',
        mandate_items: ['Represent the studentry in the Board of Regents', 'Consult students and councils'],
        mandate_note: 'Aligned with the BulSU Charter.',
        sr_name: 'Juan D. Dela Cruz',
        sr_meta: 'Term: AY 2026-2027 · Campus: Main',
        dir_exec_name: 'Maria S. Santos',
        dir_exec_tag: 'OSR',
        college_rows: ['College of Engineering — representative pending'],
        vision: 'Bulacan State University is a progressive knowledge-generating institution.',
        mission: 'Bulacan State University exists to produce competent, ethical professionals.',
        values: ['Service to God & Community', 'Order & Peace'],
        response_time: 'Within office hours',
        info: [{ label: 'Governing body', value: 'Board of Regents' }, { label: '', value: '' }],
        featured: [{ title: 'Free Printing Services', tag: 'Ongoing', description: 'Printing support for students.', link_label: 'View in Initiatives', link_href: '#initiatives' }],
        links: [
          { label: 'Bulacan State University', href: 'https://bulsu.edu.ph' },
          { label: 'Board Meeting Archive (this site)', href: '#board-meetings' }
        ],
        unknown_key: 'ignored by the server'
      };

      const saved = await call('/api/about', 'PATCH', content, cookie);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));

      const stored = (await call('/api/about/public')).body;
      assert.equal(stored.title, 'About the Office of the Student Regent');
      assert.equal(stored.sr_name, 'Juan D. Dela Cruz');
      assert.deepEqual(stored.mandate_items, ['Represent the studentry in the Board of Regents', 'Consult students and councils']);
      assert.deepEqual(stored.values, ['Service to God & Community', 'Order & Peace']);
      assert.equal(stored.info.length, 1, 'empty rows are dropped');
      assert.equal(stored.featured[0].link_href, '#initiatives');
      assert.equal(stored.links[1].href, '#board-meetings');
      assert.equal(stored.unknown_key, undefined, 'unknown keys are never stored');

      // The admin screen reads the same document back.
      assert.equal((await call('/api/about', 'GET', null, cookie)).body.sr_name, 'Juan D. Dela Cruz');

      // A plain administrator keeps the office facts current too, like contact details.
      const editor = await call('/api/admin-users', 'POST', { name: 'Editor', email: 'editor@example.org', role: 'admin' }, cookie);
      assert.equal(editor.status, 200);
      const editorCookie = (await call('/api/auth/login', 'POST', { email: 'editor@example.org', password: editor.body.temporaryPassword })).cookie;
      const editorSave = await call('/api/about', 'PATCH', { sr_name: 'Ana R. Reyes' }, editorCookie);
      assert.equal(editorSave.status, 200);
      assert.equal((await call('/api/about/public')).body.sr_name, 'Ana R. Reyes');

      // Rejected payloads never reach the database.
      const rejections = [
        { sr_name: 'x'.repeat(4000) },
        { mandate_items: 42 },
        { values: { not: 'a list' } },
        { info: { label: 'Nope' } },
        { links: [{ label: 'Bad link', href: 'javascript:alert(1)' }] },
        { featured: [{ title: 'Bad link', link_href: 'ftp://example.org' }] },
        { vision: 42 }
      ];
      for (const payload of rejections) {
        const rejected = await call('/api/about', 'PATCH', payload, cookie);
        assert.equal(rejected.status, 400, `${JSON.stringify(payload)} must be rejected`);
      }
      assert.equal((await call('/api/about/public')).body.sr_name, 'Ana R. Reyes', 'a rejected save changes nothing');

      // Resetting clears every override so the built-in wording returns.
      assert.equal((await call('/api/about', 'PATCH', {}, cookie)).status, 200);
      assert.deepEqual((await call('/api/about/public')).body, {});
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally { db?.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

// The public page keeps its built-in wording and only the ids the CMS patches
// are added; without those hooks the saved content would never appear.
test('public About page exposes the hooks the CMS patches', async () => {
  const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
  const html = await fs.readFile(sitePath, 'utf8');
  for (const id of ['about-title', 'aboutEyebrow', 'aboutIntro', 'aboutBadge', 'aboutOfficeP1', 'aboutMandateList',
    'aboutSrName', 'aboutDirExecName', 'aboutVision', 'aboutMission', 'aboutValuesList', 'aboutInfoRows',
    'aboutResponseTime', 'aboutFeaturedList', 'aboutLinksList']) {
    assert.ok(html.includes(`id="${id}"`), `the public About page must keep #${id} for CMS updates`);
  }
  assert.match(html, /About the Office of the Student Regent/, 'the built-in wording stays as the fallback');

  const integration = await fs.readFile(new URL('../../osr-website/js/cms-integration.js', import.meta.url).pathname, 'utf8');
  assert.match(integration, /function applyAboutContent/, 'the integration must apply the saved About content');
  assert.match(integration, /api\/about\/public/, 'the integration must read the public About endpoint');
});

test('About content sanitizer trims, caps and normalizes what the office types', () => {
  const result = sanitizeAboutContent({
    title: '  About the Office of the Student Regent  ',
    mandate_items: '- First bullet\n• Second bullet\n\n   ',
    values: ['Service to God & Community'],
    featured: [{ title: 'Free Printing', tag: '', description: '   ' }],
    links: []
  });
  assert.equal(result.error, undefined);
  assert.equal(result.content.title, 'About the Office of the Student Regent', 'surrounding spaces are trimmed');
  assert.deepEqual(result.content.mandate_items, ['First bullet', 'Second bullet'], 'bullet markers are stripped');
  assert.deepEqual(result.content.featured, [{ title: 'Free Printing', tag: '', description: '', link_label: '', link_href: '' }]);
  assert.deepEqual(result.content.links, []);

  assert.match(sanitizeAboutContent('nope').error, /object/);
  assert.match(sanitizeAboutContent({ links: [{ label: 'x', href: 'javascript:alert(1)' }] }).error, /https/);
  assert.match(sanitizeAboutContent({ sr_name: 'x'.repeat(400) }).error, /too long/);
  assert.match(sanitizeAboutContent({ mandate_items: Array.from({ length: 20 }, (_, i) => `Bullet ${i}`) }).error, /at most 12 lines/);
});

test('About staff list accepts real staff rows and rejects unsafe photos or bad emails', async () => {
  const { sanitizeAboutContent } = await import('../routes/about.js');
  const ok = sanitizeAboutContent({ staff: [{ name: 'Ana Reyes', role: 'Secretary', email: 'ana@bulsu.edu.ph', photo: '/uploads/a.jpg' }, { name: '' }] });
  assert.equal(ok.error, undefined);
  assert.equal(ok.content.staff.length, 1, 'empty staff rows are dropped');
  assert.match(sanitizeAboutContent({ staff: [{ name: 'X', photo: 'javascript:alert(1)' }] }).error, /https/);
  assert.match(sanitizeAboutContent({ staff: [{ name: 'X', email: 'nope' }] }).error, /email/);
  assert.match(sanitizeAboutContent({ sr_photo: '//evil.example/x.png' }).error, /https/);
});
