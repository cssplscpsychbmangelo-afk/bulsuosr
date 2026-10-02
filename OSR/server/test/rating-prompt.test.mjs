import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const siteHtml = fs.readFileSync(new URL('../../osr-website/index.html', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../../admin/index.html', import.meta.url), 'utf8');

// Regression: submitting a rating printed the same sentence twice — once in the
// form's own status line and again as a floating toast on top of it. Repeated
// taps stacked copies over each other, and the "Send rating" button stayed live
// while the request was in flight, so one student could post several ratings.
test('one rating produces one prompt: the form status is never repeated as a toast', () => {
  const handler = siteHtml.match(/document\.getElementById\("helpFeedbackForm"\)\?\.addEventListener\("submit"[\s\S]*?\n\}\);/);
  assert.ok(handler, 'the rating submit handler must exist');
  assert.doesNotMatch(handler[0], /toast\(/, 'the rating form must not raise a floating toast as well');
  assert.match(handler[0], /ratingSending=true/, 'a submission must lock the button while the request is in flight');
  assert.match(handler[0], /if\(ratingSending\) return;/);
  // The success card and the concern card already report their own result.
  assert.doesNotMatch(siteHtml, /toast\("Concern submitted/);
});

test('toasts de-duplicate, skip inline status text, and stay inside the viewport', () => {
  const toastFn = siteHtml.match(/function toast\(msg\)\{[\s\S]*?\n\}/);
  assert.ok(toastFn, 'the site toast helper must exist');
  assert.match(toastFn[0], /toastState/, 'toasts are tracked so the same sentence cannot stack');
  assert.match(toastFn[0], /toastInlineOwner\(text\)/, 'a sentence already shown in a form status is not repeated');
  assert.match(siteHtml, /function toastInlineOwner\(text\)/);
  // The toast stack keeps a width cap so a long sentence never runs off a phone.
  assert.match(siteHtml, /\.toast-wrap\{[^}]*width:min\(420px, calc\(100vw - 24px\)\)/);
  assert.match(siteHtml, /\.toast\{[^}]*max-width:100%/);
});

test('the dashboard toast list never shows the same sentence twice', () => {
  const toastFn = adminHtml.match(/function toast\(message\) \{[\s\S]*?\n\}/);
  assert.ok(toastFn, 'the admin toast helper must exist');
  assert.match(toastFn[0], /host\.children\]\.some\(/, 'identical toasts are skipped while one is still visible');
});

// Regression: /admin pre-filled the email field with a placeholder account and
// the browser could restore saved credentials into both fields. The sign-in
// form must open empty, with autocomplete off.
test('admin sign-in never pre-adds an email or password', () => {
  const email = adminHtml.match(/<input id="loginEmail"[^>]*>/);
  const pass = adminHtml.match(/<input id="loginPass"[^>]*>/);
  assert.ok(email && pass, 'both sign-in fields must exist');
  assert.doesNotMatch(email[0], /value=/, 'the email field must not ship a value');
  assert.doesNotMatch(pass[0], /value=/, 'the password field must not ship a value');
  assert.match(email[0], /autocomplete="off"/);
  assert.match(pass[0], /autocomplete="off"/);
  assert.match(adminHtml, /<form id="loginFormBox" class="auth-form" autocomplete="off">/);
  assert.match(adminHtml, /function clearLoginForm\(\)/, 'a helper must blank both fields');
  assert.match(adminHtml, /checkAuthAndSetup\(\)[\s\S]*?clearLoginForm\(\)/, 'the boot path must blank restored credentials');
  assert.doesNotMatch(adminHtml, /\$\('#loginEmail'\)\.value = data\.email/, 'creating an account must not pre-fill the next sign-in');
  assert.match(adminHtml, /function showAuth\(mode = 'login'\)/);
});

// Regression: the Service ratings screen was rendered as wide tables inside a
// grid column, so on a phone the whole page scrolled sideways and stats were
// cut off. Sections now cap their column and the responses table becomes cards.
test('the admin service ratings screen is built for a phone', () => {
  assert.match(adminHtml, /\.section\.is-active\{display:grid;gap:18px;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(adminHtml, /\.section\.is-active>\*\{min-width:0\}/);
  assert.match(adminHtml, /@media\(max-width:680px\)\{[\s\S]*?\.report-bar__range\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(adminHtml, /@media\(max-width:680px\)\{[\s\S]*?\.rating-table--responses thead\{display:none\}/);
  assert.match(adminHtml, /@media\(max-width:680px\)\{[\s\S]*?\.rating-stat--hero\{grid-column:1\/-1\}/);
  // Long archives open in chunks instead of laying out every card at once.
  assert.match(adminHtml, /const RESPONSE_CHUNK = 50;/);
  assert.match(adminHtml, /data-more-responses/);
  assert.match(adminHtml, /list\.slice\(0, responseLimit\)/);

  // Every response cell carries the label its card view prints, and the table
  // keeps the wrapper that scrolls it if the card layout is ever bypassed.
  const responses = adminHtml.match(/<table class="rating-table rating-table--responses">[\s\S]*?<\/table>/);
  assert.ok(responses, 'the responses table must exist');
  assert.ok((responses[0].match(/data-label="/g) || []).length >= 6, 'every response cell needs its card label');
  for (const label of ['Date', 'Service', 'Rating', 'Comment']) {
    assert.match(adminHtml, new RegExp(`<td[^>]*data-label="${label}"`), `${label} card row must keep its label`);
  }
  assert.match(adminHtml, /<td data-label="Student">/, 'the student cell keeps its label too');
  assert.match(adminHtml, /data-label="Actions"><button[^>]*data-rating-delete/, 'Delete stays reachable in the card view');
  assert.match(adminHtml, /<div class="table-wrap table-wrap--cards"><table class="rating-table rating-table--responses">/);
});

// The public About page used to read like a work-in-progress ("Easy to update",
// "[Name — to be supplied]", "Replace with verified dates…"). It now carries
// pre-written wording in the site's own voice.
test('the About page shows finished wording, not template notes', () => {
  assert.doesNotMatch(siteHtml, /Easy to update/i);
  assert.doesNotMatch(siteHtml, /\[Name[^\]]*to be supplied\]/i);
  assert.doesNotMatch(siteHtml, /Intentionally empty/i);
  assert.doesNotMatch(siteHtml, /Replace with verified/i);
  assert.doesNotMatch(siteHtml, /Replaces the original/i);
  assert.match(siteHtml, /<span class="ab-hero__badge" id="aboutBadge">Student representation<\/span>/);
  assert.match(siteHtml, /id="aboutIntro">The Office of the Student Regent is the student voice/);
  assert.match(siteHtml, /id="aboutSrName">To be announced</);
});
