import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The footer used to be a second sitemap: nine "Explore" links, an address
// block, a phone number, opening hours and two action buttons, all of which the
// header navigation, the Get Help page and the pages themselves already carry.
// It now says three things — who the Office is, the six places worth going next,
// and how to reach it — and the administrator edits only what it prints.

const read = async relative => fs.readFile(new URL(relative, import.meta.url).pathname, 'utf8');

const siteHtml = await read('../../osr-website/index.html');
const integration = await read('../../osr-website/js/cms-integration.js');
const adminHtml = await read('../../admin/index.html');
const settingsRoute = await read('../routes/settings.js');
const seed = await read('../db/seed.js');

const footer = siteHtml.slice(siteHtml.indexOf('<footer class="footer"'), siteHtml.indexOf('</footer>') + '</footer>'.length);

test('the footer carries the identity, six destinations and one way in', () => {
  assert.match(footer, /<h4 id="foName">Office of the Student Regent<\/h4>/, 'the office name is the one value Admin can rewrite');
  assert.match(footer, /class="footer__university">Bulacan State University</, 'and the university it belongs to');
  assert.match(footer, /id="foDescription">Student representation in the Bulacan State University Board of Regents\./, 'one line, not a paragraph');
  assert.match(footer, /<img class="osr-mark osr-mark--footer" src="\/osr-mark\.svg"/, 'the mark identifies the Office');

  const labels = [...footer.matchAll(/data-footer-nav>([^<]+)</g)].map(match => match[1]);
  assert.deepEqual(labels, ['Home', 'Announcements', 'Board Meetings', 'Initiatives', 'Resources', 'About'],
    'the six primary destinations, in the order the site tells its own story');

  assert.match(footer, /<h4>Contact the OSR<\/h4>/);
  assert.match(footer, /id="foEmail" href="mailto:bulsusg1983@gmail.com">bulsusg1983@gmail\.com</, 'the official email');
  assert.match(footer, /id="foFacebook" href="https:\/\/www\.facebook\.com\/BulSUSG1983\/"/, 'the official page');
  assert.match(footer, /id="foMessenger" href="https:\/\/m\.me\/BulSUSG1983"/, 'and the message shortcut to it');
  assert.match(footer, /© <span id="year"><\/span> Office of the Student Regent · Bulacan State University/,
    'the bottom line is the institutional one');
});

test('the footer is not a second sitemap', () => {
  for (const gone of ['Academic Calendar', 'Build Your Ideal BulSU', 'Student Help', 'Track My Concern',
    'Raise a concern', 'Board archive', 'Announcements archive', 'data-footer-action', 'foLine1', 'foPhone', 'foHours']) {
    assert.ok(!footer.includes(gone), `the footer no longer carries "${gone}" — it lives on its own page`);
  }
  const links = [...footer.matchAll(/<a [^>]*>/g)].map(match => match[0]);
  assert.equal(links.length, 9, 'six destinations, an email and two official links: nothing else to click');
});

test('every footer link goes somewhere real', () => {
  const hrefs = [...footer.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(hrefs.length >= 9, 'the footer still links out');
  for (const href of hrefs) {
    if (href.startsWith('#')) {
      const page = href.slice(1);
      assert.ok(siteHtml.includes(`id="page-${page}"`), `${href} must be a page the site actually has`);
      assert.match(footer, new RegExp(`href="${href}" data-nav`), `${href} must route through the site's own router`);
    } else {
      assert.match(href, /^(https:\/\/|mailto:)/, `${href} must be https or a mailto, never a placeholder`);
      assert.ok(!/^https?:\/\/(#+|#|\.)?$/.test(href), `${href} must not be an empty address`);
    }
  }
  assert.ok(!footer.includes('href="#"'), 'no dead link a student can click');
});

test('the footer follows the main navigation instead of keeping its own list', () => {
  assert.match(integration, /function patchNavigation\(/, 'one function writes the navigation');
  assert.match(integration, /a\[data-footer-nav\]/, 'and it keeps the footer in step with it');
  assert.match(integration, /row\.hidden = !visible\.has\(link\.getAttribute\('href'\)\)/,
    'a destination hidden from the navigation leaves the footer too');
  assert.ok(!adminHtml.includes('footer_link'), 'there is no second editor for footer links');
  assert.ok(!/FOOTER_NAV|footerLinks/.test(siteHtml), 'and no second list of them in the page');
});

test('the administrator edits only what the footer prints', () => {
  const groups = adminHtml.slice(adminHtml.indexOf('const CONTACT_GROUPS'), adminHtml.indexOf('const PUBLIC_TEXT_FIELDS'));
  assert.match(groups, /\['Footer', \[/, 'the footer has one group of its own in Contact & details');
  for (const key of ['footer_name', 'footer_description', 'footer_credit', 'contact_email', 'social_facebook', 'social_messenger']) {
    assert.match(groups, new RegExp(`'${key}'`), `${key} is printed by the footer or the contact card, so it stays editable`);
  }
  for (const gone of ['office_hours_short', 'footer_text']) {
    assert.ok(!groups.includes(`'${gone}'`), `${gone} fed a footer line that no longer exists, so the field is gone`);
    assert.ok(!settingsRoute.includes(`'${gone}'`), `${gone} is not offered by the settings API either`);
    assert.ok(!seed.includes(`${gone}:`), `${gone} is not seeded into a fresh database`);
  }
  assert.match(groups, /the six main navigation links/, 'and the admin is told where the footer links come from');

  // The footer's identity and description reach the page through the one config
  // object the site already reads, not through a second copy of the details.
  assert.match(integration, /window\.FOOTER_OFFICE\.name = s\.footer_name/);
  assert.match(integration, /window\.FOOTER_OFFICE\.description = s\.footer_description/);
  assert.match(integration, /window\.renderFooterOffice\(\)/, 'then the footer is drawn again from that one object');
  assert.match(siteHtml, /const FOOTER_OFFICE = \{\n  name:/, 'FOOTER_OFFICE holds what the footer prints');
  assert.ok(!siteHtml.includes('line1: "Student Government'), 'the address block is not part of it any more');
});

test('the footer stays readable and tappable on a phone', () => {
  assert.match(siteHtml, /\.footer__inner\{[^}]*grid-template-columns:minmax\(0,1\.5fr\) minmax\(0,0\.9fr\) minmax\(0,1\.1fr\)/,
    'three columns when there is room for three');
  assert.match(siteHtml, /@media\(max-width:860px\)\{\s*\.footer__inner\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/,
    'two when there is not, with the identity spanning both');
  assert.match(siteHtml, /@media\(max-width:520px\)\{\s*\.footer__inner\{grid-template-columns:minmax\(0,1fr\)\}/,
    'and one on a phone');
  assert.match(siteHtml, /@media \(pointer:coarse\)\{[\s\S]{0,220}?\.footer li a\{display:inline-flex; align-items:center; min-height:44px\}/,
    'a thumb gets a 44px target even though the type stays small');
  assert.match(siteHtml, /\.footer li a\{color:#E8E0D6/, 'links keep the tint verified against the ink background');
  // The site's red focus ring is 2.5:1 on ink, under the 3:1 a focus indicator
  // needs, so the footer turns it white rather than dropping it.
  assert.match(siteHtml, /\.footer a:focus-visible\{outline-color:#fff\}/,
    'the focus ring stays visible against the ink band');
});
