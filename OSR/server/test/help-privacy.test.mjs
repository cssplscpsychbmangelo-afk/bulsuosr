import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

// Get Help carries three forms and each one has to say what it collects before a
// student types into it. Three bordered, tinted panels inside three bordered
// cards is what made the page read as clutter — a box inside a box, four points
// deep, in the accent red. The notice is now fine print under a hairline: still
// complete, still beside the form it describes, and quiet enough that the red on
// the page belongs to the things a student has to act on.

function helpPage() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://osr.netlify.app/#help',
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
  return {
    document: dom.window.document,
    close: async () => { await new Promise(r => setTimeout(r, 120)); dom.window.close(); },
  };
}

const NOTICES = [
  { id: 'concernPrivacyNotice', form: 'concernForm', title: 'Raise a concern' },
  { id: 'ratingPrivacyNotice', form: 'helpFeedbackForm', title: 'Rate the BulSU OSR' },
  { id: 'orgPrivacyNotice', form: 'orgForm', title: 'Organization & council submissions' },
];

test('every form on Get Help still says what it collects', async t => {
  const page = helpPage();
  t.after(page.close);
  const { document } = page;

  for (const notice of NOTICES) {
    const block = document.getElementById(notice.id);
    assert.ok(block, `${notice.id} must exist`);
    assert.equal(block.querySelector('.privacy__title').textContent, 'Privacy notice');
    const points = [...block.querySelectorAll('dl > div')];
    assert.equal(points.length, 4, `${notice.id} answers four questions, found ${points.length}`);
    const labels = points.map(point => point.querySelector('dt').textContent.trim());
    assert.deepEqual(labels, ['What we collect', 'Why we collect it', 'Who can see it', 'How long we keep it'],
      `${notice.id} keeps the four answers in order`);
    for (const point of points) {
      assert.ok(point.querySelector('dd').textContent.trim().length > 24, `${notice.id}: "${labels[points.indexOf(point)]}" still says something`);
    }
    // A notice that drifts away from its form explains nothing.
    const card = block.closest('.about-card');
    assert.ok(card, `${notice.id} lives in a card`);
    assert.ok(card.querySelector(`#${notice.form}`), `${notice.id} is in the same card as ${notice.form}`);
    assert.ok(block.compareDocumentPosition(card.querySelector(`#${notice.form}`)) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING,
      `${notice.id} comes before the fields it describes`);
  }
});

test('the retention line is still the one the office can set', async t => {
  const page = helpPage();
  t.after(page.close);
  const held = [...page.document.querySelectorAll('[data-retention]')];
  assert.equal(held.length, 3, 'one per notice');
  for (const line of held) {
    assert.ok(line.textContent.trim().length > 20, 'and it is a sentence, not a placeholder');
    assert.doesNotMatch(line.textContent, /TBD|to be supplied|to be confirmed/i, 'nothing invented');
  }
});

test('the notice is fine print, not a panel inside a panel', () => {
  const block = /\.privacy\{([^}]*)\}/.exec(html)[1];
  assert.match(block, /border-top:1px solid var\(--line\)/, 'it hangs off the same hairline the rest of the page divides with');
  assert.doesNotMatch(block, /background:/, 'no fill of its own inside a card that already has one');
  assert.doesNotMatch(block, /border-radius/, 'and no second set of corners');
  assert.doesNotMatch(block, /border:1px/, 'no box');
  assert.match(block, /margin:14px 0 0; padding:11px 0 0/, 'breathing room above the rule, and none wasted below it');
  assert.match(html, /\.privacy dl\{[^}]*max-width:min\(600px, 100%\)/, 'and the answers are held to a reading measure, not stretched across the card');

  const title = /\.privacy__title\{([^}]*)\}/.exec(html)[1];
  assert.match(title, /color:var\(--stone\)/, 'the label wears the stone the other labels wear');
  assert.doesNotMatch(title, /color:var\(--red\)/, 'the accent is left for what a student has to act on');
  assert.match(title, /font:600 10px "IBM Plex Mono"/, 'and it is the smallest label size the site uses, not a shout');

  assert.match(html, /\.privacy dt\{[^}]*font-size:12\.5px[^}]*color:var\(--ink-2\)/, 'the questions stay in ink');
  assert.match(html, /\.privacy dd\{[^}]*font-size:12\.5px[^}]*color:var\(--stone\)/, 'the answers in stone, which is 7.2:1 on white at this size');
});

test('the four points read across where there is room, and down where there is not', () => {
  // Stacked by default: a phone card has no room for a label column.
  assert.match(html, /\.privacy dl > div\{display:grid; grid-template-columns:minmax\(0,1fr\); gap:1px\}/, 'one column first');
  const wide = /@media\(min-width:620px\)\{([^@]*?)\n\}/s.exec(html);
  assert.ok(wide, 'the wide-screen rule exists');
  assert.match(wide[1], /\.privacy dl > div\{grid-template-columns:138px minmax\(0,1fr\); gap:0 18px; align-items:baseline\}/,
    'a label column, with each answer starting on the line its question starts on');
  assert.match(wide[1], /\.privacy dl\{gap:7px\}/, 'and the rows tighten once they read across');
});
