import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initDb } from '../db/init.js';
import { seedFromFrontend } from '../db/seed.js';
import { createApp } from '../app.js';

// The public site runs on Netlify's free tier: 100 GB of bandwidth and 125,000
// Function invocations a month. Everything a visitor downloads is an
// invocation, so what keeps the site free is not how big the responses are —
// it is how many times the browser has to ask, and how big the biggest answer
// can get. These tests hold the three things that decide it.

const sourcePath = new URL('../../osr-website/index.html', import.meta.url).pathname;

// The throttle is one store for the whole process, so each test asks from its own
// address (documentation ranges, RFC 5737) instead of inheriting the previous
// test's count.
let nextAddress = 0;
const fromAddress = () => {
  nextAddress += 1;
  return { 'x-forwarded-for': `203.0.113.${nextAddress}` };
};

async function withServer(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osr-bandwidth-'));
  const db = await initDb(path.join(dir, 'bw.db'));
  await seedFromFrontend(db);
  const app = createApp(db);
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.close();
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('the whole public site arrives in one request, cacheable, instead of eleven', async t => {
  await withServer(async base => {
    const res = await fetch(`${base}/api/public/bootstrap`);
    assert.equal(res.status, 200);
    // A minute of cache means a reload inside it never reaches the function.
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
    const body = await res.json();
    for (const section of ['announcements', 'board-meetings', 'initiatives', 'resources', 'calendar', 'guides', 'navigation', 'pulse-aggregates']) {
      assert.ok(Array.isArray(body[section]), `${section} is in the bootstrap`);
    }
    // The three sections that live inside authenticated routers come too, so a
    // page load is this one request and the Pulse poll.
    assert.ok(Array.isArray(body.leadership), 'the leadership archive is in the bootstrap');
    assert.equal(typeof body.settings, 'object', 'the office settings are in the bootstrap');
    assert.equal(typeof body.about, 'object', 'the About copy is in the bootstrap');
    assert.equal(body.calendar.length, 276, 'and nothing was left behind');
    // An old deployment that has no bootstrap route answers 404 and the site
    // falls back to asking section by section, so the two must agree.
    const alone = await (await fetch(`${base}/api/public/calendar`)).json();
    assert.equal(alone.length, body.calendar.length, 'the bootstrap and the single section carry the same rows');
  });
});

test('a public response is capped, and says so when the office publishes past it', async t => {
  const previous = process.env.PUBLIC_ROW_CAP;
  process.env.PUBLIC_ROW_CAP = '25';
  t.after(() => { if (previous === undefined) delete process.env.PUBLIC_ROW_CAP; else process.env.PUBLIC_ROW_CAP = previous; });
  await withServer(async base => {
    const res = await fetch(`${base}/api/public/calendar`);
    const rows = await res.json();
    // 276 seeded rows, cap 25: the page still loads, and it loads bounded. A
    // content mistake or a script cannot turn one request into a megabyte.
    assert.equal(rows.length, 25, 'the response is cut at the cap');
    assert.equal(res.headers.get('x-osr-truncated'), 'calendar', 'and says which section was cut');
    const boot = await fetch(`${base}/api/public/bootstrap`);
    assert.equal((await boot.json()).calendar.length, 25, 'the bootstrap is capped the same way');
    assert.equal(boot.headers.get('x-osr-truncated'), 'calendar');
    // Under the cap nothing is cut and nothing is announced.
    await fetch(`${base}/api/public/announcements`);
    const small = await fetch(`${base}/api/public/announcements`);
    assert.equal(small.headers.get('x-osr-truncated'), null, 'a section inside its cap is served whole');
  });
});

test('a loop against a public endpoint is throttled', async t => {
  const previous = process.env.PUBLIC_READ_LIMIT;
  process.env.PUBLIC_READ_LIMIT = '4';
  t.after(() => { if (previous === undefined) delete process.env.PUBLIC_READ_LIMIT; else process.env.PUBLIC_READ_LIMIT = previous; });
  await withServer(async base => {
    const from = fromAddress();
    const codes = [];
    for (let i = 0; i < 7; i += 1) codes.push((await fetch(`${base}/api/public/calendar`, { headers: from })).status);
    assert.ok(codes.slice(0, 4).every(code => code === 200), 'ordinary browsing is untouched');
    assert.ok(codes.slice(4).every(code => code === 429), `and the loop is stopped: ${codes.join(',')}`);
    const limited = await fetch(`${base}/api/public/calendar`, { headers: from });
    assert.equal(limited.headers.get('ratelimit-limit'), '4', 'with the standard headers a client can read');
    // An ordinary visitor on another address is unaffected: a shared campus
    // connection is throttled on its own count, not on everybody else's.
    assert.equal((await fetch(`${base}/api/public/calendar`, { headers: fromAddress() })).status, 200);
  });
});

test('the sections that live inside authenticated routers are throttled too', async t => {
  const previous = process.env.PUBLIC_READ_LIMIT;
  process.env.PUBLIC_READ_LIMIT = '3';
  t.after(() => { if (previous === undefined) delete process.env.PUBLIC_READ_LIMIT; else process.env.PUBLIC_READ_LIMIT = previous; });
  await withServer(async base => {
    // leadership, settings and about are public reads that happen to hang off
    // authenticated routers; a visitor can reach them without a session, so
    // they can be looped like anything else.
    for (const endpoint of ['/api/leadership/public', '/api/settings/public', '/api/about/public']) {
      const from = fromAddress();
      const codes = [];
      for (let i = 0; i < 5; i += 1) codes.push((await fetch(base + endpoint, { headers: from })).status);
      assert.ok(codes.slice(0, 3).every(code => code === 200), `${endpoint} answers normally`);
      assert.ok(codes.slice(3).every(code => code === 429), `${endpoint} is throttled: ${codes.join(',')}`);
    }
  });
});

test('the bootstrap leaks no secret the public must not read', async t => {
  await withServer(async base => {
    const body = await (await fetch(`${base}/api/public/bootstrap`)).json();
    const dumped = JSON.stringify(body);
    assert.ok(!dumped.includes('jwt_secret'), 'the signing secret is not in the payload');
    assert.ok(!/npg_[A-Za-z0-9]{8,}/.test(dumped), 'and neither is a connection string');
    // Settings is a table that holds the JWT secret right next to the office
    // address; only the public keys may cross the line.
    if (body.settings) assert.equal(body.settings.jwt_secret, undefined);
  });
});

// fetch() silently inflates gzip responses, so the only honest way to count
// what crosses the wire is to read the socket and sum the chunks.
function wireBytes(url, encoding) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { 'accept-encoding': encoding } }, res => {
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => resolve({ bytes, headers: res.headers }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

test('a public response is compressed, so the allowance is spent in bytes that count', async t => {
  await withServer(async base => {
    const url = `${base}/api/public/bootstrap`;
    const plain = await wireBytes(url, 'identity');
    const packed = await wireBytes(url, 'gzip');
    assert.equal(packed.headers['content-encoding'], 'gzip', 'the server compresses what it sends');
    assert.ok(plain.bytes > 40000, `the bootstrap is big enough to be worth compressing (${plain.bytes} bytes)`);
    // The allowance is measured on bytes served, so an uncompressed JSON feed
    // costs roughly ten times the visit. This is the difference between a
    // month of traffic and a week of it.
    assert.ok(packed.bytes < plain.bytes / 4, `the wire carries far less than the payload: ${packed.bytes} of ${plain.bytes} bytes`);
    assert.match(packed.headers.vary || '', /Accept-Encoding/i, 'and caches are told the body depends on encoding');
  });
});
