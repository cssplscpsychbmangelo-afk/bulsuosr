import fs from 'node:fs';
import path from 'node:path';

// Netlify's CJS bundler cannot preserve import.meta.url. Resolve packaged assets
// from the function task root; also support `npm start` from OSR/server locally.
const rootCandidate = path.join(process.cwd(), 'OSR');
export const osrDir = fs.existsSync(path.join(rootCandidate, 'osr-website', 'index.html'))
  ? rootCandidate
  : path.resolve(process.cwd(), '..');
export const publicDir = path.join(osrDir, 'osr-website');
export const adminDir = path.join(osrDir, 'admin');
export const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(osrDir, 'server', 'uploads'));
export const frontendSource = path.join(publicDir, 'index.html');
