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

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Your Neon **pooled** Postgres connection string, with SSL enabled |
   | `ADMIN_EMAIL` | Your initial administrator email |
   | `ADMIN_PASSWORD` | A unique initial password of at least 12 characters |
   | `JWT_SECRET` | A persistent random string of at least 32 characters |

   Copy the connection string directly from Neon. It must not contain Markdown
   links, `mailto:`, surrounding backticks, or HTML `&amp;` in place of `&`.
   The database role must be able to create a schema and tables.

   Generate a session secret locally with:
   `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`.
   Never put passwords or connection strings in Git, HTML, or chat. Rotate any
   database password that has previously been shared or exposed.
3. Remove the obsolete `OSR_BACKEND_URL` variable if present. It is not used.
4. Trigger a fresh deployment of the branch containing these changes. Visit
   `/admin` and sign in. `/admin/login` and `/admin/login.html` also work.
5. Change the password under **Settings → Account** if desired. Environment
   credentials seed the first account only; editing them later does not reset it.

The first API call initializes the private `osr` Postgres schema and content in
one transaction. A database advisory lock prevents concurrent cold starts from
creating duplicate accounts/content. Later deploys check the migration version
rather than resetting data. The first request can take longer while Neon wakes
and the initial content is seeded; subsequent requests reuse a small connection
pool. Keep `JWT_SECRET` stable or existing sessions will be invalidated.

Blobs connects using the function's Netlify-provided credentials. There is no
separate media-service account or manually created Blobs token to configure.

## Verify after deployment

- `/admin` displays the login, not “backend not connected.”
- `/api/health` returns `{"ok":true,...}` after the database is ready.
- Sign in, create a draft, publish it, and check in a logged-out browser.
- Upload a small PNG/PDF in Media and open its `/uploads/...` URL.
- Redeploy and confirm published content, account changes, and uploads remain.

Tests use a local PostgreSQL engine and mock media storage. They do not provision
or contact your production database. The deployed Netlify → Neon connection must
still be smoke-tested after deployment.

## Persistence and isolation

Content/accounts/aggregate data are relational tables in `osr`, not a SQLite
snapshot or browser localStorage. Parameterized asynchronous queries are used
throughout the CMS. Transactions pin statements to one connection (including
Pulse submissions/aggregates and schema initialization). Login throttling is
stored in Neon so it persists across function cold starts and instances.

Existing `public`-schema tables are untouched. Prefer a dedicated Neon database
or branch for OSR; never point deploy previews or automated tests at live data.
Use a separate Netlify test site for test media, since `osr-media` is site-wide.

Data from an older SQLite/Render/Blobs-snapshot deployment is **not automatically
migrated**. Back it up before retiring any old service. Neon backups cover database
records, not uploaded files; back up the Netlify `osr-media` store separately.
The local `reset:admin` command only affects local SQLite, not production Neon.

## Upload and hosting limits

Uploads are limited to **3 MB each**, keeping encoded payloads below Netlify
function limits. Supported formats: JPEG, PNG, WebP, PDF, DOC, DOCX, TXT. SVG/HTML
uploads are not accepted. Larger resources can use a hosted URL instead.
Database metadata and blob storage are separate systems; a storage/DB failure
may leave an orphaned file that needs cleanup. They are not one shared transaction.

Both Netlify and Neon plan, credit, function, bandwidth, and storage limits still
apply. This removes the Render requirement, not usage accounting. Review your
accounts' limits and configure usage alerts.

## Troubleshooting

- 503: verify `DATABASE_URL`, `JWT_SECRET`, and the initial `ADMIN_PASSWORD` are
  available to **Functions**, not just the build. Redeploy after changing them.
  Check function logs and the Neon project's status/role permissions. Never
  paste connection strings into logs or support chat.
- 401 on login: use the account currently stored in `osr.admins`, not a newly
  edited seed password. There is intentionally no public password-reset bypass.
- 429: wait for the 15-minute login attempt window to expire.
- Missing functions/admin files: deploy through Git with the repository-root
  config. Drag-and-drop of the public folder/old ZIP cannot deploy the API.
- Use Node 22.16+ (22.x) locally. Production uses Postgres; only the optional
  local SQLite mode uses `node:sqlite`.

## Local development

```bash
cd OSR/server
npm ci
cp .env.example .env
# Fill ADMIN_PASSWORD, then:
npm start
```

Leave `DATABASE_URL` empty for local SQLite and files. Set it only to a dedicated
test Neon database if you want to test Postgres connectivity locally. Local media
still uses the filesystem; production media uses Netlify Blobs.
