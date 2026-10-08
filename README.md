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
  links and the footer's identity through `PATCH /api/settings/contact`. Its
  *Footer* group holds exactly what the public footer prints — the office name,
  the one-line description and the credit line — and the preview card shows the
  footer as it will read. Super administrators still own the site-wide wording
  (title, description, homepage intro); the office, contact and footer details
  are not repeated in that form.
- **About OSR page.** *Admin → About OSR* edits the wording of the public
  "About the Office of the Student Regent" page, one pane per part of it: the
  intro, the mandate (heading, description and the points, one per line), the
  Office block (heading, short description and the title printed above the
  directorate), and the Student Regent — whose name, term and message also feed
  the card beside the homepage masthead. Any signed-in administrator can save it
  through `PATCH /api/about`; the public site reads it from
  `GET /api/about/public`. Leaving a field empty keeps the wording built into the
  site, and *Reset to built-in wording* clears every override in one action. The
  people themselves are not in this document: they are records, below.
- **Leadership archive.** *Admin → Leadership* writes the two primary figures and
  the directorate of eight that the About page prints, one record per person:
  name, position, shelf, printed number, portrait, short description, quotation,
  biography, responsibilities, previous positions, projects, Facebook, Instagram,
  email and a published/hidden switch. The tree on the left is the archive in the
  order the page reads it and the order is dragged, arrowed or keyed; the numbers
  follow the order (01, 02 · 01D…08D) unless a record overrides one, and only
  published records are counted, so withdrawing one closes the sequence up.
  Under the form is a live preview of the public strip that reads the form rather
  than the server, so the card opens, the portrait clears and the description
  arrives while the office is still typing. *Load sample profiles* fills whatever
  seats are free with records that say "Sample" in every field and carry no
  portrait, so the layout and the motion can be checked before anybody has been
  appointed; *Remove samples* deletes exactly those rows and nothing the office
  wrote. The API enforces the limits, the numbering, the link and photo rules and
  the per-field caps, and the editor refuses the same things before asking.
  `OSR/server/test/leadership.test.mjs`, `leadership-page.test.mjs` and
  `leadership-admin.test.mjs` cover the three layers on every `npm test`.
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
- **Student submissions.** *Admin → Concerns* is the individual intake (reply,
  then move each one through Received → In review → Responded → Closed; the
  student sees the reply with their tracking code), *Admin → Service ratings* is
  every "Rate the BulSU OSR" response with a one-click PDF summary, and
  *Admin → Org submissions* is what student councils and organizations file from
  Get Help: the organization, campus, topic, title and contact email, the status
  (Received → Under review → Endorsed → Published → Returned), a note for the
  office record, and the signed document itself, which is streamed from
  `GET /api/submissions/:id/file` to a signed-in administrator only.
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
site cursor and its states are driven the same way (`site-cursor.test.mjs`), the
Ideal BulSU points bar is driven the same way (`builder-bar.test.mjs`), the tab
icon set and the social card are checked against their vector source and the ink
is measured in the pixels (`tab-identity.test.mjs`), and `osr-netlify.zip` is
compared with the files in the repository (`netlify-bundle.test.mjs`), so a stale
drag-and-drop bundle fails the suite.

## What changed for standalone

- `OSR/server/db/schema.js`: no longer reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` env. Seeds default admin if empty, generates `jwt_secret` in `site_settings`.
- `OSR/server/db/postgres.js`: loads `jwt_secret` from DB into env, ensures persistence.
- `OSR/server/middleware/auth.js`: `getJwtSecret()` no longer throws in production; generates ephemeral if missing, persists via DB.
- `OSR/server/netlify/cms.mjs`: removed 503 for missing `JWT_SECRET`; only `DATABASE_URL` required. Loads secret from DB if env missing.
- `OSR/server/routes/auth.js`: added `GET /setup-status` and `POST /setup` for first-admin creation without env.
- `OSR/admin/index.html`: standalone login/setup/dashboard UI, including a health check showing "Neon standalone".

## Recent fixes

- **The calendar shows the whole record, then walks to today.** It used to open
  *filtered* to the month today falls in, which answered "what is next" by
  hiding eleven of the twelve months. Every month is now on the page, the month
  filter is untouched on arrival, and `calEnter()` — called from `setRoute()` —
  walks the student to the next date once, on arrival. That date carries
  `.cal-event--next` in both views, and one id feeds the mark, the pill and the
  walk so they cannot disagree. A filter that leaves nothing ahead of today has
  no next date, so the pill is hidden rather than pointing at a date six months
  gone and calling it "next"; the old fallback to the first filtered row, and
  the click handler's reset-and-retry path that only existed to serve it, went
  with it.
- **The two controls in the bottom-right corner are stacked, not layered.** The
  "Jump to next" pill sat at `bottom:72px` while the back-to-top button occupies
  76px to 120px in the same corner, so the pill was underneath the button. It
  now sits at `calc(132px + env(safe-area-inset-bottom))` — 12px of clear air
  above the button, the same inset, a lower z-index — and the small-screen stack
  keeps its gap.
- **The Student Regent's photograph is filed into the masthead card.** A
  confirmed name is what opens the card; the photograph and the quotation each
  appear only when the office has supplied one, so a portrait with no quotation
  works, a quotation with no portrait works, and an empty frame never does. When
  there is a photograph it runs to the card's own edges, is cropped to favour a
  face over a lapel, taken out of its own colours and washed in the office's red
  to ink at half strength in `mix-blend-mode:color`, then faded into the white
  the name is printed on. Holding or keyboard-focusing the card lets the real
  colours back through. The red file tab and the initials circle step aside when
  a portrait is there — two pictures of one face is one too many. Nothing was
  invented to fill it: save a name and a photo in *Admin → About OSR* and the
  card appears.
- **The site's pointer is an arrow again.** A red dot inside a trailing ring read
  as decoration and covered the control it was standing on. The head is now the
  seven-point arrow, cut with `clip-path` in the site's ink, its tip on the
  hotspot and edged in paper by a `drop-shadow` on the parent (a filter is
  applied before the clip-path that cuts the child, so on the child the edge
  would be cut away with it). It takes the accent over anything clickable, dips
  on its own tip on a press, becomes the caret over a field and goes to stone
  over something disabled. The ring stays as the state machine but is
  `opacity:0` over plain paper, so a page reads as paper with an arrow on it
  rather than as a reticle.
- **The privacy notices on Get Help are fine print, not panels.** Three tinted,
  rounded boxes inside three bordered cards is what made the page read as
  clutter. Each notice is now a quiet block under the same hairline the rest of
  the page divides with, its label in stone mono rather than the accent red, its
  four points reading across a 138px label column wherever the card is wide
  enough and stacking below that. All four answers, the consent gates and the
  retention lines are unchanged; only the furniture moved.
- **The About page is an office profile in three parts.** It answers what the
  mandate is, what the Office is and who is designated to it, and which
  university it serves — and stops there. The BulSU vision, mission and core
  values band, the featured-program cards, the office-information table, the
  contact card, the official-links directory, the Directors & Secretariat block,
  the college-representative rows, the sticky section jump bar and the header
  badge are gone from the document rather than hidden inside it, along with the
  links that duplicated Resources, Board Meetings and Student Help. What is left
  is the numbered block structure the page already had: the mandate carries the
  4px red filing rule, "The Office" is a list of names on hairline dividers
  (not a grid of profile cards), and the university is one compact reference with
  a single link to `bulsu.edu.ph`. `applyAboutVisibility()` went with the cards
  it was hiding; `renderAboutStaff()` now draws the list from the Student Regent
  and the saved staff rows, listing a person only when a confirmed name reaches
  it and saying plainly that no officers are published when none does.
- **The footer stopped being a second sitemap.** Nine "Explore" links, an
  address block, a phone number, opening hours and two action buttons became
  three columns: the Office's name and one-line description over the mark, the
  six primary destinations, and the two verified ways to reach it (the official
  email, and the Facebook page with its Messenger shortcut) under *Contact the
  OSR*. The bottom line is the institutional one — `© <year> Office of the
  Student Regent · Bulacan State University` — beside the credit the admin
  writes. `FOOTER_OFFICE` shrank to the three values the footer prints, and the
  six destinations are not a second list to maintain: `patchNavigation()` hides
  any of them an administrator hides in the main navigation. On touch the links
  grow a 44px hit box instead of growing the gaps between them.
- **The admin no longer offers fields the page does not print.** *About OSR*
  went from nine panes and four row editors to four panes and one list; the
  About schema in `OSR/server/routes/about.js` shrank with it, so the obsolete
  keys are ignored on read and dropped on the next save (an existing document
  loses nothing it still uses and quietly sheds the rest). Contact & details
  gained the *Footer* group and lost `office_hours_short`, which fed a footer
  line that no longer exists, and the super-administrator's *Public site
  information* form no longer duplicates the contact and footer keys — it keeps
  the three site-wide wording fields. `footer_text` was editable in two places
  and rendered in none, so it is gone from the admin, the settings allowlists and
  the seed.

- **The public site now shows only finished, student-facing work.** The top bar
  lost the inline search box that clipped its own placeholder ("…nceme") and the
  duplicate magnifier beside it; one black search button opens the site search,
  and the **Menu** button appears only below 1180px, where the full row of
  destinations no longer fits. That row now carries Calendar, Help and About so
  nothing is reachable only from a phone. The homepage lost the "Jump to
  anything" button, the four number boxes that read as zeros before the content
  loaded, and the four-card Student Help strip that repeated destinations the
  quick-access list and the footer already carry. The hero's primary action is
  **Raise a concern** (red, into the concern form) and its secondary is **View
  announcements**; the "Board archive" button is gone from the hero and from the
  drawer, because Board Meetings is one click away in the navigation.
- **The card beside the masthead is the Student Regent.** It replaced the "What
  the Office does" panel, which the About page already says at length. It is
  driven by `STUDENT_REGENT` at the top of the site script and by the Student
  Regent fields in *Admin → About OSR*, and it stays hidden — with the masthead
  taking the full width — until a confirmed name and a message from the Regent
  exist. No name, photograph or quotation was invented to fill it.
- **The About page shows nothing the office has not confirmed.** What began as
  hiding the unconfirmed cards — the badge, the Student Regent, the Directors and
  College Representatives, the contact and office-information cards — ended with
  those sections leaving the page altogether, since a profile of the Office does
  not need a directory beside it. The rule they were built for still holds: a
  value in `ABOUT_UNCONFIRMED` ("To be announced", "TBD", "[to be supplied]") is
  not a person and not a fact, so `renderAboutStaff()` drops it and the list says
  plainly that no officers are published yet. The office's real Facebook and
  Messenger links replaced the two "[to be supplied]" rows, and they live in the
  footer and on Get Help. Section numbers are a CSS counter over the blocks that
  are rendered, so the count can never skip.
- **Tracking codes read `BulSU - OSR - 4827`.** `routes/feedback.js` issues four
  random digits behind the office name instead of `OSR-ABCD-2345`. The `code`
  column keeps its UNIQUE constraint and the insert simply draws again on a
  collision, so four digits stay sufficient; `canonicalCode()` accepts the code
  with its spaces, without them, in lower case, or as the four digits alone, and
  still resolves every legacy `OSR-ABCD-2345` code already in the database. The
  copy button answers on the button itself ("Copied ✓") and falls back to a
  select-and-copy prompt where the clipboard API is unavailable.
- **Both Get Help forms carry a privacy notice and a consent gate.** Under each
  form title: what is collected, why, who can see it, and how long it is kept.
  The retention line is `PRIVACY_RETENTION` in the site script — empty, because
  the office has not published a period, so the notice states only what the
  system actually does rather than inventing a number of months. "I agree to the
  privacy notice." is required before Send on both forms *and* on the new
  council form; it is checked in the page's submit handlers and again by the API,
  which refuses the record without it.
- **Get Help stacks instead of leaving a blank column.** The concern form leads
  at full width, the rating form follows underneath, the new organization form
  after that, and Contact OSR / Student Support sit side by side at the bottom —
  one column on a phone. The two-column grid that stretched the shorter form
  beside the taller one is gone.
- **Organization & council submissions.** A signed position, resolution, request
  or statement — including proposals endorsed to SPDO — is filed from Get Help
  with the organization's name, campus, topic, document title, a PDF/Word/image
  up to 3 MB, and a contact email. It is visibly not the individual concern
  form: different heading, different border, and a line pointing individuals
  back up the page. `routes/submissions.js` reuses the media library's upload
  mechanism (Netlify Blobs in production, `uploads/submissions/` locally) and
  keeps the document off any public path: it is streamed only to a signed-in
  administrator from *Admin → Org submissions*, which lists, annotates, moves
  and deletes filings.
- **Proposals are a category on the projects page.** Choosing *Proposals* in the
  Initiatives category filter swaps the list, the status choices (Submitted /
  Under review / Approved / Returned) and the empty state over to the proposals
  record. A proposal card is an initiative card plus the body that filed it, an
  "Endorsed to SPDO" tag, and the last-update date on a rule of its own. Nothing
  is listed until the office verifies it, so `PROPOSALS` starts empty and the
  page says so and points at the filing form rather than filling the row with
  invented records.
- **The calendar opens on today.** The record starts in April 2026, so a student
  arriving in October used to land on a date 179 days in the past. `calCurrentMonth()`
  sets the month filter to the month today falls in — or the nearest month still
  ahead once the record has run past today — and *Reset* returns there rather
  than to the whole academic year. The heading no longer hard-codes an event
  total that disagreed with the 276 records actually in the file.
- **The office details have one source.** `FOOTER_OFFICE` and `OFFICIAL_LINKS`
  at the top of the site script are written into the page by
  `renderFooterOffice()` and `applyOfficialLinks()`, and overridable from
  *Admin → Contact & details* — which carries a Messenger link
  (`social_messenger`) beside the Facebook one. The footer sits outside every
  page section, so no page holds a second copy of these details, and the address,
  phone and hours are printed once, on the Get Help contact card.
- **Small text is darker and a half-step larger.** `--stone` moved from `#6B6560`
  (5.7:1) to `#5C5651` (7.2:1 on white) and `--muted` — which inline form hints
  asked for by name and which was never defined, so they silently inherited
  whatever colour surrounded them — is now that same tone. Descriptions under
  headings, card text, key/value rows, calendar activities, board summaries and
  `.small` print each gained about half a pixel. Twenty rules asked for
  "Instrument Sans", a face the site does not load, and were falling back to the
  browser's generic sans; they now ask for IBM Plex Sans like everything else.
- **A link that goes nowhere is no longer a link.** Records whose document has
  not been supplied carry `href="#"`, which rendered as a `target="_blank"`
  anchor that opened a second copy of the site in a new tab. Those print as
  plain text — "… — not published yet" — and become anchors the moment a real
  address is saved.
- **The tab icon sits in the middle of the tab.** It was drawn high, with a dead
  band of empty tab underneath it. A tab is square and this mark is not, and
  `tools/make-tab-icons.mjs` worked out the padding its *width* needed and then
  applied that same number to the height, which pinned the drawing to the top
  edge of the frame. Each axis is now centred on the mark separately, the square
  frame is derived once and written into `favicon.svg` along with the rasters, so
  the vector and the PNG/ICO set cannot disagree about where the mark sits. At
  32px the mark had 1px of air above it and 11px below; it now has 6px on both
  sides. `tab-identity.test.mjs` measures the ink in the pixels on every
  `npm test`, so the icon cannot quietly sit high again.
- **The hero has one 3D object, and it moves as one object.** The card is a record
  sheet on the two sheets filed behind it: a stage owns a single perspective, the
  card sits at z=0 and the plates behind it at -26 and -52, and all three are
  turned by the same two angles. Those angles are custom properties written by
  the pointer, not inline transforms, which is the part that matters — two rules
  writing `transform` on the same element is how the lean went missing before.
  The rest of the section answers on the same pointermove: the seal's line-work
  drifts against the pointer at a third of its travel (which is what puts it
  behind the paper), the sheet comes 10px off the stack and the file behind it
  opens, and the primary action steps toward the pointer, clamped so it never
  leaves the pointer behind. Amplitudes are held to 7 degrees across and 4.5
  deep, the release is quicker than the lean, and nothing loops, so it stays
  inside MOTION 2. `hero-motion.test.mjs` drives all of it and now asserts the
  stack itself.
- **The pointer belongs to the site now.** Every visitor on a mouse had been
  holding the operating system's arrow: black, identical over a link, over plain
  paper and over something disabled, and the one part of the page the site did
  not design. It is now a red dot that sits exactly where the pointer is, inside
  a ring that trails it by about five frames and changes shape for what is under
  it — wider and washed over anything clickable, closed on a press, a caret bar
  over a field, hollow and grey over something disabled. The system arrow is only
  retired once the replacement has mounted, so with JavaScript off nothing
  changes; a touch device never gets it, and "reduce motion" keeps the pointer
  and drops the trail. `site-cursor.test.mjs` drives the states in jsdom.
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
- **"Show my build" is no longer cut off, and the points bar reads properly on a
  phone.** The primary action in the sticky points bar clips its own overflow so
  its sheen can slide inside it, and on a phone it shared its row evenly with
  Reset — the label "Show my build — 4 points left" is wider than that half, so
  the text was cut mid-word ("how my build"). Behind it sat a second bug: the
  phone bar is a two-column grid, and as a plain grid item the action row landed
  in the first column and set that column's width, squeezing the progress track to
  a few pixels, so the bar looked empty. The action row now spans both columns,
  the primary action takes the space it needs while Reset stays compact, the label
  lives in its own box that can only shorten with an ellipsis, and the count is
  short enough to fit the narrowest width the site supports ("Show my build · 4
  left"). The full sentence is still the button's accessible name, so a screen
  reader hears "Show my build — 4 points left". The bar's three parts are named
  (`.pulse-pointsbar__count/__track/__actions`) instead of being selected by child
  position, which is what had forced a pile of `!important` overrides.
  `builder-bar.test.mjs` drives the builder in jsdom and fails if the label grows
  back past what fits.
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
  Those are replaced with pre-written wording in the site's own voice, because a
  placeholder a student can read is still a placeholder. Administrators can still
  override every line from *Admin → About OSR*; an empty field keeps the wording
  built into the site.
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
