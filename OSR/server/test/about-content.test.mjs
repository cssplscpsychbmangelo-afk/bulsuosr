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
// update the Student Regent or the mandate without a deploy. Admin → About OSR
// writes one JSON document that the website reads — and the document holds
// exactly what the page prints, because an administrator should never be asked
// to fill in a field nobody renders.
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
        intro: 'The student voice in the Bulacan State University Board of Regents.',
        mandate_heading: 'About the Office',
        mandate_lede: 'The Office of the Student Regent serves as the formal student representation of Bulacan State University in the Board of Regents.',
        mandate_items: [
          'Represents the studentry in the Board of Regents',
          'Brings student concerns, positions and proposals into university governance',
          'Communicates Board matters and developments back to students'
        ],
        office_heading: 'Office of the Student Regent',
        office_lede: 'The student representation arm within the Board of Regents.',
        directorate_heading: 'The Directorate',
        sr_name: 'Juan D. Dela Cruz',
        sr_meta: 'AY 2026-2027',
        sr_note: 'Every student concern reaches the Board through this Office.',
        // Sections the page no longer has. They are ignored rather than stored,
        // so an old document shrinks to the new page on its next save. The staff
        // list and the Regent's photograph joined them when the people moved into
        // the leadership archive, which is its own table rather than a key here.
        staff: [{ name: 'Maria S. Santos', role: 'Executive Director', photo: '/uploads/maria.jpg' }],
        staff_heading: 'The Office',
        sr_photo: '/uploads/regent.jpg',
        badge: 'Easy to update',
        vision: 'Bulacan State University is a progressive knowledge-generating institution.',
        values: ['Service to God & Community'],
        featured: [{ title: 'Free Printing Services' }],
        info: [{ label: 'Governing body', value: 'Board of Regents' }],
        links: [{ label: 'BulSU', href: 'https://bulsu.edu.ph' }],
        unknown_key: 'ignored by the server'
      };

      const saved = await call('/api/about', 'PATCH', content, cookie);
      assert.equal(saved.status, 200, JSON.stringify(saved.body));

      const stored = (await call('/api/about/public')).body;
      assert.equal(stored.title, 'About the Office of the Student Regent');
      assert.equal(stored.mandate_lede, 'The Office of the Student Regent serves as the formal student representation of Bulacan State University in the Board of Regents.');
      assert.equal(stored.mandate_items.length, 3, 'the mandate stays a short list');
      assert.equal(stored.directorate_heading, 'The Directorate', 'the title above the archive is editable copy');
      assert.equal(stored.sr_name, 'Juan D. Dela Cruz');
      assert.equal(stored.sr_note, 'Every student concern reaches the Board through this Office.');
      for (const gone of ['staff', 'staff_heading', 'sr_photo', 'badge', 'vision', 'values', 'featured', 'info', 'links', 'unknown_key']) {
        assert.equal(stored[gone], undefined, `"${gone}" belongs to a section the page no longer has, so it is never stored`);
      }

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
        { mandate_lede: 42 },
        { mandate_items: 42 },
        { mandate_items: Array.from({ length: 12 }, (_, index) => `Point ${index}`) },
        { directorate_heading: 'x'.repeat(400) },
        { office_lede: 42 }
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
  for (const id of ['about-title', 'aboutEyebrow', 'aboutIntro', 'aboutMandateHeading', 'aboutMandateLede',
    'aboutMandateList', 'aboutOfficeHeading', 'aboutOfficeLede', 'ldBoardTitle']) {
    assert.ok(html.includes(`id="${id}"`), `the public About page must keep #${id} for CMS updates`);
  }
  assert.match(html, /About the Office of the Student Regent/, 'the built-in wording stays as the fallback');

  const integration = await fs.readFile(new URL('../../osr-website/js/cms-integration.js', import.meta.url).pathname, 'utf8');
  assert.match(integration, /function applyAboutContent/, 'the integration must apply the saved About content');
  assert.match(integration, /api\/about\/public/, 'the integration must read the public About endpoint');
  assert.match(integration, /aboutText\('ldBoardTitle', a\.directorate_heading\)/, 'the title above the archive is applied from the saved document');
  assert.match(integration, /window\.applyLeadership/, 'the people themselves arrive as records, from their own endpoint');
  assert.match(integration, /fetchPublic\('leadership'/, 'which the integration fetches with the rest of the page');
});

// The page answers three questions. Everything the old page carried on top of
// that — the vision band, the programme cards, the office-information table,
// the contact card, the link directory, the directors and the college
// representatives — is gone from the document, not hidden inside it.
test('the About page is the mandate, the Office and the university, and nothing else', async () => {
  const html = await fs.readFile(new URL('../../osr-website/index.html', import.meta.url).pathname, 'utf8');
  for (const id of ['aboutSecMandate', 'aboutSecOffice', 'aboutSecUniversity']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} is one of the three sections`);
  }
  for (const gone of ['aboutSecVm', 'aboutSecPrograms', 'aboutSecContact', 'aboutSecPeople', 'aboutRegentCard',
    'aboutTeamCard', 'aboutContactCard', 'aboutInfoCard', 'aboutLinksList', 'aboutFeaturedList', 'aboutInfoRows',
    'aboutValuesList', 'aboutVision', 'aboutMission', 'aboutBadge', 'aboutDirExecName', 'aboutCollegeRows']) {
    assert.ok(!html.includes(`id="${gone}"`), `#${gone} belonged to a section the page no longer has`);
  }
  assert.ok(!html.includes('data-about-jump'), 'a three-section page needs no jump bar');

  // The second block is the leadership archive, and no officer is invented: with
  // no record published the block says so plainly instead of showing empty cards.
  assert.match(html, /id="leadership"/, 'the archive is one block of the Office section');
  assert.match(html, /id="ldEmpty" hidden>No leadership records are published yet/, 'and its empty state names the cause');
  assert.ok(!html.includes('renderAboutStaff'), 'the staff list the archive replaced is gone, not hidden');
  assert.match(html, /ABOUT_UNCONFIRMED/, 'the wording that counts as "not yet" is written down, not guessed at');
});

// The administrator sees the page the students see: one pane per section, and
// no field for anything the page stopped printing.
test('the admin About editor offers only what the page renders', async () => {
  const admin = await fs.readFile(new URL('../../admin/index.html', import.meta.url).pathname, 'utf8');
  const panes = admin.slice(admin.indexOf('const ABOUT_SECTIONS'), admin.indexOf('const ABOUT_LINE_FIELDS'));
  for (const key of ['eyebrow', 'title', 'intro', 'mandate_heading', 'mandate_lede', 'mandate_items',
    'office_heading', 'office_lede', 'directorate_heading', 'sr_name', 'sr_meta', 'sr_note']) {
    assert.match(panes, new RegExp(`'${key}'`), `the editor must still offer ${key}`);
  }
  for (const gone of ['staff_heading', 'sr_photo', 'badge', 'office_p1', 'office_p2', 'mandate_note', 'sr_heading',
    'sr_label', 'staff_intro', 'dir_heading', 'dir_exec_name', 'dir_names', 'college_rows', 'vision', 'mission',
    'values', 'featured_heading', 'info_heading', 'contact_heading', 'response_time', 'links_heading']) {
    assert.doesNotMatch(panes, new RegExp(`'${gone}'`), `${gone} is not rendered, so it must not be editable`);
  }
  assert.match(admin, /const ABOUT_LINE_FIELDS = \['mandate_items'\];/, 'the mandate is the only line list left');
  // The people are edited in their own tab, so this one holds no row machinery at
  // all — an editor for a list the page no longer prints would only invite data
  // that can never be shown.
  for (const gone of ['ABOUT_ROW_EDITORS', 'aboutRowHTML', 'collectAboutRows', 'validateAboutData']) {
    assert.ok(!admin.includes(gone), `${gone} belonged to the staff list`);
  }
  assert.match(admin, /data-tab="leadership"/, 'and the records have a tab of their own');
});

test('About content sanitizer trims, caps and normalizes what the office types', () => {
  const result = sanitizeAboutContent({
    title: '  About the Office of the Student Regent  ',
    mandate_items: '- First bullet\n• Second bullet\n\n   ',
    directorate_heading: '  The Directorate  '
  });
  assert.equal(result.error, undefined);
  assert.equal(result.content.title, 'About the Office of the Student Regent', 'surrounding spaces are trimmed');
  assert.deepEqual(result.content.mandate_items, ['First bullet', 'Second bullet'], 'bullet markers are stripped');
  assert.equal(result.content.directorate_heading, 'The Directorate');

  assert.match(sanitizeAboutContent('nope').error, /object/);
  assert.match(sanitizeAboutContent({ sr_name: 'x'.repeat(400) }).error, /too long/);
  assert.match(sanitizeAboutContent({ mandate_items: Array.from({ length: 20 }, (_, i) => `Bullet ${i}`) }).error, /at most 8 lines/);
  // Keys the page no longer prints are ignored rather than stored, so an old
  // document shrinks to the current page on its next save.
  const shrunk = sanitizeAboutContent({ sr_name: 'Ana Reyes', staff: [{ name: 'X' }], sr_photo: '/uploads/x.jpg' });
  assert.equal(shrunk.error, undefined);
  assert.deepEqual(Object.keys(shrunk.content), ['sr_name'], 'the staff list and the portrait are not part of the document any more');
  assert.match(sanitizeAboutContent({ mandate_lede: 'x'.repeat(500) }).error, /too long/);
});

test('service ratings require name and a valid student number; concerns issue a tracking code', async () => {
  const { STUDENT_NO, RATING_SERVICES, CONCERN_STATUSES } = await import('../routes/feedback.js');
  assert.ok(STUDENT_NO.test('2021-123456') && STUDENT_NO.test('2021123456'));
  assert.ok(!STUDENT_NO.test('abc') && !STUDENT_NO.test(''));
  assert.ok(RATING_SERVICES.includes('Concern handling'));
  assert.deepEqual(CONCERN_STATUSES, ['Received', 'In review', 'Responded', 'Closed']);
});
