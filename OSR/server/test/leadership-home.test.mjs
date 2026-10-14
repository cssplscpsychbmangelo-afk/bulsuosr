import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

// The Office's own two, on the dashboard. It is not a second archive: it reads
// the same rows the About page is drawn from, in the order the office filed
// them, at a size a dashboard row can carry — and it is the one place on the
// homepage a student can reach the whole record of the person who holds the
// seat. Nothing published, no section: the archive's honesty is not negotiable
// just because the block moved to a busier page.

const ARCHIVE = [
  {
    id: 'ld-aaaa', category: 'primary', name: 'Juan D. Dela Cruz', position: 'Student Regent', display_number: '01',
    short_bio: 'One line that appears under the name.', quote: 'Every decision reaches a student.',
    biography: 'Two terms on the Board of Regents.', photo: '', is_published: 1
  },
  {
    id: 'ld-bbbb', category: 'primary', name: 'Ana R. Reyes', position: 'Executive Director', display_number: '02',
    short_bio: '', quote: '', biography: '', photo: '', is_published: 1
  },
  {
    id: 'ld-cccc', category: 'director', name: 'Ben Santos', position: 'Director, Academic Affairs', display_number: '01D',
    short_bio: 'Curriculum and academic concerns.', photo: '', is_published: 1
  }
];

function homePage({ coarse = false } = {}) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://osr.netlify.app/',
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
  return {
    document, window,
    apply: rows => window.applyLeadership(rows),
    section: () => document.getElementById('homeLeadership'),
    cards: () => [...document.querySelectorAll('.ld-duo__card')],
    regent: data => window.renderStudentRegent(data),
    regentRecord: () => document.getElementById('regentRecord'),
    modalOpen: () => document.getElementById('detailModal').hasAttribute('open'),
    close: async () => { await new Promise(r => setTimeout(r, 120)); dom.window.close(); },
  };
}

test('with nothing published the homepage does not grow a row of empty cards', async t => {
  const page = homePage();
  t.after(page.close);
  assert.ok(page.section(), 'the section is in the page');
  assert.ok(page.section().hidden, 'but it is not drawn until somebody is published');
  page.apply([]);
  assert.equal(page.cards().length, 0);
  assert.ok(page.section().hidden);
  page.apply([{ id: 'ld-1', category: 'director', name: 'Ben Santos', display_number: '01D', is_published: 1 }]);
  assert.ok(page.section().hidden, 'the directorate belongs to the archive, not to the dashboard row');
  assert.equal(page.cards().length, 0);
});

test('the two seats are drawn from the same rows, in the order the office filed them', async t => {
  const page = homePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  assert.equal(page.cards().length, 2, 'the pair, and only the pair');
  assert.ok(!page.section().hidden);
  assert.deepEqual(page.cards().map(card => card.dataset.id), ['ld-aaaa', 'ld-bbbb']);
  assert.deepEqual(page.cards().map(card => card.querySelector('.ld-duo__num').textContent), ['01', '02']);
  assert.equal(page.cards()[0].querySelector('.ld-duo__name').textContent, 'Juan D. Dela Cruz');
  assert.equal(page.cards()[0].querySelector('.ld-duo__role').textContent, 'Student Regent');
  assert.equal(page.cards()[0].querySelector('.ld-duo__bio').textContent, 'One line that appears under the name.');
  assert.equal(page.cards()[1].querySelectorAll('.ld-duo__bio').length, 0, 'a line nobody wrote is not an empty line');
});

test('each card is one control over one plate, and no face is invented', async t => {
  const page = homePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  const [first, second] = page.cards();
  const hit = first.querySelector('.ld-hit');
  assert.equal(hit.tagName, 'BUTTON', 'the keyboard gets the same rectangle the mouse gets');
  assert.equal(hit.dataset.record, 'ld-aaaa');
  assert.match(hit.getAttribute('aria-label'), /Open the record of Juan D. Dela Cruz, Student Regent/);
  assert.equal(first.querySelectorAll('.ld-hit').length, 1);
  assert.equal(first.querySelectorAll('.ld-plate').length, 1, 'no portrait filed: the archive’s own plate');
  assert.equal(second.querySelectorAll('.ld-plate').length, 1);
  assert.equal(page.section().querySelectorAll('img').length, 0, 'and no invented photograph to fill it');
});

test('a name is printed, never parsed', async t => {
  const page = homePage();
  t.after(page.close);
  page.apply([{ id: 'ld-x', category: 'primary', name: '<img src=x onerror=alert(1)>', position: '"><script>alert(2)</script>', display_number: '01', is_published: 1 }]);
  const card = page.cards()[0];
  assert.equal(card.querySelectorAll('script').length, 0);
  assert.equal(card.querySelectorAll('img').length, 0, 'the injected tag is text on the card, not a node in it');
  assert.equal(card.querySelector('.ld-duo__name').textContent, '<img src=x onerror=alert(1)>');
});

test('clicking a card opens the record where the visitor is', async t => {
  const page = homePage();
  t.after(page.close);
  page.apply(ARCHIVE);
  page.cards()[1].querySelector('.ld-hit').click();
  assert.ok(page.modalOpen(), 'the record opens in the site’s own modal');
  assert.equal(page.window.location.hash, '', 'and nothing navigates away from the dashboard');
  assert.equal(page.document.getElementById('modalTitle').textContent, 'Ana R. Reyes');
  assert.equal(page.document.getElementById('modalMeta').textContent, 'Executive Director');
});

test('the masthead card offers the whole record only when the archive holds one', async t => {
  const page = homePage();
  t.after(page.close);
  page.regent({ name: 'Juan D. Dela Cruz' });
  assert.ok(page.regentRecord().hidden, 'a card with no record behind it does not offer one');
  page.apply(ARCHIVE);
  assert.ok(!page.regentRecord().hidden, 'and the same name in the archive puts it there');
  page.regentRecord().click();
  assert.ok(page.modalOpen());
  assert.equal(page.document.getElementById('modalTitle').textContent, 'Juan D. Dela Cruz');
  assert.equal(page.document.getElementById('modalEyebrow').textContent, '01 · Office of the Student Regent');
});

test('the pair is drawn at dashboard size, and the plate is developed on a touch device', () => {
  const duo = html.slice(html.indexOf('.ld-duo{'), html.indexOf('.ld-duo__card{'));
  assert.match(duo, /grid-template-columns:repeat\(2, minmax\(0,1fr\)\)/, 'two across, and never wider than the row');
  const card = html.slice(html.indexOf('.ld-duo__card{'), html.indexOf('.ld-duo__frame{'));
  assert.match(card, /border-left:4px solid var\(--red\)/, 'the filing rule, so it reads as the office’s own');
  assert.ok(!/aspect-ratio/.test(card), 'a dashboard row is not given the height of a portrait');
  assert.match(html, /\.ld-duo__card \.ld-hit:focus-visible\{outline:2px solid var\(--red\)/,
    'the focus ring is the accent on paper, where the archive’s pink would be invisible');
  const touch = html.slice(html.indexOf('@media(hover:none){'), html.indexOf('#page-about .ab-university'));
  assert.match(touch, /\.ld-duo__frame \.ld-media\{[^}]*blur\(0\)/s, 'no hover to clear it, so the plate is printed developed');
  const narrow = html.slice(html.indexOf('@media(max-width:760px){\n  .ld-leaders'), html.indexOf('@media(hover:none){'));
  assert.match(narrow, /\.ld-duo\{grid-template-columns:minmax\(0,1fr\)\}/, 'and on a phone the pair stacks');
});
