# OSR Website — Full Backend + Admin CMS

The project includes a static public website, an Express/SQLite CMS API, and an
admin dashboard. **There is no default admin password in the source.** A fresh
database requires an initial password from `ADMIN_PASSWORD` in the local `.env`
or Render environment settings.

- Public site (local): `http://localhost:4000/`
- Admin login (local): `http://localhost:4000/admin/login.html`
- Production deployment: [`server/DEPLOY.md`](server/DEPLOY.md)

## Architecture
```
Public OSR Website (`osr-website/index.html` + `cms-integration.js`)
  ↓ fetch /api/public/* (published only)
API (Express 4, port 4000)
  ↓ JWT auth, bcrypt, rate-limit, validation
Database (better-sqlite3, WAL)
  ↓ 14 tables: admins, announcements, board_meetings, initiatives, resources, calendar_events, pages, navigation_items, media, guide_steps, pulse_submissions, pulse_aggregates, activity_logs, site_settings

Admin Dashboard (/admin)
  ↓ HttpOnly session cookie (Secure in production)
  ↓ CRUD, draft/published, preview, confirm modals, autosave, search (Ctrl+K), activity log
```

## Features Implemented (per spec)

### 1. Core
- Public displays published only; admin manages drafts via CMS; DB is source of truth; frontend fetches from API.

### 2. Admin Login
- `/admin/login` with email/password, show/hide, remember (30d vs 8h), forgot placeholder, error/loading, logout (clears cookie).

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
- **About/OSR**: Mandate, Vision, Mission, Core Values, Contact, via `pages` table (JSON data)
- **Navigation**: Show/hide, order (drag-drop + Save order), add/remove, validation (href must be #//http), prevents breaking routes

### 13. Media
- Upload image/PDF/doc (10MB, type validation), Delete, Copy URL, Preview, Search, displays filename/type/size/date/usedBy

### 14-15. Pulse Backend
- Anonymous ten-point allocations are validated against the seven categories and stored with derived monthly/all-time aggregates in one transaction. No identifying information is collected.
- Public results contain real submissions only, refresh while the Pulse tab is open, and show a clear empty or unavailable state when there is no live data. No sample aggregates are returned.
- Admin views monthly, yearly, and all-time category totals and response counts, can export aggregate data, and can clear all Pulse submissions and totals after confirmation.

### 16-20. Guide System (Critical Fixes)
- **Glitch fixed**: `improvedPositionGuideTooltip` uses `getBoundingClientRect()` + viewport + scroll + headerH + mobile + resize + hash navigation + modal detection + target visibility.
- Never floats detached, never covers hero unnecessarily (detects `.hero`/cover), never outside viewport, never stuck after navigation (clears on `setRoute`/`hashchange`), never overlaps modal/header, never causes horizontal scroll (`overflow-x:hidden`, `max-width:min(280px, calc(100vw - 20px))`).
- **Admin preview anchoring**: `getPreviewContainer()` detects parent `.preview-container`/`#previewContainer` when in iframe or `?preview`, clamps tooltip to container bounds, hides if target outside container. Guide floats *inside* preview, not admin sidebar.
- **Admin Guide Editor**: `Admin → Site Guide` CRUD per step: Page, Target selector, Title, Description, Step number, Button label, Enabled, Auto open, First-visit. Validates selector (`querySelector` try/catch) → shows “Target element not found” in editor, public gracefully skips invalid.

### 21-26. Preview, Draft/Publish, Confirmations, Autosave, Search, Activity Log
- Every editor has Save Draft/Preview/Publish/Cancel; preview renders inside isolated container/iframe.
- Public only shows `status='Published'`; drafts hidden.
- Destructive actions use custom modal (not `confirm()`): Delete/Unpublish/Archive/Reset → Cancel/Delete.
- Unsaved changes detection: `beforeunload` + modal “You have unsaved changes → Stay/Leave”.
- Global search (`Ctrl/Cmd+K`) across announcements/board/initiatives/resources/calendar.
- Activity log: admin, action, content_type, content_id, details, timestamp; shown on dashboard and `/api/activity`.

### 27-29. Security, DB, API
- No shipped/default admin password or browser-stored auth token. Passwords are hashed with `bcryptjs`; admin sessions use an HttpOnly, SameSite=Lax cookie (Secure in production); protected routes use `authRequired`; login is rate-limited; credentialed CORS and state-changing API Origins are allowlisted; JWT secrets are configured through environment variables.
- **DB**: 13 tables with id, timestamps, created_by, updated_by, foreign keys, WAL.
- **API**: REST clean
  ```
  POST /api/auth/login, /logout, GET /me, PATCH /account
  GET/POST/PATCH/DELETE /api/announcements(/:id) etc for each resource
  GET /api/public/:type (published only)
  POST /api/pulse/submit (anonymous ten-point allocation)
  GET /api/pulse/aggregates (real public aggregates only)
  GET /api/pulse and /api/pulse/export (admin only)
  DELETE /api/pulse/reset (admin only, clears all Pulse data)
  ```
  Admin routes require the HttpOnly `token` cookie (Bearer authentication remains available for API clients); public endpoints return published content and real Pulse aggregates only.

### 30-33. Admin UI, Responsiveness, Error Handling
- Easy to understand, few clicks, clear labels, minimal clutter, mobile drawer (250px → hidden, hamburger), tables→cards, one-column forms, no horizontal overflow, no excessive charts/animations.
- Public remains responsive; admin works desktop/tablet/mobile.
- Every request has Loading/Success/Empty/Error/Unauthorized/Session expired/Network states with human messages.

### 36. Tested
- Public: homepage, dashboard, cover/hero, welcome, guide, nav, mobile, all 8 sections
- Admin: login/logout, change email/password, dashboard, CRUD, draft/publish, preview, media, guide editor, pulse, activity, settings
- Guide: Home→Announcements→Board→Initiatives→Resources→Calendar→Ideal BulSU→Help→About: each shows correctly, in viewport, not covering cover, no header overlap, no drift on scroll/resize, mobile, preview, no horizontal scroll, no duplicates.

## Run Locally

```bash
cd server
npm ci
cp .env.example .env
# Set ADMIN_PASSWORD in .env to a unique password (12+ characters).
npm start # → http://localhost:4000
```

The example uses `server/db/local-osr.db` and `server/uploads/`, both local-only
and ignored by Git. For production deployment, follow
[`server/DEPLOY.md`](server/DEPLOY.md): it configures Render with persistent
SQLite/uploads and connects Netlify using the `OSR_BACKEND_URL` build variable.

## Netlify

The repository-root `netlify.toml` publishes `osr-website/` and generates
redirects from `OSR_BACKEND_URL`. Without that variable Netlify intentionally
serves static fallbacks. With a Render backend URL it proxies `/api/*`,
`/admin/*`, and `/uploads/*` to the CMS. See
[`osr-website/README_NETLIFY.md`](osr-website/README_NETLIFY.md) for the Netlify
side and [`server/DEPLOY.md`](server/DEPLOY.md) for the full deployment steps.

## Guide Positioning Details
- Uses `getBoundingClientRect()` + `window.innerWidth/Height` + `header.offsetHeight` + `window.scrollY`
- Tries below → above → right → left → fallback, then clamps to viewport or preview container
- Detects hero/cover to avoid covering: if `target.closest('.hero')` and `rect.top < headerH+280`, positions below hero or to side
- Listens to `resize` (debounced 80ms) and `scroll` (passive) to re-position; on `setRoute`/`hashchange` clears highlight and hides tooltip to prevent stuck positioning
- Admin preview: `window.top !== window.self` → `top.document.getElementById('previewContainer')` → clamp to `containerRect`

