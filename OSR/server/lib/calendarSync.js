// Keeps the OSR calendar in step with the Google Document the office maintains.
//
// The administrator pastes a published Google Docs/Sheets link once. From then
// on the server re-reads that document (on demand, and automatically at most
// once every CALENDAR_SYNC_TTL_MS when a visitor opens the calendar) and
// upserts every row it finds. Events created by the document are id-prefixed
// with `gdoc-` so they can be recognised, refreshed, or removed without ever
// touching events an administrator typed in by hand.
import { DocSourceError, fetchDocText, hashText, parseCalendarText, sourceEventId } from './gdoc.js';

export const SOURCE_KEYS = {
  url: 'calendar_source_url',
  label: 'calendar_source_label',
  sheet: 'calendar_source_sheet',
  auto: 'calendar_source_auto',
  prune: 'calendar_source_prune',
  lastAt: 'calendar_sync_last_at',
  lastCheck: 'calendar_sync_last_check',
  lastStatus: 'calendar_sync_last_status',
  lastDetail: 'calendar_sync_last_detail',
  lastCount: 'calendar_sync_last_count',
  lastHash: 'calendar_sync_last_hash',
  lastSummary: 'calendar_sync_last_summary'
};

const DEFAULT_TTL_MS = Number(process.env.CALENDAR_SYNC_TTL_MS || 15 * 60 * 1000);
const DOC_PREFIX = 'gdoc-';

let inFlight = null;
let lastAttempt = 0;

export async function readSettings(db, keys) {
  const values = {};
  for (const key of keys) {
    const row = await db.prepare('SELECT value FROM site_settings WHERE key=?').get(key);
    if (row && row.value !== null && row.value !== undefined) values[key] = String(row.value);
  }
  return values;
}

export async function writeSettings(db, entries) {
  const statement = db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
  );
  for (const [key, value] of Object.entries(entries)) {
    (await statement.run(key, value === null || value === undefined ? '' : String(value)));
  }
}

export async function getSourceConfig(db) {
  const values = await readSettings(db, Object.values(SOURCE_KEYS));
  return {
    url: values[SOURCE_KEYS.url] || '',
    label: values[SOURCE_KEYS.label] || '',
    sheet: values[SOURCE_KEYS.sheet] || '',
    auto: values[SOURCE_KEYS.auto] !== '0',
    prune: values[SOURCE_KEYS.prune] === '1',
    lastSyncAt: values[SOURCE_KEYS.lastAt] || '',
    lastCheckAt: values[SOURCE_KEYS.lastCheck] || '',
    lastStatus: values[SOURCE_KEYS.lastStatus] || '',
    lastDetail: values[SOURCE_KEYS.lastDetail] || '',
    lastCount: Number(values[SOURCE_KEYS.lastCount] || 0),
    lastHash: values[SOURCE_KEYS.lastHash] || '',
    lastSummary: safeParse(values[SOURCE_KEYS.lastSummary])
  };
}

function safeParse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function markFailure(db, message) {
  await writeSettings(db, {
    [SOURCE_KEYS.lastCheck]: nowIso(),
    [SOURCE_KEYS.lastStatus]: 'error',
    [SOURCE_KEYS.lastDetail]: String(message).slice(0, 300)
  });
}

async function readDocument(config) {
  return fetchDocText(config.url);
}

// Read the document and return the parsed rows without touching the database.
export async function previewSource(db, { url } = {}) {
  const config = await getSourceConfig(db);
  const link = String(url || config.url || '').trim();
  if (!link) throw new DocSourceError('Add the Google Document link first.');
  const document = await fetchDocText(link);
  const parsed = parseCalendarText(document.text, { kind: document.kind });
  return {
    ok: true,
    sourceUrl: document.original,
    fetchUrl: document.fetchUrl,
    kind: parsed.kind,
    total: parsed.events.length,
    skipped: parsed.skipped.slice(0, 25),
    skippedCount: parsed.skipped.length,
    events: parsed.events.slice(0, 60).map(event => ({ ...event, id: sourceEventId(event) })),
    unchanged: config.lastHash ? config.lastHash === document.hash : false
  };
}

// The workhorse: fetch, parse, then create/update/remove the derived events.
export async function syncCalendarSource(db, { force = false, minIntervalMs = DEFAULT_TTL_MS, dryRun = false, admin = null, url = null } = {}) {
  const config = await getSourceConfig(db);
  const link = String(url || config.url || '').trim();
  if (!link) return { ok: false, status: 'error', code: 'no-source', message: 'No Google Document is connected yet.' };

  const attemptKey = `${link}#${force ? 'force' : 'auto'}`;
  if (!force && Date.now() - lastAttempt < 3000) {
    return { ok: true, status: 'skipped', message: 'A calendar check just ran.', config };
  }
  lastAttempt = Date.now();

  if (!force && config.lastCheckAt) {
    const elapsed = Date.now() - new Date(config.lastCheckAt.replace(' ', 'T') + 'Z').getTime();
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < minIntervalMs) {
      return { ok: true, status: 'fresh', message: 'The calendar document was checked recently.', config, total: config.lastCount };
    }
  }

  let document;
  try {
    document = await readDocument({ ...config, url: link });
  } catch (error) {
    const message = error instanceof DocSourceError ? error.message : 'The document could not be read.';
    if (!dryRun) await markFailure(db, message);
    return { ok: false, status: 'error', message, code: 'fetch-failed', statusCode: error.status || 502 };
  }

  const parsed = parseCalendarText(document.text, { kind: document.kind });
  if (!parsed.events.length) {
    const message = 'No readable activities were found. Add a Date column and an Activity column (or "October 5, 2026 | Foundation Day" lines).';
    if (!dryRun) await markFailure(db, message);
    return { ok: false, status: 'error', message, code: 'no-events', skipped: parsed.skipped.slice(0, 10), statusCode: 422 };
  }

  const unchanged = config.lastHash && config.lastHash === document.hash;
  if (dryRun) {
    return {
      ok: true,
      status: 'preview',
      message: `${parsed.events.length} activit${parsed.events.length === 1 ? 'y' : 'ies'} found.`,
      total: parsed.events.length,
      events: parsed.events.slice(0, 60).map(event => ({ ...event, id: sourceEventId(event) })),
      skipped: parsed.skipped.slice(0, 20),
      kind: parsed.kind,
      unchanged: Boolean(unchanged)
    };
  }

  if (unchanged && !force) {
    await writeSettings(db, {
      [SOURCE_KEYS.lastCheck]: nowIso(),
      [SOURCE_KEYS.lastStatus]: 'ok',
      [SOURCE_KEYS.lastDetail]: 'No changes in the document.',
      [SOURCE_KEYS.lastCount]: String(parsed.events.length)
    });
    return { ok: true, status: 'unchanged', message: 'The document has no new changes.', total: parsed.events.length, config: await getSourceConfig(db) };
  }

  const existing = new Map();
  for (const row of await db.prepare("SELECT id, status FROM calendar_events WHERE id LIKE ?").all(`${DOC_PREFIX}%`)) {
    existing.set(row.id, row.status);
  }

  const wanted = new Map();
  for (const event of parsed.events) wanted.set(sourceEventId(event), event);

  let added = 0;
  let updated = 0;
  const incoming = [...wanted.entries()];

  await db.transaction(async () => {
    const insert = db.prepare(
      "INSERT INTO calendar_events (id, title, activity, date, day, month, category, iso, start_time, end_time, location, description, link, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    );
    const update = db.prepare(
      "UPDATE calendar_events SET title=?, activity=?, date=?, day=?, month=?, category=?, iso=?, start_time=?, end_time=?, location=?, description=?, link=?, updated_at=datetime('now') WHERE id=?"
    );
    for (const [id, event] of incoming) {
      const dateLabel = event.dateLabel || String(Number(event.iso.slice(8)));
      const dayLabel = event.dayLabel || '';
      const monthLabel = event.monthLabel || '';
      // A multi-day activity keeps its range in the description so nothing is lost.
      const description = event.endIso && event.endIso !== event.iso && !event.description.includes(event.endIso)
        ? [event.description, `Runs until ${event.endIso}.`].filter(Boolean).join(' ')
        : event.description;
      if (existing.has(id)) {
        await update.run(event.activity, event.activity, dateLabel, dayLabel, monthLabel, event.category, event.iso, event.start_time, event.end_time, event.location, description, event.link, id);
        updated += 1;
      } else {
        await insert.run(id, event.activity, event.activity, dateLabel, dayLabel, monthLabel, event.category, event.iso, event.start_time, event.end_time, event.location, description, event.link, 'Published', admin?.id || null);
        added += 1;
      }
    }
    // Only events that came from the previous version of the document are ever removed.
    if (config.prune) {
      const remove = db.prepare('DELETE FROM calendar_events WHERE id=?');
      for (const id of existing.keys()) {
        if (!wanted.has(id)) (await remove.run(id));
      }
    }
  })();

  const removed = config.prune ? [...existing.keys()].filter(id => !wanted.has(id)).length : 0;
  const summary = { added, updated, removed, total: wanted.size };

  await writeSettings(db, {
    [SOURCE_KEYS.lastAt]: nowIso(),
    [SOURCE_KEYS.lastCheck]: nowIso(),
    [SOURCE_KEYS.lastStatus]: 'ok',
    [SOURCE_KEYS.lastDetail]: `${wanted.size} activities in sync (${added} new, ${updated} updated${removed ? `, ${removed} removed` : ''}).`,
    [SOURCE_KEYS.lastCount]: String(wanted.size),
    [SOURCE_KEYS.lastHash]: document.hash,
    [SOURCE_KEYS.lastSummary]: JSON.stringify(summary)
  });

  try {
    await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id, details) VALUES (?,?,?,?,?,?)')
      .run(admin?.id || null, admin?.email || 'system', 'Synced calendar from Google Document', 'calendar_source', config.label || 'document', JSON.stringify(summary));
  } catch {}

  return {
    ok: true,
    status: 'synced',
    message: `${wanted.size} activities are in sync (${added} new, ${updated} updated${removed ? `, ${removed} removed` : ''}).`,
    added,
    updated,
    removed,
    total: wanted.size,
    skipped: parsed.skipped.slice(0, 20),
    config: await getSourceConfig(db)
  };
}

// Public calendar reads call this so a visitor always sees the current
// document without anyone pressing a button. Failures are swallowed by the
// caller: a broken document link must never take the website down.
export async function autoSyncCalendar(db, options = {}) {
  const config = await getSourceConfig(db);
  if (!config.url || !config.auto) return { ok: true, status: 'disabled' };
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      return await syncCalendarSource(db, { ...options, force: false });
    } catch (error) {
      return { ok: false, status: 'error', message: error.message };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export const CALENDAR_SOURCE_KEYS = SOURCE_KEYS;
export const calendarDocPrefix = DOC_PREFIX;
export { hashText };
