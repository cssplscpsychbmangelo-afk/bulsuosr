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
- **Display: Fraunces (serif, 700)** — page titles and the masthead only. Reason: editorial authority and institutional gravitas; contrasts with geometric sans defaults. There is exactly one display face in the system.
- **Body: IBM Plex Sans (400, 500, 600)** — all UI, navigation, lists, documents. Reason: humanist, highly legible, excellent at 14px on mobile, wide coverage of Filipino diacritics.
- **Mono: IBM Plex Mono (500)** — meeting numbers, record IDs, dates and metadata labels. Reason: functional differentiation of records, not decoration.
- **One scale.** 16px body, 14px metadata and labels, 18px supporting copy, 22px sub-headings, 28px section headings, plus two display sizes for titles (`--text-display`, `--text-display-sm`). Nothing is set below 14px: a date, a status or a document label is never smaller than the smallest body text, because records are read on phones. Line-height 1.5 for body, 1.0–1.1 for display.

## Dial
ENERGY 2 / RHYTHM 3 / MOTION 2
- ENERGY 2 — precise and confident, not flat, not loud. Strong headings, deliberate red accent, ample whitespace.
- RHYTHM 3 — highly varied section heights and compositions. The masthead is one editorial block, the "now" strip is a thin utility bar, announcements are a dated bulletin, the Board archive is a chronological record list and the Ideal BulSU tool is a single working panel. Nothing is a uniform row of cards. Fixes R-05.
- MOTION 2 — purposeful motion only: reveal on view, modal/drawer slide, hover and press feedback, state transitions. No endless loops, no decorative pulse, no pointer effects. Fixes R-19, documented per R-31.

## Motion — arrival and interaction only
Reasons per R-31, dial per MOTION 2.

- **Three places, and no others.** A section arrives (reveal on view), a control
  answers a press or a hover, and a state changes (drawer, modal, command
  palette, points bar, status chip). If a movement is none of those three, it is
  decoration and it does not ship.
- **No pointer layer.** The visitor keeps their own cursor. There is no custom
  dot, no trailing ring, no glow that follows the mouse, no 3D plate stack, no
  ripple, and no idle float. Depth and authority come from typography, rules and
  spacing, which do not need a pointer to exist.
- **Nothing loops.** No pulse, no sheen on a timer, no rotating banner. Every
  transition is a response — to an arrival, a press or a state change — which is
  what MOTION 2 claims and what R-19 asks for.
- **Every layer is inert under `prefers-reduced-motion`, on touch and in print.**
  The reveal becomes a static block, the drawer and palette appear without
  sliding, and the print sheet drops the chrome entirely.

## Motif — institutional record
- Left-edge red rule (4px) on key sections — the OSR filing mark, repeated.
- Thin hairline dividers (#E9E6E1) and index numbers (01 / 02) for archival feel.
- Stamped tags: meeting type, initiative status, category — typographic, not pill-heavy, subtle radius 6px.

## Layout Principles (R-05, R-14, R-11)
- Composition uses **borders, dividers, and hierarchy**, not cards for everything. A framed surface survives only where one piece of content is genuinely one object — the office band, the Ideal BulSU working panel. Everything else is lists, records, tables and rules.
- Spacing scale: 8, 12, 16, 24, 32, 48, 64 — varied deliberately per RHYTHM 3, not uniform.
- Border radius: 8px for surfaces, 6px for tags, 999px only for search inputs and prescribed capsules where function is tag. No pill-everywhere (R-11).
- No glassmorphism, no gradients, no blobs, no heavy shadows. Shadows limited to nav dropdown and mobile drawer: 0 8px 24px rgba(16,18,20,0.08).
- **Responsive in four steps.** Layout changes at 1024 (navigation collapses into the drawer), 768 (two columns become one), 560 and 400 (phone adjustments: full-width actions, tighter gutters). A component is never re-declared at half a dozen intermediate widths; the same rules serve 375, 390 and 430.
- **One button system.** Primary (the single obvious action in a view), secondary (the alternative beside it), quiet (an action inside a record or toolbar) and icon (a symbol on the same 44px target). No pill-everywhere, no equal-weight rows of buttons, no decorative effects.
- **Records are a treatment, not the default.** Announcement posts, Board records, official documents and archived information use the record row. Resources, people, help options and interactive tools use typography, rules, spacing and interaction states instead — consistency comes from the system, not from repeating one shape.
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
