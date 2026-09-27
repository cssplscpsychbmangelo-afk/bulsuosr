import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = path.dirname(fileURLToPath(import.meta.url));
fs.cpSync(path.join(siteDir, '../admin'), path.join(siteDir, 'admin'), { recursive: true });

// Simple, valid redirects — single /admin page (Neon standalone)
// /admin and /admin/* both serve the single-page admin (which handles login/setup inline)
// API and media go to Functions, everything else to public index.html
fs.writeFileSync(path.join(siteDir, '_redirects'), `# Netlify redirects — standalone admin
/admin    /admin/index.html  200!
/admin/   /admin/index.html  200!
/admin/*  /admin/index.html  200!
/api/*    /.netlify/functions/cms/:splat  200!
/uploads/*  /.netlify/functions/media/:splat  200!
/*        /index.html  200
`);
console.log('[Netlify] Published /admin as single page; API via Functions; DB via Neon (only DATABASE_URL required).');
