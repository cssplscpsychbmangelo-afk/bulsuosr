import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sitePath = new URL('../../osr-website/index.html', import.meta.url).pathname;
const html = fs.readFileSync(sitePath, 'utf8');

test('the Pulse explorer ships six labelled views that all have a panel', () => {
  const nav = html.match(/<div id="pulseViewNav"[\s\S]*?<\/div>/);
  assert.ok(nav, 'the Pulse view navigation must exist');
  const tabs = [...nav[0].matchAll(/data-pview="([a-z]+)"[^>]*aria-controls="([^"]+)"/g)].map(match => ({ view: match[1], panel: match[2] }));
  assert.deepEqual(tabs.map(tab => tab.view), ['period', 'monthly', 'yearly', 'trend', 'history', 'share']);
  for (const tab of tabs) {
    assert.match(nav[0], new RegExp(`role="tab"[^>]*data-pview="${tab.view}"`), `${tab.view} must be a tab`);
    assert.match(html, new RegExp(`id="${tab.panel}"[^>]*role="tabpanel"`), `${tab.panel} must be a tabpanel`);
  }
  // Every panel is reachable with the keyboard, and only one starts visible.
  assert.equal((nav[0].match(/aria-selected="true"/g) || []).length, 1);
  assert.ok((html.match(/role="tabpanel"[^>]*hidden/g) || []).length >= 5, 'inactive views start hidden');
});

test('the Pulse explorer labels periods in words and steps through them', async () => {
  const sandbox = pulseSandbox();
  const { pulseRows, select, view } = sandbox;

  // Three months of stored submissions.
  view.pulseApplyRemoteAggregates(pulseRows, true);

  assert.equal(sandbox.window.__pulseUI.views.length, 6);
  assert.match(view.pulsePeriodLabel('2026-09'), /September 2026/);
  assert.match(view.pulsePeriodLabel('2026-01'), /January 2026/);
  assert.equal(view.pulsePeriodLabel('not-a-period'), 'not-a-period');

  // The period view opens on the newest period and can walk backwards.
  const periodSelect = select('pulsePeriodSelect');
  assert.equal(periodSelect.options.length, 3);
  assert.equal(periodSelect.value, '2026-09');
  assert.match(periodSelect.innerHTML, /July 2026 · 2 builds/);
  assert.equal(select('pulsePeriodNext').disabled, true, 'the newest period has nothing after it');
  assert.equal(select('pulsePeriodPrev').disabled, false);
  assert.match(select('pulsePeriodTakeaway').innerHTML, /September 2026/);
  assert.match(select('pulsePeriodTakeaway').innerHTML, /learning|Learning/i);

  sandbox.window.__pulseUI.setPeriod('2026-07');
  assert.equal(select('pulsePeriodPrev').disabled, true, 'the oldest period has nothing before it');
  assert.equal(select('pulsePeriodNext').disabled, false);
  assert.match(select('pulsePeriodMeta').textContent, /Period 1 of 3/);
  assert.match(select('pulsePeriodSelect').value, /2026-07/);

  // The step buttons move the same selection.
  view.pulseStepPeriodBy(1);
  view.pulseRenderPeriodView();
  assert.equal(select('pulsePeriodSelect').value, '2026-08');
});

test('the Pulse explorer explains shares, changes and history in words', async () => {
  const sandbox = pulseSandbox();
  const { view, select } = sandbox;
  view.pulseApplyRemoteAggregates(sandbox.pulseRows, true);

  // Overview strip answers "how much data is there?" without any clicking.
  const overview = select('pulseOverviewStats').innerHTML;
  assert.match(overview, /Periods tracked/);
  assert.match(overview, /July 2026 → September 2026/);
  assert.match(overview, /Builds recorded/);
  assert.match(overview, /Top priority so far/);

  // Monthly view: chips, human label and a month-over-month comparison.
  const monthSelect = select('pulseMonthSelect');
  monthSelect.value = '2026-09';
  view.pulseRenderMonthlyView();
  assert.match(monthSelect.innerHTML, /August 2026 · 4 builds/);
  assert.match(select('pulseMonthlyMeta').textContent, /month 3 of 3/);
  assert.match(select('pulseMonthlyTakeaway').innerHTML, /September 2026/);
  assert.match(select('pulseMonthlyChange').innerHTML, /Change versus August 2026/);
  assert.match(select('pulseMonthlyChange').innerHTML, /pulse-mover/);
  assert.equal(select('pulseMonthNext').disabled, true);

  // Yearly view reads as a sentence, not a bare code.
  assert.match(select('pulseYearSelect').innerHTML, /2026/);
  assert.match(select('pulseYearlyTakeaway').innerHTML, /2026/);

  // History lists every period, newest first, and marks the newest.
  const history = select('pulseHistoryBody').innerHTML;
  const order = [...history.matchAll(/pulse-table__period">([A-Za-z]+ 2026)/g)].map(match => match[1]);
  assert.deepEqual(order, ['September 2026', 'August 2026', 'July 2026']);
  assert.match(history, /LATEST/);
  assert.equal(select('pulseHistoryToggle').hidden, true, 'six or fewer periods need no disclosure control');
  assert.match(select('pulseHistoryMeta').textContent, /3 periods · 11 builds/);

  // Trend view: chips for now / highest / lowest plus a plain sentence.
  select('pulseTrendSelect').value = 'learning';
  view.pulseRenderTrend();
  const trend = select('pulseTrendTakeaway').innerHTML;
  assert.match(trend, /Learning/);
  assert.match(trend, /September 2026/);
  assert.match(trend, /Across 3 months with data/);
  assert.match(select('pulseTrendSummary').innerHTML, /Highest:/);
  assert.match(select('pulseTrendChart').innerHTML, /<svg/);

  // Share view explains what the snapshot is and how to use it.
  assert.match(select('pulseSnapshotPeriod').textContent, /September 2026/);
  assert.match(select('pulseSnapshotTakeaway').innerHTML, /Snapshot of the newest period/);
});

test('the Pulse explorer stays useful with no data and with one period', async () => {
  const sandbox = pulseSandbox();
  const { view, select } = sandbox;

  view.pulseApplyRemoteAggregates([], true);
  assert.match(select('pulseOverviewStats').innerHTML, /No builds yet/);
  assert.match(select('pulsePeriodEmpty').innerHTML, /No student submissions/);
  assert.equal(select('pulsePeriodPrev').disabled, true);
  assert.equal(select('pulsePeriodNext').disabled, true);
  assert.equal(select('pulseHistoryToggle').hidden, true);

  view.pulseApplyRemoteAggregates([sandbox.pulseRows[0], sandbox.pulseRows[1]], true);
  assert.match(select('pulseOverviewStats').innerHTML, /Started July 2026/);
  assert.match(select('pulseMonthlyChange').innerHTML, /nothing before it to compare|second month/);

  // Disclosing more periods is a real toggle.
  const many = [];
  for (const month of ['01', '02', '03', '04', '05', '06', '07', '08']) {
    many.push({ period: `2026-${month}`, category: 'learning', response_count: 2, total_points: 8 });
  }
  view.pulseApplyRemoteAggregates(many, true);
  assert.equal(select('pulseHistoryToggle').hidden, false);
  assert.equal((select('pulseHistoryBody').innerHTML.match(/<tr/g) || []).length, 6, 'six rows until the visitor asks for more');
  assert.match(select('pulseHistoryToggle').textContent, /Show all 8 periods/);
  sandbox.window.__pulseUI.expandHistory(true);
  assert.equal((select('pulseHistoryBody').innerHTML.match(/<tr/g) || []).length, 8);
  assert.match(select('pulseHistoryToggle').textContent, /Show fewer/);
});

// ── Test harness ────────────────────────────────────────────────────────────
// The Pulse logic is plain browser JavaScript inside index.html. Extract that
// block, give it a tiny DOM, and drive it exactly like the page does.
function pulseSandbox() {
  const elements = new Map();
  const makeElement = id => {
    const classes = new Set();
    const element = {
      id,
      innerHTML: '',
      textContent: '',
      hidden: false,
      disabled: false,
      value: '',
      tabIndex: 0,
      dataset: {},
      style: {},
      placeholder: '',
      classList: {
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle: (name, force) => { if (force === undefined) force = !classes.has(name); if (force) classes.add(name); else classes.delete(name); return force; },
        contains: name => classes.has(name)
      },
      setAttribute() {},
      getAttribute: () => null,
      focus() {},
      scrollIntoView() {},
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => [],
      appendChild() {}
    };
    // A real <select> keeps `options` in step with its markup and
    // `selectedIndex` in step with `value`; the renderers rely on both.
    Object.defineProperty(element, 'options', {
      get: () => [...String(element.innerHTML).matchAll(/<option value="([^"]*)"/g)].map(match => ({ value: match[1] }))
    });
    Object.defineProperty(element, 'selectedIndex', {
      get: () => Math.max(0, element.options.map(option => option.value).indexOf(element.value)),
      set: index => { const values = element.options.map(option => option.value); if (values[index] !== undefined) element.value = values[index]; }
    });
    return element;
  };
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  const start = html.indexOf('const PULSE_CATEGORIES = [');
  const end = html.indexOf('// prevent exceeding 10 already handled via disabled plus');
  assert.ok(start > 0 && end > start, 'the Pulse script block must be findable');
  const source = `(function(){
    const safeGet = () => null;
    const safeSet = () => {};
    const safeRemove = () => {};
    const toast = () => {};
    function escapeHtml(value){
      return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[character]);
    }
    ${html.slice(start, end)}
    }
    pulseBind();
    return {
      pulseApplyRemoteAggregates, pulseRenderPeriodView, pulseRenderMonthlyView, pulseRenderYearlyView,
      pulseRenderTrend, pulseRenderHistory, pulseRenderSnapshot, pulseRenderOverviewStats,
      pulsePeriodLabel, pulseStepPeriodBy, pulseGetPeriod, pulseAllPeriods, pulseBind
    };
  })();
  `;

  const sandboxStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const listeners = {};
  const window = {
    addEventListener: (name, handler) => { (listeners[name] ||= []).push(handler); },
    dispatchEvent: () => {},
    __pulseUI: null
  };
  const context = {
    window,
    document: {
      getElementById,
      querySelector: () => null,
      querySelectorAll: selector => (selector === '#pulseViewNav .pulse-viewtab' ? VIEW_TABS : []),
      createElement: () => makeElement('created'),
      addEventListener: () => {},
      hidden: false
    },
    localStorage: sandboxStorage,
    sessionStorage: sandboxStorage,
    navigator: { clipboard: { writeText: async () => {} } },
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async () => { throw new Error('offline'); },
    Intl,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Promise,
    Set,
    Map,
    URLSearchParams,
    isNaN,
    parseInt,
    parseFloat
  };
  context.globalThis = context;
  const view = vm.runInNewContext(source, context, { filename: 'osr-website/index.html#pulse' });
  window.__pulseUI = window.__pulseUI || view;

  const select = id => getElementById(id);
  const pulseRows = [
    { period: '2026-07', category: 'learning', response_count: 2, total_points: 9 },
    { period: '2026-07', category: 'campus', response_count: 2, total_points: 5 },
    { period: '2026-07', category: 'wellbeing', response_count: 2, total_points: 6 },
    { period: '2026-08', category: 'learning', response_count: 4, total_points: 14 },
    { period: '2026-08', category: 'campus', response_count: 4, total_points: 12 },
    { period: '2026-08', category: 'mobility', response_count: 4, total_points: 8 },
    { period: '2026-09', category: 'learning', response_count: 5, total_points: 12 },
    { period: '2026-09', category: 'campus', response_count: 5, total_points: 16 },
    { period: '2026-09', category: 'studentVoice', response_count: 5, total_points: 11 }
  ];
  return { view, window, select, pulseRows };
}

// Minimal tab elements: the sandbox's navigation code only reads dataset and
// classList on them.
const VIEW_TABS = ['period', 'monthly', 'yearly', 'trend', 'history', 'share'].map(view => ({
  dataset: { pview: view },
  classList: { add() {}, remove() {}, toggle() {}, contains: () => view === 'period' },
  setAttribute() {},
  focus() {},
  addEventListener() {}
}));
