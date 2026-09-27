# OSR — Office of the Student Regent, Bulacan State University

The public website and `/admin` CMS deploy together on **Netlify**, using your
existing **Neon Postgres** database. No Render service or paid persistent disk
is required. **Standalone mode: only Neon required.**

- `OSR/osr-website/`: public site; the build copies the admin into this folder.
- `OSR/admin/`: admin login and dashboard source (standalone, Neon-only).
- `OSR/server/`: authenticated API, Netlify Functions, and local server.
- Neon: persistent CMS content, admin accounts, activity logs, Pulse data, and JWT secret.
- Netlify Blobs: uploaded media (uses the existing Netlify account).

## Deploy (Standalone — like https://rcloudcssp2.netlify.app/admin)

Use the repository-root `netlify.toml` (leave Netlify's base directory empty).

**Base directory — either setting now works:**

| Netlify Base directory | Config file used |
|---|---|
| *(empty / repository root)* | `netlify.toml` |
| `OSR` | `OSR/netlify.toml` |

Netlify only reads the `netlify.toml` inside the Base directory. Setting Base
directory to `OSR` used to leave the site with no build config and no
`index.html` in the publish directory, so every URL failed to open. Both
configurations are now supported, so the site deploys either way.

**Only required env var (Functions scope):**
- `DATABASE_URL`: your Neon pooled connection string, copied directly from Neon.
  Example: `postgresql://neondb_owner:npg_I87tszbCRuwf@ep-little-smoke-b5vq9v7q-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

That's it. No `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` required:
- Admin credentials live only in Neon (`admins` table)
- JWT secret auto-generates and persists in `site_settings.jwt_secret` → sessions survive cold starts
- Fresh DB: open `/admin` → setup form creates first admin in Neon, or default `admin@osr.bulsu.edu.ph / Admin123456!` is seeded automatically

Redeploy, then open `https://your-site.netlify.app/admin`.

See [deployment instructions](OSR/server/DEPLOY.md) for setup, verification, and troubleshooting. Netlify and Neon usage limits still apply.

## Local development

Requires Node **22.16+ (22.x)**.

```bash
cd OSR/server
npm ci
cp .env.example .env
# Set DATABASE_URL to your Neon URL (or leave empty for SQLite)
npm start
```

Open `http://localhost:4000/admin`. Without `DATABASE_URL`, local development
uses SQLite and local files. With `DATABASE_URL`, it uses Neon directly.
Default login on a fresh DB: `admin@osr.bulsu.edu.ph / Admin123456!`. The setup form is available on `/admin` when no account exists.

## Tests

```bash
node OSR/osr-website/netlify-build.mjs
npm test --prefix OSR/server
```

Integration tests execute PostgreSQL queries in PGlite (a local PostgreSQL engine)
and use an in-memory media store; they do not connect to your live Neon account.
Tests verify standalone mode (only DATABASE_URL required, JWT secret persisted).

## What changed for standalone

- `OSR/server/db/schema.js`: no longer reads `ADMIN_EMAIL`/`ADMIN_PASSWORD` env. Seeds default admin if empty, generates `jwt_secret` in `site_settings`.
- `OSR/server/db/postgres.js`: loads `jwt_secret` from DB into env, ensures persistence.
- `OSR/server/middleware/auth.js`: `getJwtSecret()` no longer throws in production; generates ephemeral if missing, persists via DB.
- `OSR/server/netlify/cms.mjs`: removed 503 for missing `JWT_SECRET`; only `DATABASE_URL` required. Loads secret from DB if env missing.
- `OSR/server/routes/auth.js`: added `GET /setup-status` and `POST /setup` for first-admin creation without env.
- `OSR/admin/index.html`: standalone login/setup/dashboard UI, including a health check showing "Neon standalone".
