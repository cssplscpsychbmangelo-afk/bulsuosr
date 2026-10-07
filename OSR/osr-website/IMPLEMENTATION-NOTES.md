# IMPLEMENTATION-NOTES.md — what is built, and how

`DESIGN.md` is the authority: it says what the design *is*. This file is the
record of what was implemented in `index.html` and why, so the specification
never has to be read as a changelog. When the two disagree, `DESIGN.md` wins and
this file is wrong.

Last pass: **cleanup and consolidation (2026-10)**.

## Tokens — one source of truth per property

- Three layers, declared once in `:root`: primitives (raw values), semantic
  roles (`--color-*`, `--status-*`, `--text-*`, `--space-*`) and component
  geometry (`--btn-h`, `--control-h`, `--focus-ring`, `--content-max`,
  `--header-h`, `--radius-*`, `--dur-*`, `--ease`).
- The migration aliases from the redesign (`--p-*`, `--red`, `--ink`, `--stone`,
  `--paper`, `--line`, `--gold*`, `--row-*`, `--surface-*`, `--btn-*`, `--ghost`,
  `--quiet`) are gone. Every declaration and every `var()` now reads a name that
  is declared exactly once, and only the semantic and component layers are used
  by components.
- Result: **73 declarations, 72 referenced**, no undefined `var()` anywhere (the
  audit fails if one returns).

## Type scale

- One scale, tokenised: `--text-sm:14px`, `--text-base:16px`, `--text-lg:18px`,
  `--text-xl:22px`, `--text-2xl:28px`. Body copy is 16px by default.
- The 44 distinct literals of the previous pass (8.5px … 17px, 11/12.5/13.5px
  spam) are gone: `font-size` resolves to nine values including `0` and `.85em`,
  and `font:` shorthands to the same set. Metadata and labels are 14px minimum.
- One display face. Fraunces is the only family above body text; Bricolage
  Grotesque, Archivo Black, Impact and Arial Black are removed from the CSS, the
  Google Fonts request, and the repository (`fonts/` is now empty). The masthead
  is Fraunces 700 at a display clamp, the same face as every page title.

## Buttons and controls

- One system, defined once: `.btn` (base), `.btn--primary`, `.btn--secondary`,
  `.btn--quiet`, `.btn--icon`, plus `.btn--sm` for inline use and `.btn--block`.
  Every control is a 44px target (`--btn-h` / `--control-h`); `.btn--sm` keeps
  the same target height and only tightens padding.
- The five generations of button CSS (`.btn--red`, `.btn--gold`, `.btn--ghost`,
  `icon-btn`, `.header-menu-btn`, `.search-toggle`, per-page overrides at 32/34/
  36/38/40px) are deleted. The markup was renamed to the system names, so no
  legacy alias survives.

## Responsive

- **Four widths, one guard set**: 1024 (navigation collapses, masthead and
  multi-column layouts stack), 768 (two columns become one), 560 and 400 (phone:
  full-width actions, tighter gutters). 93 media blocks across 24 widths became
  10 blocks across 5 conditions (the four widths, `min-width:1025px`,
  `min-width:1440px`, `max-height:640px`, the two reduced-motion queries and
  print).
- A header search field is shown from 1025px up; below that the search icon opens
  the search page, so the utilities never double up.

## Records, and where they stop

- One record row carries what is genuinely a record: announcements, Board
  meetings, official documents and the archive. Fields in a stable order — date,
  labels, status, title, summary, facts, documents, actions — separated by
  hairlines, never nested in floating cards.
- Resources, people, help options and the Ideal BulSU tool do **not** wear the
  record treatment. They are grouped by task, set in the type scale, and
  separated by rules.
- Status is always a word first, then colour: upcoming, completed, documents
  available, minutes pending, not released, in review, responded, closed. Colour
  only repeats what the word already says, so the state survives greyscale.

## Motion, surfaces and effects

- Reveal on view, modal/drawer/palette arrival, hover and press feedback, state
  transitions. Nothing else.
- No gradients and no glass: the two remaining gradient hairlines are flat rules
  and the eleven `backdrop-filter` surfaces (overlays, toasts, sticky bars) are
  opaque surfaces with a hairline. Overlay scrims keep their alpha so focus stays
  on the panel.
- Removed in this pass: the hero 3D plate stack and its pointer geometry
  (`--tx/--ty/--lift/--spread`), the custom cursor and its trailing ring, the
  glow that followed the pointer, the press ripple, the second and third hero
  entrance animations, and the underline-sweep keyframes.
- Every remaining layer is inert under `prefers-reduced-motion`, on touch and in
  print.

## Page notes (2026-10)

- **Home.** Masthead: eyebrow, OSR title, one paragraph, two actions — nothing
  else. Then the order the office asked for: what the office does → what matters
  right now → latest announcement as the lead bulletin → Board records →
  initiatives → resources → help → the Ideal BulSU entry.
- **Announcements.** Official bulletin: date, category, title, summary, source,
  read. Newest first, hairline separators, external links marked.
- **Board meetings.** Chronological archive exposing meeting number, date,
  session, status, documents and minutes as labelled fields; both placeholder
  records stay clearly marked.
- **Initiatives.** Program register — initiative, status, purpose, current state,
  student action — one row treatment, imagery only where it earns its place.
- **Resources.** Directory grouped by task (rights, academic, governance,
  support, documents), each row: resource, why you need it, official source,
  open. External links carry the source name.
- **Student help.** First screen is the action: raise a concern, then track a
  concern; the form is on that screen, three steps, one page. Anonymity,
  evidence and what happens next are answered beside the form, not instead of it.
- **Track concern.** Code field → track → current state in words, stage list from
  received to closed, then a secondary saved list that states it is stored on
  this device only.
- **About.** Institutional profile: role and mandate strongest, then office,
  people as name/position/role in an editorial list, contact last. Photography
  is secondary and marked as supplied-by-the-office.
- **Ideal BulSU.** Ten points, categories, allocate, remaining points dominant,
  submit; results split into "your priorities" and "how students answered so
  far", with an honest empty state when no aggregate exists.
- **Academic calendar.** Utility: next-up date, search and filters, term
  sections, then DATE / EVENT / CATEGORY / DAYS-UNTIL rows that read on a phone
  without horizontal scroll.
- **Search.** Shared search across announcements, Board meetings, initiatives and
  resources with a source label on every result; empty, typing, loading, results,
  no-results and error states; `/` focuses, Escape clears, arrow keys walk the
  results.

## Verification

- `tools/osr-audit.mjs` — structural: aria references, heading order, one `h1`, labelled
  controls, `noopener` on external links, duplicate ids, skip link, dead anchors.
  Currently **0 issues** across the 11 pages.
- `tools/osr-harness.mjs` — behavioural, in jsdom with stubbed endpoints: routing, the
  board and announcement rows, filters, calendar, concern submission and
  tracking, points allocation and the split result. Currently **50 checks, 0
  failures, 0 errors** — including a parse of the whole stylesheet
  (`tools/osr-css-check.mjs`), which used to fail because nine media blocks
  had lost their `@media` header.
- Manual widths: 375, 390, 430, 768, 1024, 1440.
