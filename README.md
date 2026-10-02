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

Redeploy, then open `https://your-site.netlify.app` (and `/OSRAdminControl2026`).

Redeploying is enough — but if you upload `OSR/osr-website/osr-netlify.zip` by
hand instead of connecting the repository, rebuild that archive first with
`node OSR/osr-website/netlify-build.mjs`: it is a snapshot, and a stale one
deploys an old site.

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
- **About OSR page.** *Admin → About OSR* edits the whole public
  "About the Office of the Student Regent" page — the page header, the office
  overview, the mandate bullets, the Student Regent (name, term, campus), the
  Executive Director and Directors, the college representative rows, the BulSU
  vision, mission and core values, the office information rows, the featured
  programs and the official links. Any signed-in administrator can save it
  through `PATCH /api/about`; the public site reads it from `GET /api/about/public`.
  Leaving a field empty keeps the wording built into the site, so nothing has to
  be retyped to change one name, and *Reset to built-in wording* clears every
  override in one action.
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
The hero's pointer interactions are driven in jsdom (`hero-motion.test.mjs`), the
Ideal BulSU points bar is driven the same way (`builder-bar.test.mjs`), the tab
icon set and the social card are checked against their vector source
(`tab-identity.test.mjs`), and `osr-netlify.zip` is compared with the files in
the repository (`netlify-bundle.test.mjs`), so a stale drag-and-drop bundle fails
the suite.

## What changed for standalone

- `OSR/server/db/schema.js`: no longer reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` env. Seeds default admin if empty, generates `jwt_secret` in `site_settings`.
- `OSR/server/db/postgres.js`: loads `jwt_secret` from DB into env, ensures persistence.
- `OSR/server/middleware/auth.js`: `getJwtSecret()` no longer throws in production; generates ephemeral if missing, persists via DB.
- `OSR/server/netlify/cms.mjs`: removed 503 for missing `JWT_SECRET`; only `DATABASE_URL` required. Loads secret from DB if env missing.
- `OSR/server/routes/auth.js`: added `GET /setup-status` and `POST /setup` for first-admin creation without env.
- `OSR/admin/index.html`: standalone login/setup/dashboard UI, including a health check showing "Neon standalone".

## Recent fixes

- **The hero's interactions can actually be felt again.** They were being
  neutralised, not missing: every `.hero.is-in` entrance animation ran with
  fill-mode `both`, and a finished animation with `both` keeps ownership of the
  properties it animated — the browser ranked the settled animation above both
  inline styles and hover rules, so `transform` on the card and on the primary
  button stayed pinned at `none`. The card lean, the button drift and the hover
  lift were all being computed and thrown away. The entrances now end at
  `backwards` (the closing frame is the element's natural state), and the whole
  vocabulary was made more present: a warmer pointer light that trails the
  pointer, the top rule carrying the pointer's hotspot, a card that leans from
  anywhere in the section and lights up under the pointer, a primary button that
  steps toward it — and a ripple from the exact point pressed, which is the one
  part a finger on a phone can feel. Coming back to Home replays the arrival
  instead of leaving the masthead frozen. `hero-motion.test.mjs` drives all of it
  on every `npm test`, and the entrance fill-modes are asserted directly.
- **The OSR mark is the logo everywhere, and the tab icon reads the tab it lands
  on.** `favicon.svg` is the original logo traced from `osr-logo-original.png`
  into one vector path, so the tab shows the logo itself rather than a plate with
  a shrunken raster of it (which is what looked ugly). Inside that one file,
  `prefers-color-scheme` swaps the fill: institutional red on light browser
  chrome, a light tint of the same red on dark chrome, so the mark is never a
  dark blob on a dark strip. Safari and iOS pick up the ICO and PNGs instead;
  `tools/make-tab-icons.mjs` rasterises those from the same path
  (`npm run icons --prefix OSR`, `npm run icons:check --prefix OSR`), so the
  vector and the rasters cannot drift apart. `tab-identity.test.mjs` checks the
  sizes, the ICO container, the dark-chrome contrast and that every committed
  raster still matches the path.
- **A shared link now unfurls with the mark.** The page had `og:title` and
  `og:description` but no image, so posting the site anywhere showed a bare text
  card. `og-image.png` (1200x630) is generated from the same traced path as the
  tab icon and the page logo, on the site's own paper, with no lettering baked in:
  every unfurler prints the title and description next to it, and type inside the
  picture would only duplicate that in whatever font the reader's platform
  substitutes.
- **The mark replaced the full stacked lockup in the page's logo slots.** The
  header, mobile menu, footer, welcome card and admin login/top bar/sidebar were
  showing `osr-logo.png` — the whole lockup, wordmark included — at 36-44px,
  where its lettering is an unreadable smudge. They now render `osr-mark.svg`,
  the same traced mark as the tab icon (generated from the same path, so the two
  can never show different logos), always in institutional red and never themed
  by the operating system: a tab has to answer the browser's chrome, a logo on
  the site's own white paper does not. `osr-logo.png` is still served, and still
  fetched by the admin's transparency report, which draws the logo into a PDF on
  a canvas and needs a raster.

  The bundle's freshness check is now derived from the list of files the archive
  actually packs, so nothing can be silently left out of it again — the admin
  page had been, which is how a rebuilt archive shipped a stale admin.
- **A stale drag-and-drop bundle can no longer ship.** `OSR/osr-website/osr-netlify.zip`
  is the upload-instead-of-Git alternative, and it had gone stale — a deploy from
  it served an older page with none of the latest work and the old tab icon.
  `netlify-build.mjs` now rebuilds the archive whenever the site it packs has
  moved, and `netlify-bundle.test.mjs` fails the suite if the committed archive
  differs from the repository. The publication itself is unchanged: the site
  deploys exactly as before.
- **The hero no longer looks muddy, and it responds to the pointer.** The
  masthead used to stack a grey wash, a pink 28px grid and a masked fade on top
  of each other; it is now one warm wash plus seal line-work in the far corner
  (concentric arcs, line not dirt) and a thin red rule on top. On a mouse the
  background light follows the cursor, the mandate card leans a degree or two
  and carries a light where the pointer is, the fact chips answer as chips, and
  the primary button gets one sheen and a small drift — the same motion
  vocabulary as the gold Build Your Ideal BulSU button. Touch-only screens and
  `prefers-reduced-motion` skip all of it, and it is decoration only: nothing
  moves that carries information, and no control is blocked.
- **The hero title has its own typeface again, and the site keeps Fraunces.**
  `--font-display` is back to Fraunces, so section headings, card titles, About,
  the Ideal BulSU board and the admin screens all read as before. Only the home
  hero title uses the `--font-hero` token: **Bricolage Grotesque at 800** —
  bold, with tight apertures and squared bowls, so the masthead reads confident
  rather than like a stock corporate sans. It is self-hosted as one 21 KB latin
  subset (`osr-website/fonts/bricolage-grotesque-800.woff2`) so the title never
  waits on a third-party request; the fallback stack is Archivo Black → Impact →
  Arial Black. Size and break are unchanged: `clamp(42px, 5.4vw, 64px)`, two
  lines, 34–64 px across 360–1440 px. `font-preview.html` still compares the
  alternates on the real hero (Archivo, Anton, Oswald, Merriweather, Playfair,
  Zilla Slab, Libre Franklin, Fraunces) — each is a token change plus its font
  file.
- **“Build Your Ideal BulSU” now looks the same everywhere — and the dashboard
  row is balanced.** The quick-access row held five tiles in a four-column grid,
  so *Track My Concern* sat alone on a second row. A sixth tile — Build Your
  Ideal BulSU — joins it, and the row lays out three across (two on a tablet,
  one on a phone) so every row is full. That tile, the dashboard band’s button,
  the menu link, the command-palette entries and the builder’s own *Show my
  build* / *Add to BulSU Pulse* buttons now share one gold accent (`.btn--gold`
  plus gold tokens in `:root`), which keeps the student-consultation flow
  recognisable without touching anything else. Motion stays inside the existing
  vocabulary — hover lift, a single sheen sweep, the band’s slow gold ring — and
  switches off under `prefers-reduced-motion`.
- **One rating now produces one prompt.** Submitting “Rate the BulSU OSR” used
  to print the same sentence twice: the message under the button *and* a
  floating toast stacked on top of it. Repeated taps queued more copies that
  overlapped each other, and the button stayed live while the request was in
  flight, so a single student could post several ratings. The rating form now
  reports through its own status line only, the send button locks until the
  request finishes, and a stray tap right after a recorded rating no longer
  turns into a “name is required” error on the emptied form. Toasts site-wide
  de-duplicate themselves (the same sentence never stacks twice), skip a
  message already shown in a form status, cap at three on screen, and keep a
  width that fits a phone. `OSR/server/test/rating-prompt.test.mjs` checks all
  of this on every `npm test`.
- **`/admin` never pre-adds an email or password.** The sign-in form shipped
  with a placeholder account in the email field, and the browser could restore
  saved credentials into both fields. Both inputs (and the form) now declare
  `autocomplete="off"`, the boot path blanks whatever the browser restored, a
  failed sign-in clears the password field, and creating the first account no
  longer pre-fills the next sign-in.
- **Service ratings in the admin now work on a phone.** The filters, stats and
  wide response table were being laid out inside a grid column that could not
  shrink, so the whole page scrolled sideways and the numbers were cut off.
  Sections now cap their column (`minmax(0,1fr)`), the filter bar stacks with
  full-width controls, the average-rating card spans the row with the counters
  two-up underneath, and below 680px the responses table becomes one labelled
  card per rating (date, student, service, stars, comment, Delete) with no
  sideways scrolling. Long lists paint 50 responses at a time behind a
  *Show more* button, so a big archive opens fast on a phone.
- **The About page reads as finished copy.** The header badge said “Easy to
  update” and the page carried template notes (“Structured information that is
  easy to update…”, “[Name — to be supplied]”, “Replace with verified dates…”).
  Those are replaced with pre-written wording in the site's own voice — the
  badge now reads “Student representation” and unconfirmed roles read “To be
  announced”. Administrators can still override every line from *Admin → About
  OSR*; an empty field keeps the wording built into the site.
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
