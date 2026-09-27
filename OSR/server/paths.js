import fs from 'node:fs';
import path from 'node:path';

// Netlify's CJS bundler cannot preserve import.meta.url. Resolve packaged assets
// from the function task root; also support `npm start` from OSR/server locally.
//
// The packaged layout depends on the site's Base directory:
//   Base = repo root -> included_files land in <task>/OSR/osr-website/...
//   Base = "OSR"     -> included_files land in <task>/osr-website/...
//   Local `npm start` from OSR/server -> ../osr-website/...
// Try each candidate instead of assuming one, so a Base directory change cannot
// silently break database seeding (which reads the frontend as its content source).
const candidates = [
  path.join(process.cwd(), 'OSR'),
  process.cwd(),
  path.resolve(process.cwd(), '..'),
];
const hasFrontend = dir => fs.existsSync(path.join(dir, 'osr-website', 'index.html'));
export const osrDir = candidates.find(hasFrontend) || path.resolve(process.cwd(), '..');
export const publicDir = path.join(osrDir, 'osr-website');
export const adminDir = path.join(osrDir, 'admin');
export const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(osrDir, 'server', 'uploads'));
export const frontendSource = path.join(publicDir, 'index.html');
