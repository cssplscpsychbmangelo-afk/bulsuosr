# OSR Website — Full Backend + Admin CMS (Neon Standalone)

The project includes a static public website, an Express CMS API (Neon in production, SQLite locally), and an
admin dashboard that is **fully standalone with only Neon**.

- **Only required env var in production:** `DATABASE_URL` (Neon pooled URL)
- **No `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `JWT_SECRET` env vars required** — admin credentials live in Neon, JWT secret is auto-generated and persisted in `site_settings.jwt_secret`.
- Public site (local): `http://localhost:4000/`
- Admin login (local): `http://localhost:4000/admin`
- Production deployment: [`server/DEPLOY.md`](server/DEPLOY.md)

## Standalone Admin (like https://rcloudcssp2.netlify.app/admin)

Reference: rCloud CSSP LSC admin uses only Neon. This OSR admin now does the same:

1. **DB-only credentials** — `admins` table in Neon. No env var.
   - Fresh DB auto-seeds `admin@osr.bulsu.edu.ph / Admin123456!` OR you can create the first admin from the `/admin` setup form (`/api/auth/setup`).
2. **JWT secret persistence** — On first migration, a random 96-char secret is generated and stored as `site_settings.jwt_secret`. `process.env.JWT_SECRET` is populated from DB, so sessions survive Netlify cold starts without env config.
3. **Only DATABASE_URL required in Netlify Functions env** — set it with Functions scope and redeploy. No need to set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`.
4. **Setup flow** — `GET /api/auth/setup-status` tells login page if DB has 0 admins → shows setup form. `POST /api/auth/setup` creates first admin without auth (blocked after first admin exists).

## Architecture
```
Public OSR Website (`osr-website/index.html` + `cms-integration.js`)
  ↓ fetch /api/public/* (published only)
API (Netlify Functions; Express 5 on port 4000 locally)
  ↓ JWT auth (secret from DB), bcrypt, rate-limit, validation
Database (Neon Postgres in production; Node SQLite locally)
  ↓ 14 tables: admins, announcements, board_meetings, initiatives, resources, calendar_events, pages, navigation_items, media, guide_steps, pulse_submissions, pulse_aggregates, activity_logs, site_settings

Admin Dashboard (/admin)
  ↓ HttpOnly session cookie (Secure in production)
  ↓ CRUD, draft/published, preview, confirm modals, autosave, search (Ctrl+K), activity log
```

## Features Implemented (per spec)

### 1. Core
- Public displays published only; admin manages drafts via CMS; DB is source of truth; frontend fetches from API.

### 2. Admin Login
- `/admin` has the email/password sign-in, show/hide, remember (30d vs 8h), setup, error/loading, and logout (clears cookie).
- Standalone: detects if no admin → shows setup form to create first admin in Neon.

### 3. Admin Account
- `Admin → Settings → Account`: change email (current+new+confirm) and password (current+new+confirm) with strength indicator (0-4), confirmation modal, success/error toast, new JWT issued, session handling.

### 4-5. Dashboard
- Clean institutional sidebar, Dashboard overview cards (Published/Draft Announcements, Upcoming Board, Active Initiatives, Resources, Upcoming Calendar, Pulse Responses, Last Updated) + Recent Activity (who/what/when).

### 6-12. Content Management
All sections support Create/Edit/Delete, Draft/Published/Archived, Preview, Save/Cancel.
- **Announcements**: Title, Category, Date, Summary, Content, Link, Attachment, Featured, Status
- **Board Meetings**: Number, Date, Title, Description, Tags, Type, AcademicYear, Documents, Links
- **Initiatives**: Title, Description, Purpose, Status (ONGOING/PLANNED/COMPLETED/ON_HOLD), Date, Category, Image, Links
- **Resources**: Title, Description, Category (editable), File URL/PDF, External link, Publish
- **Calendar**: Title, Date, Start/End, Category, Location, Link, Attachment, Add/Edit/Delete/Duplicate, auto-reflects public
- **About/OSR**: Mandate, Vision, Mission, Core Values, Student Regent, Directors, office information, featured programs and official links, edited in *Admin → About OSR* and stored as one JSON document in `site_settings.about_content` (`GET /api/about/public`, `PATCH /api/about`). Empty fields keep the wording built into the public page.
- **Navigation**: Show/hide, order (drag-drop + Save order), add/remove, validation (href must be #//http), prevents breaking routes

### 13. Media
- Upload image/PDF/doc (10MB, type validation), Delete, Copy URL, Preview, Search, displays filename/type/size/date/usedBy

### 14-15. Pulse Backend
- Anonymous ten-point allocations are validated against the seven categories and stored with derived monthly/all-time aggregates in one transaction. No identifying information is collected.
- Public results contain real submissions only, refresh while the Pulse tab is open, and show a clear empty or unavailable state when there is no live data. No sample aggregates are returned.
- Admin views monthly, yearly, and all-time category totals and response counts, can export aggregate data, and can clear all Pulse submissions and totals after confirmation.

### 16-20. Guide System
- Uses `getBoundingClientRect()` + viewport + scroll + headerH + mobile + resize + hash navigation + modal detection + target visibility.
- Never floats detached, never covers hero unnecessarily, never outside viewport, never stuck after navigation, never overlaps modal/header, never causes horizontal scroll.
- Admin preview anchoring: clamps tooltip to container bounds, hides if target outside container.

### 21-26. Preview, Draft/Publish, Confirmations, Autosave, Search, Activity Log
- Every editor has Save Draft/Preview/Publish/Cancel; preview renders inside isolated container/iframe.
- Public only shows `status='Published'`; drafts hidden.
- Destructive actions use custom modal (not `confirm()`).
- Unsaved changes detection: `beforeunload` + modal.
- Global search (`Ctrl/Cmd+K`) across announcements/board/initiatives/resources/calendar.
- Activity log: admin, action, content_type, content_id, details, timestamp.

### 27-29. Security, DB, API
- No shipped/default admin password in source required for operation, but default seed exists for convenience and can be changed. Passwords hashed with `bcryptjs`; sessions use HttpOnly SameSite=Lax cookie (Secure in production); JWT secret persisted in DB, not required in env; login rate-limited; CORS allowlisted.
- **DB**: 14 tables with id, timestamps, created_by, etc.
- **API**: REST clean
  ```
  POST /api/auth/login, /logout, GET /me, PATCH /account
  GET /api/auth/setup-status, POST /api/auth/setup (first admin, no auth)
  GET/POST/PATCH/DELETE /api/announcements(/:id) etc
  GET /api/public/:type (published only)
  GET /api/about/public, PATCH /api/about (public About page content)
  POST /api/pulse/submit, GET /api/pulse/aggregates, etc
  ```

### 30-33. Admin UI, Responsiveness, Error Handling
- Easy to understand, few clicks, clear labels, minimal clutter, mobile drawer, tables→cards, one-column forms, no horizontal overflow.
- Public remains responsive; admin works desktop/tablet/mobile.
- Every request has Loading/Success/Empty/Error/Unauthorized/Session expired/Network states.

## Run Locally

```bash
cd OSR/server
npm ci
cp .env.example .env
# Edit .env and set DATABASE_URL to your Neon URL (or leave empty for SQLite)
npm start # → http://localhost:4000
# Login: admin@osr.bulsu.edu.ph / Admin123456!  OR use setup form if fresh DB
```

Local uses `server/db/local-osr.db` and `server/uploads/` when DATABASE_URL empty.

## Netlify (Standalone)

Use repository-root `netlify.toml` with empty base directory. `/admin` is published directly; API runs on Netlify Functions, data lives in Neon, media in Netlify Blobs. No Render needed.

**Required env var (Functions scope):**
- `DATABASE_URL` — Neon pooled connection string (only one required)

**Optional:**
- `JWT_SECRET` — if not set, auto-generated and persisted in `site_settings.jwt_secret` (sessions survive cold starts)
- `ALLOWED_ORIGINS` — for cross-origin API if public site on different domain

**No longer required:**
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` — ignored, admin lives in DB.

Set `DATABASE_URL` in Netlify → Site settings → Environment variables → Functions scope, then redeploy. See `server/DEPLOY.md`.

## Neon Connection (provided)

The connection string you provided can be set as `DATABASE_URL` in Netlify. Locally, put it in `OSR/server/.env`. The admin will auto-migrate and seed.

Example `.env`:
```
DATABASE_URL=postgresql://neondb_owner:npg_I87tszbCRuwf@ep-little-smoke-b5vq9v7q-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

## Guide Positioning Details
- Uses `getBoundingClientRect()` + `window.innerWidth/Height` + `header.offsetHeight` + `window.scrollY`
- Tries below → above → right → left → fallback, then clamps to viewport or preview container
- Detects hero/cover to avoid covering
- Listens to `resize` (debounced 80ms) and `scroll` (passive) to re-position; on `setRoute`/`hashchange` clears highlight
- Admin preview: `window.top !== window.self` → clamp to `containerRect`
