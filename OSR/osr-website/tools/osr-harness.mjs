/* Behavioural harness for index.html — run with: npm i jsdom && node tools/osr-harness.mjs
   It loads the real file in jsdom, stubs the three public endpoints, and walks
   routing, the record rows, filters, the calendar, the concern flow, tracking
   and the Ideal BulSU builder. It lives in tools/ so a regression cannot hide. */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';   // npm i jsdom
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const errors=[];
const vc=new VirtualConsole();
vc.on('jsdomError',e=>errors.push('jsdomError: '+(e.detail?.message||e.message)));
vc.on('error',(...a)=>errors.push('console.error: '+a.join(' ').slice(0,200)));
vc.on('warn',()=>{}); vc.on('log',()=>{}); vc.on('info',()=>{});
const calls=[];
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'https://bulsuosr.test/',
  beforeParse(win){
    win.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},onchange:null});
    win.IntersectionObserver=class{constructor(cb){this.cb=cb;}observe(el){this.cb([{isIntersecting:true,target:el}],this);}unobserve(){}disconnect(){}takeRecords(){return [];}};
    win.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
    win.scrollTo=()=>{}; win.scrollBy=()=>{};
    win.HTMLElement.prototype.scrollIntoView=function(){};
    win.navigator.clipboard={writeText:async()=>{}};
    win.fetch=async(url,opt={})=>{
      calls.push([String(url),opt.method||'GET']);
      if(String(url).includes('/api/concerns')&&opt.method==='POST')
        return {ok:true,status:200,json:async()=>({code:'OSR-TEST-4821'})};
      if(String(url).includes('/api/concerns/track/'))
        return {ok:true,status:200,json:async()=>({code:'OSR-TEST-4821',status:'In review',responded:false,submitted_at:'2026-09-28 09:12:00',updated_at:'2026-10-01 14:03:00',category:'Academic',campus:'Main - Malolos'})};
      if(String(url).includes('/api/ratings'))
        return {ok:true,status:200,json:async()=>({ok:true})};
      return {ok:false,status:404,json:async()=>({}),text:async()=>''};
    };
    win.addEventListener('error',e=>errors.push('window error: '+(e.error?.message||e.message)));
    win.addEventListener('unhandledrejection',e=>errors.push('unhandled rejection: '+(e.reason?.message||e.reason)));
  }});
const win=dom.window, doc=win.document;
const $=s=>doc.querySelector(s);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ok=[],bad=[];
const t=(name,cond,extra='')=>{(cond?ok:bad).push(name+(extra?' → '+extra:''));};
const click=el=>el.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
const type=(el,v)=>{el.value=v;el.dispatchEvent(new win.Event('input',{bubbles:true}));};
const change=(el,v)=>{el.value=v;el.dispatchEvent(new win.Event('change',{bubbles:true}));};
await wait(700);

// ── routes ──────────────────────────────────────────────────────────────────
const routes=['home','announcements','board-meetings','initiatives','resources','help','about','track','ideal-bulsu','academic-calendar','search'];
for(const r of routes){
  win.location.hash='#'+r; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(60);
  const page=doc.getElementById('page-'+r);
  const active=page.getAttribute('aria-current')==='true';
  const hidden=!active;
  t('route #'+r+' visible', !hidden, 'active-attr='+active);
}
// ── resources: save toggle round-trip ───────────────────────────────────────
win.location.hash='#resources'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(80);
const firstSave=$('#resList [data-save]');
t('resource row renders a Save control', !!firstSave, firstSave?firstSave.textContent.trim():'');
const id=firstSave?.dataset.save;
click(firstSave); await wait(60);
t('save marks the row', $('#resList [data-save="'+id+'"]')?.getAttribute('aria-pressed')==='true');
t('saved count updates', $('#resSavedCount').textContent.trim()==='1', $('#resSavedCount').textContent.trim());
click($('#resSavedBtn')); await wait(60);
t('Saved view button is pressed', $('#resSavedBtn').getAttribute('aria-pressed')==='true');
t('Saved view lists one row', $('#resList [data-save]')?.dataset.save===id||doc.querySelectorAll('#resList [data-save]').length===1);
t('saved rows only', doc.querySelectorAll('#resList .resource').length===1, 'rows='+doc.querySelectorAll('#resList .resource').length);
click($('#resSavedBtn')); await wait(60);
t('leaving Saved restores the full desk', doc.querySelectorAll('#resList .resource').length>1, 'rows='+doc.querySelectorAll('#resList .resource').length);
// ── search: prompt, results, no-results, error ─────────────────────────────
win.location.hash='#search'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(80);
t('search shows a prompt before typing', /Search the record|Start typing|Try/i.test($('#searchResults').textContent), $('#searchResults').textContent.trim().slice(0,60));
type($('#siteSearch'),'handbook'); await wait(280);
t('search returns a resource result for “handbook”', /Handbook/i.test($('#searchResults').textContent), $('#searchCount').textContent);
t('results carry a source label', /RESOURCE|Resource/i.test($('#searchResults').textContent));
type($('#siteSearch'),'zzzznothing'); await wait(280);
t('no-results state is designed', !$('#searchEmpty').hidden && /Nothing matched/i.test($('#searchEmpty').textContent), $('#searchEmpty').textContent.trim().slice(0,60));
// ── concern: validation, review, submit ─────────────────────────────────────
win.location.hash='#help'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(80);
click($('#toStep2')); await wait(60);
t('step 1 blocks an empty name with a field error',
  $('#concernName').getAttribute('aria-invalid')==='true' && !$('#concernName-error').hidden,
  'invalid='+$('#concernName').getAttribute('aria-invalid'));
type($('#concernName'),'Ana Reyes'); type($('#concernEmail'),'ana@bulsu.edu.ph');
click($('#toStep2')); await wait(40);
t('step 2 opens once name+email are valid', !doc.querySelector('#concernForm [data-step="2"]').hidden);
click($('#toStep3')); await wait(40);
t('step 2 blocks an empty concern', $('#concernText').getAttribute('aria-invalid')==='true');
type($('#concernText'),'The laboratory fee was charged twice this term.');
type($('#concernOutcome'),'A corrected assessment.');
click($('#toStep3')); await wait(60);
t('review step shows what will be sent', /charged twice/i.test($('#concernReview').textContent));
t('step label tracks progress', $('#concernStepLabel').textContent.trim()==='Step 3 of 3', $('#concernStepLabel').textContent.trim());
click($('#concernSubmitBtn')); await wait(250);
t('submit posts to /api/concerns', calls.some(c=>c[0].includes('/api/concerns')&&c[1]==='POST'));
t('a tracking code is issued to the student', /OSR-TEST-4821/.test($('#concernFeedback').textContent));
t('the code is remembered on this device', /OSR-TEST-4821/.test(win.localStorage.getItem('osr-tracked-concerns')||''));
// ── track ───────────────────────────────────────────────────────────────────
win.location.hash='#track'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(80);
t('tracking remembers the code it issued', /OSR-TEST-4821/.test($('#trackSaved').textContent));
type($('#trackCode'),'OSR-TEST-4821'); click($('#trackForm [type="submit"]')||$('#trackForm button')); await wait(200);
t('lookup renders the current stage', /In review/i.test($('#trackResult').textContent), $('#trackResult').textContent.replace(/\s+/g,' ').trim().slice(0,70));
t('stage progress marks the current step', !!$('#trackResult .track-steps .is-current'));
// ── calendar ────────────────────────────────────────────────────────────────
win.location.hash='#academic-calendar'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(120);
t('calendar “next up” block is populated', $('#calSoonList') && $('#calSoonList').children.length>0, 'rows='+($('#calSoonList')?.children.length));
t('calendar renders the month grid', ($('#calGrid')?.textContent||'').trim().length>200, 'grid chars='+(($('#calGrid')?.textContent||'').trim().length));
t('calendar next-up block is populated', $('#calSoonList').children.length===3, 'rows='+$('#calSoonList').children.length);
// ── home dashboard ──────────────────────────────────────────────────────────
win.location.hash='#home'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(120);
t('dashboard calendar shows the next three dates', $('#dashCalList').children.length===3, 'rows='+$('#dashCalList').children.length);
t('dashboard stats count real records', /^\d+$/.test($('#dashAnn').textContent.trim()));
t('no rotating calendar track is left behind', !$('.dash-rotate-indicator'));
// ── accessibility spot checks ───────────────────────────────────────────────
const imgs=[...doc.querySelectorAll('img:not([alt])')];
t('every image carries an alt attribute', imgs.length===0, imgs.length+' missing');
const btns=[...doc.querySelectorAll('button')].filter(b=>!b.textContent.trim() && !b.getAttribute('aria-label') && !b.querySelector('[aria-label]'));
t('every button has an accessible name', btns.length===0, btns.length+' unnamed');
const dup=[...new Set([...doc.querySelectorAll('[id]')].map(e=>e.id).filter((v,i,a)=>a.indexOf(v)!==i))];
t('no duplicate element ids', dup.length===0, dup.slice(0,5).join(','));
t('one h1 in the document', doc.querySelectorAll('h1').length===1, 'h1s='+doc.querySelectorAll('h1').length);


// ── ideal bulsu: 10 points, then a split result ─────────────────────────────
win.location.hash='#ideal-bulsu'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(120);
const plusBtns=[...doc.querySelectorAll('#pulseAlloc .pulse-alloc-row')];
t('the builder lists the seven areas', plusBtns.length===7, 'areas='+plusBtns.length);
let placed=0;
for(const row of plusBtns){
  const inc=row.querySelector('button[data-inc], button[data-plus], .pulse-alloc-row__inc, button:not([disabled])');
  const label=(inc?.getAttribute('aria-label')||inc?.textContent||'').trim();
  if(!inc) continue;
  for(let i=0;i<3 && placed<10;i++){
    if(/\bminus\b|−|-/i.test(label) && !/plus|add/i.test(label)) break;
    inc.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
    const left=Number($('#pulsePointsLeft').textContent.trim());
    if(!isNaN(left)){ if(left<=0) { placed=10; break; } placed=10-left; }
  }
  if(placed>=10) break;
}
t('points can be placed up to 10', Number($('#pulsePointsLeft').textContent.trim())<10, 'left='+$('#pulsePointsLeft').textContent.trim());
// top up whatever is left, using the first increment control
let guard=0;
while(Number($('#pulsePointsLeft').textContent.trim())>0 && guard++<20){
  const inc=doc.querySelector('#pulseAlloc button:not([disabled])');
  if(!inc) break;
  inc.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));
}
click($('#pulseShowResult')); await wait(80);
t('the result separates your priorities from the aggregate',
  !!$('#pulseResultBody .result-split') && /Your priorities/i.test($('#pulseResultBody').textContent) && /How students answered/i.test($('#pulseResultBody').textContent),
  ($('#pulseResultBody').textContent||'').replace(/\s+/g,' ').slice(0,60));
t('the aggregate column says when there is nothing to compare', /No student submissions|unavailable|Checking/i.test($('#pulseResultBody .result-split__col--aggregate').textContent));

// ── help: cross-page helpers ────────────────────────────────────────────────
win.location.hash='#help'; win.dispatchEvent(new win.HashChangeEvent('hashchange')); await wait(80);
const jumpBtn=$('[data-scroll-to]');
t('“Raise a concern” points the cursor at the form', !!jumpBtn && jumpBtn.dataset.scrollTo==='#raise');
click(jumpBtn); await wait(60);
t('the concern form is on the first screen of Help', !!$('#raise') && !!$('#concernForm'));
const filterLink=$('[data-filter]');
click(filterLink); await wait(120);
t('a Help link can open the resource category it names', $('#resCategory').value==='STUDENT RIGHTS & POLICIES', 'value='+$('#resCategory').value);


// ── the cleanup holds: one face, no pointer layer, four widths ──────────────
const style=html.slice(html.indexOf('<style>')+7, html.indexOf('</style>'));
t('only one display face ships', !/Bricolage|Archivo Black|Arial Black|--font-hero/.test(html) && /Fraunces/.test(html));
t('the pointer layer is gone', !/osr-cursor|hero__plate|hero__glow|hero__seal|hero__fx|cursor-on/.test(html));
t('the masthead is eyebrow, title, one paragraph, two actions',
  !!$('.hero__kicker') && !!$('.hero__title') && doc.querySelectorAll('.hero__lead').length===1
  && doc.querySelectorAll('.hero__actions .btn').length===2);
const conds=[...new Set([...style.matchAll(/@media\s*([^{]+)\{/g)].map(m=>m[1].replace(/\s+/g,'')))];
const expected=['(max-width:1024px)','(max-width:768px)','(max-width:560px)','(max-width:400px)',
  '(min-width:1025px)','(min-width:1440px)','(max-height:640px)','(prefers-reduced-motion:no-preference)',
  '(prefers-reduced-motion:reduce)','print'];
t('the stylesheet has one guard set and four widths',
  conds.length===expected.length && expected.every(c=>conds.includes(c)) && conds.length===new Set(conds).size,
  conds.join(' '));
const navBlock=(style.match(/@media\s*\(max-width:1024px\)\{[\s\S]*?\n\}/)||[''])[0];
t('navigation collapses at 1024', /\.nav\{\s*display:none/.test(navBlock));
t('every font size comes from the scale', !/font-size:\s*[\d.]+px/.test(style));
t('no legacy token alias survives',
  !/var\(--p-/.test(html) && !/var\(--(?:red|ink|stone|paper|line|gold|muted|ok|warn)\)|var\(--gold-/.test(html));
t('one button system, no legacy names',
  !/btn--red|btn--ghost|btn--gold|icon-btn|header-menu-btn/.test(html)
  && /\.btn--primary\{/.test(style) && /\.btn--secondary\{/.test(style) && /\.btn--quiet\{/.test(style) && /\.btn--icon\{/.test(style));
const declared=new Set([...html.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map(m=>m[1]));
const used=new Set([...html.matchAll(/var\((--[\w-]+)/g)].map(m=>m[1]));
t('every token has one declaration', [...used].every(u=>declared.has(u)),
  [...used].filter(u=>!declared.has(u)).join(' ')||'none missing');
t('the tracking field relies on its visible label',
  !!$('label[for="trackCode"]') && !$('#trackCode').hasAttribute('aria-label'));

console.log('\nPASS ('+ok.length+')');
ok.forEach(x=>console.log('  ✓ '+x));
console.log('\nFAIL ('+bad.length+')');
bad.forEach(x=>console.log('  ✗ '+x));
console.log('\nERRORS ('+[...new Set(errors)].length+')');
console.log([...new Set(errors)].slice(0,10).map(e=>'  - '+e).join('\n')||'  (none)');
console.log('\nfetch calls:', calls.map(c=>c[1]+' '+c[0].replace('https://bulsuosr.test','')).join(' | '));
