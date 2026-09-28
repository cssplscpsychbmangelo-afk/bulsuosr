# OSR — Office of the Student Regent, Bulacan State University

The public website and `/admin` CMS deploy together on **Netlify**, using your
existing **Neon Postgres** database. No Render service or paid persistent disk
is required. **Standalone mode: only Neon required.**

- `OSR/osr-website/`: public site; the build copies the admin into this folder.
- `OSR/admin/`: admin login and dashboard source (standalone, Neon-only).
- `OSR/server/`: authenticated API, Netlify Functions, and local server.
- Neon: persistent CMS content, admin accounts, activity logs, Pulse data, and JWT secret.
- Netlify Blobs: uploaded media (uses the existing Netlify account).

## Deploy (Standalone — like https://rcloudcssp2.netlify.app/admin)

Use the repository-root `netlify.toml` (leave Netlify's base directory empty).

**Base directory — either setting now works:**

| Netlify Base directory | Config file used |
|---|---|
| *(empty / repository root)* | `netlify.toml` |
| `OSR` | `OSR/netlify.toml` |

Netlify only reads the `netlify.toml` inside the Base directory. Setting Base
directory to `OSR` used to leave the site with no build config and no
`index.html` in the publish directory, so every URL failed to open. Both
configurations are now supported, so the site deploys either way.

**Only required env var (Functions scope):**
- `DATABASE_URL`: your Neon pooled connection string, copied directly from Neon.
  Example: `postgresql://neondb_owner:npg_I87tszbCRuwf@ep-little-smoke-b5vq9v7q-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

That's it. No `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` required:
- Admin credentials live only in Neon (`admins` table)
- JWT secret auto-generates and persists in `site_settings.jwt_secret` → sessions survive cold starts
- Fresh DB: open `/admin` → setup form creates first admin in Neon, or default `admin@osr.bulsu.edu.ph / Admin123456!` is seeded automatically

Redeploy, then open `https://your-site.netlify.app/admin`.

See [deployment instructions](OSR/server/DEPLOY.md) for setup, verification, and troubleshooting. Netlify and Neon usage limits still apply.

## Local development

Requires Node **22.16+ (22.x)**.

```bash
cd OSR/server
npm ci
cp .env.example .env
# Set DATABASE_URL to your Neon URL (or leave empty for SQLite)
npm start
```

Open `http://localhost:4000/admin`. Without `DATABASE_URL`, local development
uses SQLite and local files. With `DATABASE_URL`, it uses Neon directly.
Default login on a fresh DB: `admin@osr.bulsu.edu.ph / Admin123456!`. The setup form is available on `/admin` when no account exists.

## Admin tools

- **Mass publish / archive / delete.** Every content screen (announcements,
  board meetings, initiatives, resources, calendar, media) has a select-all
  option and one sticky toolbar that publishes, unpublishes, archives, restores,
  or permanently deletes the selected records in a single request
  (`POST /api/bulk`, up to 500 ids). Deleting three or more records asks for a
  typed confirmation; deleting media also removes the stored file.
- **Google Document calendar.** In *Admin → Calendar → Google Document source*,
  paste the published link of the Google Docs/Sheets file that lists activities.
  *Check document* previews what the parser reads without saving anything;
  *Connect & sync* stores the link and imports every activity. The website
  re-reads the document on its own (at most once every 15 minutes, before a
  public calendar request), so later edits in the document appear on the site
  without anyone re-uploading it. Only events created by the document (ids
  starting with `gdoc-`) are ever updated or removed; hand-typed events are
  left alone. `POST /api/calendar/source/preview` and friends back the panel.
- **BulSU Pulse data.** *Admin → Pulse data* lists every period that has
  submissions with counts, points, the top priority and the last submission time,
  sorted newest or oldest first and filterable by date range. A period, a range,
  or the entire dataset can be wiped; aggregates are rebuilt from what remains,
  so the public Pulse never shows a deleted submission. Wiping everything
  requires typing `WIPE`.
- **Contact & details.** Any OSR administrator (not only a super administrator)
  can edit the email, phone, office address, office hours, official page, social
  links and footer credit shown on the public site through
  `PATCH /api/settings/contact`. Super administrators still own the public text
  blocks (title, description, homepage intro, footer note).
- **Activity log.** A dedicated screen lists every recorded change (administrator,
  action, content type, time) with search, type filter and CSV export.
- **BulSU Pulse, once it has data.** The public Pulse panel is a single tablist
  with six views — This period, Monthly, Yearly, Trends, History, Share & report —
  each with a ‹ select › period stepper and a Latest jump. Periods are shown as
  "September 2026 · 5 builds", every view opens with a one-line takeaway, month
  comparisons are labelled ("Change versus August 2026, percentage points of
  share") and History is a table that discloses periods beyond the latest six.
  `OSR/server/test/pulse-nav.test.mjs` drives that navigation against synthetic
  submissions on every `npm test`.
- **Overview.** The dashboard now shows per-section library health (published /
  draft / archived counts) taken from `GET /api/bulk/summary`.

## Tests

```bash
node OSR/osr-website/netlify-build.mjs
npm test --prefix OSR/server
```

Integration tests execute PostgreSQL queries in PGlite (a local PostgreSQL engine)
and use an in-memory media store; they do not connect to your live Neon account.
Tests verify standalone mode (only DATABASE_URL required, JWT secret persisted).

## What changed for standalone

- `OSR/server/db/schema.js`: no longer reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` env. Seeds default admin if empty, generates `jwt_secret` in `site_settings`.
- `OSR/server/db/postgres.js`: loads `jwt_secret` from DB into env, ensures persistence.
- `OSR/server/middleware/auth.js`: `getJwtSecret()` no longer throws in production; generates ephemeral if missing, persists via DB.
- `OSR/server/netlify/cms.mjs`: removed 503 for missing `JWT_SECRET`; only `DATABASE_URL` required. Loads secret from DB if env missing.
- `OSR/server/routes/auth.js`: added `GET /setup-status` and `POST /setup` for first-admin creation without env.
- `OSR/admin/index.html`: standalone login/setup/dashboard UI, including a health check showing "Neon standalone".

## Recent fixes

- **A stray leftover script fragment was removed from `/admin`.** A duplicated
  `</script></body></html>` tail followed by a bare `AndSetup();` call sat after
  the admin page's closing `</html>`. Nothing executed it, but it was removed so
  the document ends where it should; the real `checkAuthAndSetup();` call is
  untouched.
- **The default calendar no longer contains term-summary rows.** Thirteen
  "TERMS & SCHEDULES" lines had been imported as events (their date, day and
  activity were the same string). They are gone from the built-in calendar; the
  parser now stops at that heading, and misread rows can be cleared from the
  admin in one action.

- **`/admin` no longer shows a blank white page.** The admin page is one inline
  `<script>`; a stray `\"` inside the escape helper was invalid JavaScript, so
  the entire script failed to parse and both `#authScreen` and `#adminScreen`
  stayed `display:none` — an empty page with no error in the UI. Fixed in
  `OSR/admin/index.html`. `OSR/server/test/admin-page.test.mjs` now parses that
  inline script on every `npm test`, so this cannot ship again.
- **Login works behind a TLS-terminating proxy.** The API's CSRF guard compared
  `req.protocol://host` with the browser's `Origin`; behind Netlify/preview URLs
  the internal protocol is `http` while the browser sends `https`, so same-site
  logins returned `403 Origin not allowed`. The guard now compares host names
  (scheme-agnostic) and still rejects genuine cross-site origins.
- The admin header now shows the signed-in email immediately after login
  (it used to stay empty until a page reload).
