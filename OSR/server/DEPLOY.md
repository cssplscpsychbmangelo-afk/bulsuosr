# Deploy /admin with Netlify + Neon (Standalone, no env admin)

Netlify serves the website, admin pages, and API functions. Your Neon Postgres database stores CMS content and accounts. Netlify Blobs stores uploaded files. No Render service, separate backend host, or paid disk is required.

**Standalone mode:** Only `DATABASE_URL` is required. Admin credentials live in Neon, JWT secret is auto-generated and persisted in `site_settings.jwt_secret`. No `ADMIN_EMAIL`, `ADMIN_PASSWORD`, or `JWT_SECRET` env vars needed.

## One-time setup

1. Deploy this repository using Netlify's **Git integration**. Leave **Base directory** empty. The root `netlify.toml` supplies build command, publish dir, function dir, Node 22.
2. In Netlify → Site configuration → Environment variables, set **only** this for production context and **Functions** scope (or all scopes):

   | Variable | Required | Value |
   |---|---|---|
   | `DATABASE_URL` | ✅ | Your Neon **pooled** Postgres connection string, with SSL enabled |

   That's it. No `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` needed.

   Copy the connection string directly from Neon. It must not contain Markdown links, `mailto:`, backticks, or HTML `&amp;` in place of `&`. The role must be able to create schema and tables.

   Example: `postgresql://neondb_owner:npg_xxx@ep-xxx-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

   **Optional overrides:**
   - `JWT_SECRET` — if you want to force a specific secret (32+ chars). If omitted, one is generated and stored in `site_settings.jwt_secret` so sessions survive cold starts.
   - `ALLOWED_ORIGINS` — for cross-origin API if public site on different domain.

3. Remove obsolete vars if present: `OSR_BACKEND_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` are ignored now.
4. Trigger a fresh deployment. Visit `/admin`:

   - If DB empty: setup form appears → create first admin (stored in Neon only)
   - If an admin already exists: sign in with that account

5. Go to **Settings → Account** to change email/password immediately.

   **No default login exists.** The site ships no known credentials — the first
   administrator is whoever the setup form creates. If you inherited a database
   from an earlier version that was seeded with a default account, change it now
   or delete it and re-create it through the setup form.

First API call initializes private `osr` Postgres schema and content in one transaction. Advisory lock prevents concurrent cold starts from duplicating. First request can take longer while Neon wakes and seeds.

## Verify after deployment

- `/admin` displays login or setup, not "backend not connected"
- `/api/health` returns `{"ok":true,...}` after DB ready
- `GET /api/auth/setup-status` returns `{"needsSetup":false}` after first admin exists
- Sign in, create draft, publish, check logged-out browser
- Upload small PNG/PDF in Media and open its `/uploads/...` URL
- Redeploy and confirm published content, account changes, uploads remain

## Troubleshooting

- **503 "DATABASE_URL is missing"** — set `DATABASE_URL` to Neon pooled string in Netlify env (Functions scope) and redeploy. Only this var is required.
- **503 "Cannot connect to the database"** — verify `DATABASE_URL` correct and Neon running.
- **503 "Database authentication failed"** — wrong user/pass in `DATABASE_URL`.
- **503 other message** — read it; it tells exactly what failed.
- **401 on login** — sign in with the account the setup form created. There is no default login. If it is forgotten, use SQL to delete admins (`DELETE FROM osr.admins`) then re-run the setup form on `/admin`.
- **429** — wait 15 min for login rate limit reset.
- **Missing functions/admin files** — deploy through Git with root config. Drag-and-drop cannot deploy API.
- **`/admin` is a blank white page** — a JavaScript syntax error in `OSR/admin/index.html` stops the whole inline script, so neither `#authScreen` nor `#adminScreen` ever becomes visible. Check the browser console for `Uncaught SyntaxError`. `npm test --prefix OSR/server` now parses that inline script and fails the build/test if this returns. Fix the source in `OSR/admin/index.html` (the Netlify build copies it to `osr-website/admin/`) and redeploy; a hard refresh clears a cached copy.
- **403 "Origin not allowed" on login** — the API only accepts writes from its own host or from `ALLOWED_ORIGINS`. Same-host requests are detected by host name, so TLS-terminating proxies (Netlify, preview URLs, tunnels) work even when the internal protocol is `http`. Only add `ALLOWED_ORIGINS` when the admin page is served from a different host than the API.

## Local development

```bash
cd OSR/server
npm ci
cp .env.example .env
# Set DATABASE_URL to Neon URL for Postgres test, or leave empty for SQLite
npm start
```

There is no default login. On a fresh database, open `/admin` and use the setup
form to create the first administrator.

## How standalone works (like rcloudcssp2.netlify.app/admin)

- `schema.js` seeds default admin only if `admins` empty — no env reading.
- `site_settings.jwt_secret` persists JWT secret across Netlify cold starts.
- `netlify/cms.mjs` loads secret from DB if `JWT_SECRET` env missing, generates if not exists.
- `auth.js` provides `/api/auth/setup` to create first admin without auth when count==0.
- Login page checks `/api/auth/setup-status` and shows setup if needed.

Only Neon connection required. No admin email/password in environment variables.
