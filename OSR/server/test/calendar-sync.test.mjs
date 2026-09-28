import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../db/init.js';
import { getSourceConfig, previewSource, syncCalendarSource, autoSyncCalendar, writeSettings, SOURCE_KEYS } from '../lib/calendarSync.js';

const DOC_URL = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit?usp=sharing';
const admin = { id: 1, email: 'osr@bulsu.edu.ph' };

// Google Docs' `?format=txt` export gives one line per paragraph, so that is
// what the server really receives. Rebuild it from the Registrar's saved page.
const savedPage = await fs.readFile(new URL('../../uploads/Adjusted_Academic_Calendar_AY_2026-2027.html', import.meta.url), 'utf8');
const decode = value => value.replace(/<[^>]+>/g, '')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const fixture = [...savedPage.matchAll(/<(p|h2)[^>]*>([\s\S]*?)<\/\1>/g)].map(match => decode(match[2]).trimEnd()).join('\n');

// The sync engine must never depend on the network in tests: swap in a fake
// Google that serves the Registrar's document, then edit it mid-test.
function serveDocument(html) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  return calls;
}

async function withDb(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osr-sync-test-'));
  const db = await initDb(path.join(dir, 'test.db'));
  try {
    return await run(db);
  } finally {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('automatic sync stays off until a document is connected', async () => {
  await withDb(async db => {
    const config = await getSourceConfig(db);
    assert.equal(config.url, '');
    assert.equal(config.auto, true);
    assert.deepEqual(await autoSyncCalendar(db), { ok: true, status: 'disabled' });

    serveDocument(fixture);
    await writeSettings(db, { [SOURCE_KEYS.url]: DOC_URL, [SOURCE_KEYS.auto]: '0' });
    assert.deepEqual(await autoSyncCalendar(db), { ok: true, status: 'disabled' }, 'auto=0 disables the visitor-triggered re-check');

    await writeSettings(db, { [SOURCE_KEYS.auto]: '1' });
    const result = await autoSyncCalendar(db);
    assert.equal(result.ok, true);
    assert.equal(result.added > 250, true);
    assert.equal((await getSourceConfig(db)).lastStatus, 'ok');
  });
});

test('a preview reads the Google Document without touching the calendar', async () => {
  await withDb(async db => {
    serveDocument(fixture);
    const preview = await previewSource(db, { url: DOC_URL });
    assert.equal(preview.total > 250, true);
    assert.equal(preview.kind, 'text');
    assert.equal(preview.events[0].id.startsWith('gdoc-'), true);
    const count = (await db.prepare('SELECT COUNT(*) AS c FROM calendar_events').get()).c;
    assert.equal(count, 0, 'a preview must not write events');
    const settings = (await db.prepare("SELECT COUNT(*) AS c FROM site_settings WHERE key LIKE 'calendar_%'").get()).c;
    assert.equal(settings, 0, 'a preview must not store source settings');
  });
});

test('sync creates document events, updates them and prunes removed ones', async () => {
  await withDb(async db => {
    serveDocument(fixture);
    await writeSettings(db, { [SOURCE_KEYS.url]: DOC_URL, [SOURCE_KEYS.auto]: '1', [SOURCE_KEYS.prune]: '1' });

    const first = await syncCalendarSource(db, { force: true, admin });
    assert.equal(first.ok, true);
    assert.equal(first.added > 250, true);
    assert.equal(first.updated, 0);

    const stored = (await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE id LIKE 'gdoc-%'").get()).c;
    assert.equal(stored, first.total);
    const published = (await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE id LIKE 'gdoc-%' AND status='Published'").get()).c;
    assert.equal(published, first.total, 'synced events ship as Published');

    const graduation = await db.prepare("SELECT * FROM calendar_events WHERE activity LIKE 'Regular Graduation AY 2025%'").get();
    assert.equal(graduation.iso, '2026-06-05');
    assert.match(graduation.date, /5, 8/);
    assert.match(graduation.description, /Runs until 2026-06-11/);

    // A forced re-read of the same document refreshes rows, never duplicates them.
    const second = await syncCalendarSource(db, { force: true, admin });
    assert.equal(second.added, 0);
    assert.equal(second.updated, first.total);
    assert.equal((await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE id LIKE 'gdoc-%'").get()).c, first.total);

    // Without a forced read the short TTL keeps a second check cheap.
    const throttled = await autoSyncCalendar(db, { minIntervalMs: 60_000 });
    assert.equal(['fresh', 'skipped'].includes(throttled.status), true);

    // Edit the document: rename an activity and delete a different one.
    const renamed = fixture.replace('Regular Graduation AY 2025 - 2026 (85th Commencement Exercises)', 'Regular Graduation AY 2025 - 2026 (moved to August)');
    const withoutLaborDay = renamed.replace('1 | Fri | Labor Day\n', '');
    serveDocument(withoutLaborDay);
    const third = await syncCalendarSource(db, { force: true, admin });
    assert.equal(third.ok, true);
    assert.equal(third.updated > 0, true);
    const after = (await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE id LIKE 'gdoc-%'").get()).c;
    assert.equal(after, third.total);
    assert.equal((await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE activity LIKE '%moved to August%'").get()).c, 1, 'renames reach the calendar');
    assert.equal((await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE activity='Labor Day'").get()).c, 0, 'prune removes deleted rows');

    // Hand-written events are never touched by the document.
    await db.prepare("INSERT INTO calendar_events (id,title,activity,date,day,month,category,iso,status) VALUES ('cal-manual','Hand written','Hand written','9','Wed','July 2026','OSR','2026-07-09','Published')").run();
    serveDocument(fixture);
    await syncCalendarSource(db, { force: true, admin });
    assert.equal((await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE id='cal-manual'").get()).c, 1);
  });
});

test('a failing document is reported without breaking the calendar', async () => {
  await withDb(async db => {
    await writeSettings(db, { [SOURCE_KEYS.url]: DOC_URL, [SOURCE_KEYS.auto]: '1' });
    globalThis.fetch = async () => new Response('nope', { status: 404 });
    const result = await syncCalendarSource(db, { force: true, admin });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.match(result.message, /not found|published|share/i);
    const config = await getSourceConfig(db);
    assert.equal(config.lastStatus, 'error');

    // The public page still renders whatever stored events exist.
    await db.prepare("INSERT INTO calendar_events (id,title,activity,date,day,month,category,iso,status) VALUES ('cal-x','Stored','Stored','1','Mon','June 2026','OSR','2026-06-01','Published')").run();
    // The automatic check never forces a download, so a visitor just keeps
    // seeing the stored calendar until the document answers again.
    const auto = await autoSyncCalendar(db);
    assert.equal(auto.ok, true);
    assert.equal(['fresh', 'skipped'].includes(auto.status), true);
    assert.equal((await db.prepare('SELECT COUNT(*) AS c FROM calendar_events').get()).c, 1);
  });
});
