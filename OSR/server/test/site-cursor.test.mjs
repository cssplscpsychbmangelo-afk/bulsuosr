import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

// The site's own pointer: a red dot that sits exactly where the pointer is,
// inside a ring that trails it and changes shape for what is underneath. It is
// the one control every visitor on a mouse already holds, so the way it fails
// matters as much as the way it works: no fine pointer, no cursor; no script,
// the system arrow stays.

/** @param {{fine?: boolean, calm?: boolean, touch?: boolean}} options */
function cursorPage({ fine = true, calm = false, touch = false } = {}) {
  const media = query => ({
    matches: query.includes('hover:hover') ? fine : query.includes('prefers-reduced-motion') ? calm : false,
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
  const { document } = window;
  const cursors = () => [...document.querySelectorAll('.osr-cursor')];
  const dot = () => document.querySelector('.osr-cursor--dot');
  const ring = () => document.querySelector('.osr-cursor--ring');
  const move = (target, clientX, clientY, pointerType = 'mouse') =>
    (target || document.body).dispatchEvent(
      new window.PointerEvent('pointermove', { clientX, clientY, pointerType, bubbles: true })
    );
  const down = (target, clientX, clientY, pointerType = 'mouse') =>
    (target || document.body).dispatchEvent(
      new window.PointerEvent('pointerdown', { clientX, clientY, pointerType, bubbles: true })
    );
  const frame = () => new Promise(resolve => window.requestAnimationFrame(() => resolve()));
  const frames = async count => {
    for (let index = 0; index < count; index += 1) await frame();
  };
  const close = async () => {
    await new Promise(resolve => setTimeout(resolve, 120));
    window.close();
  };
  return { window, document, cursors, dot, ring, move, down, frame, frames, close, touch };
}

test('the cursor is drawn, and the system arrow only goes once it is on screen', async t => {
  const page = cursorPage();
  t.after(page.close);
  const { document, cursors, dot, ring, move } = page;

  assert.equal(cursors().length, 2, 'a dot and a ring, and nothing else');
  assert.ok(dot() && ring(), 'both halves must exist before the pointer moves');
  assert.equal(dot().getAttribute('aria-hidden'), 'true', 'the cursor is decoration to a screen reader');
  assert.equal(ring().getAttribute('aria-hidden'), 'true');
  // The page must not retire the system arrow until the replacement exists, so a
  // visitor with the script blocked keeps a pointer instead of losing one.
  assert.ok(!document.documentElement.classList.contains('cursor-on'), 'the arrow is still there before the first move');

  move(document.querySelector('.hero__lead'), 240, 160);
  assert.ok(document.documentElement.classList.contains('cursor-on'), 'the first move hands the pointer to the site');
  assert.equal(dot().style.transform, 'translate3d(240.00px, 160.00px, 0)', 'the dot sits exactly where the pointer is');
});

test('the ring trails the pointer and catches up', async t => {
  const page = cursorPage();
  t.after(page.close);
  const { dot, ring, move, frame, frames } = page;

  move(null, 100, 100);
  await frame();
  move(null, 400, 300);
  await frame();
  // One frame of travel: 22% of the way, so the ring is visibly behind the dot.
  assert.equal(ring().style.transform, 'translate3d(166.00px, 144.00px, 0)', 'the ring lags on purpose');
  assert.equal(dot().style.transform, 'translate3d(400.00px, 300.00px, 0)', 'the dot never lags');
  await frames(60);
  assert.equal(ring().style.transform, 'translate3d(400.00px, 300.00px, 0)', 'and it arrives exactly, not approximately');
});

test('the ring says what is under the pointer', async t => {
  const page = cursorPage();
  t.after(page.close);
  const { document, dot, ring, move, down, frame } = page;
  const states = element => ['is-link', 'is-text', 'is-off'].filter(name => element.classList.contains(name));

  move(document.querySelector('.hero__lead'), 240, 160);
  await frame();
  assert.deepEqual(states(ring()), [], 'plain paper gets the plain pointer');

  move(document.querySelector('.hero__actions .btn--red'), 60, 440);
  await frame();
  assert.deepEqual(states(ring()), ['is-link'], 'anything clickable opens the ring');
  assert.deepEqual(states(dot()), ['is-link'], 'and both halves carry the state');

  const field = document.querySelector('textarea, input[type="text"], input[type="email"]');
  assert.ok(field, 'the page must have a text field to test against');
  move(field, 300, 300);
  await frame();
  assert.deepEqual(states(ring()), ['is-text'], 'a field turns the pointer into a caret');

  const off = document.createElement('button');
  off.disabled = true;
  off.textContent = 'Disabled';
  document.body.appendChild(off);
  move(off, 12, 12);
  await frame();
  assert.deepEqual(states(ring()), ['is-off'], 'a disabled control keeps the affordance the arrow used to give');

  // A press is felt in the cursor at the same instant the ripple fires under it.
  move(document.querySelector('.hero__actions .btn--red'), 60, 440);
  down(document.querySelector('.hero__actions .btn--red'), 60, 440);
  assert.ok(ring().classList.contains('is-down'), 'the ring closes on a press');
  assert.ok(dot().classList.contains('is-down'));
  page.window.dispatchEvent(new page.window.PointerEvent('pointerup', { clientX: 60, clientY: 440, bubbles: true }));
  assert.ok(!ring().classList.contains('is-down'), 'and opens again on release');
});

test('a finger keeps its own cursor', async t => {
  const page = cursorPage({ fine: false, touch: true });
  t.after(page.close);
  const { document, cursors, move } = page;
  assert.equal(cursors().length, 0, 'a touch device gets no custom cursor at all');
  move(null, 200, 200, 'touch');
  assert.ok(!document.documentElement.classList.contains('cursor-on'), 'and the system pointer is left alone');
});

test('reduce motion keeps the pointer and drops the trail', async t => {
  const page = cursorPage({ calm: true });
  t.after(page.close);
  const { dot, ring, move, frame } = page;
  move(null, 120, 220);
  await frame();
  move(null, 480, 260);
  await frame();
  assert.equal(dot().style.transform, 'translate3d(480.00px, 260.00px, 0)', 'the pointer still follows');
  assert.equal(ring().style.transform, dot().style.transform, 'but nothing trails behind it');
});

test('leaving the window gives the system arrow back', async t => {
  const page = cursorPage();
  t.after(page.close);
  const { document, move } = page;
  move(null, 100, 100);
  assert.ok(document.documentElement.classList.contains('cursor-on'));
  document.dispatchEvent(new page.window.PointerEvent('pointerleave', { bubbles: false }));
  assert.ok(!document.documentElement.classList.contains('cursor-on'), 'no site pointer left floating over the browser chrome');
});

test('the cursor is styled, hidden from print, and only ever red', () => {
  assert.match(html, /\.osr-cursor\{position:fixed/, 'the cursor is drawn in the page, not shipped as a file');
  assert.match(html, /\.osr-cursor--dot \.osr-cursor__i\{[^}]*background:var\(--red\)/, 'the dot is the institutional accent');
  // Eleven controls set `cursor` inline and three set it on a `:disabled` rule,
  // all of which outrank a plain class selector — without the !important they
  // would leave a second, black arrow under the red one.
  assert.match(html, /html\.cursor-on,html\.cursor-on \*\{cursor:none !important\}/, 'the system arrow is retired only under the mounted class, and firmly');
  assert.doesNotMatch(html, /html\s*\*\s*\{cursor:none/, 'and never unconditionally, which would strand a visitor with no script');
  assert.match(html, /\.osr-cursor\{[^}]*pointer-events:none/, 'it must never swallow a click');
  assert.match(html, /@media print\{\.osr-cursor\{display:none\}\}/, 'it stays out of a printed page');
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{[^}]*\.osr-cursor__i\{transition:none/, 'the trail obeys the motion setting');
});
