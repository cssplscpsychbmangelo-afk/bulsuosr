# Office of the Student Regent — BulSU — Netlify Deployment

Static, no build. Premium, accessible, anti-slop filtered.

## Deploy to Netlify (3 ways)

**Drag & drop**
1. Run `zip -r osr.zip . -x "*.git*"` inside `osr-website/`
2. Netlify dashboard → Add new site → Deploy manually → drop `osr.zip`

**Git**
1. Push `osr-website/` to your repo root (or set publish directory to `osr-website`)
2. Netlify → Add new site → Import from Git
3. Build command: `echo 'Static site - no build required'`  Publish directory: `.` (or `osr-website`)

**Netlify CLI**
```bash
npm i -g netlify-cli
netlify login
netlify deploy --dir=.          # draft
netlify deploy --dir=. --prod   # production
```

## How Netlify routing works
- `netlify.toml` handles SPA fallback: `/* → /index.html 200` so direct links like `/` `/#board-meetings` work on refresh and deep links.
- `_redirects` is the fallback for older Netlify deploys.
- Headers are set in `netlify.toml`: security headers + cache (HTML no-cache, assets immutable).

## Performance
- Single `index.html` (103KB), 1 Google Fonts request, no heavy JS libs.
- Client-side filtering, localStorage for saved resources + concern draft.
- Works offline as static; no backend required until you wire the concern form.

## Wiring the concern form
In `index.html` search `concernForm` submit handler. Replace demo toast with:
```js
fetch("https://your-endpoint", {method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target)))})
```
Add consent checkbox and server-side validation.

## CMS hook
All content is in top-level arrays: `ANNOUNCEMENTS`, `BOARD_MEETINGS`, `INITIATIVES`, `RESOURCES`. Replace with fetch from your CMS or Netlify Blobs / Decap CMS.

## Fix log — what was wrong and what was fixed
- **Spaces:** Sections were 18px padding with tight rhythm — fixed to 40px/48px with RHYTHM 3 variation, hero 28px padded, quick access 18px, sticky filters give breathing.
- **Premium:** Header flat, no depth — added scroll shadow + 44px mark + subtle hover lifts + red underline on hero title. Cards now lift 2px with soft shadow only on hover (purposeful).
- **Interactive:** Only basic filters — added command palette (Ctrl+K / /), search highlighting, save/bookmark (localStorage), share + calendar .ics, timeline toggle, sticky filter bar, concern stepper with autosave + review, toast, back-to-top, scroll progress, reveal on view.
- **Animations:** Was MOTION 1 static — upgraded to MOTION 2 choreographed (documented in DESIGN.md): scroll progress, reveal, drawer/modal slide+fade, hover lift. All respect `prefers-reduced-motion`.
- **Netlify:** Missing — added `netlify.toml`, `_redirects`, `_headers`, publish `.` no build.

Dial: ENERGY 2 / RHYTHM 3 / MOTION 2 — premium institutional.
