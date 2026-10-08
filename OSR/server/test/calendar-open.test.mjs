import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

// The academic calendar used to open *filtered* to the month today falls in.
// That put a student on the right date by hiding eleven of the twelve months
// from them. It now opens on the whole record and walks to the next date on it,
// which is the difference between being shown where you are and being locked
// there. These tests hold both halves: nothing hidden, and the walk still
// happens — including on a deep link, where the page has to render the record
// before it can walk to a row in it.

/** @param {{hash?: string}} options */
function calendarPage({ hash = '#academic-calendar' } = {}) {
  const walked = [];
  const tops = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: `https://osr.netlify.app/${hash}`,
    beforeParse(window) {
      window.matchMedia = query => ({
        matches: query.includes('hover:hover'),
        media: query,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      });
      window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      window.scrollTo = options => tops.push(options);
      window.Element.prototype.scrollIntoView = function record() { walked.push(this.id); };
    },
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 260));
  return {
    window: dom.window,
    document: dom.window.document,
    walked,
    tops,
    settle,
    close: async () => { await new Promise(resolve => setTimeout(resolve, 120)); dom.window.close(); },
  };
}

const months = document => [...document.querySelectorAll('#calGrid .cal-month-section h3')].map(h => h.textContent.trim());
// Both views stay in the document and one of them is display:none, so the mark
// is counted inside the view that is actually on screen.
const marked = document => [...document.querySelectorAll('.cal-event--next')]
  .filter(row => row.closest('#calList')?.style.display !== 'none' && row.closest('#calGrid')?.style.display !== 'none');
const pill = document => document.getElementById('calJumpNext');

test('the calendar opens on the whole record, not on one month of it', async t => {
  const page = calendarPage();
  t.after(page.close);
  const { document, settle } = page;
  await settle();

  assert.equal(document.getElementById('calMonth').value, 'all', 'the month filter is untouched on arrival');
  const sections = months(document);
  assert.ok(sections.length >= 12, `every month of the record is on the page, found ${sections.length}`);
  assert.ok(sections[0].startsWith('April 2026'), `and it starts where the record starts, at ${sections[0]}`);
  assert.match(document.getElementById('calCount').textContent, /^(\d+) of \1 events$/, 'nothing is filtered out of the count');
});

test('the next date is marked, and it is a date that has not gone by', async t => {
  const page = calendarPage();
  t.after(page.close);
  const { document, window, settle } = page;
  await settle();

  const hits = marked(document);
  assert.equal(hits.length, 1, 'exactly one row carries the mark');
  const id = hits[0].id.replace('cal-evt-', '');
  assert.equal(pill(document).dataset.target, id, 'the pill points at the row the page marks');
  const event = window.ACADEMIC_CALENDAR.find(row => String(row.id) === id);
  assert.ok(event, 'the marked row is a real event in the record');
  const when = new Date(`${event.iso}T12:00:00`);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  assert.ok(when >= today, `the date walked to is ${event.iso}, which is today or later`);
  const ahead = window.ACADEMIC_CALENDAR
    .map(row => new Date(`${row.iso}T12:00:00`))
    .filter(date => date >= today)
    .sort((a, b) => a - b)[0];
  assert.equal(when.getTime(), ahead.getTime(), 'and it is the nearest one, not merely a future one');
});

test('arriving on the page walks the student to that date', async t => {
  const page = calendarPage();
  t.after(page.close);
  const { document, walked, tops, settle } = page;
  await settle();

  const id = marked(document)[0].id;
  assert.ok(walked.includes(id), `the page walked to ${id}; walked to ${walked.join(', ') || 'nothing'}`);
  // The walk is the page placing itself, so the scroll to the top has to be
  // instant: a smooth one would still be running when the walk starts and the
  // two would fight each other down the record.
  assert.ok(tops.some(call => call && call.behavior === 'auto'), 'the top of the page is reached instantly, then the walk runs');
});

test('the list view marks the same date', async t => {
  const page = calendarPage();
  t.after(page.close);
  const { document, settle } = page;
  await settle();
  const id = marked(document)[0].id;

  const view = document.getElementById('calView');
  view.value = 'list';
  view.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  assert.equal(document.getElementById('calList').style.display, 'grid', 'the list is the view on screen');
  const hits = marked(document);
  assert.equal(hits.length, 1, 'one mark in the list too');
  assert.equal(hits[0].id, id, 'and it is the same date the month view marked');
});

test('a filter that leaves nothing ahead takes the pill away with it', async t => {
  const page = calendarPage();
  t.after(page.close);
  const { document, walked, settle } = page;
  await settle();
  const id = marked(document)[0].id;

  // April 2026 is where the record starts, so by now every date in it has gone by.
  const month = document.getElementById('calMonth');
  month.value = months(document)[0];
  month.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  assert.equal(marked(document).length, 0, 'nothing in that month is a next date');
  assert.ok(pill(document).hidden, 'so the pill is not offering one');
  assert.equal(pill(document).dataset.target, undefined, 'and it is not holding a stale one');

  walked.length = 0;
  document.getElementById('calReset').click();
  assert.equal(month.value, 'all', 'Reset brings the whole record back');
  assert.equal(marked(document)[0].id, id, 'and marks the same date it marked on arrival');
  pill(document).click();
  assert.deepEqual(walked, [id], 'the pill walks to it, and only to it');
});

test('the two controls in the bottom-right corner are stacked, not layered', () => {
  // The bug: the pill sat at bottom 72px and the back-to-top button occupies
  // 76px to 120px in the same corner, so the pill was underneath the button.
  const jump = /\.cal-jump\{([^}]*)\}/.exec(html)[1];
  const fab = /\.fab\{([^}]*)\}/.exec(html)[1];
  assert.match(jump, /bottom:calc\(132px \+ env\(safe-area-inset-bottom, 0px\)\)/, 'the pill clears the button, with the same inset');
  assert.match(fab, /bottom:calc\(76px \+ env\(safe-area-inset-bottom, 0px\)\)/, 'the button still owns the corner');
  assert.match(fab, /height:44px/, 'which is 44px tall, so it reaches 120px');
  assert.match(jump, /z-index:48/, 'and the pill stays under it if the two ever meet');
  assert.match(fab, /z-index:49/);
  assert.match(html, /@media\(max-width:640px\)\{\.cal-jump\{right:12px; bottom:calc\(128px/, 'the small-screen stack keeps its gap too');
});
