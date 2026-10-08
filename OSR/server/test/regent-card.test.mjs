import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');
const integration = fs.readFileSync(new URL('../../osr-website/js/cms-integration.js', import.meta.url).pathname, 'utf8');

// The masthead's one card is a person, not a poster: a confirmed name, the term,
// one line in the Regent's own words, and the way to reach them. The portrait
// that used to be filed into the top of this card now belongs to the leadership
// archive on About, where it is one of ten records instead of the only face on
// the homepage — so what has to hold here is that the card still works in every
// combination the office can produce, and that nothing in it asks for a
// photograph any more.

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

test('the card never carries a portrait, however one is offered', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', photo: '/uploads/regent.jpg', message: 'x' });
  assert.equal(page.card().querySelectorAll('img').length, 0, 'no photograph is filed into the masthead card');
  assert.equal(page.avatar().textContent, 'JD', 'the initials are the card\'s only picture of the person');
  assert.ok(!page.card().className.includes('photo'), 'and no portrait state is left on the card');
});

test('the portrait and everything that hung off it are gone from the masthead', () => {
  for (const gone of ['regentPortrait', 'regentPortraitImg', 'regent-card__portrait', 'hero__card--photo', '--pad:26px']) {
    assert.ok(!html.includes(gone), `${gone} is no longer part of the page`);
  }
  assert.match(html, /\.hero--solo\{grid-template-columns:minmax\(0,1fr\)\}/, 'the masthead still takes the full width when the card is hidden');
  assert.match(html, /\.hero--solo \.hero__stage\{display:none\}/, 'and the empty column is not left behind it');
  assert.doesNotMatch(html, /photo:\s*""\s*,\s*\/\/\s*\/uploads/, 'the built-in record has no photograph field to fill in');
  assert.doesNotMatch(integration, /sr_photo/, 'the CMS no longer hands a portrait to the masthead');
});
