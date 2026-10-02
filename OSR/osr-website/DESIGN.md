# DESIGN.md — Office of the Student Regent, Bulacan State University

## Identity
Institutional, editorial, student-centered. A real university office, not a startup. Feels like a university publication and official record office: precise, calm, trustworthy. The Office of the Student Regent speaks for students within the Board of Regents; the design must convey representation and record-keeping, not marketing.

## Audience
BulSU students across all campuses who need announcements, Board records, initiatives, resources, and a clear path to contact or raise a concern. Many access on phones, with varying data and devices.

## Personality
Clean, confident, restrained, accessible. Direct language. No hype. Factual and caring: "here is what you need, here is how to reach us."

## Identity — the mark, not a plate
`favicon.svg` is the original OSR mark (`osr-logo-original.png`, the runner-and-letterforms device) traced to a single vector path, so the tab shows the real logo at any size instead of a raster of the whole lockup shrunk into a 16px square. The mark is drawn in institutional red on light browser chrome and in a light tint of the same red on dark chrome (`prefers-color-scheme` inside the file), because a tab is the one surface the page does not control. The same mark is what the page itself uses (`osr-mark.svg`) in the header, menu, footer, welcome card and admin, rather than the full stacked lockup: at 28-46px the lockup's wordmark is an unreadable smudge, and the device is what people recognise. The in-page mark is always institutional red — it must not flip colour because the operating system is in dark mode; only the tab, which sits on someone else's chrome, adapts. Safari, iOS and older clients read the ICO and PNGs, which `tools/make-tab-icons.mjs` rasterises from the same path so the files can never drift apart. No plate, no background square, no second drawing to keep in sync.

The frame is derived, not drawn. A tab is square and this mark is 3:2, so the
generator works out one square the mark spans 92% of, centred on the mark on both
axes separately, and writes it into `favicon.svg` along with the rasters. The
first version took the padding its width needed and applied that to the height
too, which pinned the mark to the top edge of the tab; the framing is now the one
decision in one place, and `tab-identity.test.mjs` measures the ink in the pixels
to hold it there.

## Palette — RED + WHITE institutional
- **Institutional Red #A6192E** — primary accent only. Reason: BulSU institutional red. Used for the one deliberate accent: the left-edge rule, key actions, status markers, and OSR wordmark bar. Not as a background wash. Contrast on white is 7.2:1, passes AA large and normal.
- **White #FFFFFF** — dominant surface. Reason: formality, readability, institutional paper. Keeps the site light and printable.
- **Ink #111214** — typography. Reason: near-black for maximum legibility without harsh pure black.
- **Light Gray #F4F2EF / #E9E6E1** — secondary surface and dividers. Reason: subtle separation without turning every section into a card. Neutrals do not count toward palette cap per R-29.
- **Stone #6B6560** — secondary text. Reason: muted but still AA on white for small text at 4.6:1.

Palette is 2 core (ink, white) + 1 accent (red) + neutrals. Complies with R-29, R-01 (no gradients as decoration), R-29.

## Typography — reason per R-06, R-31
- **Display: Fraunces (serif, 700)** — used only for page titles and "OFFICE OF THE STUDENT REGENT" lockup. Reason: editorial authority and institutional gravitas; contrasts with geometric sans defaults. Not used as body.
- **Body: IBM Plex Sans (400, 500, 600)** — all UI, navigation, lists, documents. Reason: humanist, highly legible at small sizes, excellent at 14px on mobile. Chosen for readability, not trend. Wide coverage of Filipino diacritics.
- **Mono: IBM Plex Mono (500)** — meeting numbers, archive IDs, metadata tags. Reason: functional differentiation of records, not aesthetic.

All type set with fluid clamp, line-height 1.5 for body, 1.0-1.1 for display. No wide-tracked uppercase labels without purpose.

## Dial
ENERGY 2 / RHYTHM 3 / MOTION 2
- ENERGY 2 — precise and confident, not flat, not loud. Strong headings, deliberate red accent, ample whitespace.
- RHYTHM 3 — highly varied section heights and compositions. Announcement strip is a thin bar, hero is editorial split, quick access is a 4-up list, announcements are a vertical feed, board archive is a chronological list, not uniform cards. Fixes R-05.
- MOTION 2 — choreographed, purposeful motion (scroll progress, reveal on view, modal/drawer slide, hover lift). No endless loops, no decorative pulse. Fixes R-19. Premium institutional direction warrants MOTION 2, documented per R-31.

## Motion — one 3D object, one pointer, nothing that loops
Reasons per R-31, dial per MOTION 2.

- **Why the hero has a 3D object at all.** The card is the office's record sheet.
  Putting it on the two sheets filed behind it is depth doing a job — it says
  "this one record, out of a file" — rather than a card floating for effect. One
  perspective on `.hero__stage`, the sheet at z=0, the plates at -26 and -52.
- **Why the angles are custom properties.** The pointer writes `--tx`, `--ty`,
  `--lift` and `--spread` on the section and the sheet and both plates read them,
  so one pointermove moves the whole stack as one object. Two rules writing
  `transform` on the same element is how the hero's lean was silently dropped
  once already.
- **Why the amplitudes are small.** 7 degrees across, 4.5 deep, a 10px lift, the
  seal drifting 9px against the pointer. This is a university record office; the
  motion has to read as weight, not as a trick. The release is 190ms against a
  300ms lean, so leaving the section never feels like lag.
- **Why nothing loops.** No pulse, no idle float, no sheen on a timer. Every
  movement in the hero is answered to a pointer or to an arrival, which is what
  MOTION 2 claims and what R-19 asks for.
- **Why the pointer is red.** It is the one control every visitor on a mouse
  already holds, and it was the only part of the page the site did not design.
  The dot is the institutional accent at 7px — an accent, not a wash — and it
  sits exactly on the pointer so aiming at a 12px chip is never guesswork. The
  ring trails by about five frames, which is the part that gives the pointer
  weight, and it carries the states the system arrow gave away: open over
  anything clickable, closed on a press, a caret bar over a field, hollow and
  grey over something disabled.
- **Why it fails towards the system arrow.** `cursor:none` is applied only under
  a class the script adds after it has mounted, so with JavaScript off the
  visitor keeps the OS pointer instead of losing one. Touch devices never get it
  (a finger is its own cursor) and "reduce motion" keeps the pointer and drops
  the trail. The admin keeps the system cursor deliberately: it has drag-and-drop
  reordering, and WCAG 2.2 asks for the native drag affordance there.

## Motif — institutional record
- Left-edge red rule (4px) on key sections — the OSR filing mark, repeated.
- Thin hairline dividers (#E9E6E1) and index numbers (01 / 02) for archival feel.
- Stamped tags: meeting type, initiative status, category — typographic, not pill-heavy, subtle radius 6px.

## Layout Principles (R-05, R-14, R-11)
- Composition uses **borders, dividers, and hierarchy**, not cards for everything. Cards appear only where content needs grouping (initiatives, help cards); otherwise lists and tables.
- Spacing scale: 8, 12, 16, 24, 32, 48, 64 — varied deliberately per RHYTHM 3, not uniform.
- Border radius: 8px for surfaces, 6px for tags, 999px only for search inputs and prescribed capsules where function is tag. No pill-everywhere (R-11).
- No glassmorphism, no gradients, no blobs, no heavy shadows. Shadows limited to nav dropdown and mobile drawer: 0 8px 24px rgba(16,18,20,0.08).
- No stock-photo-heavy hero. Use typography and structure; optional images only where supplied, with honest placeholders.

## Data views — BulSU Pulse navigation
- One view at a time. The Pulse panel exposes six views (This period, Monthly, Yearly, Trends, History, Share & report) behind a single tablist, so nothing important sits below three other cards.
- Every view carries its own period stepper (‹ select ›) plus a "Latest" jump, so a visitor can walk the record without hunting inside a dropdown.
- Periods read in words — "September 2026 · 5 builds", never `2026-09`. A one-line takeaway in plain language states what the current numbers mean before any chart.
- Comparisons are always labelled ("Change versus August 2026, percentage points of share") and described as descriptive only, never as a ranking.
- History is a real table (period, builds, top priority, share, runner-up) that shows the latest six periods and discloses the rest on request.

## Human / Mobile (R-03, R-25, R-27, R-32)
- Mobile-first, no horizontal overflow at 320. Tap targets minimum 44px. Keyboard order follows visual order, visible focus ring (red).
- Contrast verified: Ink #111214 on white 15.9:1 PASS, Stone #6B6560 on white 5.8:1 PASS, White on Red #A6192E 7.2:1 PASS, Red on light gray fails so never set red text on gray.
- Every data view has empty, loading, and error states. Reduced-motion support. Scalable text to 200%.

Dial: ENERGY 2 / RHYTHM 3 / MOTION 2
