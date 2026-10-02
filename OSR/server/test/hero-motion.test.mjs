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

test('the hero carries one 3D object: a sheet on the file behind it', () => {
  // The card sits on two plates inside a stage that owns a single perspective,
  // and all three are turned by the same two angles. That is what makes it read
  // as one object with depth rather than as a card with a shadow under it.
  const dom = new JSDOM(html);
  const stage = dom.window.document.querySelector('.hero__stage');
  assert.ok(stage, 'the hero must have a stage to hold the perspective');
  const plates = [...stage.querySelectorAll('.hero__plate')];
  assert.equal(plates.length, 2, 'the sheet sits on two more behind it');
  assert.ok(plates.every(plate => plate.getAttribute('aria-hidden') === 'true'),
    'the plates are decoration and must stay out of the accessibility tree');
  assert.ok(stage.querySelector(':scope > .hero__card'), 'the card is a direct child of the stage');
  assert.match(html, /\.hero__stage\{[^}]*perspective:\d+px/, 'the stage must own the perspective');
  assert.match(html, /\.hero__stage\{[^}]*transform-style:preserve-3d/, 'and keep its children in one 3D space');
  // The angles are custom properties, not inline transforms: one pointermove has
  // to move the card and both plates, and two rules writing `transform` on the
  // same element is how the lean went missing the first time.
  assert.match(html, /\.hero__stage \.hero__card\{[^}]*rotateX\(var\(--tx/, 'the card is turned by the pointer angles');
  assert.match(html, /\.hero__plate\{[^}]*rotateX\(var\(--tx/, 'and so is the sheet behind it');
  assert.match(html, /\.hero__plate\{[^}]*-26px/, 'the near plate sits behind the card');
  assert.match(html, /\.hero__plate--deep\{[^}]*-52px/, 'the far plate sits behind that');
  // Release is quicker than the lean, so leaving the section never feels like lag.
  assert.match(html, /\.hero-wrap:not\(\.is-pointing\) \.hero__stage \.hero__card[^{]*\{transition-duration:\.19s\}/,
    'the settle back to flat must be faster than the lean');
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
  // jsdom does no layout: give the section, stage, card and action the rectangles
  // a 1000×600 hero would have, so the pointer maths has real numbers to work on.
  const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top });
  const elements = {
    wrap: window.document.querySelector('.hero-wrap'),
    stage: window.document.querySelector('.hero__stage'),
    card: window.document.querySelector('.hero__card'),
    cta: window.document.querySelector('.hero__actions .btn--red'),
  };
  elements.wrap.getBoundingClientRect = () => box(0, 0, 1000, 600);
  elements.stage.getBoundingClientRect = () => box(600, 40, 380, 420);
  elements.card.getBoundingClientRect = () => box(600, 40, 380, 420);
  elements.cta.getBoundingClientRect = () => box(40, 430, 150, 42);
  const move = (target, clientX, clientY, pointerType = 'mouse') =>
    target.dispatchEvent(new window.PointerEvent('pointermove', { clientX, clientY, pointerType, bubbles: true }));
  const press = (target, clientX, clientY, pointerType = 'touch') =>
    target.dispatchEvent(new window.PointerEvent('pointerdown', { clientX, clientY, pointerType, bubbles: true }));
  const frame = () => new Promise(resolve => window.requestAnimationFrame(() => resolve()));
  // The pointer writes its angles inside a frame, so a test has to let one pass
  // before it reads them back.
  const moved = async (clientX, clientY) => {
    move(elements.wrap, clientX, clientY);
    await frame();
  };
  // The page keeps a few deferred callbacks of its own (idle work, the reveal
  // observer). Let them drain before tearing the window down, otherwise they run
  // against a closed document and the runner reports async activity after the
  // test — a failure in the harness, not in the page.
  const close = async () => {
    await new Promise(resolve => setTimeout(resolve, 120));
    window.close();
  };
  return { dom, window, ...elements, move, moved, press, frame, close };
}

test('the pointer drives the hero: light, lean, and a reset when it leaves', async t => {
  const page = heroPage();
  t.after(page.close);
  const { wrap, card, moved, move } = page;
  assert.ok(wrap.classList.contains('is-pointing') === false, 'the section starts quiet');

  await moved(320, 180);
  assert.ok(wrap.classList.contains('is-pointing'), 'the section must know the pointer is on it');
  assert.equal(wrap.style.getPropertyValue('--gx'), '320.0px', 'the light follows the pointer');
  assert.equal(wrap.style.getPropertyValue('--gy'), '180.0px');
  assert.match(wrap.style.getPropertyValue('--hot'), /^\d+(\.\d+)?%$/, 'the top rule carries the pointer hotspot');
  // The seal drifts against the pointer, which is what puts it behind the paper.
  assert.equal(wrap.style.getPropertyValue('--px'), '3.24px', 'the seal drifts the other way to the pointer');
  assert.equal(wrap.style.getPropertyValue('--py'), '2.80px');

  // Over the card: the sheet comes off the stack, the sheets behind it fan out,
  // the stack turns toward the pointer and lights up under it.
  await moved(800, 200);
  assert.ok(card.classList.contains('is-lit'), 'the card lights up under the pointer');
  assert.equal(wrap.style.getPropertyValue('--tx'), '1.07deg', 'the stack tilts toward the pointer');
  assert.equal(wrap.style.getPropertyValue('--ty'), '0.37deg');
  assert.equal(wrap.style.getPropertyValue('--lift'), '10.00px', 'the sheet comes off the stack');
  assert.equal(wrap.style.getPropertyValue('--spread'), '1.000', 'and the file behind it opens');
  assert.equal(card.style.getPropertyValue('--cx'), '52.6%', 'the card light sits under the pointer');

  // Away from the card the lean keeps going but the lift and the light let go.
  await moved(120, 60);
  assert.ok(!card.classList.contains('is-lit'), 'the card light follows the pointer off the card');
  assert.equal(wrap.style.getPropertyValue('--lift'), '3.00px', 'the sheet settles back onto the stack');
  assert.equal(wrap.style.getPropertyValue('--spread'), '0.300', 'and the file closes again');
  assert.equal(wrap.style.getPropertyValue('--tx'), '4.07deg', 'the lean runs to the end of the section, not the end of the card');

  move(wrap, 120, 60);
  wrap.dispatchEvent(new page.window.PointerEvent('pointerleave', { bubbles: true }));
  assert.ok(!wrap.classList.contains('is-pointing'), 'leaving must put the section back');
  assert.equal(wrap.style.getPropertyValue('--tx'), '0.00deg', 'no lean is left behind');
  assert.equal(wrap.style.getPropertyValue('--ty'), '0.00deg');
  assert.equal(wrap.style.getPropertyValue('--lift'), '0.00px', 'the sheet is flat on the stack again');
  assert.equal(wrap.style.getPropertyValue('--spread'), '0.000');
  assert.equal(wrap.style.getPropertyValue('--px'), '0.00px', 'and the seal comes back to rest');
});

test('the primary action steps toward the pointer and ripples when pressed', async t => {
  const page = heroPage();
  t.after(page.close);
  const { wrap, cta, move, press, frame } = page;

  move(wrap, 60, 440);
  await frame();
  assert.match(cta.style.transform, /^translate3d\(-/, 'the button drifts toward a pointer on its left half');
  assert.match(cta.style.boxShadow, /^0 10px 26px/, 'and warms up as the pointer arrives');
  // Magnetic but clamped: a pointer 55px off the button's centre moves it 7.7px,
  // never far enough to leave the pointer behind.
  assert.equal(cta.style.transform, 'translate3d(-7.7px, -1.8px, 0)', 'the pull is proportional and clamped');

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

test('touch-only and reduce-motion visitors get no pointer theatre, but still feel a press', async t => {
  for (const options of [{ touchOnly: true }, { calm: true }]) {
    const page = heroPage(options);
    t.after(page.close);
    const { wrap, card, move, press, frame } = page;
    move(wrap, 320, 180);
    await frame();
    assert.ok(!wrap.classList.contains('is-pointing'), `${JSON.stringify(options)}: the pointer must not dress the section`);
    assert.equal(wrap.style.getPropertyValue('--tx'), '', `${JSON.stringify(options)}: nothing leans`);
    assert.equal(wrap.style.getPropertyValue('--lift'), '', `${JSON.stringify(options)}: nothing lifts`);
    assert.equal(card.style.transform, '', `${JSON.stringify(options)}: no inline transform is left on the card`);
    press(card.querySelector('.hero__card-actions .btn'), 620, 300);
    assert.equal((options.calm ? 0 : 1), card.querySelectorAll('.hero__ripple').length,
      `${JSON.stringify(options)}: press feedback respects the motion setting`);
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
