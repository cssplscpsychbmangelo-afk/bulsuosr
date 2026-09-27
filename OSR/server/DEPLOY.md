# Deploy /admin with Netlify + Neon (no Render)

Netlify serves the website, admin pages, and API functions. Your existing Neon
Postgres database stores CMS content and accounts. Netlify Blobs stores uploaded
files. No Render service, separate backend host, or paid disk is required.

## One-time setup

1. Deploy this repository using Netlify's **Git integration**. Leave **Base
   directory** empty. The root `netlify.toml` supplies the build command, publish
   directory, function directory, and Node 22 selection.
2. In Netlify → Site configuration → Environment variables, set these for the
   production context and **Functions** scope (or all scopes):

   | Variable | Required | Value |
   |---|---|---|
   | `DATABASE_URL` | ✅ | Your Neon **pooled** Postgres connection string, with SSL enabled |
   | `JWT_SECRET` | ✅ | A persistent random string of at least 32 characters |

   That's the minimum. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are optional — the
   default admin account is created automatically on first startup.

   Copy the connection string directly from Neon. It must not contain Markdown
   links, `mailto:`, surrounding backticks, or HTML `&amp;` in place of `&`.
   The database role must be able to create a schema and tables.

   Generate a session secret locally with:
   `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`.
   Never put passwords or connection strings in Git, HTML, or chat.
3. Remove the obsolete `OSR_BACKEND_URL` variable if present. It is not used.
4. Trigger a fresh deployment. Visit `/admin/login.html` and sign in with:

   - **Email:** `admin@osr.bulsu.edu.ph`
   - **Password:** `Admin123456!`

5. Go to **Settings → Account** to change your email and password immediately.

The first API call initializes the private `osr` Postgres schema and content in
one transaction. A database advisory lock prevents concurrent cold starts from
creating duplicate accounts/content. The first request can take longer while
Neon wakes and the initial content is seeded.

## Verify after deployment

- `/admin` displays the login, not "backend not connected."
- `/api/health` returns `{"ok":true,...}` after the database is ready.
- Sign in with the default credentials, create a draft, publish it, check in a
  logged-out browser.
- Upload a small PNG/PDF in Media and open its `/uploads/...` URL.
- Redeploy and confirm published content, account changes, and uploads remain.

## Troubleshooting

- **503 with "JWT_SECRET is missing"** — set `JWT_SECRET` (32+ characters) in
  Netlify environment variables with Functions scope, then redeploy.
- **503 with "DATABASE_URL is missing"** — set `DATABASE_URL` to your Neon
  pooled connection string in Netlify environment variables.
- **503 with "Cannot connect to the database"** — verify the `DATABASE_URL` is
  correct and the Neon database is running.
- **503 with "Database authentication failed"** — wrong username/password in
  `DATABASE_URL`. Update it in Netlify and redeploy.
- **503 with another message** — read it; it tells you exactly what failed.
- **401 on login** — make sure you're using the default credentials above.
  If you changed them and forgot, there is no public password-reset bypass.
- **429** — wait 15 minutes for the login rate limit to reset.
- **Missing functions/admin files** — deploy through Git with the repository-root
  config. Drag-and-drop of the public folder cannot deploy the API.

## Local development

```bash
cd OSR/server
npm ci
cp .env.example .env
# Edit .env if needed (or leave defaults), then:
npm start
```

Default login: `admin@osr.bulsu.edu.ph` / `Admin123456!`

Leave `DATABASE_URL` empty for local SQLite. Set it only to a dedicated test
Neon database if you want to test Postgres locally.