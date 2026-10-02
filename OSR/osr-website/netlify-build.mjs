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

// The committed osr-netlify.zip is the drag-and-drop alternative to a Git
// deploy: whatever is inside it is the whole site for anyone who uploads it.
// It is a snapshot, so it silently goes stale as soon as the source moves —
// that is how a deploy ended up missing the hero work and serving the old tab
// icon. Rebuilding it here means a fresh clone always packs the current site.
//
// Everything the archive packs is listed once, with where it comes from on disk,
// so a file can never be left out of the freshness check (the admin page was,
// once) or packed from somewhere unexpected.
const archive = {
  folders: ['js', adminFolder],
  files: [
    ['index.html', path.join(siteDir, 'index.html')],
    ['js/cms-integration.js', path.join(siteDir, 'js', 'cms-integration.js')],
    ['_redirects', path.join(siteDir, '_redirects')],
    ['_headers', path.join(siteDir, '_headers')],
    ['osr-logo.png', path.join(siteDir, 'osr-logo.png')],
    ['osr-logo-original.png', path.join(siteDir, 'osr-logo-original.png')],
    ['favicon.svg', path.join(siteDir, 'favicon.svg')],
    ['osr-mark.svg', path.join(siteDir, 'osr-mark.svg')],
    ['favicon.ico', path.join(siteDir, 'favicon.ico')],
    ['favicon-16.png', path.join(siteDir, 'favicon-16.png')],
    ['favicon-32.png', path.join(siteDir, 'favicon-32.png')],
    ['favicon-48.png', path.join(siteDir, 'favicon-48.png')],
    ['apple-touch-icon.png', path.join(siteDir, 'apple-touch-icon.png')],
    [`${adminFolder}/index.html`, path.join(siteDir, '..', 'admin', 'index.html')],
    [`${adminFolder}/design-preview.html`, path.join(siteDir, '..', 'admin', 'design-preview.html')],
  ],
};

if (process.env.OSR_SKIP_ZIP !== '1') {
  const { execFileSync } = await import('node:child_process');
  const zipPath = path.join(siteDir, 'osr-netlify.zip');
  const packedAt = fs.existsSync(zipPath) ? fs.statSync(zipPath).mtimeMs : 0;
  const stale = archive.files.filter(([, file]) => fs.statSync(file).mtimeMs > packedAt).map(([name]) => name);
  if (!packedAt || stale.length) {
    fs.rmSync(zipPath, { force: true });
    // The archive holds no secrets — the page, the logo, the icons and the admin
    // page — and `zip` is present on Netlify's build image. If it is missing, say
    // so rather than leaving a stale file behind.
    try {
      execFileSync('zip', ['-q', '-r', '-X', zipPath, ...archive.files.map(([name]) => name), ...archive.folders], { cwd: siteDir });
      console.log(`[Netlify] Rebuilt osr-netlify.zip (${stale.length || 'new'} file(s) moved).`);
    } catch (error) {
      console.warn(`[Netlify] Could not rebuild osr-netlify.zip (${error.message}). Upload the published folder instead.`);
    }
  }
}

console.log(`[Netlify] Published single-page admin at ${ADMIN_PATH}; API runs on Netlify; CMS data uses Neon.`);
