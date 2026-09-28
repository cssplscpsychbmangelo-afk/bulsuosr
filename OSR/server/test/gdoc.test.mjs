import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeDocUrl, parseCalendarText, parseDateRangeCell, parseTimeCell, sourceEventId } from '../lib/gdoc.js';

const fixture = new URL('../../uploads/Adjusted_Academic_Calendar_AY_2026-2027.html', import.meta.url).pathname;
const today = new Date('2026-09-28T00:00:00Z');

test('Google document links are normalised to a readable download URL', () => {
  assert.equal(
    normalizeDocUrl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit?usp=sharing').fetchUrl,
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/export?format=txt'
  );
  assert.equal(
    normalizeDocUrl('https://docs.google.com/document/d/e/2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz1234567890/pub').fetchUrl,
    'https://docs.google.com/document/d/e/2PACX-1vAbCdEfGhIjKlMnOpQrStUvWxYz1234567890/pub?output=txt'
  );
  assert.equal(
    normalizeDocUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0').fetchUrl,
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/export?format=csv'
  );
});

test('only allowlisted https document hosts are accepted', () => {
  assert.throws(() => normalizeDocUrl('http://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'), /https/);
  assert.throws(() => normalizeDocUrl('https://example.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'), /Google Docs/);
  assert.throws(() => normalizeDocUrl('not-a-link'), /link/i);
});

test('date ranges and times are understood', () => {
  assert.equal(parseDateRangeCell('October 5, 2026').start, '2026-10-05');
  assert.equal(parseDateRangeCell('Oct 5-9, 2026').label, '5 - 9');
  assert.equal(parseDateRangeCell('Oct 5-9, 2026').end, '2026-10-09');
  assert.equal(parseDateRangeCell('2026-10-05 to 2026-10-09').end, '2026-10-09');
  assert.deepEqual(parseTimeCell('9:00 AM - 10:30 AM'), { start_time: '09:00', end_time: '10:30' });
  assert.deepEqual(parseTimeCell('1:00 PM'), { start_time: '13:00', end_time: '' });
  assert.equal(parseDateRangeCell('Academic Year 2026').start, '');
});

test('a CSV sheet with columns becomes calendar events', () => {
  const csv = [
    'Date,Activity,Time,Venue,Category,Details,Link',
    '"October 5, 2026",Foundation Day,9:00 AM - 4:00 PM,University Gym,Celebration,All units https://bulsu.edu.ph/foundation'
  ].join('\n');
  const { events, kind } = parseCalendarText(csv, { today });
  assert.equal(kind, 'csv');
  assert.equal(events.length, 1);
  assert.equal(events[0].iso, '2026-10-05');
  assert.equal(events[0].activity, 'Foundation Day');
  assert.equal(events[0].start_time, '09:00');
  assert.equal(events[0].end_time, '16:00');
  assert.equal(events[0].location, 'University Gym');
  assert.equal(events[0].category, 'Celebration');
  assert.equal(events[0].link, 'https://bulsu.edu.ph/foundation');
});

test('plain text lines become calendar events', () => {
  const text = [
    'October 5, 2026 | Foundation Day | 9:00 AM | Gym',
    '- [ ] Nov 3, 2026 — Research Congress — 8:00 AM — Auditorium'
  ].join('\n');
  const { events } = parseCalendarText(text, { today });
  assert.equal(events.length, 2);
  assert.equal(events[0].activity, 'Foundation Day');
  assert.equal(events[1].iso, '2026-11-03');
});

test("the Registrar's real document parses into the full academic calendar", () => {
  const html = fs.readFileSync(fixture, 'utf8');
  const { events, skipped, kind } = parseCalendarText(html, { today });
  assert.equal(kind, 'html');
  assert.ok(events.length > 250, `expected the whole calendar, parsed ${events.length}`);

  const graduation = events.find(event => event.activity.includes('Regular Graduation AY 2025 - 2026'));
  assert.equal(graduation.iso, '2026-06-05');
  assert.equal(graduation.dateLabel, '5, 8 - 11');
  assert.equal(graduation.dayLabel, 'Fri - Thu');
  assert.equal(graduation.monthLabel, 'June 2026');

  const laborDay = events.find(event => event.activity === 'Labor Day');
  assert.equal(laborDay.iso, '2026-05-01');
  assert.equal(laborDay.dayLabel, 'Fri');

  // The print stylesheet, the term-summary block and the signatories must not
  // leak in as "activities".
  assert.ok(!events.some(event => /font-family|margin|@page/i.test(event.activity)), 'CSS leaked into events');
  assert.ok(!events.some(event => /^[A-Za-z]{3,9}\s+\d{4}$/.test(event.activity)), 'a month heading became an event');
  assert.ok(!events.some(event => event.activity === 'University President'), 'signatories became events');
  assert.ok(skipped.length < 80, `too many skipped lines: ${skipped.length}`);

  // Every event needs a real ISO date, a display label and a stable id.
  for (const event of events) {
    assert.match(event.iso, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(event.activity.length > 1);
    assert.match(sourceEventId(event), /^gdoc-[0-9a-f]{20}$/);
  }
  // Re-parsing is idempotent: identical rows keep identical ids.
  const second = parseCalendarText(html, { today });
  assert.deepEqual(second.events.map(sourceEventId), events.map(sourceEventId));
});
