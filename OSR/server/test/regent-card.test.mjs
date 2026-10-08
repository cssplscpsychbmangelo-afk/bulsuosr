import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');
const integration = fs.readFileSync(new URL('../../osr-website/js/cms-integration.js', import.meta.url).pathname, 'utf8');

// The masthead's one card is a person, not a poster: a confirmed name, the term,
// one line in the Regent's own words, the way to reach them, and the portrait
// the leadership archive holds for the seat. What has to hold here is that the
// card works in every combination the office can produce — a photograph filed
// in the archive appears, a seat with none falls back to initials, and an
// unsafe address never becomes an <img>.

function heroPage() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://osr.netlify.app/',
    beforeParse(window) {
      window.matchMedia = query => ({
        matches: query.includes('hover:hover'),
        media: query,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      });
      window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      window.scrollTo = () => {};
    },
  });
  const { document, window } = dom.window;
  return {
    document, window,
    card: () => document.getElementById('regentCard'),
    hero: () => document.querySelector('.hero'),
    avatar: () => document.getElementById('regentPhoto'),
    message: () => document.getElementById('regentMessage'),
    term: () => document.getElementById('regentTerm'),
    render: data => window.renderStudentRegent(data),
    close: async () => { await new Promise(r => setTimeout(r, 120)); dom.window.close(); },
  };
}

test('with nobody confirmed the card is not there at all', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: '', message: '' });
  assert.ok(page.card().hidden, 'no name, no card');
  assert.ok(page.hero().classList.contains('hero--solo'), 'and the masthead takes the full width');
});

test('a name on its own is enough for the card, and nothing else appears', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', message: '', term: 'AY 2026–2027' });
  assert.ok(!page.card().hidden, 'a confirmed person is a card');
  assert.equal(page.document.getElementById('regentName').textContent, 'Juan D. Dela Cruz');
  assert.equal(page.avatar().textContent, 'JD', 'the initials come from the name, not from a placeholder');
  assert.ok(page.message().hidden, 'a line nobody wrote is not shown as an empty quotation');
  assert.ok(!page.term().hidden, 'the term the seat is held for is printed');
});

test('a message and a term appear only when the office has supplied them', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', message: 'Every decision reaches a student.', term: '' });
  assert.ok(!page.message().hidden);
  assert.equal(page.message().textContent, 'Every decision reaches a student.');
  assert.ok(page.term().hidden, 'and a term nobody confirmed is left out');
  assert.equal(page.avatar().textContent, 'JD', 'the initials carry the card whatever else is filled in');
});

test('the portrait the archive holds for the Regent is filed into the card', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', message: 'x' });
  assert.equal(page.card().querySelectorAll('img').length, 0, 'no archive yet: the initials carry the card');
  assert.equal(page.avatar().textContent, 'JD');
  page.window.applyLeadership([
    { id: 'ld-1', category: 'primary', name: 'Juan D. Dela Cruz', position: 'Student Regent', photo: 'https://drive.google.com/file/d/abc123/view?usp=sharing', is_published: 1 },
    { id: 'ld-2', category: 'primary', name: 'Ana R. Reyes', position: 'Executive Director', photo: '/uploads/ana.jpg', is_published: 1 }
  ]);
  const img = page.card().querySelector('img');
  assert.ok(img, 'the archive portrait arrives without a reload');
  assert.equal(img.getAttribute('src'), 'https://lh3.googleusercontent.com/d/abc123=w1200', 'a Drive share link is rewritten to the address an <img> can read');
  assert.equal(img.getAttribute('alt'), '', 'decorative: the name is printed beside it');
  assert.equal(page.document.getElementById('regentName').textContent, 'Juan D. Dela Cruz', 'and the re-render keeps the confirmed name');
});

test('the card reads the Student Regent seat when the names differ', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'No Match Name', message: 'x' });
  page.window.applyLeadership([
    { id: 'ld-1', category: 'primary', name: 'Ana R. Reyes', position: 'Executive Director', photo: '/uploads/ana.jpg', is_published: 1 },
    { id: 'ld-2', category: 'primary', name: 'Juan D. Dela Cruz', position: 'Student Regent', photo: '/uploads/juan.jpg', is_published: 1 }
  ]);
  assert.equal(page.card().querySelector('img').getAttribute('src'), '/uploads/juan.jpg', 'the Regent seat is the one whose portrait is shown');
});

test('an offered portrait wins, and an unsafe one never becomes an image', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', photo: 'https://example.com/regent.jpg', message: 'x' });
  assert.equal(page.card().querySelector('img').getAttribute('src'), 'https://example.com/regent.jpg');
  page.render({ name: 'Juan D. Dela Cruz', photo: 'javascript:alert(1)', message: 'x' });
  assert.equal(page.card().querySelectorAll('img').length, 0, 'an unsafe address is dropped');
  assert.equal(page.avatar().textContent, 'JD', 'and the initials stand in');
  assert.ok(!page.card().className.includes('photo'), 'no portrait state is left on the card');
});

test('the portrait and everything that hung off it are gone from the masthead', () => {
  for (const gone of ['regentPortrait', 'regentPortraitImg', 'regent-card__portrait', 'hero__card--photo', '--pad:26px']) {
    assert.ok(!html.includes(gone), `${gone} is no longer part of the page`);
  }
  assert.match(html, /\.hero--solo\{grid-template-columns:minmax\(0,1fr\)\}/, 'the masthead still takes the full width when the card is hidden');
  assert.match(html, /\.hero--solo \.hero__stage\{display:none\}/, 'and the empty column is not left behind it');
  assert.match(html, /function regentArchivePhoto\(name\)/, 'the card reads its portrait from the leadership archive');
  assert.match(html, /\.regent-card__photo img\{[^}]*object-fit:cover/, 'a filed portrait fills the circle');
  assert.doesNotMatch(integration, /sr_photo/, 'the CMS hands over no portrait; the archive supplies it');
});
