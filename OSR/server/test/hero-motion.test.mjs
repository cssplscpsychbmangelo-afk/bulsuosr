import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

// The hero answers the pointer — and it does so out loud. This file guards both
// halves of that, because the section already shipped once with the whole set of
// interactions neutralised and nothing in the suite noticed.

test('the hero entrance hands transform back when it finishes', () => {
  // The bug: every `.hero.is-in …` entrance ran with fill-mode `both`. A
  // finished animation with `both` keeps ownership of the properties it
  // animated, and a settled animation beats inline styles and hover rules — so
  // `transform` on the card and the primary button stayed pinned to `none` for
  // the rest of the session. The pointer code ran, wrote its values, and the
  // browser threw them away. `backwards` holds the opening frame through the
  // delay and then steps aside, which is what this entrance wants.
  const entrance = [...html.matchAll(/animation:\s*hero-(?:title-in|underline)[^;}]*/g)].map(match => match[0].trim());
  assert.ok(entrance.length >= 7, 'the hero must still have its staggered entrance');
  for (const declaration of entrance) {
    assert.match(declaration, /\sbackwards$/, `${declaration} must end its fill mode at the element's own state`);
    assert.doesNotMatch(declaration, /\b(both|forwards)\b/, `${declaration} must not keep owning transform after it settles`);
  }
  // The non-hero reveals on the page may still use `both`; only the masthead has
  // elements whose transform is written by the pointer.
  assert.match(html, /\.hero__card\{[^}]*transition:transform/, 'the card must animate the transform the pointer writes');
});

// A DOM with the page's own scripts running. jsdom has no layout and no media
// queries, so the two things the hero script asks the browser for are stubbed
// here; everything else — the listeners, the class toggles, the inline custom
// properties, the ripple — is the page's real code.
function heroPage({ touchOnly = false, calm = false } = {}) {
  const media = query => ({
    matches: query.includes('hover:none')
      ? touchOnly
      : query.includes('prefers-reduced-motion')
        ? calm
        : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
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
  // jsdom does no layout: give the section, card and action the rectangles a
  // 1000×600 hero would have, so the pointer maths has real numbers to work on.
  const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top });
  const elements = {
    wrap: window.document.querySelector('.hero-wrap'),
    card: window.document.querySelector('.hero__card'),
    cta: window.document.querySelector('.hero__actions .btn--red'),
  };
  elements.wrap.getBoundingClientRect = () => box(0, 0, 1000, 600);
  elements.card.getBoundingClientRect = () => box(600, 40, 380, 420);
  elements.cta.getBoundingClientRect = () => box(40, 430, 150, 42);
  const move = (target, clientX, clientY, pointerType = 'mouse') =>
    target.dispatchEvent(new window.PointerEvent('pointermove', { clientX, clientY, pointerType, bubbles: true }));
  const press = (target, clientX, clientY, pointerType = 'touch') =>
    target.dispatchEvent(new window.PointerEvent('pointerdown', { clientX, clientY, pointerType, bubbles: true }));
  const frame = () => new Promise(resolve => window.requestAnimationFrame(() => resolve()));
  // The page keeps a few deferred callbacks of its own (idle work, the reveal
  // observer). Let them drain before tearing the window down, otherwise they run
  // against a closed document and the runner reports async activity after the
  // test — a failure in the harness, not in the page.
  const close = async () => {
    await new Promise(resolve => setTimeout(resolve, 120));
    window.close();
  };
  return { dom, window, ...elements, move, press, frame, close };
}

test('the pointer drives the hero: light, lean, and a reset when it leaves', async t => {
  const page = heroPage();
  t.after(page.close);
  const { wrap, card, move, frame } = page;
  assert.ok(wrap.classList.contains('is-pointing') === false, 'the section starts quiet');

  move(wrap, 320, 180);
  await frame();
  assert.ok(wrap.classList.contains('is-pointing'), 'the section must know the pointer is on it');
  assert.equal(wrap.style.getPropertyValue('--gx'), '320.0px', 'the light follows the pointer');
  assert.equal(wrap.style.getPropertyValue('--gy'), '180.0px');
  assert.match(wrap.style.getPropertyValue('--hot'), /^\d+(\.\d+)?%$/, 'the top rule carries the pointer hotspot');

  // Over the card the pointer also lights it and leans it toward the pointer.
  move(wrap, 800, 200);
  assert.ok(card.classList.contains('is-lit'), 'the card lights up under the pointer');
  assert.match(card.style.transform, /^perspective\(900px\) rotateX\(-?\d/, 'the card leans toward the pointer');
  assert.equal(card.style.getPropertyValue('--cx'), '52.6%', 'the card light sits under the pointer');

  // Away from the card, the lean stays but the lift and the light let go.
  move(wrap, 120, 60);
  assert.ok(!card.classList.contains('is-lit'), 'the card light follows the pointer off the card');
  assert.match(card.style.transform, /translateY\(-1.5px\)/, 'the card keeps a shallower lean across the section');

  wrap.dispatchEvent(new page.window.PointerEvent('pointerleave', { bubbles: true }));
  assert.ok(!wrap.classList.contains('is-pointing'), 'leaving must put the section back');
  assert.equal(card.style.transform, '', 'no lean is left behind');
});

test('the primary action steps toward the pointer and ripples when pressed', async t => {
  const page = heroPage();
  t.after(page.close);
  const { wrap, cta, move, press, frame } = page;

  move(wrap, 60, 440);
  await frame();
  assert.match(cta.style.transform, /^translate3d\(-/, 'the button drifts toward a pointer on its left half');
  assert.match(cta.style.boxShadow, /^0 8px 22px/, 'and warms up as the pointer arrives');

  move(wrap, 900, 560);
  assert.equal(cta.style.transform, '', 'the drift only happens near the button');

  // A press leaves one ripple from the exact point pressed — mouse, pen or
  // finger — and cleans it up afterwards. On a phone this is the whole effect.
  press(cta, 96, 448);
  const ripples = cta.querySelectorAll('.hero__ripple');
  assert.equal(ripples.length, 1, 'a press leaves exactly one ripple');
  assert.equal(ripples[0].style.left, '56px', 'the ripple starts where the press landed');
  assert.equal(ripples[0].style.top, '18px');
  ripples[0].dispatchEvent(new page.window.Event('animationend'));
  assert.equal(cta.querySelectorAll('.hero__ripple').length, 0, 'the ripple is removed when it finishes');
});

test('touch-only and reduce-motion visitors get no pointer theatre, but still feel a press', t => {
  for (const options of [{ touchOnly: true }, { calm: true }]) {
    const page = heroPage(options);
    t.after(page.close);
    const { wrap, card, cta, move, press } = page;
    move(wrap, 320, 180);
    assert.ok(!wrap.classList.contains('is-pointing'), `${JSON.stringify(options)}: the pointer must not dress the section`);
    assert.equal(card.style.transform, '', `${JSON.stringify(options)}: nothing leans`);
    press(cta, 60, 440);
    assert.equal((options.calm ? 0 : 1), cta.querySelectorAll('.hero__ripple').length, `${JSON.stringify(options)}: press feedback respects the motion setting`);
  }
});

test('returning to the home page replays the arrival instead of freezing it', async t => {
  const page = heroPage();
  t.after(page.close);
  const { window } = page;
  const hero = window.document.querySelector('.hero');
  // The arrival is started on the next frame, exactly as the page does it.
  await page.frame();
  assert.ok(hero.classList.contains('is-in'), 'the first arrival plays');
  window.location.hash = '#announcements';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  assert.ok(!hero.classList.contains('is-in'), 'leaving home clears the state so the next arrival can play');
  window.location.hash = '#home';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await page.frame();
  assert.ok(hero.classList.contains('is-in'), 'coming home plays the arrival again');
});
