# Deploy the OSR BulSU website and CMS

The frontend is a static Netlify site; the CMS/API runs separately as a Node
service. The repository includes a Render Blueprint, a persistent SQLite/upload
configuration, and a Netlify build script that wires the two hosts together.

## 1. Netlify setup

Netlify reads `netlify.toml` from the **base directory** (the repository root by
default). The root config publishes `OSR/osr-website`; it has a small Node build
step that generates `_redirects` from the `OSR_BACKEND_URL` environment variable.
There is no asset bundling or package-install step.

### Deploy from Git (recommended)

1. Push or merge this repository version to the branch you want Netlify to
   deploy.
2. Netlify → **Add new site → Import an existing project** → choose this repo.
3. Leave **Base directory** empty (repository root). Netlify reads `/netlify.toml`
   automatically. If you use `OSR/osr-website` as the base directory instead,
   its local `netlify.toml` is configured to do the same job.
4. Deploy. Without a backend URL, the public site uses its built-in content and
   `/admin` displays a clear “backend not connected” page.

## 2. Deploy and connect the backend

Follow [`../server/DEPLOY.md`](../server/DEPLOY.md) to deploy the Express CMS to
Render. That guide covers the paid persistent disk, initial admin password,
production secrets, CORS origin, and health check.

Once Render is healthy, add this **public URL** in Netlify → **Site configuration
→ Environment variables**:

```text
OSR_BACKEND_URL=https://<your-render-service>.onrender.com
```

Use only the service origin—no `/api`, path, or trailing slash. Redeploy Netlify.
The build automatically proxies:

- `/admin` and `/admin/*` → the Express admin pages
- `/api/*` → the CMS API
- `/uploads/*` → uploaded media on Render's persistent disk

This same-origin proxy keeps the browser on the Netlify domain for the admin
cookie and API calls. Put the exact Netlify site origin in Render's
`ALLOWED_ORIGINS` variable; if the proxy forwards the browser's `Origin` header,
the CORS and CSRF checks depend on that allowlist. Do not put `JWT_SECRET` or
the admin password in Netlify.

### Verify the connection

- `https://<your-netlify-site>/api/health` should return JSON containing
  `"ok": true`.
- `https://<your-netlify-site>/admin/login.html` should show the real CMS login.
- Sign in with the initial email/password configured on Render, then change the
  password in **Admin → Settings → Account**.
- Upload a test file and make sure its `/uploads/...` URL loads from the Netlify
  domain.

## Manual and drag-and-drop deploys

The Git build runs `netlify-build.mjs` automatically. For a one-off CLI deployment
with the backend enabled, generate proxy rules before publishing:

```bash
OSR_BACKEND_URL=https://<your-render-service>.onrender.com \
  node OSR/osr-website/netlify-build.mjs
netlify deploy --dir=OSR/osr-website --prod
```

For a static-only manual deploy, run the build script without `OSR_BACKEND_URL`
before deploying. It writes the static fallback rules to `_redirects`. If you
drag and drop a zip, zip the **contents** of `OSR/osr-website/` so `_redirects`
and `_headers` are at the published root.

## What works where

| Feature | Netlify static-only | Netlify + Render backend |
|---|---|---|
| Public site, search, guides, PDF export, saved resources | Yes, built-in content | Yes, live published CMS content |
| `/admin` CMS | Explanatory fallback | Full admin dashboard |
| Pulse submissions | Local draft only | Stored in the backend database |
| Media uploads | No | Persisted on Render disk and proxied through Netlify |

## Local development

The full stack can run from `OSR/server`:

```bash
cd OSR/server
npm ci
cp .env.example .env
# Set ADMIN_PASSWORD in .env (12+ unique characters), then:
npm start
```

See [`../server/DEPLOY.md`](../server/DEPLOY.md) for local and production
configuration details. A fresh database requires an explicit initial admin
password; there is no default login shipped in the source.

## Housekeeping

- `osr-netlify.zip` is currently inside the published folder, so it is publicly
  downloadable. Move it outside `OSR/osr-website/` if that is not intended.
- `osr-logo-original.png` is the unoptimised source of `osr-logo.png` and is not
  referenced by the page; it is still included in the static deploy.
