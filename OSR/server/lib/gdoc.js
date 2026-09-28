// Google Docs / Sheets calendar source.
//
// The OSR keeps its academic calendar in a Google Document. An administrator
// pastes the document link into the admin panel; the server then fetches the
// document as plain text (or CSV, for Sheets) and turns each row into a
// calendar event.
//
// Nothing here trusts the remote document: every URL is pinned to an allowlist
// of Google hosts over HTTPS, the download is time-limited and size capped, and
// every parsed value is validated before it is written to the database.
//
// The Registrar's real document looks like this (one <p> per line, pipes
// between the columns, a month heading before each block):
//
//     April 2026 | April 2026 | April 2026
//     DATE | DAY | ACTIVITY / HOLIDAY
//     6 - 10 | Mon - Fri | Enrollment period for 1st Semester AY 2026 - 2027
//
// so the parser keeps a month/year context while it walks the document.
import { createHash } from 'node:crypto';

const GOOGLE_HOSTS = new Set(['docs.google.com', 'drive.google.com', 'sheets.google.com']);

// Escape hatch for self-hosted mirrors: CALENDAR_DOC_HOSTS="calendar.example.edu,cdn.example.edu".
const extraHosts = new Set(
  String(process.env.CALENDAR_DOC_HOSTS || '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
);

export function allowedHosts() {
  return [...GOOGLE_HOSTS, ...extraHosts];
}

function isAllowedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (GOOGLE_HOSTS.has(host) || extraHosts.has(host)) return true;
  // Accept regional Google document hosts such as docs.google.co.uk.
  if (/^(docs|drive|sheets)\.google\.[a-z.]{2,}$/.test(host)) return true;
  return false;
}

export class DocSourceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Turn any Google Docs/Sheets link an administrator might paste into a direct
// plain-text download URL. Already-direct URLs are passed through untouched.
export function normalizeDocUrl(rawUrl) {
  const input = String(rawUrl || '').trim();
  if (!input) throw new DocSourceError('Add a Google Document link first.');
  if (input.length > 2000) throw new DocSourceError('That link is too long.');

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new DocSourceError('That does not look like a link. Paste the full https:// Google Docs address.');
  }
  if (url.protocol !== 'https:') throw new DocSourceError('Use an https:// link so the calendar can be read securely.');
  if (!isAllowedHost(url.hostname)) {
    throw new DocSourceError(`Only Google Docs links are supported (${allowedHosts().join(', ')}). In the document choose File → Share → Publish to the web, then paste that link.`);
  }

  const path = url.pathname;
  const docMatch = path.match(/^\/document\/d\/([A-Za-z0-9_-]{10,})\/?$/) || path.match(/^\/document\/d\/([A-Za-z0-9_-]{10,})\//);
  const publishedMatch = path.match(/^\/document\/d\/e\/([A-Za-z0-9_-]{10,})/);
  const sheetMatch = path.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/) || path.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]{10,})/);

  if (publishedMatch) {
    return { fetchUrl: `https://docs.google.com/document/d/e/${publishedMatch[1]}/pub?output=txt`, kind: 'text', original: input };
  }
  if (docMatch) {
    return { fetchUrl: `https://docs.google.com/document/d/${docMatch[1]}/export?format=txt`, kind: 'text', original: input };
  }
  if (sheetMatch) {
    const id = sheetMatch[1];
    const gid = url.searchParams.get('gid');
    const suffix = gid ? `&gid=${encodeURIComponent(gid)}` : '';
    return { fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${suffix}`, kind: 'csv', original: input };
  }
  if (url.hostname === 'drive.google.com') {
    const driveMatch = path.match(/^\/file\/d\/([A-Za-z0-9_-]{10,})/);
    if (driveMatch) return { fetchUrl: `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`, kind: 'text', original: input };
  }

  // Any other allowlisted URL is treated as a document that already returns text or CSV.
  const lower = `${path}${url.search}`.toLowerCase();
  const kind = lower.includes('format=csv') || lower.includes('output=csv') || lower.includes('out:csv') || /\.csv(\?|$)/.test(lower)
    ? 'csv'
    : lower.includes('output=txt') || lower.includes('format=txt') || /\.(txt|md|tsv)(\?|$)/.test(lower)
      ? 'text'
      : 'auto';
  return { fetchUrl: url.toString(), kind, original: input };
}

// Fetch the document as text with a hard timeout and a size ceiling.
export async function fetchDocText(rawUrl, { timeoutMs = 9000, maxBytes = 512 * 1024 } = {}) {
  const { fetchUrl, kind } = normalizeDocUrl(rawUrl);
  let response;
  try {
    response = await fetch(fetchUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'OSR-Calendar-Sync/1.0 (+https://osr.bulsu.edu.ph)' }
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new DocSourceError('The document took too long to load. Check that it is published to the web, then try again.', 504);
    }
    throw new DocSourceError(`The document could not be downloaded: ${error.message}`, 502);
  }

  // Follow the redirect chain only inside the allowlist.
  const finalUrl = response.url || fetchUrl;
  let parsedFinal;
  try {
    parsedFinal = new URL(finalUrl);
  } catch {
    throw new DocSourceError('The document link is not a valid URL.', 502);
  }
  if (parsedFinal.protocol !== 'https:' || !isAllowedHost(parsedFinal.hostname)) {
    throw new DocSourceError('The link redirected outside Google Docs, so it was not read.', 502);
  }

  if (response.status === 404) throw new DocSourceError('The document was not found. Check that the link is published and still shared.', 502);
  if (response.status === 401 || response.status === 403) {
    throw new DocSourceError('Google refused the request. Open the document, choose File → Share → Publish to the web, then paste that published link.', 502);
  }
  if (!response.ok) throw new DocSourceError(`The document returned HTTP ${response.status}.`, 502);

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new DocSourceError('That document is too large for the calendar reader (limit 512 KB of text).');
  const text = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
  return { text, kind: detectKind(text, response.headers.get('content-type') || '', kind), fetchUrl, finalUrl, original: rawUrl, hash: hashText(text) };
}

export function hashText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 32);
}

function detectKind(text, contentType, hint) {
  if (hint === 'csv' || hint === 'text') return hint;
  const sample = text.slice(0, 4000).trim();
  if (!sample) return 'text';
  if (/text\/csv/i.test(contentType)) return 'csv';
  if (/<table|<tr|<td|<html/i.test(sample)) return 'html';
  const firstLine = sample.split(/\r?\n/).find(line => line.trim()) || '';
  if (firstLine.includes('\t') && firstLine.split('\t').length >= 2) return 'csv';
  if (firstLine.includes(',') && firstLine.split(',').length >= 2) return 'csv';
  return 'text';
}

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function isoFrom(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || y < 1990 || y > 2100) return '';
  if (!Number.isInteger(m) || m < 1 || m > 12) return '';
  if (!Number.isInteger(d) || d < 1 || d > 31) return '';
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return '';
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Documents often list "October 5" without a year. Prefer the current year, and
// roll forward when that date has clearly already passed.
function inferYear(month, day, today) {
  const current = today.getFullYear();
  const candidate = new Date(Date.UTC(current, month - 1, day));
  const reference = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  if ((reference - candidate) / 86400000 > 45) return current + 1;
  return current;
}

// Understand the date shapes people actually type into a Google Doc.
// Returns the first date of a range: "Oct 5-9, 2026" -> 2026-10-05.
export function parseDateCell(rawCell, options = {}) {
  return parseDateRangeCell(rawCell, options).start;
}

export function parseDateRangeCell(rawCell, { today = new Date() } = {}) {
  const rawText = String(rawCell || '').replace(/\u00a0/g, ' ').trim();
  if (!rawText) return { start: '', end: '', label: '', dayLabel: '' };

  const isoRangeMatch = rawText.match(/(\d{4}-\d{2}-\d{2})\s*(?:-|–|—|to)\s*(\d{4}-\d{2}-\d{2})/i);
  if (isoRangeMatch) return { start: isoRangeMatch[1], end: isoRangeMatch[2], label: displayRange(isoRangeMatch[1], isoRangeMatch[2]), dayLabel: '' };

  const namedRangeMatch = rawText.match(/^([A-Za-z]{3,9})\.?\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*,?\s*(\d{4})?$/);
  if (namedRangeMatch && MONTHS[namedRangeMatch[1].toLowerCase()]) {
    const month = MONTHS[namedRangeMatch[1].toLowerCase()];
    const day1 = Number(namedRangeMatch[2]);
    const day2 = Number(namedRangeMatch[3]);
    const year = namedRangeMatch[4] ? Number(namedRangeMatch[4]) : inferYear(month, day1, today);
    const start = isoFrom(year, month, day1);
    return { start, end: isoFrom(year, month, day2) || start, label: `${day1} - ${day2}`, dayLabel: '' };
  }

  const explicitRange = rawText.split(/\s+(?:to|until|thru|through)\s+/i);
  const parts = explicitRange.length > 1 ? explicitRange : [rawText];
  const start = parseSingleDate(parts[0], today);
  if (!start) return { start: '', end: '', label: '', dayLabel: '' };
  if (parts.length > 1) {
    const end = parseSingleDate(parts[1], today) || start;
    return { start, end, label: displayRange(start, end), dayLabel: '' };
  }
  return { start, end: start, label: String(Number(start.slice(8))), dayLabel: '' };
}

function displayRange(start, end) {
  if (!end || end === start) return String(Number(start.slice(8)));
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))} - ${Number(end.slice(8))}`;
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const fmt = date => `${date.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${date.getUTCDate()}`;
  return `${fmt(startDate)} - ${fmt(endDate)}`;
}

function parseSingleDate(rawCell, today) {
  let cell = String(rawCell || '').replace(/\u00a0/g, ' ').trim();
  if (!cell) return '';
  cell = cell.split(/\s+(?:to|until|thru|through)\s+/i)[0].trim();

  const isoRange = cell.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoRange) return isoFrom(isoRange[1], isoRange[2], isoRange[3]);

  const slashed = cell.match(/(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    let year = slashed[3] ? Number(slashed[3]) : null;
    if (year !== null && year < 100) year += 2000;
    const month = first <= 12 ? first : second;
    const day = first <= 12 ? second : first;
    return isoFrom(year || inferYear(month, day, today), month, day);
  }

  const named = cell.match(/([A-Za-z]{3,9})\.?\s*(\d{1,2})(?:\s*[-,]\s*\d{1,2})?\s*,?\s*(\d{4})?/);
  if (named && MONTHS[named[1].toLowerCase()]) {
    const month = MONTHS[named[1].toLowerCase()];
    const day = Number(named[2]);
    return isoFrom(named[3] ? Number(named[3]) : inferYear(month, day, today), month, day);
  }

  const dayFirst = cell.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})?/);
  if (dayFirst && MONTHS[dayFirst[2].toLowerCase()]) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    const day = Number(dayFirst[1]);
    return isoFrom(dayFirst[3] ? Number(dayFirst[3]) : inferYear(month, day, today), month, day);
  }

  return '';
}

// A calendar document walks through months. Resolve the short forms the
// Registrar uses ("6", "6 - 10", "17, 20, 24", "5 - June 5", "29 - Jul 11")
// against the month heading that came before them.
function resolveCalendarDate(rawCell, context, today) {
  const raw = String(rawCell || '').replace(/\u00a0/g, ' ').trim();
  if (!raw) return null;

  // "6", "6 - 10", "17, 20, 24", "5, 8- 11" — day numbers resolved against the month heading.
  const bare = raw.match(/^(\d{1,2}(?:\s*[-–—]\s*\d{1,2})?)(?:\s*,\s*\d{1,2}\s*[-–—]?\s*\d{0,2})*$/);
  if (bare && context.month) {
    const days = raw.match(/\d{1,2}/g).map(Number);
    const start = isoFrom(context.year, context.month, days[0]);
    if (!start) return null;
    const rangeEnd = raw.match(/[-–—]\s*(\d{1,2})/);
    const end = rangeEnd ? isoFrom(context.year, context.month, Number(rangeEnd[1])) || start : start;
    return { start, end, label: normalizeDateLabel(raw) };
  }

  const crossing = raw.match(/^(\d{1,2})\s*[-–—]\s*([A-Za-z]{3,9})\.?\s*(\d{1,2})$/);
  if (crossing && context.month && MONTHS[crossing[2].toLowerCase()]) {
    const start = isoFrom(context.year, context.month, Number(crossing[1]));
    if (!start) return null;
    const endMonth = MONTHS[crossing[2].toLowerCase()];
    const endYear = endMonth < context.month ? context.year + 1 : context.year;
    const end = isoFrom(endYear, endMonth, Number(crossing[3])) || start;
    return { start, end, label: normalizeDateLabel(raw) };
  }

  const parsed = parseDateRangeCell(raw, { today });
  if (!parsed.start) return null;
  return { start: parsed.start, end: parsed.end || parsed.start, label: parsed.label };
}

function normalizeDateLabel(raw) {
  return String(raw)
    .replace(/\s*[-–—]\s*/g, ' - ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTimeCell(rawCell) {
  const cell = String(rawCell || '').replace(/\u00a0/g, ' ').trim();
  if (!cell) return { start_time: '', end_time: '' };
  const matches = [...cell.matchAll(/(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/gi)]
    .filter(match => match[3] || cell.includes(':'))
    .map(match => {
      let hour = Number(match[1]);
      const minute = Number(match[2] || '0');
      const meridiem = (match[3] || '').toLowerCase().replace(/\./g, '');
      if (meridiem.startsWith('p') && hour < 12) hour += 12;
      if (meridiem.startsWith('a') && hour === 12) hour = 0;
      if (hour > 23 || minute > 59) return '';
      return `${pad(hour)}:${pad(minute)}`;
    })
    .filter(Boolean);
  return { start_time: matches[0] || '', end_time: matches[1] || '' };
}

// ── Rows ─────────────────────────────────────────────────────────────────────

const HEADER_ALIASES = {
  date: ['date', 'dates', 'when', 'schedule', 'event date', 'start date', 'iso'],
  day: ['day', 'weekday', 'days'],
  activity: ['activity', 'activities', 'event', 'events', 'title', 'subject', 'name', 'particulars', 'activity / holiday', 'activity/holiday', 'holiday'],
  time: ['time', 'times', 'hour', 'start time', 'schedule time', 'duration'],
  location: ['location', 'venue', 'place', 'where', 'room'],
  category: ['category', 'type', 'classification', 'tag'],
  description: ['description', 'details', 'notes', 'remarks', 'note', 'coverage'],
  link: ['link', 'url', 'registration', 'registration link', 'form', 'reference']
};

const MONTH_YEAR = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/;

// A row uses exactly one separator. Mixing them splits dates like
// "17, 20, 24" into separate columns, which produced wrong activities.
function splitRow(line) {
  const text = String(line);
  if (text.includes('|')) return text.split('|').map(value => value.trim());
  if (text.includes('\t')) return text.split('\t').map(value => value.trim());
  return splitCsvLine(text);
}

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ',') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell);
  return cells.map(value => value.trim());
}

function htmlToLines(html) {
  // Stylesheet and script text is not calendar content and would otherwise be
  // read as rows (the Registrar's page carries a full print stylesheet).
  const bodyMatch = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const source = (bodyMatch ? bodyMatch[1] : String(html))
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const unescape = value => value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();

  const rows = [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match =>
    [...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => unescape(cell[1]))
  );
  if (rows.length) return rows.map(cells => cells.join(' | '));

  // No table: treat each block element as one line (this is the Registrar's layout).
  return source
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/\r?\n/)
    .map(line => unescape(line))
    .filter(Boolean);
}

function headerIndex(cells) {
  const found = { date: -1, day: -1, activity: -1, time: -1, location: -1, category: -1, description: -1, link: -1 };
  let hits = 0;
  cells.forEach((cell, index) => {
    const normalized = cell.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (found[field] !== -1) continue;
      if (aliases.some(alias => normalized === alias || normalized.startsWith(`${alias} `))) {
        found[field] = index;
        hits += 1;
        return;
      }
    }
  });
  return hits >= 2 ? found : null;
}

function cleanCell(value, limit = 400) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function safeLink(value) {
  const raw = cleanCell(value, 2000);
  if (!raw) return '';
  const match = raw.match(/https?:\/\/[^\s<>"')]+/i);
  if (!match) return '';
  try {
    const url = new URL(match[0]);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function weekday(dateIso) {
  return new Date(`${dateIso}T12:00:00Z`).toLocaleString('en', { weekday: 'short', timeZone: 'UTC' });
}

function buildEvent(fields, context, today) {
  const range = fields.resolvedDate || resolveCalendarDate(fields.date, context, today);
  const activity = cleanCell(fields.activity, 220);
  if (!range || !activity) return null;
  // Guard against document furniture: month headings, bare years, bare numbers.
  if (/^[A-Za-z]{3,9}\s+\d{4}$/.test(activity)) return null;
  if (!/[A-Za-z]{2}/.test(activity)) return null;
  if (/^\d{4}\s*[-–—]\s*\d{4}$/.test(activity)) return null;
  const { start_time, end_time } = parseTimeCell(fields.time);
  const startDate = new Date(`${range.start}T12:00:00Z`);
  const endDate = new Date(`${range.end || range.start}T12:00:00Z`);
  const providedDay = cleanCell(fields.day, 60);
  const dayLabel = providedDay || (range.end && range.end !== range.start
    ? `${weekday(range.start)} - ${weekday(range.end)}`
    : weekday(range.start));
  return {
    iso: range.start,
    endIso: range.end || range.start,
    dateLabel: range.label || String(Number(range.start.slice(8))),
    dayLabel,
    monthLabel: startDate.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    activity,
    start_time,
    end_time,
    location: cleanCell(fields.location, 200),
    category: cleanCell(fields.category, 80) || 'Academic calendar',
    description: cleanCell(fields.description, 1200),
    // Links are often pasted into the details or the activity text itself.
    link: safeLink(fields.link) || safeLink(fields.description) || safeLink(fields.activity)
  };
}

// A line that is not part of a table: "October 5, 2026 | Foundation Day | 9:00 AM | Gym".
function fieldsFromLooseLine(cells, line, today) {
  const parts = (cells && cells.length > 1 ? cells : line.split(/\s*[|•·]\s*|\t+/)).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    const loose = line.replace(/^[-*•\d.)\]]+\s*/, '').replace(/^\[[ x]\]\s*/i, '').trim();
    const dateMatch = loose.match(/^(.{3,40}?\d{4}|^\d{4}-\d{2}-\d{2}|^[A-Za-z]{3,9}\.?\s*\d{1,2}(?:,\s*\d{4})?)\s*[-–—:|]\s*(.+)$/);
    if (!dateMatch) return null;
    return { date: dateMatch[1], activity: dateMatch[2], link: dateMatch[2] };
  }
  const dateIndex = parts.findIndex(part => parseDateCell(part, { today }));
  if (dateIndex === -1) return null;
  const rest = parts.filter((part, index) => index !== dateIndex);
  const timeIndex = rest.findIndex(part => /\d{1,2}(:\d{2})?\s*[ap]\.?m/i.test(part));
  return {
    date: parts[dateIndex],
    activity: rest[0] || '',
    day: /^[A-Za-z]{3}\s*[-–—]?\s*[A-Za-z]{0,3}$/.test(rest[1] || '') ? rest[1] : '',
    time: timeIndex >= 0 ? rest[timeIndex] : '',
    location: rest.length > 2 ? rest[2] : '',
    description: rest.slice(3).join(' · '),
    link: rest.join(' ')
  };
}

// Parse the document text into calendar rows. Returns every row it could
// understand plus the lines it skipped, so the admin sees exactly what happened.
export function parseCalendarText(text, { kind = 'auto', today = new Date(), limit = 800 } = {}) {
  const events = [];
  const skipped = [];
  const sourceKind = kind === 'auto' ? detectKind(text, '', 'auto') : kind;
  const lines = sourceKind === 'html'
    ? htmlToLines(text)
    : String(text || '').split(/\r?\n/).map(line => line.replace(/\s+$/, '')).filter(line => line.trim());

  let mapping = null;
  let context = { year: today.getFullYear(), month: today.getMonth() + 1 };
  let inTermsSection = false;
  let lastRange = null;

  const rows = sourceKind === 'html' ? lines : lines.map(line => line.trim());

  for (const rawLine of rows) {
    const line = String(rawLine).trim();
    if (!line) continue;

    const parts = splitRow(line).filter(Boolean);
    const monthHeading = parts.length && parts.every(part => MONTH_YEAR.test(part));
    if (monthHeading) {
      const match = MONTHS[parts[0].match(MONTH_YEAR)[1].toLowerCase()];
      if (match) {
        context = { year: Number(parts[0].match(MONTH_YEAR)[2]), month: match };
        continue;
      }
    }

    // The Registrar ends the document with term summaries; those are not activities.
    if (/^terms?\s*(and|&)\s*schedules/i.test(line.replace(/\s+/g, ' '))) {
      inTermsSection = true;
      continue;
    }
    if (inTermsSection) {
      skipped.push(line.slice(0, 200));
      continue;
    }

    const cells = splitRow(line);
    const header = headerIndex(cells);
    if (header) {
      mapping = header;
      continue;
    }

    let fields = null;
    if (mapping) {
      const pick = index => (index >= 0 && index < cells.length ? cells[index] : '');
      const dateCell = pick(mapping.date) || cells.find(cell => resolveCalendarDate(cell, context, today)) || '';
      fields = {
        date: dateCell,
        day: pick(mapping.day),
        activity: pick(mapping.activity) || cells.filter((cell, index) => index !== mapping.date && !resolveCalendarDate(cell, context, today))[0] || '',
        time: pick(mapping.time),
        location: pick(mapping.location),
        category: pick(mapping.category),
        description: pick(mapping.description),
        link: pick(mapping.link)
      };
      // A row with an empty date cell continues the previous date block.
      if (!dateCell && lastRange && fields.activity) fields.resolvedDate = lastRange;
    } else {
      fields = fieldsFromLooseLine(cells, line, today);
    }

    const event = fields ? buildEvent(fields, context, today) : null;
    if (event) lastRange = { start: event.iso, end: event.endIso, label: event.dateLabel };
    if (event) {
      if (events.length < limit) events.push(event);
    } else {
      skipped.push(line.slice(0, 200));
    }
  }

  // De-duplicate identical rows inside the document itself.
  const unique = [];
  const seen = new Set();
  for (const event of events) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...event, key });
  }
  return { events: unique, skipped, kind: sourceKind };
}

export function eventKey(event) {
  return createHash('sha1')
    .update([event.iso, event.activity.toLowerCase(), event.start_time, event.location].join('|'))
    .digest('hex')
    .slice(0, 20);
}

export function sourceEventId(event) {
  return `gdoc-${eventKey(event)}`;
}
