import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = path.dirname(fileURLToPath(import.meta.url));

// The dashboard answers on one unguessable path (ADMIN_PATH, default
// /OSRAdminControl2026). The old /admin address is intentionally not served.
// Set ADMIN_PATH in Netlify's build environment to change it; the Express
// server reads the same variable (see OSR/server/app.js).
const ADMIN_PATH = (process.env.ADMIN_PATH || '/OSRAdminControl2026').replace(/\/+$/, '') || '/OSRAdminControl2026';
const adminFolder = ADMIN_PATH.replace(/^\//, '');

fs.rmSync(path.join(siteDir, adminFolder), { recursive: true, force: true });
fs.rmSync(path.join(siteDir, 'admin'), { recursive: true, force: true });
fs.cpSync(path.join(siteDir, '../admin'), path.join(siteDir, adminFolder), { recursive: true });
fs.writeFileSync(path.join(siteDir, '_redirects'), `# Netlify serves the login and dashboard from one admin page, on one
# unguessable path only. Do not route the admin through another file: a legacy
# redirect there can create a loop.
${ADMIN_PATH}          /${adminFolder}/index.html      200!
${ADMIN_PATH}/         /${adminFolder}/index.html      200!
${ADMIN_PATH}/*        /${adminFolder}/index.html      200!
/api/*         /.netlify/functions/cms/:splat 200!
/uploads/*     /.netlify/functions/media/:splat 200!
# The typeface review page is a local check file, never part of the public site.
/font-preview.html  /                      404
/*             /index.html                200
`);
console.log(`[Netlify] Published single-page admin at ${ADMIN_PATH}; API runs on Netlify; CMS data uses Neon.`);
