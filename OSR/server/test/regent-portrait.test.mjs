import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

// The masthead's one card is a person: a confirmed name, and — when the office
// has one — a photograph treated into the site's own palette and filed into the
// top of the card. Neither the name nor the photograph is ever invented here, so
// what has to hold is the shape of every combination the office can actually
// produce, including the three where something is missing.

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
  const card = () => document.getElementById('regentCard');
  const portrait = () => document.getElementById('regentPortrait');
  const photo = () => document.getElementById('regentPortraitImg');
  const avatar = () => document.getElementById('regentPhoto');
  const message = () => document.getElementById('regentMessage');
  const render = data => window.renderStudentRegent(data);
  return {
    document, window, card, portrait, photo, avatar, message, render,
    close: async () => { await new Promise(r => setTimeout(r, 120)); dom.window.close(); },
  };
}

test('with nobody confirmed the card is not there at all', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: '', photo: '', message: '' });
  assert.ok(page.card().hidden, 'no name, no card');
  assert.ok(page.document.querySelector('.hero').classList.contains('hero--solo'), 'and the masthead takes the full width');
  assert.ok(page.portrait().hidden, 'no empty frame is left where a photograph would go');
});

test('a name on its own is enough for the card, and nothing else appears', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', photo: '', message: '', term: 'AY 2026–2027' });
  assert.ok(!page.card().hidden, 'a confirmed person is a card');
  assert.equal(page.document.getElementById('regentName').textContent, 'Juan D. Dela Cruz');
  assert.ok(page.portrait().hidden, 'with no photograph the portrait block stays out of the way');
  assert.ok(!page.avatar().hidden, 'and the initials carry the card instead');
  assert.equal(page.avatar().textContent, 'JD', 'the initials come from the name, not from a placeholder');
  assert.ok(page.message().hidden, 'a quotation nobody wrote is not shown as an empty line');
  assert.ok(!page.card().classList.contains('hero__card--photo'));
});

test('a photograph is filed into the top of the card, once', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', photo: '/uploads/regent.jpg', message: 'Every decision reaches a student.' });
  assert.ok(!page.portrait().hidden, 'the portrait is on the card');
  assert.equal(page.photo().getAttribute('src'), '/uploads/regent.jpg');
  assert.equal(page.photo().getAttribute('alt'), '', 'decorative: the name it belongs to is printed under it');
  assert.ok(page.card().classList.contains('hero__card--photo'), 'which is what the treatment hangs off');
  assert.ok(page.avatar().hidden, 'one portrait of the person, not a second smaller one below it');
  assert.equal(page.avatar().textContent, '', 'and no initials left behind it');
  assert.ok(!page.message().hidden, 'the quotation still has its line');
  assert.equal(page.message().textContent, 'Every decision reaches a student.');
});

test('a photograph that is not an image is dropped, not rendered', async t => {
  const page = heroPage();
  t.after(page.close);
  page.render({ name: 'Juan D. Dela Cruz', photo: 'javascript:alert(1)', message: 'x' });
  assert.ok(page.portrait().hidden, 'an unsafe address never becomes a portrait');
  assert.ok(!page.avatar().hidden, 'the initials stay');
  assert.equal(page.avatar().textContent, 'JD');
  assert.ok(!page.card().classList.contains('hero__card--photo'));

  page.render({ name: 'Juan D. Dela Cruz', photo: 'https://bulsu.edu.ph/regent.jpg', message: 'x' });
  assert.ok(!page.portrait().hidden, 'an https image does');
  assert.equal(page.photo().getAttribute('src'), 'https://bulsu.edu.ph/regent.jpg');
});

test('the portrait is treated into the palette and filed into the card', () => {
  // Full-bleed to the card's own edges, using the card's own padding variable so
  // there is no second number to keep in step with it.
  assert.match(html, /\.hero__card--regent\{--pad:26px; padding:var\(--pad\)\}/, 'the card declares its padding once');
  assert.match(html, /\.regent-card__portrait\{[^}]*margin:calc\(var\(--pad\) \* -1\) calc\(var\(--pad\) \* -1\) 0/, 'the print runs to the card edges');
  assert.match(html, /\.regent-card__portrait\{[^}]*isolation:isolate/, 'so the wash blends with the photograph and not with the page behind it');
  // Greyscale under a red-to-ink wash in `color`: the photograph keeps its own
  // light and takes the office's hue, at half strength so a person stays a
  // person rather than becoming a poster.
  assert.match(html, /\.regent-card__portrait img\{[^}]*filter:grayscale\(1\) contrast\(1\.06\)/, 'the photograph is taken out of its own colours first');
  assert.match(html, /\.regent-card__portrait:before\{[^}]*mix-blend-mode:color/, 'and the office red is laid over it as hue, not as paint');
  assert.match(html, /\.regent-card__portrait:before\{[^}]*opacity:\.5/, 'at half strength');
  assert.match(html, /\.regent-card__portrait:after\{[^}]*linear-gradient\(180deg, rgba\(255,255,255,0\) 44%, rgba\(255,255,255,0\.66\) 82%, #fff 100%\)/,
    'then it fades into the paper the name is printed on');
  assert.match(html, /\.regent-card__portrait img\{[^}]*object-position:50% 22%/, 'the crop favours a face over a lapel');
  // The one piece of motion, and the visitor starts it.
  assert.match(html, /\.hero__card--regent:hover \.regent-card__portrait img[^{]*\{filter:grayscale\(\.16\)/, 'holding the card lets the real colours back through');
  assert.match(html, /\.hero__card--regent:focus-within \.regent-card__portrait img[^{]*\{filter:grayscale\(\.16\)/, 'and so does keyboard focus, not just a mouse');
  assert.match(html, /\.hero__card--photo:after\{display:none\}/, 'the red file tab steps aside when there is a portrait');
  assert.match(html, /\.hero__card--photo \.regent-card__person\{grid-template-columns:minmax\(0,1fr\)/, 'the name takes the full width once the initials are gone');
  // The trap this page has fallen into before: a class that sets `display`
  // outranks the browser's own [hidden], so the guard is part of the design.
  assert.match(html, /\.regent-card__photo\[hidden\]\{display:none\}/, 'the initials actually hide when a portrait replaces them');
  // 430px of masthead column against 240px of print is close to 3:2: a head and
  // shoulders. Shorter crops across somebody's eyes, taller outweighs the title.
  assert.match(html, /\.regent-card__portrait\{[^}]*height:240px/, 'the print is sized to the card, near 3:2');
  assert.match(html, /@media\(max-width:640px\)\{\.regent-card__portrait\{height:200px\}\}/, 'and shorter on a phone, where the card is the whole width');
});
