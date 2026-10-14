import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Nothing that opens the office's database or its dashboard is allowed to sit
// in this repository. It is public: a connection string committed here has been
// published, and no amount of deleting the line afterwards takes it back — the
// only cure is rotating the credential at the provider.
//
// So the repository is scanned on every `npm test`, and the build fails on the
// first string that looks like a live credential. This is the guard that was
// missing: the Neon connection string reached `main` through two READMEs and
// stayed there until someone read the whole file.

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

// Files the scanner reads. `git ls-files` — the committed tree, not the working
// copy — because an untracked file cannot leak through a push.
const tracked = () => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n').map(line => line.trim()).filter(Boolean);

// Binaries are not readable as text and carry no credentials.
const isText = name => !/\.(png|jpe?g|gif|ico|zip|woff2?|ttf|otf|pdf|mp4|webp)$/i.test(name);

// Each rule: what it is, the pattern, and the file it must never appear in.
// Patterns are written to catch a real credential and to leave the placeholders
// the docs use (`USER:PASSWORD`, `npg_xxx`, `user:pass`) alone.
const RULES = [
  {
    name: 'a database connection string carrying a password',
    pattern: /postgres(?:ql)?:\/\/[^\s`'"]*:[^\s`'"]*@/i,
    allow: value => /USER:PASSWORD|user:pass@|npg_xxx@|<[a-z_-]+>/i.test(value),
    note: 'connection strings belong in Netlify env vars or OSR/server/.env, never in Git',
  },
  {
    name: 'the published Neon endpoint of this project',
    pattern: /ep-[a-z0-9]+-pooler\.[a-z0-9-]+\.aws\.neon\.tech/i,
    allow: value => /EP-NAME-pooler\.REGION/i.test(value),
    note: 'the endpoint identifies the database; only the placeholder belongs in docs',
  },
  {
    name: 'a Neon password',
    pattern: /npg_[A-Za-z0-9]{16,}/,
    allow: () => false,
    note: 'rotate it in Neon first — deleting the line does not un-publish it',
  },
  {
    name: 'the default administrator password the site used to ship',
    pattern: /Admin123456!/,
    allow: () => false,
    note: 'the site seeds no default account; a documented password is an open door',
  },
  {
    name: 'an AWS access key id',
    pattern: /AKIA[0-9A-Z]{16}/,
    allow: () => false,
  },
  {
    name: 'a Google API key',
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    allow: () => false,
  },
  {
    name: 'a GitHub personal access token',
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}/,
    allow: () => false,
  },
  {
    name: 'a Slack token',
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/,
    allow: () => false,
  },
  {
    name: 'a private key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    allow: () => false,
  },
];

function scan() {
  const hits = [];
  for (const file of tracked()) {
    if (!isText(file)) continue;
    // This file has to be able to name the strings it hunts for, so it is the
    // one place a pattern is allowed to appear literally.
    if (file.endsWith('test/no-secrets.test.mjs')) continue;
    const full = path.join(repoRoot, file);
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, index) => {
      for (const rule of RULES) {
        const match = line.match(rule.pattern);
        if (!match) continue;
        if (rule.allow && rule.allow(match[0])) continue;
        hits.push({ file, line: index + 1, rule: rule.name, note: rule.note || '' });
      }
    });
  }
  return hits;
}

test('no credential is committed to the repository', () => {
  const hits = scan();
  assert.deepEqual(
    hits.map(hit => `${hit.file}:${hit.line} — ${hit.rule}`),
    [],
    hits.length
      ? `found ${hits[0].rule} at ${hits[0].file}:${hits[0].line}. ${hits[0].note}\n` +
        'Rotate the credential at the provider first: this repository is public, so a committed\n' +
        'secret is already published and removing the line does not take it back.'
      : ''
  );
});

test('the environment files Git keeps are placeholders only', () => {
  // .env is ignored; .env.example is committed precisely because it is safe to
  // publish. Every value in it must be empty or obviously fake.
  const example = fs.readFileSync(path.join(repoRoot, 'OSR/server/.env.example'), 'utf8');
  const assignments = example.split('\n')
    .map(line => line.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map(match => ({ key: match[1], value: match[2].trim() }));
  assert.ok(assignments.length > 0, 'the example file still documents the variables');
  for (const { key, value } of assignments) {
    if (/URL|SECRET|PASSWORD|TOKEN|KEY/.test(key)) {
      assert.ok(
        value === '' || /^(USER:PASSWORD|xxx|…|\.\.\.|<.*>)$/i.test(value),
        `${key} in .env.example must be empty or a placeholder, not a real value`
      );
    }
  }
  assert.match(example, /ADMIN_EMAIL=\n/, 'and it must not carry a usable administrator email');
});

test('.gitignore keeps every shape of the environment file out of Git', () => {
  const ignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  for (const pattern of ['.env', '.env.*', '*.pem', '*.key']) {
    assert.ok(
      new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(ignore),
      `.gitignore must ignore ${pattern}`
    );
  }
  assert.match(ignore, /!\.env\.example/, 'while still committing the placeholder example');
});
