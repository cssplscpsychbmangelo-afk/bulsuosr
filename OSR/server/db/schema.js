import bcrypt from 'bcryptjs';

export async function initializeDatabase(db) {
  // admins
  (await db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT DEFAULT 'OSR Administrator',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      date TEXT,
      summary TEXT,
      content TEXT,
      external_link TEXT,
      image TEXT,
      status TEXT DEFAULT 'Published' CHECK(status IN ('Draft','Published','Archived')),
      is_featured INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      published_at TEXT
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS board_meetings (
      id TEXT PRIMARY KEY,
      meeting_number TEXT,
      date TEXT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT,
      academic_year TEXT,
      status TEXT DEFAULT 'Published' CHECK(status IN ('Draft','Published','Archived')),
      minutes_link TEXT,
      related_documents TEXT, -- JSON
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS initiatives (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      purpose TEXT,
      status TEXT DEFAULT 'ONGOING' CHECK(status IN ('ONGOING','PLANNED','COMPLETED','ON_HOLD')),
      date TEXT,
      category TEXT,
      image TEXT,
      links TEXT, -- JSON
      status_public TEXT DEFAULT 'Published' CHECK(status_public IN ('Draft','Published','Archived')),
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      file_url TEXT,
      external_link TEXT,
      status TEXT DEFAULT 'Published' CHECK(status IN ('Draft','Published','Archived')),
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      activity TEXT NOT NULL,
      date TEXT,
      day TEXT,
      month TEXT,
      category TEXT,
      iso TEXT,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      description TEXT,
      link TEXT,
      status TEXT DEFAULT 'Published' CHECK(status IN ('Draft','Published','Archived')),
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT,
      content TEXT,
      data TEXT, -- JSON for structured data
      status TEXT DEFAULT 'Published',
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS navigation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      href TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT,
      file_type TEXT,
      size INTEGER,
      url TEXT NOT NULL,
      used_by TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS guide_steps (
      id TEXT PRIMARY KEY,
      page TEXT NOT NULL,
      target_selector TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      step_number INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 1,
      auto_open INTEGER DEFAULT 1,
      first_visit_only INTEGER DEFAULT 1,
      button_label TEXT DEFAULT 'Next',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS pulse_submissions (
      id TEXT PRIMARY KEY,
      allocation TEXT NOT NULL, -- JSON {category: points}
      total_points INTEGER DEFAULT 10,
      period TEXT, -- e.g., 2026-09
      created_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS pulse_aggregates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT,
      category TEXT NOT NULL,
      total_points INTEGER DEFAULT 0,
      response_count INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(period, category)
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      admin_email TEXT,
      action TEXT NOT NULL,
      content_type TEXT,
      content_id TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `));

  (await db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `));

  // ── Standalone admin: no env dependency ──
  // The admin account lives entirely in Neon (or SQLite locally). We seed a
  // default account only when the admins table is empty, so the site works
  // out-of-the-box without ADMIN_EMAIL / ADMIN_PASSWORD env vars.
  // After first login, change credentials from Settings → Account.
  const adminCount = (await db.prepare('SELECT COUNT(*) as c FROM admins').get()).c;
  if (adminCount === 0) {
    const email = 'admin@osr.bulsu.edu.ph';
    const password = 'Admin123456!';
    const hash = bcrypt.hashSync(password, 10);
    try {
      (await db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?,?,?)').run(email, hash, 'OSR Administrator'));
      console.log(`[DB] Seeded default admin ${email} — change password from Settings → Account after first login.`);
    } catch (e) {
      // Race: another cold start seeded first — ignore unique violation
      if (!String(e.message).toLowerCase().includes('duplicate') && !String(e.message).toLowerCase().includes('unique') && !String(e.code).includes('23505')) {
        throw e;
      }
      console.log('[DB] Admin already seeded by concurrent instance');
    }
  } else {
    console.log(`[DB] Found ${adminCount} admin account(s) — standalone mode, no env needed.`);
  }

  // ── Standalone JWT secret: persist in site_settings so sessions survive
  // cold starts even when JWT_SECRET env var is not set (Netlify Functions).
  // This makes the admin self-contained with only DATABASE_URL required.
  try {
    const existingSecret = (await db.prepare('SELECT value FROM site_settings WHERE key=?').get('jwt_secret'))?.value;
    if (!existingSecret) {
      const { randomBytes } = await import('node:crypto');
      const generated = randomBytes(48).toString('hex'); // 96 chars
      (await db.prepare('INSERT INTO site_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO NOTHING').run('jwt_secret', generated));
      if (!process.env.JWT_SECRET) process.env.JWT_SECRET = generated;
      console.log('[DB] Generated persistent jwt_secret in site_settings (standalone mode)');
    } else if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = existingSecret;
      console.log('[DB] Loaded jwt_secret from site_settings into env');
    }
  } catch (e) {
    console.warn('[DB] Could not ensure jwt_secret in site_settings:', e.message);
  }

  // Seed guide_steps if empty
  const guideCount = (await db.prepare('SELECT COUNT(*) as c FROM guide_steps').get()).c;
  if (guideCount === 0) {
    const guides = [
      {id:'g-home-1', page:'home', target_selector:'a[href="#announcements"].btn--red', title:'View announcements', description:'Tap to see verified posts — 6 types.', step_number:1, is_enabled:1},
      {id:'g-home-2', page:'home', target_selector:'.quick a[href="#board-meetings"]', title:'Board Meetings', description:'BOR archive — numbers, minutes, docs.', step_number:2, is_enabled:1},
      {id:'g-home-3', page:'home', target_selector:'.quick a[href="#initiatives"]', title:'Initiatives', description:'Projects — ongoing & completed.', step_number:3, is_enabled:1},
      {id:'g-home-4', page:'home', target_selector:'.quick a[href="#resources"]', title:'Resources', description:'Handbook, policies, support docs.', step_number:4, is_enabled:1},
      {id:'g-home-5', page:'home', target_selector:'.quick a[href="#help"]', title:'Student Help', description:'Raise a concern or contact.', step_number:5, is_enabled:1},
      {id:'g-home-6', page:'home', target_selector:'.dash-stats a[href="#announcements"]', title:'Announcements count', description:'Live total — tap to open archive.', step_number:6, is_enabled:1},
      {id:'g-home-7', page:'home', target_selector:'#dashCalendar', title:'Upcoming calendar', description:'Next events — tap Calendar for full AY 2026-2027.', step_number:7, is_enabled:1},
      {id:'g-about-1', page:'about', target_selector:'#page-about .about-card:first-child', title:'OSR mandate', description:'The mandate — who the Regent represents and what the Office does.', step_number:1, is_enabled:1},
      {id:'g-ann-1', page:'announcements', target_selector:'#annSearch', title:'Search', description:'Type to filter — updates instantly.', step_number:1, is_enabled:1},
      {id:'g-board-1', page:'board-meetings', target_selector:'#boardSearch', title:'Search meetings', description:'Find by title or number.', step_number:1, is_enabled:1},
    ];
    const stmt = db.prepare('INSERT INTO guide_steps (id, page, target_selector, title, description, step_number, is_enabled) VALUES (?,?,?,?,?,?,?)');
    for (const g of guides) (await stmt.run(g.id, g.page, g.target_selector, g.title, g.description, g.step_number, g.is_enabled));
    console.log('[DB] Seeded guide_steps');
  }

  // Seed navigation if empty
  const navCount = (await db.prepare('SELECT COUNT(*) as c FROM navigation_items').get()).c;
  if (navCount === 0) {
    const navs = [
      {label:'Home', href:'#home', order_index:1},
      {label:'Announcements', href:'#announcements', order_index:2},
      {label:'Board Meetings', href:'#board-meetings', order_index:3},
      {label:'Initiatives', href:'#initiatives', order_index:4},
      {label:'Resources', href:'#resources', order_index:5},
      {label:'Calendar', href:'#academic-calendar', order_index:6},
      {label:'Ideal BulSU', href:'#ideal-bulsu', order_index:7},
      {label:'Help', href:'#help', order_index:8},
      {label:'About', href:'#about', order_index:9},
    ];
    const stmt = db.prepare('INSERT INTO navigation_items (label, href, order_index, is_visible) VALUES (?,?,?,1)');
    for (const n of navs) (await stmt.run(n.label, n.href, n.order_index));
    console.log('[DB] Seeded navigation');
  }

}
