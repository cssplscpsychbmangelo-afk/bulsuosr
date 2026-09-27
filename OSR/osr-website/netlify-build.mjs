import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = path.dirname(fileURLToPath(import.meta.url));
fs.cpSync(path.join(siteDir, '../admin'), path.join(siteDir, 'admin'), { recursive: true });
fs.writeFileSync(path.join(siteDir, '_redirects'), `# Netlify serves the admin and API without a separate host.
/admin         /admin/login.html          200!
/admin/        /admin/index.html          200!
/admin/login   /admin/login.html          200!
/api/*         /.netlify/functions/cms/:splat 200!
/uploads/*     /.netlify/functions/media/:splat 200
/admin/*       /admin/index.html          200
/*             /index.html                200
`);
console.log('[Netlify] Published /admin; API runs on Netlify; CMS data uses Neon.');
