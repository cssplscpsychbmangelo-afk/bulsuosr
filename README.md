# OSR — Office of the Student Regent, Bulacan State University

The public website and `/admin` CMS deploy together on **Netlify**, using your
existing **Neon Postgres** database. No Render service or paid persistent disk
is required.

- `OSR/osr-website/`: public site; the build copies the admin into this folder.
- `OSR/admin/`: admin login and dashboard source.
- `OSR/server/`: authenticated API, Netlify Functions, and local server.
- Neon: persistent CMS content, admin accounts, activity logs, and Pulse data.
- Netlify Blobs: uploaded media (uses the existing Netlify account).

## Deploy

Use the repository-root `netlify.toml` (leave Netlify's base directory empty).
Set these Netlify environment variables with **Functions** scope:

- `DATABASE_URL`: your Neon pooled connection string, copied directly from Neon.
- `ADMIN_EMAIL`: the initial administrator's email.
- `ADMIN_PASSWORD`: a unique initial password, 12+ characters.
- `JWT_SECRET`: a persistent random session secret, 32+ characters.

Redeploy, then open `https://your-site.netlify.app/admin`. The first API request
creates the isolated `osr` schema and seeds the content/admin account in Neon.
Existing tables in other schemas are not modified.

See [deployment instructions](OSR/server/DEPLOY.md) for setup, limitations, and
verification. Netlify and Neon usage limits still apply.

## Local development

Requires Node **22.16+ (22.x)**.

```bash
cd OSR/server
npm ci
cp .env.example .env
# Set ADMIN_PASSWORD in .env. Never commit passwords.
npm start
```

Open `http://localhost:4000/admin`. Without `DATABASE_URL`, local development
uses SQLite and local files. If you set `DATABASE_URL`, use a separate test Neon
database: starting the server can initialize its OSR schema. No default password
is shipped.

## Tests

```bash
node OSR/osr-website/netlify-build.mjs
npm test --prefix OSR/server
```

Integration tests execute PostgreSQL queries in PGlite (a local PostgreSQL engine)
and use an in-memory media store; they do not connect to your live Neon account.
