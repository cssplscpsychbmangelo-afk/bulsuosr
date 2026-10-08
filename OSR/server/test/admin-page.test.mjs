import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { request } from 'node:http';
import { initDb } from '../db/init.js';
import { seedFromFrontend } from '../db/seed.js';
import { createApp } from '../app.js';

const adminPath = new URL('../../admin/index.html', import.meta.url).pathname;

// Regression: a stray `\"` object key inside this file's single inline <script>
// made the whole block fail to parse. Because both #authScreen and #adminScreen
// start as display:none, one syntax error turned /admin into a blank white page.
test('admin page inline script parses, so /admin can never render blank', async () => {
  const html = await fs.readFile(adminPath, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length > 0, 'admin page must ship its inline script');

  for (const [index, code] of scripts.entries()) {
    // Throws SyntaxError on invalid JavaScript, exactly like a browser.
    new vm.Script(code, { filename: `admin/index.html#script-${index}` });
  }

  // The page must contain both screens and boot the auth flow, otherwise a
  // visitor would see an empty document even with valid JavaScript.
  assert.match(html, /id="authScreen"/);
  assert.match(html, /id="adminScreen"/);
  assert.match(html, /checkAuthAndSetup\(\);/);
  assert.match(html, /function showAuth\(/, 'the boot path must be able to reveal a screen');

  assert.match(html, /src="\/osr-mark\.svg"/, 'the OSR mark must identify the login, top bar and mobile sidebar');
  // The transparency report draws the logo into the PDF on a canvas, which needs
  // a raster: the PNG stays in the page for that one job even though the UI uses
  // the vector mark.
  assert.match(html, /fetch\('\/osr-logo\.png'/s, 'the PDF report must keep its raster logo');
  assert.match(html, /id="adminSidebar"/, 'the workspace needs a persistent navigation landmark');
  assert.match(html, /id="mobileMenuBtn"[^>]+aria-controls="adminSidebar"/, 'mobile navigation must be labeled and connected');
  for (const section of ['overview', 'activity', 'announcements', 'board', 'initiatives', 'resources', 'calendar', 'media', 'contact', 'leadership', 'about', 'pulse', 'settings']) {
    assert.match(html, new RegExp(`data-tab="${section}"`), `${section} must remain reachable from admin navigation`);
  }
});

// Regression: the CSRF origin guard compared `${req.protocol}://${host}` with the
// Origin header. Behind a TLS-terminating proxy (Netlify, previews, tunnels) the
// browser sends https://… while req.protocol is http, so same-site logins were
// rejected with 403 "Origin not allowed" and the dashboard never loaded.
test('same-site login works behind a TLS-terminating proxy, foreign origins stay blocked', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'osr-origin-test-'));
  let db;
  try {
    db = await initDb(path.join(dir, 'origin.db'));
    await seedFromFrontend(db);
    await db.prepare('INSERT INTO admins (name,email,password_hash) VALUES (?,?,?)').run('Test Admin','admin@osr.bulsu.edu.ph',(await import('bcryptjs')).default.hashSync('Admin123456!',10));
    const app = createApp(db);
    const server = await new Promise(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const port = server.address().port;
      const publicHost = 'osr-preview.example.net';
      // node:http is used because fetch() refuses to set a Host header, and the
      // whole point is simulating the host the proxy forwards.
      const login = (origin) => new Promise((resolve, reject) => {
        const body = JSON.stringify({ email: 'admin@osr.bulsu.edu.ph', password: 'Admin123456!' });
        const req = request({
          host: '127.0.0.1',
          port,
          path: '/api/auth/login',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            host: publicHost,
            ...(origin ? { origin } : {}),
          },
        }, res => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { text += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end(body);
      });

      const sameSite = await login(`https://${publicHost}`);
      assert.equal(sameSite.status, 200, 'same-site login through a proxy must succeed');
      assert.match(sameSite.headers['set-cookie']?.join(';') || '', /token=/, 'a session cookie must be issued');
      assert.equal(sameSite.json().ok, true);

      const foreign = await login('https://evil.example.com');
      assert.equal(foreign.status, 403, 'a genuine cross-site origin must still be rejected');
      assert.equal(foreign.json().error, 'Origin not allowed');

      // Requests without an Origin header (same-origin GETs, curl, health checks) stay allowed.
      const noOrigin = await login(null);
      assert.equal(noOrigin.status, 200);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally { db?.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
