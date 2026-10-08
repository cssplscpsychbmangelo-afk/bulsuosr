import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../../osr-website/index.html', import.meta.url).pathname, 'utf8');
const integration = fs.readFileSync(new URL('../../osr-website/js/cms-integration.js', import.meta.url).pathname, 'utf8');

// The leadership archive on the public About page: two primary figures, then a
// directorate as a strip of narrow cards that open around whichever one the
// visitor points at. What has to hold is the interaction — one card is always
// open, pointing at another moves the whole row, and clicking opens the record
// in the site's own modal rather than navigating away — and the honesty of it:
// no record, no card, and never a name the office did not publish.

const ARCHIVE = [
  {
    id: 'ld-aaaa', category: 'primary', name: 'Juan D. Dela Cruz', position: 'Student Regent', display_number: '01',
    short_bio: 'One line that appears when the card opens.', quote: 'Every decision reaches a student.',
    biography: 'Two terms on the Board of Regents.', responsibilities: ['Chairs the student caucus', 'Files the annual report'],
    previous_positions: ['Council President'], projects: ['Free printing services'],
    facebook: 'https://facebook.com/bulsuosr', instagram: '', email: 'regent@bulsu.edu.ph',
    photo: '/uploads/regent.jpg', is_published: 1
  },
  {
    id: 'ld-bbbb', category: 'primary', name: 'Ana R. Reyes', position: 'Executive Director', display_number: '02',
    short_bio: '', quote: '', biography: '', responsibilities: [], previous_positions: [], projects: [],
    facebook: '', instagram: '', email: '', photo: '', is_published: 1
  },
  {
    id: 'ld-cccc', category: 'director', name: 'Ben Santos', position: 'Director, Academic Affairs', display_number: '01D',
    short_bio: 'Curriculum and academic concerns.', quote: '', biography: 'Nine years in the Office.',
    responsibilities: ['Academic concerns'], previous_positions: [], projects: [],
    facebook: '', instagram: 'https://instagram.com/bulsuosr', email: '', photo: '', is_published: 1
  },
  {
    id: 'ld-dddd', category: 'director', name: 'Carla Mendoza', position: 'Director, Finance', display_number: '02D',
    short_bio: 'Budget and transparency.', quote: '', biography: '', responsibilities: [], previous_positions: [], projects: [],
    facebook: '', instagram: '', email: '', photo: 'javascript:alert(1)', is_published: 1
  },
  {
    id: 'ld-eeee', category: 'director', name: 'Dino Ramos', position: 'Director, Student Welfare', display_number: '03D',
    short_bio: 'Welfare and services.', quote: '', biography: '', responsibilities: [], previous_positions: [], projects: [],
    facebook: '', instagram: '', email: '', photo: '', is_published: 1
  }
];

function archivePage({ coarse = false } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://osr.netlify.app/#about',
    beforeParse(window) {
      window.matchMedia = query => ({
        matches: coarse ? query.includes('hover:none') : query.includes('hover:hover'),
        media: query,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      });
      window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      window.scrollTo = () => {};
      window.Element.prototype.scrollIntoView = () => {};
      window.BroadcastChannel = undefined;
    },
  });
  const { document, window } = dom.window;
  const pointer = (node, type) => node.dispatchEvent(new window.MouseEvent(type, { bubbles: type !== 'pointerleave' }));
  return {
    document, window, pointer,
    apply: rows => window.applyLeadership(rows),
    wrap: () => document.getElementById('leadership'),
    leaders: () => [...document.querySelectorAll('.ld-leader')],
    cards: () => [...document.querySelectorAll('.ld-card')],
    strip: () => document.getElementById('ldStrip'),
    active: () => document.querySelector('.ld-card.is-active'),
    modal: () => document.getElementById('detailModal'),
    modalOpen: () => document.getElementById('detailModal').hasAttribute('open'),
    body: () => document.getElementById('modalBody'),
    close: async () => { await new Promise(r => setTimeout(r, 120)); dom.window.close(); },
  };
}

test('with nothing published the block says so, and shows no cards', async t => {
  const page = archivePage();
  t.after(page.close);
  assert.equal(page.cards().length, 0, 'a fresh page draws no cards at all');
  page.apply([]);
  assert.ok(!page.document.getElementById('ldEmpty').hidden, 'the empty state is the whole block');
  assert.match(page.document.getElementById('ldEmpty').textContent, /No leadership records are published yet/);
  assert.ok(page.document.getElementById('ldLeaders').hidden, 'no empty shelf is left behind');
  assert.ok(page.document.getElementById('ldBoard').hidden);
  assert.equal(page.wrap().querySelectorAll('img').length, 0, 'and no portrait is invented to fill it');
});

test('a name that means "nobody yet" is not a person', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply([
    { id: 'ld-1', category: 'primary', name: 'TBD', position: 'Student Regent', display_number: '01', is_published: 1 },
    { id: 'ld-2', category: 'director', name: '   ', display_number: '01D', is_published: 1 },
    { id: 'ld-3', category: 'director', name: 'To be announced', display_number: '02D', is_published: 1 }
  ]);
  assert.equal(page.wrap().querySelectorAll('.ld-leader, .ld-card').length, 0, 'a placeholder is never printed as an officer');
  assert.ok(!page.document.getElementById('ldEmpty').hidden);
});

test('the two shelves are drawn separately, and one card is always open', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  assert.equal(page.leaders().length, 2, 'the primary figures are the two large cards');
  assert.equal(page.cards().length, 3, 'and the directorate is the strip below them');
  assert.deepEqual(page.leaders().map(node => node.querySelector('.ld-leader__num').textContent), ['01', '02']);
  assert.deepEqual(page.cards().map(node => node.querySelector('.ld-card__num').textContent), ['01D', '02D', '03D']);
  assert.equal(page.active().dataset.id, 'ld-cccc', 'the first director is open before anybody points at anything');
  assert.ok(page.strip().classList.contains('is-open'), 'so the row is never a wall of blur');
  assert.equal(page.document.getElementById('ldEmpty').hidden, true);
  assert.equal(page.leaders()[0].querySelector('.ld-leader__name').textContent, 'Juan D. Dela Cruz');
  assert.equal(page.leaders()[0].querySelector('.ld-leader__role').textContent, 'Student Regent');
  assert.equal(page.leaders()[0].querySelector('.ld-leader__bio').textContent, 'One line that appears when the card opens.');
  assert.equal(page.leaders()[1].querySelectorAll('.ld-leader__bio').length, 0, 'a description nobody wrote is not an empty line');
});

test('each card is one control over one portrait, and nothing is invented', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  const [first, second, third] = page.cards();
  const hit = first.querySelector('.ld-hit');
  assert.equal(hit.tagName, 'BUTTON', 'the card is opened by a real button, so the keyboard gets the same target');
  assert.equal(hit.dataset.record, 'ld-cccc');
  assert.match(hit.getAttribute('aria-label'), /Open the record of Ben Santos, Director, Academic Affairs/);
  assert.equal(first.querySelector('h5.ld-card__name').textContent, 'Ben Santos');
  assert.equal(first.querySelectorAll('.ld-hit').length, 1, 'one control per card');

  assert.equal(first.querySelectorAll('.ld-plate').length, 1, 'no portrait: the archive’s own numbered plate');
  assert.equal(first.querySelectorAll('img').length, 0);
  assert.equal(second.querySelectorAll('img').length, 0, 'an unsafe address never becomes a portrait');
  assert.equal(second.querySelectorAll('.ld-plate').length, 1, 'so the plate stands in for it');
  assert.equal(third.querySelectorAll('.ld-plate').length, 1);
  assert.equal(page.leaders()[0].querySelector('img').getAttribute('src'), '/uploads/regent.jpg');
  assert.equal(page.leaders()[0].querySelector('img').getAttribute('alt'), '', 'decorative: the name is printed on the card');
});

test('a name is printed, never parsed', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply([{ id: 'ld-x', category: 'director', name: '<img src=x onerror=alert(1)>', position: '"><script>alert(2)</script>', display_number: '01D', is_published: 1 }]);
  const card = page.cards()[0];
  assert.equal(card.querySelectorAll('script').length, 0);
  assert.equal(card.querySelectorAll('img').length, 0, 'the injected tag is text on the card, not a node in it');
  assert.equal(card.querySelector('.ld-card__name').textContent, '<img src=x onerror=alert(1)>');
});

test('pointing at a card moves the whole row, and leaving puts it back', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  const [first, , third] = page.cards();
  page.pointer(third, 'pointerover');
  assert.equal(page.active().dataset.id, 'ld-eeee', 'the card under the cursor is the one that opens');
  assert.equal(first.classList.contains('is-active'), false, 'and the row reorganises around it');
  page.pointer(first, 'pointerover');
  assert.equal(page.active().dataset.id, 'ld-cccc');
  page.pointer(page.strip(), 'pointerleave');
  assert.equal(page.active().dataset.id, 'ld-cccc', 'leaving the row returns it to the first record');
  assert.ok(page.strip().classList.contains('is-open'), 'which is still open: the strip never collapses to nothing');
});

test('keyboard focus opens the same card the cursor does', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  const third = page.cards()[2];
  third.querySelector('.ld-hit').dispatchEvent(new page.window.FocusEvent('focusin', { bubbles: true }));
  assert.equal(page.active().dataset.id, 'ld-eeee');
});

test('clicking a card opens the record in the modal, and stays on the page', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  page.leaders()[0].querySelector('.ld-hit').click();
  assert.ok(page.modalOpen(), 'the record opens where the visitor is');
  assert.equal(page.window.location.hash, '#about', 'nothing navigates away from the archive');
  assert.equal(page.document.getElementById('modalTitle').textContent, 'Juan D. Dela Cruz');
  assert.equal(page.document.getElementById('modalEyebrow').textContent, '01 · Office of the Student Regent');
  assert.equal(page.document.getElementById('modalMeta').textContent, 'Student Regent');

  const record = page.body().querySelector('.ld-rec');
  assert.ok(record, 'the record is one block of portrait, quotation, biography and lists');
  assert.equal(record.querySelector('.ld-rec__num').textContent, '01');
  assert.equal(record.querySelector('.ld-rec__quote').textContent, 'Every decision reaches a student.');
  assert.equal(record.querySelector('.ld-rec__bio').textContent, 'Two terms on the Board of Regents.');
  const sections = [...record.querySelectorAll('.ld-rec__sec')];
  assert.deepEqual(sections.map(node => node.querySelector('.ld-rec__label').textContent),
    ['Responsibilities', 'Previous positions', 'Projects & initiatives']);
  assert.deepEqual([...sections[0].querySelectorAll('li')].map(li => li.textContent), ['Chairs the student caucus', 'Files the annual report']);
  const links = [...record.querySelectorAll('.ld-rec__links a')];
  assert.deepEqual(links.map(a => a.textContent), ['Facebook', 'Email']);
  assert.equal(links[0].getAttribute('href'), 'https://facebook.com/bulsuosr');
  assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer', 'an external link does not get the window');
  assert.equal(links[1].getAttribute('href'), 'mailto:regent@bulsu.edu.ph');
  assert.equal(links[1].hasAttribute('target'), false);
  assert.equal(record.querySelector('.ld-rec__media img').getAttribute('src'), '/uploads/regent.jpg');
});

test('a record with only a name and a seat is a short record, not a page of blanks', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  page.leaders()[1].querySelector('.ld-hit').click();
  const record = page.body().querySelector('.ld-rec');
  assert.equal(page.document.getElementById('modalTitle').textContent, 'Ana R. Reyes');
  assert.equal(record.querySelectorAll('.ld-rec__quote, .ld-rec__bio, .ld-rec__sec, .ld-rec__links').length, 0,
    'every field the office left empty is simply not drawn');
  assert.equal(record.querySelectorAll('.ld-plate').length, 1, 'and the plate stands in for the portrait');
});

test('the directorate record carries its own shelf title and its links', async t => {
  const page = archivePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  page.cards()[0].querySelector('.ld-hit').click();
  assert.equal(page.document.getElementById('modalEyebrow').textContent, '01D · The Directorate');
  const links = [...page.body().querySelectorAll('.ld-rec__links a')];
  assert.deepEqual(links.map(a => a.getAttribute('href')), ['https://instagram.com/bulsuosr']);
});

test('the heading above the directorate is the one the office saved', async t => {
  const page = archivePage();
  t.after(page.close);
  page.document.getElementById('ldBoardTitle').textContent = 'The Board of Directors';
  page.apply(ARCHIVE);
  page.cards()[0].querySelector('.ld-hit').click();
  assert.equal(page.document.getElementById('modalEyebrow').textContent, '01D · The Board of Directors',
    'the record reads the page’s own wording rather than a second copy of it');
  assert.equal(page.document.getElementById('ldBoardTitle').textContent, 'The Board of Directors',
    'and re-rendering the archive does not overwrite it');
});

test('with no hover the first tap opens the card and the second opens the record', async t => {
  const page = archivePage({ coarse: true });
  t.after(page.close);
  page.apply(ARCHIVE);
  const [first, , third] = page.cards();
  assert.equal(page.active().dataset.id, 'ld-cccc');
  third.querySelector('.ld-hit').click();
  assert.equal(page.modalOpen(), false, 'a finger has no way to preview, so the first tap is the preview');
  assert.equal(page.active().dataset.id, 'ld-eeee', 'and the row moves to that person');
  third.querySelector('.ld-hit').click();
  assert.ok(page.modalOpen(), 'the second tap opens the record');
  assert.equal(page.document.getElementById('modalTitle').textContent, 'Dino Ramos');

  page.window.closeModal();
  first.querySelector('.ld-hit').click();
  assert.equal(page.modalOpen(), false, 'tapping another card switches to that person instead');
  assert.equal(page.active().dataset.id, 'ld-cccc');
});

test('on a touch device the pointer does not fight the tap', async t => {
  const page = archivePage({ coarse: true });
  t.after(page.close);
  page.apply(ARCHIVE);
  page.pointer(page.cards()[2], 'pointerover');
  assert.equal(page.active().dataset.id, 'ld-cccc', 'a hover that cannot happen does not move the row');
  page.pointer(page.strip(), 'pointerleave');
  assert.equal(page.active().dataset.id, 'ld-cccc');
});

test('the archive is drawn by the page and fed by the CMS', async t => {
  assert.match(html, /function renderLeadership\(/, 'the page decides how the records are drawn');
  assert.match(html, /window\.applyLeadership = function\(rows\)/, 'so the CMS only hands over data');
  assert.match(html, /let LEADERSHIP = \[\];/, 'and nothing is hard-coded in the frontend');
  assert.match(html, /bindLeadership\(\); renderLeadership\(\);/, 'the archive is bound and drawn at boot, before any fetch resolves');
  assert.match(html, /openModal\(\{/, 'the record reuses the site’s own modal instead of shipping a second dialog');
  assert.match(integration, /fetchPublic\('leadership', forceRefresh\)/, 'the records are fetched with the rest of the page');
  assert.match(integration, /window\.applyLeadership\(leadership\)/, 'and applied through the page’s own renderer');
  assert.match(integration, /leadership: Array\.isArray\(leadership\) \? leadership : null/, 'so a failed fetch leaves the built-in empty state alone');
});

test('the blur-to-clear row is the signature, and it is written in the sheet', () => {
  // Many faces, out of focus; one person, sharp. The blur is on the shared media
  // wrapper, so a portrait and the drawn plate behave identically.
  assert.match(html, /\.ld-media\{[^}]*filter:grayscale\(1\) contrast\(1\.05\) brightness\(\.58\) blur\(3px\)/s, 'every card starts out of focus');
  assert.match(html, /\.ld-card\.is-active \.ld-media\{[^}]*blur\(0\)/, 'and the open one comes clear');
  assert.match(html, /\.ld-strip\.is-open \.ld-card:not\(\.is-active\) \.ld-media\{[^}]*blur\(4\.5px\)/, 'while the rest of the row recedes behind it');
  assert.match(html, /\.ld-media:after\{[^}]*mix-blend-mode:color/, 'the office red is laid over the photograph as hue, not as paint');
  assert.match(html, /\.ld-card\.is-active \.ld-media:after\{opacity:\.16\}/, 'and lifts when the card opens');
  assert.match(html, /\.ld-leader\{[^}]*isolation:isolate/s, 'so the wash blends with the portrait and not with the page behind it');
  // The card physically reorganises: it grows, the others shrink, over 500ms.
  assert.match(html, /\.ld-card\{[^}]*transition:flex-grow \.5s var\(--ease\)/s, 'the row moves over half a second on the site’s own ease');
  assert.match(html, /\.ld-card\.is-active\{flex-grow:4\.4/, 'the open card takes the room the others give up');
  assert.match(html, /\.ld-card\.is-active\{[^}]*box-shadow:inset 0 0 0 1px rgba\(166,25,46,\.4\)/s, 'with a thin accent edge rather than a shadow of its own');
  assert.match(html, /\.ld-strip\{[^}]*height:320px/, 'the strip has a fixed height, so opening a card never pushes the page under the cursor');
  // One element for the name in both states: a font size is animatable, a change
  // of typeface or writing direction is not.
  assert.match(html, /\.ld-card__name\{[^}]*font-size:13px[^}]*white-space:nowrap; overflow:hidden/s, 'the name is clipped while the card is narrow');
  assert.match(html, /\.ld-card__name\{[^}]*transition:font-size \.45s var\(--ease\)/s, 'and grows with the card instead of being swapped out');
  assert.match(html, /\.ld-card\.is-active \.ld-card__name\{font-size:22px\}/);
  assert.ok(!/\.ld-card[^{]*\{[^}]*writing-mode/.test(html), 'no rotated type between the two states');
  // The information arrives after the card has finished moving.
  assert.match(html, /\.ld-card__bio\{[^}]*transition:opacity \.35s var\(--ease\) \.1s/s, 'the description is delayed behind the motion');
  assert.match(html, /\.ld-card__cue\{[^}]*transition:opacity \.3s var\(--ease\) \.18s/s, 'and the cue last of all');
  assert.match(html, /\.ld-hit:focus-visible\{outline:2px solid #FFC9D1/, 'the focus ring is light, because the card is ink');
  assert.match(html, /@media\(hover:none\)\{[^}]*\.ld-leader__bio, \.ld-leader__cue\{opacity:1; transform:none\}/s,
    'with no hover to reveal it, the description is simply printed');
  assert.match(html, /\.ld-card__body\{[^}]*linear-gradient\(180deg/s, 'the type sits on a scrim, not on the photograph');
  assert.match(html, /\.ld-plate\{[^}]*radial-gradient\(44% 27% at 50% 30%/s, 'and a record with no portrait is a drawn plate, never a pretend face');
});

test('the archive survives a phone without becoming a horizontal scroll trap', () => {
  const mobile = html.slice(html.indexOf('@media(max-width:760px){\n  .ld-leaders'), html.indexOf('@media(hover:none){'));
  assert.match(mobile, /\.ld-leaders\{grid-template-columns:minmax\(0,1fr\)\}/, 'the two primary figures stack');
  assert.match(mobile, /\.ld-leader\{aspect-ratio:5\/4\}/, 'and stay large enough to be the top of the page');
  assert.match(mobile, /\.ld-strip\{height:auto; gap:10px; overflow-x:auto; scroll-snap-type:x proximity/,
    'the strip becomes a swipeable row, which is the one place horizontal scrolling is the point');
  assert.match(mobile, /\.ld-card\{flex:0 0 66%; height:290px; scroll-snap-align:center\}/, 'each card is a swipe target');
  assert.match(mobile, /\.ld-card\.is-active\{flex-grow:0\}/, 'and opening one no longer squeezes the others off the screen');
  assert.match(mobile, /\.ld-rec__media\{height:200px\}/, 'the record portrait is shorter where the panel is the whole width');
});
