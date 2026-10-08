import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { initDb } from '../db/init.js';
import { seedFromFrontend } from '../db/seed.js';
import { createApp } from '../app.js';

const adminPath = new URL('../../admin/index.html', import.meta.url).pathname;
const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const adminHtml = await fs.readFile(adminPath, 'utf8');

// The leadership archive is written in one place: Admin → Leadership. What has to
// hold is that the dashboard can do everything the public page needs without
// anybody editing code — the two shelves and their seats, every field the page
// prints, the order dragged or arrowed into place, publication, the sample
// profiles that let the office check the layout before it has anybody to
// publish — and that the preview underneath the form is the public interaction
// itself, moving as the office types rather than after a save.
//
// The dashboard is driven against the real server here, so the limits, the
// numbering and the validation being exercised are the API's own.

const settle = (ms = 140) => new Promise(resolve => setTimeout(resolve, ms));

async function bootDashboard() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osr-leadership-admin-'));
  const db = await initDb(path.join(dir, 'leadership.db'));
  await seedFromFrontend(db);
  await db.prepare("INSERT INTO media (id, filename, original_name, file_type, size, url) VALUES ('m-portrait','regent.jpg','Regent portrait','image/jpeg',20480,'/uploads/regent.jpg')").run();

  const app = createApp(db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (route, body) => fetch(base + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body)
  });
  assert.equal((await post('/api/auth/setup', { name: 'Owner', email: 'owner@example.org', password: 'SecureOwner123!' })).status, 200);
  const login = await post('/api/auth/login', { email: 'owner@example.org', password: 'SecureOwner123!' });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'the dashboard needs a session to write with');

  const errors = [];
  const state = { confirm: true };
  const dom = new JSDOM(adminHtml, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `${base}/OSRAdminControl2026`,
    beforeParse(window) {
      window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
      window.BroadcastChannel = undefined;
      // askConfirm falls back to window.confirm where <dialog> has no showModal,
      // which is the case in jsdom: this is the office clicking "Confirm".
      window.confirm = () => state.confirm;
      window.fetch = (url, options = {}) => fetch(new URL(String(url), base), {
        ...options,
        headers: { ...(options.headers || {}), cookie, origin: base }
      });
      window.addEventListener('error', event => errors.push(String(event.error?.stack || event.message)));
    },
  });
  await settle(260);

  const { window } = dom;
  const document = window.document;
  const tab = () => document.getElementById('tab-leadership');
  const form = () => document.getElementById('ldForm');
  const preview = () => document.getElementById('ldPreview');
  const field = name => form().querySelector(`[name="${name}"]`);
  const navItems = () => [...tab().querySelectorAll('.ld-nav-item')];
  const errText = () => (form().querySelector('.err')?.textContent || '').trim();
  const toasts = () => [...document.querySelectorAll('#toasts .toast')].map(node => node.textContent);
  const type = (name, value) => {
    const input = field(name);
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const choose = (name, value) => {
    const input = field(name);
    input.value = value;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const api = async (route, options) => (await fetch(base + route, { ...options, headers: { ...(options?.body ? { 'content-type': 'application/json' } : {}), cookie, origin: base } })).json();
  const records = async () => api('/api/leadership');
  const open = async () => { await window.renderLeadershipAdmin(); await settle(); };

  return {
    window, document, tab, form, preview, field, navItems, errText, toasts, type, choose, api, records, open, errors, state, base,
    click: selector => {
      const node = typeof selector === 'string' ? tab().querySelector(selector) : selector;
      assert.ok(node, `nothing to click for ${selector}`);
      node.click();
      return node;
    },
    async shutdown() {
      dom.window.close();
      await new Promise(resolve => server.close(resolve));
      db.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

let dash;
before(async () => { dash = await bootDashboard(); });
after(async () => { await dash.shutdown(); });

test('the dashboard reaches the archive, and only the archive, from its own tab', async () => {
  assert.deepEqual(dash.errors, [], 'the dashboard booted without throwing');

  assert.match(adminHtml, /data-tab="leadership"><span class="tab-index">10<\/span><span>Leadership<\/span>/, 'the sidebar carries the tab, in the numbered run');
  assert.match(adminHtml, /data-tab="leadership">Leadership<\/button>\s*<button class="topbar-nav-link" type="button" data-tab="about">/, 'and so does the top bar, next to the page it prints on');
  assert.match(adminHtml, /<section id="tab-leadership" class="section" aria-label="Leadership archive"><\/section>/);
  assert.match(adminHtml, /if \(tab === 'leadership'\) return renderLeadershipAdmin\(\);/, 'the tab has its own renderer');
  assert.match(adminHtml, /leadership: \['Administration 10'/);
  assert.match(adminHtml, /about: \['Administration 11'/, 'the tabs below it were renumbered rather than left with two tens');
  assert.match(adminHtml, /settings: \['Administration 13'/);
});

test('an empty archive offers seats, not blank cards', async () => {
  await dash.open();
  assert.match(dash.tab().textContent, /The archive is empty/, 'the pane says what is missing');
  assert.equal(dash.navItems().length, 0, 'no record, no row');
  const counts = [...dash.tab().querySelectorAll('.ld-nav-count')].map(node => node.textContent);
  assert.deepEqual(counts, ['0 / 2', '0 / 8'], 'both shelves show how many seats they hold');
  const adds = [...dash.tab().querySelectorAll('.ld-nav [data-ld-new]')].map(node => node.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(adds, ['+ Add primary leader · seat 01', '+ Add director · seat 01D'], 'and the next seat is named');
  assert.match(dash.preview().textContent, /Nothing to preview yet/, 'the preview does not invent a row to show');
  assert.equal(dash.preview().querySelectorAll('.ldp-card, .ldp-leader').length, 0);
  assert.ok(dash.tab().querySelector('[data-ld-samples]'), 'the sample profiles are one click away');
});

test('the sample profiles fill every seat, and say what they are', async () => {
  dash.click('[data-ld-samples]');
  await settle(260);
  const rows = await dash.records();
  assert.equal(rows.length, 10, 'two primary figures and eight directors');
  assert.equal(rows.filter(row => Number(row.is_sample) === 1).length, 10);
  assert.deepEqual([...dash.tab().querySelectorAll('.ld-nav-count')].map(node => node.textContent), ['2 / 2', '8 / 8']);
  assert.deepEqual(dash.navItems().map(node => node.querySelector('.ld-nav-item__num').textContent.split(' · ')[0]),
    ['01', '02', '01D', '02D', '03D', '04D', '05D', '06D', '07D', '08D'], 'the seats are numbered in the order they are filed');
  assert.ok(dash.navItems().every(node => /sample/.test(node.querySelector('.ld-nav-item__num').textContent)), 'and every one of them is marked as a sample');
  assert.match(dash.tab().textContent, /All 2 seats are taken/, 'a full shelf offers no add button');
  assert.equal(dash.tab().querySelectorAll('[data-ld-new]').length, 0);
  assert.match(dash.tab().textContent, /Remove 10 samples/, 'which is why removal is offered instead');

  assert.equal(dash.preview().querySelectorAll('.ldp-leader').length, 2, 'the preview is the page: two large cards');
  assert.equal(dash.preview().querySelectorAll('.ldp-card').length, 8, 'and the strip of eight below them');
  assert.ok(dash.preview().querySelector('.ldp-card.is-active'), 'one card is open before anybody points at anything');
  assert.equal(dash.preview().querySelectorAll('.ldp-plate').length, 10, 'no sample carries a portrait, so all ten show the plate');
  assert.match(dash.toasts().join(' '), /sample/, 'and the office is told what it just loaded');
});

test('the preview moves as the office types, before anything is saved', async () => {
  const director = dash.navItems()[2];
  const id = director.dataset.ldId;
  dash.click(director.querySelector('[data-ld-select]'));
  await settle();
  const card = () => dash.preview().querySelector(`[data-ldp-id="${id}"]`);
  assert.ok(card().classList.contains('is-active'), 'the record being edited is the card held open');

  dash.type('name', 'Maria S. Santos');
  dash.type('position', 'Director, Academic Affairs');
  dash.type('short_bio', 'Curriculum, consultations and academic concerns.');
  dash.type('quote', 'A record is a promise kept.');
  assert.equal(card().querySelector('.ldp-name').textContent, 'Maria S. Santos', 'the name is on the card as it is typed');
  assert.equal(card().querySelector('.ldp-role').textContent, 'Director, Academic Affairs');
  assert.equal(card().querySelector('.ldp-bio').textContent, 'Curriculum, consultations and academic concerns.');

  const stored = (await dash.records()).find(row => String(row.id) === id);
  assert.equal(stored.name, 'Sample Director 01', 'none of that has been written to the archive yet');

  // The portrait comes from the Media library picker, not from a pasted link.
  const picker = dash.form().querySelector('.photo-pick');
  assert.ok(picker, 'the media library is offered wherever a portrait can be filed');
  picker.value = '/uploads/regent.jpg';
  picker.dispatchEvent(new dash.window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(dash.field('photo').value, '/uploads/regent.jpg', 'the picker fills the field');
  assert.equal(card().querySelector('.ldp-media img')?.getAttribute('src'), '/uploads/regent.jpg', 'and the preview shows the portrait at once');
  assert.equal(card().querySelectorAll('.ldp-plate').length, 0, 'the plate gives way to it');

  dash.choose('is_published', '0');
  await settle();
  assert.ok(dash.preview().querySelector(`[data-ldp-id="${id}"]`).classList.contains('is-draft'),
    'a withdrawn record is marked in the preview rather than silently dropped from it');
  dash.choose('is_published', '1');
  await settle();
  dash.choose('category', 'primary');
  await settle();
  assert.equal(dash.preview().querySelectorAll('.ldp-leader').length, 3, 'moving the record to the other shelf moves its card in the preview');
  dash.choose('category', 'director');
  await settle();

  dash.form().querySelector('[type="submit"]').click();
  await settle(260);
  const saved = (await dash.records()).find(row => String(row.id) === id);
  assert.equal(saved.name, 'Maria S. Santos', 'and saving writes exactly what the preview was showing');
  assert.equal(saved.photo, '/uploads/regent.jpg');
  assert.equal(saved.quote, 'A record is a promise kept.');
  assert.equal(Number(saved.is_published), 1);
  assert.deepEqual(saved.previous_positions, ['Sample line — replace with the first real entry', 'Sample line — replace with the second real entry'],
    'a line list comes back as lines');
  assert.match(dash.toasts().join(' '), /Record saved/);
});

test('the editor refuses what the API would refuse, before asking it', async () => {
  const cases = [
    ['name', '', /needs a name/],
    ['quote', 'q'.repeat(341), /too long — 341 characters, the limit is 340/],
    ['photo', 'javascript:alert(1)', /https:\/\/ image link or an image from the Media library/],
    ['facebook', 'facebook.com/osr', /must be an https:\/\/ link/],
    ['email', 'not-an-email', /is not a valid email address/],
    ['responsibilities', Array.from({ length: 15 }, (_, index) => `Line ${index}`).join('\n'), /at most 14 lines/],
    ['short_bio', 'x'.repeat(241), /too long — 241 characters, the limit is 240/],
  ];
  // A valid record, apart from whichever one field is being tried.
  const valid = {
    name: 'Maria S. Santos',
    quote: 'A record is a promise kept.',
    photo: '/uploads/regent.jpg',
    facebook: 'https://facebook.com/bulsuosr',
    email: 'osr@bulsu.edu.ph',
    responsibilities: 'Academic concerns\nConsultations',
    short_bio: 'Curriculum, consultations and academic concerns.'
  };
  const before = await dash.records();
  for (const [name, value, message] of cases) {
    dash.type(name, value);
    dash.form().querySelector('[type="submit"]').click();
    await settle(160);
    assert.match(dash.errText(), message, `${name} is refused in the editor`);
    assert.deepEqual(await dash.records(), before, `and refusing ${name} changes nothing in the archive`);
    dash.type(name, valid[name]);   // the next case has to fail on its own field
  }
  dash.form().querySelector('[type="submit"]').click();
  await settle(260);
  assert.equal(dash.errText(), '', 'a valid record saves without an argument');
  const saved = (await dash.records()).find(row => row.name === 'Maria S. Santos');
  assert.deepEqual(saved.responsibilities, ['Academic concerns', 'Consultations']);
  assert.equal(saved.email, 'osr@bulsu.edu.ph');
});

test('the shelf limit is enforced in the editor too', async () => {
  const id = (await dash.records()).find(row => row.name === 'Maria S. Santos').id;
  dash.navItems().find(node => node.dataset.ldId === id).querySelector('[data-ld-select]').click();
  await settle();
  dash.choose('category', 'primary');
  await settle();
  dash.form().querySelector('[type="submit"]').click();
  await settle(200);
  assert.match(dash.errText(), /The archive holds 2 primary leaders/, 'a third primary figure is refused before the request is made');
  dash.choose('category', 'director');
  await settle();
  dash.form().querySelector('[type="submit"]').click();
  await settle(240);
  assert.equal(dash.errText(), '');
});

test('order is dragged, arrowed and keyed, and the numbers follow', async () => {
  await dash.open();
  const directors = () => dash.navItems().filter(node => /D$/.test(node.querySelector('.ld-nav-item__num').textContent.split(' · ')[0]));
  const names = () => directors().map(node => node.querySelector('.row-title').textContent);
  assert.equal(directors().length, 8, 'the directorate is eight seats');
  const [first, second] = names();

  // ↑/↓: the reorder anybody can do without a mouse.
  dash.click(directors()[1].querySelector('[data-ld-move="-1"]'));
  await settle(280);
  assert.deepEqual(names().slice(0, 2), [second, first], 'the second director is now first, and the first moved down behind it');
  assert.deepEqual((await dash.records()).filter(row => row.category === 'director').slice(0, 2).map(row => row.name),
    [second, first], 'which is the order the server now holds');

  // Drag-and-drop, which is what the office will actually do.
  const items = directors();
  const dragged = items[2];
  const target = items[0];
  const draggedName = dragged.querySelector('.row-title').textContent;
  const dragEvent = (type, node, clientY) => {
    const event = new dash.window.Event(type, { bubbles: true, cancelable: true });
    event.clientY = clientY;
    event.dataTransfer = { setData() {}, getData: () => '', effectAllowed: '', dropEffect: '' };
    node.dispatchEvent(event);
    return event;
  };
  const box = { top: 0, height: 40 };
  dragged.getBoundingClientRect = () => box;
  target.getBoundingClientRect = () => box;
  dragEvent('dragstart', dragged, 0);
  assert.ok(dragged.classList.contains('is-dragging'), 'the row being dragged says so');
  dragEvent('dragover', target, 4);
  assert.ok(target.classList.contains('is-drop-before'), 'and the row it is over shows where it will land');
  dragEvent('drop', target, 4);
  await settle(280);
  assert.equal(directors().map(node => node.querySelector('.row-title').textContent)[0], draggedName, 'the drop put it there');
  assert.equal(dash.navItems().filter(node => node.classList.contains('is-dragging')).length, 0, 'and the drag markers are cleared');
  assert.match(dash.toasts().join(' '), /reordered/i);

  // The keyboard does the same job on the grip.
  const grip = directors()[1].querySelector('[data-ld-grip]');
  const keyed = directors()[1].querySelector('.row-title').textContent;
  const keyEvent = new dash.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
  grip.dispatchEvent(keyEvent);
  await settle(300);
  assert.equal(directors().map(node => node.querySelector('.row-title').textContent)[0], keyed, 'an arrow key on the grip reorders exactly like a drag');

  // A director cannot be dropped onto the primary shelf.
  const primary = dash.navItems()[0];
  const moved = directors()[directors().length - 1];
  moved.getBoundingClientRect = () => box;
  primary.getBoundingClientRect = () => box;
  const before = await dash.records();
  dragEvent('dragstart', moved, 0);
  dragEvent('dragover', primary, 4);
  dragEvent('drop', primary, 4);
  await settle(280);
  assert.match(dash.toasts().join(' '), /cannot be dropped/, 'the two shelves stay two shelves');
  assert.deepEqual((await dash.records()).map(row => row.id), before.map(row => row.id), 'and nothing moved');
});

test('a printed number can be overridden by hand, and given back', async () => {
  await dash.open();
  const item = dash.navItems()[3];
  dash.click(item.querySelector('[data-ld-select]'));
  await settle();
  dash.type('number', 'VII');
  dash.form().querySelector('[type="submit"]').click();
  await settle(260);
  await dash.open();
  assert.equal(dash.navItems()[3].querySelector('.ld-nav-item__num').textContent.split(' · ')[0], 'VII', 'the override is what the page will print');
  dash.click(dash.navItems()[3].querySelector('[data-ld-select]'));
  await settle();
  dash.type('number', '');
  dash.form().querySelector('[type="submit"]').click();
  await settle(260);
  await dash.open();
  assert.match(dash.navItems()[3].querySelector('.ld-nav-item__num').textContent, /^0\dD/, 'and clearing it hands the number back to the order');
});

test('a record can be added, and removing the samples leaves it alone', async () => {
  // One seat is freed so a real record can be written into a full archive.
  dash.click(dash.navItems()[9].querySelector('[data-ld-select]'));
  await settle();
  dash.click('[data-ld-delete]');
  await settle(280);
  assert.equal((await dash.records()).length, 9, 'the record is gone from the archive');
  assert.match(dash.toasts().join(' '), /removed from the archive/);

  dash.click('[data-ld-new="director"]');
  await settle();
  assert.equal(dash.field('name').value, '', 'a new seat starts empty — nothing is filled in for the office');
  assert.equal(dash.field('category').value, 'director');
  assert.equal(dash.field('is_published').value, '1', 'and is published unless the office says otherwise');
  assert.match(dash.tab().textContent, /Nothing is published until it is saved/);
  dash.type('name', 'Jose R. Reyes');
  dash.type('position', 'Director, Student Welfare');
  dash.type('short_bio', 'Welfare, services and the concern desk.');
  dash.type('biography', 'Nine years in the Office.');
  dash.type('responsibilities', 'Runs the concern desk');
  dash.type('previous_positions', 'Council Secretary');
  dash.type('projects', 'Free printing services');
  assert.equal(dash.preview().querySelector('[data-ldp-id="ld-draft"] .ldp-name').textContent, 'Jose R. Reyes',
    'an unsaved record is previewed in the row it will join');
  dash.form().querySelector('[type="submit"]').click();
  await settle(300);
  const rows = await dash.records();
  assert.equal(rows.length, 10);
  const created = rows.find(row => row.name === 'Jose R. Reyes');
  assert.ok(created, 'the record was written');
  assert.equal(created.display_number, '08D', 'and numbered by the seat it took');
  assert.equal(Number(created.is_sample), 0, 'a record the office wrote is not a sample');

  dash.click('[data-ld-clear-samples]');
  await settle(320);
  const kept = await dash.records();
  assert.equal(kept.length, 1, 'the nine samples are gone');
  assert.equal(kept[0].name, 'Jose R. Reyes', 'and the record the office wrote is untouched');
  assert.equal(kept[0].display_number, '01D', 'which closes up into the first seat');
  await dash.open();
  assert.deepEqual([...dash.tab().querySelectorAll('.ld-nav-count')].map(node => node.textContent), ['0 / 2', '1 / 8']);
  assert.equal(dash.tab().querySelectorAll('[data-ld-samples]').length, 1, 'the samples can be loaded again');
  assert.ok(!/Remove \d+ samples/.test(dash.tab().textContent), 'and there is nothing left to remove');
});

test('the preview is the public interaction, and clicking a card edits that person', async () => {
  dash.click('[data-ld-samples]');
  await settle(300);
  const cards = () => [...dash.preview().querySelectorAll('.ldp-card')];
  const point = node => node.dispatchEvent(new dash.window.MouseEvent('pointerover', { bubbles: true }));
  point(cards()[4]);
  assert.equal(dash.preview().querySelector('.ldp-card.is-active').dataset.ldpId, cards()[4].dataset.ldpId, 'pointing at a card opens it');
  const strip = dash.preview().querySelector('[data-ldp-strip]');
  strip.dispatchEvent(new dash.window.MouseEvent('pointerleave'));
  assert.equal(dash.preview().querySelector('.ldp-card.is-active').dataset.ldpId, cards()[0].dataset.ldpId, 'and leaving the row puts it back');

  const target = cards()[6].dataset.ldpId;
  cards()[6].querySelector('[data-ldp-select]').click();
  await settle();
  assert.equal(dash.field('name').value, (await dash.records()).find(row => String(row.id) === target).name,
    'clicking a card in the preview opens that record for editing');

  // The motion is the public page's own: out of focus, one card clear, the rest
  // of the row behind it, over half a second.
  assert.match(adminHtml, /\.ldp-media\{[^}]*blur\(3px\)/s, 'the preview cards start out of focus');
  assert.match(adminHtml, /\.ldp-card\.is-active \.ldp-media[^{]*\{[^}]*blur\(0\)/, 'and the open one comes clear');
  assert.match(adminHtml, /\.ldp-strip\.is-open \.ldp-card:not\(\.is-active\) \.ldp-media\{[^}]*blur\(4\.5px\)/, 'while the others recede');
  assert.match(adminHtml, /\.ldp-card\{[^}]*transition:flex-grow \.5s cubic-bezier\(\.16,1,\.3,1\)/s, 'the row reorganises on the same ease as the site');
  assert.match(adminHtml, /\.ldp-card\.is-active\{flex-grow:4\.4/, 'by the same amount');
  assert.match(adminHtml, /\.ldp-name\{[^}]*transition:font-size \.45s/s, 'and the name grows instead of being replaced');
  assert.match(adminHtml, /\.ldp-hit:focus-visible\{outline:2px solid #FFC9D1/, 'the preview is keyboard-reachable on ink');
  assert.match(adminHtml, /\.ldp-leader\.is-draft:after,\.ldp-card\.is-draft:after\{content:"HIDDEN"/, 'a withdrawn record is marked, not hidden from the office');
});

test('unsaved edits are not thrown away by a click elsewhere', async () => {
  await dash.open();
  const secondId = dash.navItems()[1].dataset.ldId;
  // The tree is repainted on every selection, so the row to click has to be
  // looked up again each time rather than held on to.
  const selectRow = id => dash.click(dash.navItems().find(node => node.dataset.ldId === id).querySelector('[data-ld-select]'));
  selectRow(dash.navItems()[0].dataset.ldId);
  await settle();
  const written = `Draft ${Date.now()}`;
  dash.type('short_bio', written);
  assert.match(dash.form().querySelector('[data-ld-state]').textContent, /Unsaved changes/);

  dash.state.confirm = false;
  selectRow(secondId);
  await settle();
  assert.equal(dash.field('short_bio').value, written, 'declining the warning keeps the office where it was');

  dash.state.confirm = true;
  selectRow(secondId);
  await settle();
  assert.notEqual(dash.field('short_bio').value, written, 'accepting it moves on, and the draft goes with it');
  assert.equal((await dash.records()).some(row => row.short_bio === written), false, 'and nothing was written behind the office’s back');
});

// The people moved out of the About tab into this one, which left that editor
// holding wording only. Drawing it is the check: a field list that no longer
// matches the code around it is a blank dashboard, not a warning.
test('the About tab still renders, now that its people moved out', async () => {
  await dash.window.renderAbout();
  await settle();
  const about = dash.document.getElementById('tab-about');
  assert.deepEqual([...about.querySelectorAll('[data-pane]')].map(node => node.dataset.pane),
    ['header', 'mandate', 'office', 'regent'], 'one pane per part of the page');
  assert.deepEqual([...about.querySelectorAll('#aboutForm [name]')].map(input => input.getAttribute('name')),
    ['eyebrow', 'title', 'intro', 'mandate_heading', 'mandate_lede', 'mandate_items',
      'office_heading', 'office_lede', 'directorate_heading', 'sr_name', 'sr_meta', 'sr_note'],
    'exactly the wording the page prints, and the title above the archive');
  assert.ok(about.querySelector('#aboutForm [type="submit"]'), 'and it can still be saved');
  assert.deepEqual(dash.errors, [], 'nothing threw while drawing it');
});

test('the editor offers every field the page prints, and nothing it does not', async () => {
  const site = await fs.readFile(sitePath, 'utf8');
  const listed = adminHtml.slice(adminHtml.indexOf('const LD_FIELDS = ['), adminHtml.indexOf('const LD_FIELD_LABELS'));
  const keys = [...listed.matchAll(/^  \['([a-z_]+)'/gm)].map(match => match[1]);
  assert.deepEqual(keys, ['name', 'position', 'category', 'number', 'photo', 'short_bio', 'quote', 'biography',
    'responsibilities', 'previous_positions', 'projects', 'facebook', 'instagram', 'email', 'is_published'],
    'the record form is the whole schema and no more');
  const routes = await fs.readFile(new URL('../routes/leadership.js', import.meta.url).pathname, 'utf8');
  for (const key of keys.filter(key => key !== 'is_published')) {
    assert.ok(site.includes(key), `${key} is a field the public archive actually reads`);
  }
  // The one field the page never reads: the API filters on it, so a withdrawn
  // record cannot reach the frontend at all.
  assert.ok(!site.includes('is_published'), 'publication is decided by the server, not by the page');
  assert.match(routes, /filter\(row => Number\(row\.is_published\) === 1\)/);
  // What the page renders is what the archive prints: no field for a heading the
  // page does not have, no second photo field, no ordering field the drag does.
  for (const gone of ['order_index', 'display_number', 'created_at', 'is_sample', 'twitter', 'linkedin', 'phone']) {
    assert.doesNotMatch(listed, new RegExp(`'${gone}'`), `${gone} is not something the office should be typing`);
  }
  assert.match(adminHtml, /draggable="true"/, 'the order is dragged');
  assert.match(adminHtml, /data-ld-move="-1"/, 'and arrowed, for anybody who cannot drag');
  assert.match(adminHtml, /\['ArrowUp', 'ArrowDown'\]\.includes\(event\.key\)/, 'and keyed on the grip itself');
  assert.match(adminHtml, /data-ld-grip/, 'which is a button, so it is reachable by Tab');
  assert.match(adminHtml, /ld-nav-item__open\{position:absolute;inset:0/, 'one control is stretched over the row, as on the public card');
});
