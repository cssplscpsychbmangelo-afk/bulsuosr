import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

/** The contents of every `@media (<query>) { … }` block, matched by braces. */
function mediaBlocks(query) {
  const blocks = [];
  const marker = `@media(${query}){`;
  for (let at = html.indexOf(marker); at !== -1; at = html.indexOf(marker, at + 1)) {
    let depth = 0;
    let index = at + marker.length - 1;
    const start = index + 1;
    for (; index < html.length; index += 1) {
      if (html[index] === '{') depth += 1;
      else if (html[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(html.slice(start, index));
  }
  return blocks;
}

// The points bar above "Build Your Ideal BulSU" is sticky, so it is on screen the
// whole time a student allocates their 10 points — and its primary action used to
// be cut off mid-word on a phone: "how my build" instead of "Show my build". The
// button clips its own overflow so its sheen can slide inside it, and the label
// was wider than the half-width slot the action row gave it. These are the
// properties that keep that from coming back.

test('the points bar names its parts instead of relying on child position', () => {
  // The phone layout is a two-column grid (count, track). It used to select its
  // children positionally — `> div:first-child`, `> div:nth-child(2)`,
  // `> div[style*="margin-left:auto"]` — and every patch added another
  // `!important` to win. Naming the three parts is what makes the grid rule below
  // safe to reason about.
  for (const hook of ['pulse-pointsbar__count', 'pulse-pointsbar__track', 'pulse-pointsbar__actions']) {
    assert.match(html, new RegExp(`class="pulse-pointsbar ${hook}"|class="[^"]*${hook}`), `the bar must expose .${hook}`);
  }
  assert.doesNotMatch(html, /\.pulse-pointsbar > div:(first-child|nth-child\(2\)|last-child)/,
    'the bar must not be laid out by child position again');
  assert.doesNotMatch(html, /\.pulse-pointsbar > div\[style\*=/,
    'the bar must not be laid out by matching an inline style string again');
});

test('the action row takes its own line on a phone, so the track stays visible', () => {
  // As a plain grid item the action row landed in column 1 and its content set
  // that column's width, squeezing the progress track to a few pixels — the bar
  // read as empty. It has to span the grid.
  const rules = mediaBlocks('max-width:640px')
    .flatMap(block => [...block.matchAll(/\.pulse-pointsbar__actions\{([^}]*)\}/g)])
    .map(match => match[1]);
  const phone = rules.find(body => /grid-column/.test(body));
  assert.ok(phone, 'the phone rule for the action row must span the grid');
  assert.match(phone, /grid-column:\s*1\s*\/\s*-1/, 'the action row must span both grid columns');
  assert.match(phone, /width:100%/, 'and take the full width of the bar');
});

test('the bar overrides the section\'s button sizing with an id, not a class', () => {
  // #page-ideal-bulsu .btn--sm pins every small button in this section to 34px
  // tall. An id-qualified selector beats any number of classes, so a class-based
  // rule for the bar loses silently however specific it looks: the first fix
  // here set 44px buttons on a phone and the page kept rendering 34px ones,
  // sitting ten pixels off the bottom of the card. The bar's rules have to be
  // id-qualified for the same reason.
  assert.match(html, /#page-ideal-bulsu \.pulse-pointsbar \.btn[\s\S]{0,160}?min-height:40px/,
    'the bar must size its own buttons for a comfortable desktop height');
  const phone = mediaBlocks('max-width:640px').join('\n');
  assert.match(phone, /#page-ideal-bulsu \.pulse-pointsbar \.btn[\s\S]{0,160}?min-height:44px/,
    '44px is the smallest comfortable thumb target, and it must be id-qualified so .btn--sm cannot beat it');
  assert.match(phone, /#page-ideal-bulsu #pulseSubmitArea \.btn[\s\S]{0,160}?min-height:44px/,
    'the buttons that finish the flow get the same treatment');
});

test('the points counter cannot break "10" across two lines', () => {
  // On a phone the number box was 22px wide at 17px type, so the moment a
  // student put all ten points into one area the counter rendered "1" over "0".
  const base = html.match(/\.pulse-num\{([^}]*)\}/)[1];
  assert.match(base, /white-space:nowrap/, 'the number never wraps to a second line');
  const phone = mediaBlocks('max-width:640px')
    .flatMap(block => [...block.matchAll(/#page-ideal-bulsu \.pulse-num\{([^}]*)\}/g)])
    .map(match => match[1])[0];
  assert.ok(phone, 'the phone number box must be sized in the phone block');
  assert.match(phone, /min-width:[\d.]+em/, 'the box is at least as wide as two digits of its own type size');
  assert.doesNotMatch(phone, /width:\d+px/, 'and not a fixed pixel width narrower than "10"');
});

test('the primary label can only shorten, never lose characters', () => {
  // The button is `overflow:hidden` for its sheen, so a label wider than the
  // button is cut mid-word. The label therefore lives in its own box that
  // ellipsises, and the visible copy is kept short enough to fit the narrowest
  // width the site supports (320px).
  assert.match(html, /id="pulseShowResultLabel"/, 'the primary action needs its own label element');
  const rule = html.match(/#pulseShowResult \.btn__label\{([^}]*)\}/);
  assert.ok(rule, 'the label must have its own rule');
  assert.match(rule[1], /text-overflow:ellipsis/, 'the label shortens with an ellipsis');
  assert.match(rule[1], /white-space:nowrap/, 'the label never wraps to a second line');
  assert.match(rule[1], /overflow:hidden/, 'and it clips its own box rather than the button clipping the text');
  // The primary action grows into the free space; Reset keeps its natural size.
  assert.match(html, /#pulseShowResult\{flex:1 1 auto; min-width:0\}/, 'the primary action must be allowed to take the space it needs');
  assert.match(html, /#pulseReset\{flex:0 0 auto\}/, 'Reset stays compact beside it');
});

// The page's own scripts, running against the real markup. jsdom has no layout
// and no media queries, which is why the layout rules above are asserted from the
// stylesheet — but the label logic is real code and is driven here.
function builderPage() {
  const media = query => ({
    matches: false, media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://osr.netlify.app/',
    beforeParse(window) {
      window.matchMedia = media;
      window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      window.scrollTo = () => {};
      window.requestIdleCallback = callback => setTimeout(callback, 0);
    },
  });
  const { window } = dom;
  const document = window.document;
  const click = selector => { const el = document.querySelector(selector); if (el) el.click(); return !!el; };
  return {
    window, document,
    click,
    label: () => document.getElementById('pulseShowResultLabel').textContent,
    button: () => document.getElementById('pulseShowResult'),
    pointsLeft: () => document.getElementById('pulsePointsLeft').textContent,
    close: async () => { await new Promise(resolve => setTimeout(resolve, 120)); window.close(); },
  };
}

test('the primary action says exactly what it will do, in a length that fits', async t => {
  const page = builderPage();
  t.after(page.close);
  await new Promise(resolve => setTimeout(resolve, 400));

  assert.equal(page.label(), 'Show my build · 10 left', 'an untouched build says how many points are left');
  assert.equal(page.button().disabled, true, 'and cannot be used yet');
  assert.equal(page.button().getAttribute('aria-label'), 'Show my build — 10 points left',
    'the accessible name spells the sentence out in full even though the visible label is short');

  // The budget: the longest state must fit the label box at 320px, where the
  // button shares its row with Reset. This is the guard against the label
  // growing back into the clipped state.
  // Measured in a browser at 320px: this copy renders 159px wide inside a 176px
  // label box. The label that was being clipped — "Show my build — 4 points left"
  // — is 30 characters and 195px, wider than the box it had.
  const longest = 'Show my build · 10 left';
  assert.ok(longest.length <= 24, `the longest label is ${longest.length} characters and no longer fits the 320px bar`);

  for (let i = 0; i < 10; i += 1) page.click('.pulse-alloc-row .pulse-btn:last-child');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(page.label(), 'Show my build', 'with all 10 points placed the label drops the count');
  assert.equal(page.button().disabled, false, 'and the action becomes available');
  assert.equal(page.button().getAttribute('aria-label'), 'Show my build');

  page.click('.pulse-alloc-row .pulse-btn');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(page.label(), 'Show my build · 1 left', 'one point short reads in the singular, not "1 points left"');
  assert.equal(page.button().disabled, true, 'and the action closes again');
  assert.equal(page.button().getAttribute('aria-label'), 'Show my build — 1 point left');
});
