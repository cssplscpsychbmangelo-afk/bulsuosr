import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const siteDir = new URL('../../osr-website/', import.meta.url).pathname;

// osr-netlify.zip is the drag-and-drop alternative to a Git deploy: it is the
// whole published site for anyone who uploads it instead of connecting the repo.
// It is a snapshot, and it had gone stale — a deploy from it served an older page
// with none of the latest work on it, and the old tab icon. netlify-build.mjs
// rebuilds it on every build; this reads the committed archive the way Netlify
// would and checks it really is the site in this repository.

/** Minimal ZIP reader: central directory → local header → inflate. */
function unzip(buffer) {
  const files = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  assert.ok(end >= 0, 'the archive must have an end-of-central-directory record');
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, 'central directory entry signature');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, 'local header signature');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const archivePath = `${siteDir}osr-netlify.zip`;
const zip = unzip(fs.readFileSync(archivePath));
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

test('the drag-and-drop bundle holds the site that is in this repository', () => {
  // The page and its scripts are the parts that change; if the archive's copy
  // differs from the source, a hand-uploaded deploy would publish an old site.
  for (const name of ['index.html', 'js/cms-integration.js', '_redirects', '_headers']) {
    const packed = zip.get(name);
    assert.ok(packed, `${name} must be in the bundle`);
    assert.equal(digest(packed), digest(fs.readFileSync(`${siteDir}${name}`)),
      `${name} in the bundle must match the source — run node OSR/osr-website/netlify-build.mjs to refresh the archive`);
  }
  // The tab icon travels with it, so a hand-uploaded deploy gets the new identity too.
  for (const name of ['favicon.svg', 'osr-mark.svg', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png']) {
    const packed = zip.get(name);
    assert.ok(packed, `${name} must be in the bundle`);
    assert.equal(digest(packed), digest(fs.readFileSync(`${siteDir}${name}`)),
      `${name} in the bundle must match the source — run node OSR/osr-website/netlify-build.mjs to refresh the archive`);
  }
  // And the admin, on the unguessable path the build publishes it under, so the
  // uploaded bundle still has a working dashboard behind it.
  const adminFolder = (process.env.ADMIN_PATH || '/OSRAdminControl2026').replace(/^\//, '');
  const adminPage = zip.get(`${adminFolder}/index.html`);
  assert.ok(adminPage, `the bundle must carry the admin page at ${adminFolder}/`);
  assert.equal(digest(adminPage), digest(fs.readFileSync(`${siteDir}../admin/index.html`)),
    'the bundled admin must match the source — run node OSR/osr-website/netlify-build.mjs to refresh the archive');
});
