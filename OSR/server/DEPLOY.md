# Deploy the OSR CMS (Render + Netlify)

The public site remains a static Netlify site. The CMS/API runs as a Node service on
Render. Netlify then proxies `/api/*`, `/admin/*`, and `/uploads/*` to Render so
visitors and admins use the same Netlify origin, including for the HttpOnly login
cookie.

```text
Browser → Netlify public site
             ├─ /                 static OSR website
             ├─ /api/*            → Render Express API
             ├─ /admin/*          → Render admin CMS
             └─ /uploads/*        → Render persistent uploads

Render service → SQLite + uploaded files on its mounted persistent disk
```

## 1. Deploy the backend

The repository-root [`render.yaml`](../../render.yaml) is a Render Blueprint. It
keeps the service root at the repository root because the server also serves
`OSR/admin` and `OSR/osr-website` at runtime. It configures Node, the health check,
a generated JWT secret, SQLite/upload paths, and a 1 GB persistent disk mounted
at `/var/data`.

1. Push or merge this repository version to the GitHub branch you intend to
   deploy. In Render, choose **New → Blueprint**, connect this repository, and
   deploy the Blueprint from the branch containing `render.yaml`.
2. When prompted for the `sync: false` variables, set:
   - `ADMIN_PASSWORD`: a unique password with **at least 12 characters**. Keep it
     in Render's environment settings, not in Git or Netlify.
   - `ALLOWED_ORIGINS`: the exact public Netlify origin, for example
     `https://your-site.netlify.app`. Add any custom domain origins as a
     comma-separated list. Do not include paths or a trailing slash.
3. Wait for Render's health check to pass. Copy the service's HTTPS origin, for
   example `https://bulsu-osr-cms.onrender.com`, from the Render dashboard.
4. Verify the service directly at `https://<render-host>/api/health`. It should
   return JSON with `"ok": true`.

The Blueprint uses a paid web-service plan because Render's Free web services do
not support persistent disks. Without persistent storage, SQLite data and media
uploads would be lost on redeploy/restart. See Render's [free service
limitations](https://render.com/docs/free) and [Blueprint
reference](https://render.com/docs/infrastructure-as-code). The database and
uploads must stay under the `/var/data` mount for durability. The disk is not an
automatic backup—keep periodic backups outside Render as well.

### First admin account and secrets

On an empty database, the backend creates the initial admin using `ADMIN_EMAIL`
(default `admin@osr.bulsu.edu.ph`) and `ADMIN_PASSWORD`. The password is hashed;
it is never printed to logs or returned to browser JavaScript. The password
environment variable is used **only when the database has no admins**. Changing
it later does not reset an existing account; change credentials in the CMS under
**Admin → Settings → Account**. Store `JWT_SECRET` in Render and do not rotate it
casually, since doing so invalidates current sessions. Render generates it for
the Blueprint.

## 2. Connect Netlify to Render

In Netlify → **Site configuration → Environment variables**, add:

```text
OSR_BACKEND_URL=https://<your-render-service>.onrender.com
```

Use the service's HTTPS **origin only**—no `/api`, path, or trailing slash. This
URL is public configuration, not a secret. Keep the Render password and JWT
secret out of Netlify.

Trigger a Netlify deploy. The build script at
[`OSR/osr-website/netlify-build.mjs`](../osr-website/netlify-build.mjs) writes
proxy rules for the backend. The backend's `ALLOWED_ORIGINS` must contain the
exact Netlify site origin (and any custom domains) if the upstream request
forwards the browser's `Origin` header. If your Netlify domain changes, update
`ALLOWED_ORIGINS` on Render and redeploy/restart the service.

After the deploy, verify:

- `https://<your-netlify-site>/api/health` returns `{"ok":true,...}`.
- `https://<your-netlify-site>/admin/login.html` displays the real admin login.
- Log in with `ADMIN_EMAIL` and the initial password entered in Render.
- Upload a test image/document and verify its `/uploads/...` URL loads from the
  Netlify domain.

Once logged in, change the initial password in **Admin → Settings → Account**.

## 3. Netlify modes and manual deployments

When `OSR_BACKEND_URL` is absent, the build intentionally stays in static-only
mode: the public site uses its built-in content, and `/admin` explains that the
CMS is not connected. When it is present, the build proxies `/admin`, `/api`,
and `/uploads` to Render. No manual redirect edits are needed for Git-based
Netlify deploys.

For a one-off Netlify CLI/manual deploy, generate the matching redirects first:

```bash
OSR_BACKEND_URL=https://<your-render-service>.onrender.com \
  node OSR/osr-website/netlify-build.mjs
netlify deploy --dir=OSR/osr-website --prod
```

To make a static-only manual deploy instead, run the script without
`OSR_BACKEND_URL` before deploying.

## Local development

```bash
cd OSR/server
npm ci
cp .env.example .env
```

Set `ADMIN_PASSWORD` in `.env` to a unique password of at least 12 characters.
Optionally set a persistent development `JWT_SECRET`, then run:

```bash
npm start
```

Open `http://localhost:4000/` for the site and
`http://localhost:4000/admin/login.html` for the CMS. The example uses
`./db/local-osr.db` and `./uploads`; both are local-only and ignored by Git.

## Operational notes

- `GET /api/health` is the Render health check.
- `DB_PATH` and `UPLOAD_DIR` are configurable; keep both inside `/var/data` on
  Render. SQLite and local media storage are intended for this single service,
  not multiple horizontally scaled instances.
- The admin uses an HttpOnly cookie with `Secure` enabled in production. Credentialed
  CORS is allowlisted, state-changing API requests reject untrusted `Origin`
  headers, and production startup rejects missing/short JWT secrets.
- If you want a different host or managed database later, change the Render
  Blueprint and storage strategy before removing the persistent disk.
- No service has been created in Render or Netlify from this workspace. The
  hosting account must perform the account-authorized deployment steps above.

## Troubleshooting

### Netlify `/admin` still shows "The CMS backend is not connected here"

That page means Netlify served the static fallback, so the proxy is not active
for this deploy. Work through this checklist:

1. **Backend live?** Open `https://<your-render-service>.onrender.com/api/health`
   directly. It must return JSON with `"ok": true`. A first Render deploy takes
   a few minutes; wait for the dashboard to report "Live".
2. **Shortcut (no proxy needed):** the "backend not connected" page has a
   "Backend already deployed?" box. Paste the Render origin there and press
   **Connect** — it verifies `/api/health` and jumps straight to the backend's
   own admin login at `https://<render-host>/admin/login.html`, where the API
   and dashboard share the same origin. The address is remembered in that
   browser for next time.
3. **Proxy configured?** In Netlify → **Site configuration → Environment
   variables**, `OSR_BACKEND_URL` must be the backend **origin only**, e.g.
   `https://bulsu-osr-cms.onrender.com` (no `/api`, path, or trailing slash).
4. **Redeployed after setting it?** The `_redirects` proxy rules are generated
   at build time. After adding or changing `OSR_BACKEND_URL`, trigger a new
   Netlify deploy (Deploys → Trigger deploy). Merely saving the variable does
   not update the live site.
5. **Git or manual deploy?** The build script only runs on Git-connected and CLI
   builds. Drag-and-drop zips use the `_redirects` file as committed, which is
   the static fallback. Regenerate it before zipping (see
   [`../osr-website/README_NETLIFY.md`](../osr-website/README_NETLIFY.md#manual-and-drag-and-drop-deploys)).
6. **Verify:** `https://<netlify-site>/api/health` must return `{"ok":true,…}`.
   If it returns the `available:false` stub, the proxy rules are not in effect.
   The fallback page also self-checks this and offers a "Check again" button —
   if it detects the proxy, it forwards you to the real login automatically.

### Admin login says "Invalid credentials" locally

`ADMIN_PASSWORD` is used **only when the database has no admins yet**. If the
server opens an existing database file, it logs how many admins already exist
and ignores `ADMIN_PASSWORD`. Common causes:

- The server is using a different database file than you think. `.env` sets
  `DB_PATH` (default `./db/osr.db` relative to `OSR/server`). The startup log
  names the file it opened.
- A stale `osr.db` from an earlier setup (with an unknown password) is being
  reused. Either delete the local `osr.db*` files for a clean start (content is
  lost), or keep the content and reset just the logins:
  ```bash
  cd OSR/server
  npm run reset:admin -- --confirm
  npm start   # re-creates the admin from ADMIN_EMAIL + ADMIN_PASSWORD in .env
  ```
