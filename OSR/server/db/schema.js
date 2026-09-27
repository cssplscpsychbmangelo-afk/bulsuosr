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

  // Seed the first admin only from explicitly configured credentials.
  const adminCount = (await db.prepare('SELECT COUNT(*) as c FROM admins').get()).c;
  if (adminCount === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@osr.bulsu.edu.ph').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    const atIndex = email.indexOf('@');
    if (atIndex <= 0 || !email.slice(atIndex + 1).includes('.') || email.includes(' ')) {
      throw new Error('Set a valid ADMIN_EMAIL before first startup.');
    }
    if (!password || password.length < 12) {
      throw new Error('Set ADMIN_PASSWORD to a unique password of at least 12 characters before first startup.');
    }
    const hash = bcrypt.hashSync(password, 10);
    (await db.prepare('INSERT INTO admins (email, password_hash, name) VALUES (?,?,?)').run(email, hash, 'OSR Administrator'));
    console.log(`[DB] Seeded the initial admin account for ${email}.`);
  } else if (process.env.ADMIN_PASSWORD) {
    // The seed password only applies to an empty admins table. Logging this
    // saves a confusing "Invalid credentials" loop when the server is started
    // against an existing database file.
    console.log(`[DB] ${adminCount} admin account(s) already exist in the database; ADMIN_PASSWORD is ignored on this startup. To recover a lost local password, run: npm run reset:admin -- --confirm`);
  } else {
    console.log(`[DB] Opened existing database at the database (${adminCount} admin account(s)).`);
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
