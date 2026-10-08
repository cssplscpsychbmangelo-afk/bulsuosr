import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');
const integration = fs.readFileSync(new URL('../../osr-website/js/cms-integration.js', import.meta.url).pathname, 'utf8');

// The masthead's one card is a person, not a poster: a confirmed name, the term,
// one line in the Regent's own words, their portrait and the way to reach them.
// The portrait is filed once in the leadership archive and the card shows it
// from there — a Google Drive share link pasted in the dashboard is rewritten
// to a direct image — and with none filed the initials carry the card. On a
// wide screen the card grows with the masthead so the hero stays balanced.

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

test('a filed portrait shows on the card, and without one the initials carry it', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', photo: '/uploads/regent.jpg', message: 'x' });
  const img = page.avatar().querySelector('img');
  assert.ok(img, 'the portrait is filed into the masthead card');
  assert.equal(img.getAttribute('src'), '/uploads/regent.jpg', 'a file this site serves is drawn as-is');
  page.render({ name: 'Juan D. Dela Cruz', photo: '' });
  assert.equal(page.avatar().querySelectorAll('img').length, 0, 'with no portrait the image is cleared');
  assert.equal(page.avatar().textContent, 'JD', 'and the initials carry the card again');
});

test('a Google Drive share link pasted as the portrait is drawn as a direct image', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', photo: 'https://drive.google.com/file/d/ABC123def45G/view?usp=sharing' });
  const img = page.avatar().querySelector('img');
  assert.ok(img, 'the Drive link becomes a picture on the card');
  assert.equal(img.getAttribute('src'), 'https://lh3.googleusercontent.com/d/ABC123def45G', 'the share page is swapped for the direct image endpoint');
});

test('the card grows with the masthead on a wide screen', () => {
  assert.match(html, /\.hero\{display:grid; grid-template-columns:1\.05fr 0\.95fr/, 'the hero columns are balanced on desktop');
  assert.match(html, /@media\(min-width:961px\)\{[\s\S]*?\.regent-card__photo\{width:96px; height:96px/, 'the portrait grows past its phone size on desktop');
  assert.match(html, /\.regent-card__photo img\{width:100%; height:100%; object-fit:cover/, 'and a filed portrait fills the round frame');
  assert.match(html, /\.hero--solo\{grid-template-columns:minmax\(0,1fr\)\}/, 'the masthead still takes the full width when the card is hidden');
  assert.match(html, /\.hero--solo \.hero__stage\{display:none\}/, 'and the empty column is not left behind it');
  assert.doesNotMatch(integration, /sr_photo/, 'the portrait reaches the card through the leadership archive, not the About document');
});
