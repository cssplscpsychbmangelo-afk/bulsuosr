# OSR — Office of the Student Regent, Bulacan State University

Everything lives in [`OSR/`](OSR):

| Path | What it is |
|---|---|
| `OSR/osr-website/` | **Public website** — static `index.html` and CMS integration script. Netlify publishes this folder. |
| `OSR/admin/` | Admin CMS dashboard — served by the backend and proxied through Netlify when connected. |
| `OSR/server/` | Express API + SQLite CMS (port 4000). Serves the public site, admin, uploads, and `/api/*`. |
| `OSR/uploads/` | Existing project files and resources. New CMS media uploads use the configurable backend upload directory. |
| `OSR/anti-slop-website/` | Design & copy rules the site is built against. |

## Deploy the full site and CMS

The repository includes a Render Blueprint at [`render.yaml`](render.yaml) and a
Netlify build script. Render hosts the Express/SQLite backend on a persistent
disk; Netlify continues to serve the static site and proxies `/api/*`, `/admin/*`,
and `/uploads/*` to Render.

Follow [`OSR/server/DEPLOY.md`](OSR/server/DEPLOY.md) for the complete steps,
including the Render environment variables, initial administrator setup,
persistent storage, and Netlify connection. Netlify-specific notes are in
[`OSR/osr-website/README_NETLIFY.md`](OSR/osr-website/README_NETLIFY.md).

## Run locally

```bash
cd OSR/server
npm ci
cp .env.example .env
# Set ADMIN_PASSWORD in .env to a unique password of at least 12 characters.
npm start
```

Open `http://localhost:4000/` for the public site and
`http://localhost:4000/admin/login.html` for the admin CMS. A fresh database
requires explicit `ADMIN_PASSWORD` configuration; there is no default admin
credential in the source. `JWT_SECRET` can be generated locally for stable
sessions; it is mandatory and must be persistent in production.
