# OSR — Office of the Student Regent, Bulacan State University

Everything lives in [`OSR/`](OSR):

| Path | What it is |
|---|---|
| `OSR/osr-website/` | **Public website** — single static `index.html` + `js/cms-integration.js`. This is what Netlify publishes. |
| `OSR/admin/` | Admin CMS dashboard (`login.html`, `index.html`) — served by the backend, not part of the static deploy. |
| `OSR/server/` | Express 4 API + `better-sqlite3` database (port 4000). Serves the public site, `/admin`, `/uploads` and `/api/*`. |
| `OSR/uploads/` | Uploaded/seed files used by the backend. |
| `OSR/anti-slop-website/` | Design & copy rules the site is built against. |

## Deploying to Netlify

[`netlify.toml`](netlify.toml) in this directory tells Netlify to publish
`OSR/osr-website`:

```toml
[build]
  publish = "OSR/osr-website"
  command = "echo 'Static site - no build step required'"
```

Netlify reads `netlify.toml` from the **base directory** — the repository root by
default. Before this file existed, Netlify published the repo root, which holds
only the `OSR/` folder and no `index.html`, so every URL returned
**"Page Not Found"**.

Details, drag-&-drop and CLI options, and what does/doesn't work without the
backend: [`OSR/osr-website/README_NETLIFY.md`](OSR/osr-website/README_NETLIFY.md).

## Running the full stack locally (public site + CMS + API)

```bash
cd OSR/server
npm install
node index.js          # → http://localhost:4000
```

Environment variables (optional locally — `OSR/server/.env`, read by `dotenv`):
`JWT_SECRET` (32+ chars, **required** for admin login), `DB_PATH`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `PORT` (default 4000).

Public site: `http://localhost:4000/` · Admin: `http://localhost:4000/admin/login.html`

See [`OSR/README.md`](OSR/README.md) for the full feature and architecture notes.
