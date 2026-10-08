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
- **Stone #5C5651** — secondary text. Reason: descriptions under headings, card text and small print are read on phones, outdoors, at arm's length; the previous #6B6560 cleared AA at 5.7:1 but had nothing left in it for glare. One step darker on the same warm gray is 7.2:1 on white and 6.8:1 on the light-gray surface, so the hierarchy is unchanged — ink still reads as the heading colour, stone still reads as the second voice — and the second voice carries further. `--muted` is the same tone: inline form hints asked for it by name and it was never defined, so they silently inherited whatever colour surrounded them.

Palette is 2 core (ink, white) + 1 accent (red) + neutrals. Complies with R-29, R-01 (no gradients as decoration), R-29.

## Typography — reason per R-06, R-31
- **Display: Fraunces (serif, 700)** — used only for page titles and "OFFICE OF THE STUDENT REGENT" lockup. Reason: editorial authority and institutional gravitas; contrasts with geometric sans defaults. Not used as body.
- **Body: IBM Plex Sans (400, 500, 600)** — all UI, navigation, lists, documents. Reason: humanist, highly legible at small sizes, excellent at 14px on mobile. Chosen for readability, not trend. Wide coverage of Filipino diacritics.
- **Mono: IBM Plex Mono (500)** — meeting numbers, archive IDs, metadata tags. Reason: functional differentiation of records, not aesthetic.

All type set with fluid clamp, line-height 1.5 for body, 1.0-1.1 for display. No wide-tracked uppercase labels without purpose.

Only these three families are loaded. Twenty rules asked for "Instrument Sans",
a face the page never requests, so the small form hints and the guide tooltip
were being set in the browser's generic sans — a fourth, unintended voice in the
middle of the smallest text on the site. They ask for IBM Plex Sans now. The
smallest text a student has to read (the "— required unless anonymous" hints)
was 10px; it is 11.5px, in the family the rest of the page uses, in `--muted`.

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
- **Why the pointer is an arrow.** It is the one control every visitor on a mouse
  already holds, and it was the only part of the page the site did not design —
  but "designed" cannot mean "unrecognisable". A red dot inside a trailing ring
  reads as decoration, and the ring covers the very chip it is hovering. So the
  head is the seven-point arrow every hand already knows, at the 21px a system
  arrow occupies, cut with `clip-path` in the ink the site writes in, its tip on
  the hotspot and its `transform-origin` on that same corner so a press shrinks
  it towards the pixel being aimed at. The paper edge is a `drop-shadow` on the
  *parent*: a filter is applied before the clip-path that cuts the child, so on
  the child the edge would be cut away with everything outside the polygon.
- **Why the ring stayed, and went quiet.** It still trails by about five frames,
  which is the part that gives the pointer weight, and it still carries the
  states the system arrow gave away — but it is `opacity:0` over plain paper and
  appears only where it has something to say: a hairline of the accent over
  anything clickable, tighter on a press, dashed and grey over something
  disabled. Over a field the head itself becomes the caret. The accent is for
  the states, not for the shape.
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
- Mobile-first, no horizontal overflow at 320. Tap targets minimum 44px — on the footer the links grow their hit box under `pointer:coarse` rather than growing the gaps between them, so the type stays at reading size. Keyboard order follows visual order, visible focus ring (red), except on the ink footer, where red measures 2.5:1 against the band and the ring goes white at 18.7:1 instead: a focus indicator below 3:1 is not an indicator.
- Contrast verified: Ink #111214 on white 13.8:1 PASS, Ink-2 #2B2D31 on white 13.8:1 PASS, Stone #5C5651 on white 7.2:1 PASS, Stone on Light Gray #F7F5F2 6.6:1 PASS, White on Red #A6192E 7.5:1 PASS, footer #E8E0D6 on Ink 14.3:1 PASS, footer #D5CEC7 on Ink 12.0:1 PASS, footer #9A9590 on Ink 6.3:1 PASS, About band #F0DDE0 on Red-Ink #6E0F1F 9.2:1 PASS and its eyebrow #FFC9D1 8.3:1 PASS, Red on light gray fails so never set red text on gray.
- Every data view has empty, loading, and error states. Reduced-motion support. Scalable text to 200%.

## Finished page — nothing a student reads is a note to whoever edits it
A page for students carries only finished, student-facing content. Three rules
came out of that, and they are the reason the About page and the homepage look
the way they do now:
- **Unconfirmed means absent, not placeholder.** "To be announced", "TBD" and
  "[to be supplied]" are all the same failure: the page is asking the reader to
  wait. `ABOUT_UNCONFIRMED` lists that wording, `confirmedText()` refuses it, and
  what is left over is shown — a person without a confirmed name is simply not
  listed, and the list says plainly that no officers are published yet. An honest
  empty state is the design; an empty card is not.
- **Instructions to the editor do not ship.** "Add only verified official
  links.", "Fields are updated as official records are released.", "Easy to
  update" — these belong in the README and the admin, not on the page.
- **A number is either counted or absent.** The homepage's four number boxes are
  gone rather than zero-filled, and the calendar heading states no event total:
  the badge prints the length of the record it is actually showing.

## About is an office profile, not a brochure
The About page answers three questions and stops: what the mandate is, what the
Office is and who is designated to it, and which university it serves. That is
what an official university office profile carries. Everything else the page used
to hold — the vision, mission and core values band, the featured-program cards,
the office-information table, the contact card, the link directory, the directors
and the college representatives — is either on the page that owns it or nowhere,
and a student looking for the handbook should land on Resources, not scroll past
a copy of it.
- **Three numbered blocks, no jump bar.** The count is a CSS counter over the
  blocks that render, hairline dividers separate them, and a page this short does
  not need a sticky pill navigation of its own sections.
- **One marked block.** The mandate carries the 4px red filing rule and nothing
  else on the page is boxed. Hierarchy comes from Fraunces against IBM Plex Sans,
  from the lede against the list, and from the index numbers — not from cards,
  borders or icons.
- **People are a list, not a grid of profiles.** Name, position, one optional
  line, and a photograph only when the office supplied one. No initials in a
  circle standing in for a face, no biography, no per-person contact block: the
  Office answers as one office.

## The footer says three things
Identity, six destinations, one way in — on an ink band, with the mark, at the
quietest volume on the site. It is not a second sitemap: the address, the phone
number, the opening hours, the calendar, the builder, the concern form and every
archive have a page or a button that already owns them, and repeating nine links
at the foot of every page taught nobody where to go.
- **Six destinations, one list.** The footer's links are the primary navigation's
  own destinations, and `patchNavigation()` hides any of them an administrator
  hides there. There is no footer-link editor, because there is no second list.
- **Three values, one object.** `FOOTER_OFFICE` holds the office name, the
  one-line description and the email; `OFFICIAL_LINKS` holds the page and its
  Messenger shortcut. Admin → Contact & details overrides them and the footer is
  drawn again from the same objects.
- **A thumb gets 44px.** Under `pointer:coarse` the links grow their hit box
  rather than the gaps between them, so the type stays at reading size and the
  targets stay at touching size.

## The calendar shows the record, then walks to today
The academic year is one document and a student should be able to read all of
it, so the page opens on the whole record — every month, no filter applied —
and then walks to the next date on it. Being put where you are and being locked
there are different things: the old version opened *filtered* to the current
month, which answered "what is next" by hiding eleven months. `calEnter()` runs
from `setRoute()` and is the one page that places the student itself, so its
scroll to the top is instant and the walk down is the only movement; a smooth
scroll to the top would still be running when the walk starts and the two would
fight. The date is marked with a warm wash and a hairline of the accent —
`.cal-event--next` in both views — and the same id feeds the mark, the pill and
the walk, so the three cannot disagree. A filter that leaves nothing ahead of
today has no next date, and the pill says so by not being there: pointing at a
date six months gone and calling it "next" is worse than pointing at nothing.

Two controls live in the bottom-right corner, so they are stacked and not
layered: the back-to-top button owns the corner at 76px and is 44px tall, the
calendar's pill sits at 132px with a 12px gap, both clear the home indicator by
the same inset, and the pill keeps the lower z-index.

## The masthead's card is a person
The card beside the hero is the Student Regent — photograph, name, term, one
line in their own words, and **Ask the Regent** into the concern form. It is the
same card the pointer tilts, so nothing about the motion changed; only its
contents did. `STUDENT_REGENT` at the top of the site script and the Student
Regent fields in *Admin → About OSR* both feed it. **A confirmed name is the
gate**: with one, the card is a person; without one, it is hidden and
`.hero--solo` gives the masthead the full width. The photograph and the
quotation are each shown only when the office has supplied one, so the card can
carry a portrait with no quotation, or a quotation with no portrait, and never
an empty frame. The same saved person is the first name in "The Office" list on
About — one record, two pages, and the About list does not repeat anyone the
office has already typed into it.

**The photograph is treated, not dropped in.** A portrait arrives from wherever
it was taken — a phone, a scanned ID, a press shot — in colours this page did
not choose, so it is filed rather than pasted: it runs to the card's own edges
(`--pad`, declared once, and negative margins against it), the crop favours a
face over a lapel (`object-position:50% 22%`), the image is taken out of its own
colours (`grayscale(1)`) and the office's red into its deep red into the ink is
laid over it in `mix-blend-mode:color` at half strength, which keeps the
photograph's own light and gives it the palette's hue. A full duotone would turn
a person into a poster; half a wash keeps them a person. The bottom of the print
fades to the white the name is printed on, so the eye is carried from the face
to the name instead of stopping at an edge, and `isolation:isolate` keeps the
wash blending with the photograph and not with the page behind it. Holding the
card — or focusing it with the keyboard — lets the real colours back through:
the one piece of motion the portrait has, and the visitor starts it. The red
file tab steps aside when there is a portrait, and the initials circle goes with
it, because two pictures of one face is one too many.

## Office details have one home
`OFFICIAL_LINKS`, `FOOTER_OFFICE`, `PRIVACY_RETENTION` and `STUDENT_REGENT` sit
together at the top of the site script. The footer, the Contact OSR card on Get
Help and the homepage card all read from them, and *Admin → Contact & details* /
*Admin → About OSR* override them at runtime through `js/cms-integration.js`. One
value, one place, every page — which is also why the footer is rendered once
outside every page section rather than repeated per page. Each object holds only
what is printed: when the footer's address block and hours line went, the fields
behind them went with it, in the page, in the admin, in the settings allowlists
and in the seed.

## Forms: consent is a gate, not fine print
Every form on Get Help carries a privacy notice under its title — what is
collected, why, who can see it, how long it is kept — and an "I agree to the
privacy notice." checkbox immediately above its send button. The notice is set
as fine print and not as a panel: three of them sit inside three bordered cards
on one page, and three tinted, rounded boxes inside three boxes is what made Get
Help read as clutter. A hairline above, the label in the stone mono the page's
other labels wear at the smallest size the site uses, four points that read
across in a 138px label column wherever the card is wide enough for one and
stack below that — the accent red is left for what a student has to act on,
which on this page is the consent gate itself. The row turns red
when a submission is refused for want of it, the page's own submit handler stops
the request, and the API refuses it again, because a control that only looks
required is not required. The retention sentence is `PRIVACY_RETENTION`: empty,
because the office has not published a period, so the notice describes what the
system does instead of inventing a number of months.

Dial: ENERGY 2 / RHYTHM 3 / MOTION 2
