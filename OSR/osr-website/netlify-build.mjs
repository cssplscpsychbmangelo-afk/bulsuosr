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

// Sources the drag-and-drop zip is rebuilt from, relative to siteDir.
const indexHtmlPath = path.join(siteDir, 'index.html');
const cmsPath = path.join(siteDir, 'js', 'cms-integration.js');
const faviconPath = path.join(siteDir, 'favicon.svg');

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
if (process.env.OSR_SKIP_ZIP !== '1') {
  const { execFileSync } = await import('node:child_process');
  const zipPath = path.join(siteDir, 'osr-netlify.zip');
  const stale = [indexHtmlPath, cmsPath, faviconPath].filter(file => {
    const newest = fs.statSync(file).mtimeMs;
    return !fs.existsSync(zipPath) || fs.statSync(zipPath).mtimeMs < newest;
  });
  if (stale.length) {
    fs.rmSync(zipPath, { force: true });
    const entries = ['index.html', 'osr-logo.png', 'osr-logo-original.png', 'favicon.svg', 'favicon.ico',
      'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'js',
      '_redirects', '_headers', adminFolder];
    // The archive holds no secrets — index.html, the logo, the icons, the icons'
    // generator output and the admin page — and `zip` is present on Netlify's
    // build image. If it is missing, say so rather than shipping a stale file.
    try {
      execFileSync('zip', ['-q', '-r', '-X', zipPath, ...entries], { cwd: siteDir });
      console.log(`[Netlify] Rebuilt osr-netlify.zip (${stale.length} newer source file(s)).`);
    } catch (error) {
      console.warn(`[Netlify] Could not rebuild osr-netlify.zip (${error.message}). Upload the published folder instead.`);
    }
  }
}

console.log(`[Netlify] Published single-page admin at ${ADMIN_PATH}; API runs on Netlify; CMS data uses Neon.`);
