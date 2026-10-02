import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const siteDir = new URL('../../osr-website/', import.meta.url).pathname;
const read = name => fs.readFileSync(`${siteDir}${name}`);
const html = read('index.html').toString('utf8');
const adminHtml = read('../admin/index.html').toString('utf8');
const svg = read('favicon.svg').toString('utf8');

// The tab icon is the original OSR mark on the tab's own terms: one vector path
// traced from osr-logo-original.png, drawn in institutional red on light browser
// chrome and in a light tint of the same red on dark chrome. It replaced a cream
// mark on a maroon plate — a raster of the whole logo shrunk to 32px, which is
// what made the tab look wrong — so these are the properties worth holding on to.

test('both pages point at the vector mark, with the raster set behind it', () => {
  for (const [name, page] of [['public site', html], ['admin', adminHtml]]) {
    assert.match(page, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"\/>/, `${name} must offer the adaptive vector icon`);
    assert.match(page, /<link rel="icon" href="\/favicon\.ico" sizes="16x16 32x32 48x48"\/>/, `${name} must keep the ICO for Safari, iOS and older clients`);
    assert.match(page, /<link rel="icon" type="image\/png" href="\/favicon-32\.png" sizes="32x32"\/>/, `${name} must keep the 32px PNG fallback`);
    assert.match(page, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png"\/>/, `${name} must keep the home-screen icon`);
    // The plate icon is gone: a shape that has to be read at 16px cannot carry a
    // background of its own and still show the mark.
    assert.doesNotMatch(page, /favicon-[a-z-]*plate/, `${name} must not go back to the plate icon`);
  }
});

test('the vector icon reads the tab it lands on', () => {
  assert.match(svg, /<svg[^>]*viewBox="[-\d. ]+"/, 'the icon needs a viewBox to scale from 16px to a bookmark tile');
  assert.match(svg, /@media\s*\(prefers-color-scheme:\s*dark\)/, 'dark chrome must be answered inside the file, not by a second PNG');
  assert.ok((svg.match(/<path/g) || []).length === 1, 'the mark is one path: the traced logo');
  assert.match(svg, /fill:\s*#A6192E/i, 'light chrome gets institutional red');
  const darkTint = svg.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*\.mark\s*\{\s*fill:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(darkTint, 'the dark rule must recolour the mark');
  // A dark tab needs the mark light: relative luminance above 0.5 means the
  // shape reads as a light mark rather than a dark blob.
  const [r, g, b] = [1, 3, 5].map(i => parseInt(darkTint[1].slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(luminance > 0.5, `${darkTint[1]} is too dark to stand on dark browser chrome (luminance ${luminance.toFixed(2)})`);
});

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('latin1'), 'PNG', 'expected a PNG payload');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('the raster fallbacks are the sizes they claim to be', () => {
  for (const size of [16, 32, 48]) {
    const { width, height } = pngSize(read(`favicon-${size}.png`));
    assert.equal(width, size, `favicon-${size}.png must be ${size}px wide`);
    assert.equal(height, size, `favicon-${size}.png must be ${size}px tall`);
  }
  const touch = pngSize(read('apple-touch-icon.png'));
  assert.equal(touch.width, 180, 'iOS asks for 180px');
  assert.equal(touch.height, 180);
});

test('the ICO carries 16, 32 and 48 so tabs never downscale a 32', () => {
  const ico = read('favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0, 'the ICO header starts with the reserved word');
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 is an icon');
  const count = ico.readUInt16LE(4);
  assert.equal(count, 3, 'three sizes ship in the container');
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = ico.readUInt8(entry) || 256;
    const height = ico.readUInt8(entry + 1) || 256;
    const bytes = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.equal(width, height, 'icons are square');
    assert.equal(pngSize(ico.subarray(offset, offset + 24)).width, width, `the payload at ${offset} must be a ${width}px PNG`);
    assert.ok(offset + bytes <= ico.length, 'every entry stays inside the file');
    sizes.push(width);
  }
  assert.deepEqual(sizes, [16, 32, 48]);
});

test('every committed icon still matches favicon.svg', () => {
  // The generator rasterises favicon.svg into the PNG/ICO set. If the mark in the
  // vector file is edited and the rasters are not rebuilt, Safari and iOS quietly
  // keep the old logo, so `--check` is part of the suite.
  const output = execFileSync(process.execPath, [`${siteDir}tools/make-tab-icons.mjs`, '--check'], { encoding: 'utf8' });
  assert.match(output, /tab icons match favicon\.svg/, 'the committed icons must be the ones the vector path produces');
});
