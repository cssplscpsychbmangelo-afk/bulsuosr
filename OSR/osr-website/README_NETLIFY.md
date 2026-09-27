# Netlify deployment — Office of the Student Regent (BulSU)

Static site, no build step. Premium, accessible, anti-slop filtered.

## Why you saw "Page Not Found"

Netlify reads `netlify.toml` from the **base directory** (the repository root by
default) and publishes that directory. This repository's root contains only the
`OSR/` folder — no `index.html`, no config — so Netlify published an empty root
and answered every URL with its 404 page.

The site itself lives in `OSR/osr-website/`. That is now wired up in
[`/netlify.toml`](../../netlify.toml):

```toml
[build]
  publish = "OSR/osr-website"
  command = "echo 'Static site - no build step required'"
```

## Deploy from Git (recommended)

1. Netlify → *Add new site* → *Import an existing project* → pick this repo.
2. Leave **Base directory empty** (repo root) — `/netlify.toml` does the rest.
3. Build command / publish directory are picked up automatically. Click *Deploy*.
4. Netlify deploys the branch in *Site configuration → Build & deploy → Branch
   deployments* (`main` by default), so merge your changes there.

**Equivalent manual setting:** if you'd rather not rely on the root config, set
*Base directory* to `OSR/osr-website` — Netlify then reads
`OSR/osr-website/netlify.toml` (`publish = "."`). Both files are kept in sync.

## Deploy by drag & drop

Zip the **contents of `osr-website/`**, not the repo and not the `OSR/` folder:

```bash
cd OSR/osr-website
zip -r osr.zip . -x "*.git*"
```

Netlify dashboard → *Add new site* → *Deploy manually* → drop `osr.zip`.
`_redirects` and `_headers` in that folder are the fallbacks Netlify uses when
`netlify.toml` isn't processed.

## Netlify CLI

```bash
npm i -g netlify-cli
netlify login
netlify deploy --dir=OSR/osr-website --prod
```

## Routing on Netlify

- `/api/*` → `api-unavailable.json` (200). The Express + SQLite backend in
  `OSR/server` cannot run on Netlify, so the page detects "no backend" in one
  ~180-byte request and renders its built-in content. Without this rule the
  single-page fallback would answer every API call with the 374 KB `index.html`
  (~3 MB of wasted downloads per page view) and log JSON parse errors.
- `/*` → `/index.html` (200) so unknown paths and deep links still render.
- Headers: security headers + cache policy (HTML and `/js/*` always revalidate —
  there is no build step to hash filenames, so `immutable` would pin visitors to
  stale JS for a year).

## What works on Netlify, and what doesn't

| | Netlify (static) | `OSR/server` (Express, port 4000) |
|---|---|---|
| Public site, all sections, search, command palette, guides, PDF export, saved resources | Yes | Yes |
| Content comes from | Built-in arrays in `index.html` | SQLite via `/api/public/*` |
| `/admin` CMS dashboard | **No** — not part of the published folder | Yes |
| Pulse submissions stored | No (local draft only) | Yes |
| Media uploads | No | Yes |

To point the Netlify-hosted public site at an API running elsewhere (a VPS,
Render, Fly.io…), add this **before** `js/cms-integration.js` loads:

```html
<script>window.OSR_CONFIG = { apiBase: 'https://api.your-domain.tld' };</script>
```

or `<meta name="osr-api-base" content="https://api.your-domain.tld">`. The API
must send CORS headers allowing your Netlify origin (`OSR/server` already uses
`cors({ origin: true, credentials: true })`).

Running the whole CMS on Netlify itself would mean porting `OSR/server` to
Netlify Functions and swapping `better-sqlite3` for a hosted Postgres — the API
contract stays the same, but it's a separate piece of work.

## Content

All content is in top-level arrays in `index.html`: `ANNOUNCEMENTS`,
`BOARD_MEETINGS`, `INITIATIVES`, `RESOURCES`. Edit those for a static deploy, or
manage them in `/admin` when the backend is running.

## Housekeeping

- `osr-netlify.zip` sits inside the published folder, so it is deployed and
  publicly downloadable. Delete it (or move it out of `osr-website/`) if you
  don't want it served — regenerate it any time with the `zip` command above.
- `osr-logo-original.png` (577 KB) is the unoptimised source of `osr-logo.png`
  and isn't referenced by the page; it also ships to Netlify as-is.

Dial: ENERGY 2 / RHYTHM 3 / MOTION 2 — premium institutional.
