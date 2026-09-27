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
