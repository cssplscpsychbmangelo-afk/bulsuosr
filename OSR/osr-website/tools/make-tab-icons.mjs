/**
 * Brand assets, built from favicon.svg.
 *
 * favicon.svg holds the original OSR mark as one vector path, so nothing here
 * is redrawn by hand: this script rasterises that same path into the PNG and
 * ICO fallbacks that Safari, iOS and older clients read, writes the mark as a
 * standalone file for use in the page (osr-mark.svg), and keeps every file's
 * colour role explicit in one place.
 *
 *   node tools/make-tab-icons.mjs           # write the files
 *   node tools/make-tab-icons.mjs --check   # fail if the committed files differ
 *
 * Requires sharp (dev-only). The published site never runs this: the build only
 * copies the folder, and the icons are committed alongside the page.
 *
 *   npm install --prefix OSR          # once, pulls sharp
 *   npm run icons --prefix OSR        # write the files
 *   npm run icons:check --prefix OSR  # verify they still match favicon.svg
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, '..');
const checkOnly = process.argv.includes('--check');

/** Institutional red — DESIGN.md's primary accent, the mark's own colour.
 *
 *  There is deliberately no second "dark mode" PNG pair. Dark chrome is handled
 *  inside favicon.svg, which swaps the fill for a light tint of the same red
 *  through a prefers-color-scheme query; that single file is the documented
 *  route, and it cannot misfire. A duplicated dark PNG would have to be picked
 *  by a `media="(prefers-color-scheme: dark)"` link, and browsers that ignore
 *  `media` there would happily pick the light mark for a light tab — the one
 *  outcome worse than a plain icon. Rasters here stay one colour: the ICO is
 *  what Safari, iOS and legacy clients read, and it has to hold its own on
 *  either chrome without asking which one it is on. */
const RED = '#A6192E';
/** Home-screen plate. iOS masks the corners and does not keep transparency, so
 *  the icon carries the site's own warm paper instead of an invented colour. */
const PAPER = '#F7F5F2';
/** How much of a square icon the mark spans, and the roomier frame iOS wants. */
const FILL = 0.92;
const TOUCH_FILL = 0.72;

const { default: sharp } = await import('sharp').catch(() => {
  console.error('sharp is required: npm install --prefix OSR');
  process.exit(1);
});

const svgSource = fs.readFileSync(path.join(siteDir, 'favicon.svg'), 'utf8');
const viewBox = (svgSource.match(/viewBox="([^"]+)"/) || [])[1];
const pathData = (svgSource.match(/<path[^>]*\sd="([^"]+)"/) || [])[1];
if (!viewBox || !pathData) throw new Error('favicon.svg must expose a viewBox and one path');
const [vx, vy, vw, vh] = viewBox.trim().split(/\s+/).map(Number);

/** The mark centred on a square canvas, spanning `fill` of its width. */
function markSvg(size, { fill, tint, plate }) {
  const frame = vw / fill;
  const padding = (frame - vw) / 2;
  const originX = vx - padding;
  const originY = vy - padding;
  const background = plate ? `<rect x="${originX}" y="${originY}" width="${frame}" height="${frame}" fill="${plate}"/>` : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${originX} ${originY} ${frame} ${frame}">` +
      background +
      `<path fill="${tint}" fill-rule="evenodd" d="${pathData}"/>` +
    `</svg>`
  );
}

/** The mark at its natural 1036x695 proportions, for laying out on a card. */
const markAtWidth = (width, tint) => {
  const height = Math.round((width * vh) / vw);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${vx} ${vy} ${vw} ${vh}">` +
      `<path fill="${tint}" fill-rule="evenodd" d="${pathData}"/>` +
    `</svg>`
  );
};

// The social card: what a shared link shows. No lettering, on purpose — every
// unfurler prints the page's own title and description next to the image, and
// type baked into the picture would only duplicate it in whatever font the
// reader's platform substitutes. It is the mark, the paper and the red rule the
// rest of the site uses, and nothing else.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OG_MARK_WIDTH = 560;
async function socialCard() {
  const mark = await sharp(markAtWidth(OG_MARK_WIDTH, RED)).png().toBuffer();
  const markHeight = Math.round((OG_MARK_WIDTH * vh) / vw);
  const rule = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="10"><rect width="${OG_WIDTH}" height="10" fill="${RED}"/></svg>`
  );
  return sharp({ create: { width: OG_WIDTH, height: OG_HEIGHT, channels: 4, background: PAPER } })
    .composite([
      { input: rule, top: 0, left: 0 },
      // Optically centred: a hair above the middle reads as centred, exact
      // centring reads as low.
      { input: mark, top: Math.round((OG_HEIGHT - markHeight) / 2) - 12, left: Math.round((OG_WIDTH - OG_MARK_WIDTH) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const raster = (size, options) => sharp(markSvg(size, options)).png({ compressionLevel: 9 }).toBuffer();

/** ICO is a small container: one header, one 16-byte entry per image, then the
 *  images themselves. Every browser that reads an .ico reads PNG payloads, so
 *  the sizes here are exactly the PNGs above. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(image => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size >= 256 ? 0 : image.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(image => image.data)]);
}

const files = new Map();

// The mark as the page uses it: the same path, always institutional red, and
// deliberately without the tab icon's prefers-color-scheme rule. A tab has to
// answer the browser's chrome; a logo sitting on the site's own white paper must
// not change colour because the operating system is in dark mode.
files.set(
  'osr-mark.svg',
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="Office of the Student Regent">` +
      `\n  <title>Office of the Student Regent — Bulacan State University</title>` +
      `\n  <!-- The OSR mark from osr-logo-original.png, the same traced path favicon.svg` +
      `\n       carries. Used in the page header, footer, menu, welcome card and admin` +
      `\n       instead of the full stacked lockup, whose wordmark is illegible at logo` +
      `\n       sizes. Generated by tools/make-tab-icons.mjs — edit that file, not this. -->` +
      `\n  <path fill="${RED}" fill-rule="evenodd" d="${pathData}"/>` +
    `\n</svg>\n`
  )
);

for (const size of [16, 32, 48]) {
  files.set(`favicon-${size}.png`, await raster(size, { fill: FILL, tint: RED }));
}
files.set(
  'apple-touch-icon.png',
  await raster(180, { fill: TOUCH_FILL, tint: RED, plate: PAPER })
);
files.set('og-image.png', await socialCard());
files.set(
  'favicon.ico',
  ico(await Promise.all([16, 32, 48].map(async size => ({ size, data: await raster(size, { fill: FILL, tint: RED }) }))))
);

let changed = 0;
for (const [name, data] of files) {
  const target = path.join(siteDir, name);
  const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
  const same = current && crypto.createHash('sha256').update(current).digest('hex') === crypto.createHash('sha256').update(data).digest('hex');
  if (same) continue;
  changed += 1;
  if (checkOnly) {
    console.error(`stale: ${name} does not match favicon.svg — run node tools/make-tab-icons.mjs`);
    continue;
  }
  fs.writeFileSync(target, data);
  console.log(`wrote ${name} (${data.length} bytes)`);
}

if (checkOnly && changed) process.exit(1);
console.log(
  checkOnly
    ? 'tab icons match favicon.svg'
    : changed
      ? `${changed} file(s) rebuilt from favicon.svg`
      : 'tab icons already up to date'
);
