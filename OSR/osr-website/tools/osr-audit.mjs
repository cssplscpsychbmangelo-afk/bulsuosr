/* Structural audit for index.html — no dependencies: node tools/osr-audit.mjs */
import fs from 'node:fs';
import { JSDOM, VirtualConsole } from '/tmp/node_modules/jsdom/lib/api.js';
const html=fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vc=new VirtualConsole(); vc.on('jsdomError',()=>{}); vc.on('error',()=>{});
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'https://bulsuosr.test/',
  beforeParse(w){w.matchMedia=q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   w.IntersectionObserver=class{constructor(c){this.c=c;}observe(e){this.c([{isIntersecting:true,target:e}],this);}unobserve(){}disconnect(){}takeRecords(){return[]}};
   w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};w.scrollTo=()=>{};w.scrollBy=()=>{};
   w.HTMLElement.prototype.scrollIntoView=function(){};w.navigator.clipboard={writeText:async()=>{}};
   w.fetch=async()=>({ok:false,status:404,json:async()=>({}),text:async()=>''});}});
const win=dom.window, doc=win.document;
await new Promise(r=>setTimeout(r,700));
const issues=[];
const add=(page,msg)=>issues.push(page+' :: '+msg);
const ids=new Set([...doc.querySelectorAll('[id]')].map(e=>e.id));
const dynamic=new Set(['annClearEmpty','boardClearEmpty','calClearEmpty','initClearEmpty','resClearEmpty','searchClearEmpty','searchRetry','heroCmd','dashCalList','calSoonList']);
const pages=[...doc.querySelectorAll('section.page')];
for(const p of pages){
  const name=p.id.replace('page-','');
  const lab=p.getAttribute('aria-labelledby');
  if(!lab) add(name,'page section has no aria-labelledby');
  else if(!ids.has(lab)) add(name,'aria-labelledby → missing #'+lab);
  // heading order
  const hs=[...p.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>+h.tagName[1]);
  for(let i=1;i<hs.length;i++) if(hs[i]-hs[i-1]>1) add(name,`heading level jumps h${hs[i-1]} → h${hs[i]}`);
  if(hs.length && hs[0]!==2 && hs[0]!==1) add(name,'first heading is h'+hs[0]);
  if(p.querySelectorAll('h1').length>1) add(name,'more than one h1 inside the page');
  // resolvable aria references
  for(const attr of ['aria-labelledby','aria-describedby','aria-controls']){
    for(const el of p.querySelectorAll('['+attr+']')){
      for(const id of el.getAttribute(attr).split(/\s+/).filter(Boolean)){
        if(!ids.has(id) && !dynamic.has(id)) add(name, `${attr} → #${id} does not exist (${el.tagName.toLowerCase()}${el.id?'#'+el.id:''})`);
      }
    }
  }
  // accessible names
  for(const b of p.querySelectorAll('button')){
    if(!b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')) add(name,'button without an accessible name: '+b.outerHTML.slice(0,70));
  }
  for(const a of p.querySelectorAll('a')){
    if(!a.textContent.trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]:not([alt=""])')) add(name,'link without an accessible name: '+a.outerHTML.slice(0,70));
  }
  for(const img of p.querySelectorAll('img')) if(!img.hasAttribute('alt')) add(name,'img without alt: '+img.getAttribute('src'));
  // external links
  for(const a of p.querySelectorAll('a[target="_blank"]')) if(!/noopener/.test(a.getAttribute('rel')||'')) add(name,'target=_blank without rel=noopener: '+(a.getAttribute('href')||'').slice(0,40));
  // list semantics
  for(const list of p.querySelectorAll('[role="list"]')){
    const kids=[...list.children];
    if(kids.length && !kids.every(k=>k.getAttribute('role')==='listitem'||k.tagName==='LI'||k.tagName==='TEMPLATE')) add(name,'role=list with non-listitem children: '+(list.id||list.className));
  }
  // form labels (static only)
  for(const f of p.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,textarea')){
    const id=f.id; const hasLabel=id && doc.querySelector(`label[for="${id}"]`);
    if(!hasLabel && !f.getAttribute('aria-label') && !f.getAttribute('aria-labelledby') && !f.closest('label')) add(name,'form control without a label: '+(id||f.outerHTML.slice(0,60)));
  }
  // in-page anchors that are not routes
  for(const a of p.querySelectorAll('a[href^="#"]')){
    const h=a.getAttribute('href').slice(1).split('?')[0];
    if(!h || a.hasAttribute('data-nav')) continue;
    if(!ids.has(h)) add(name,'in-page link → #'+h+' does not exist');
  }
  // empty clickable text
  for(const el of p.querySelectorAll('[role="button"]')) if(!el.textContent.trim() && !el.getAttribute('aria-label')) add(name,'role=button without a name');
}
// duplicate ids
const seen=new Map();
for(const el of doc.querySelectorAll('[id]')) seen.set(el.id,(seen.get(el.id)||0)+1);
for(const [id,n] of seen) if(n>1) add('document','duplicate id: '+id+' ×'+n);
// global: skip link
if(!doc.querySelector('.skip-link')) add('document','no skip link');
const main=doc.querySelector('main');
if(!main || main.id!=='main') add('document','main landmark missing or not #main');
if(!/width=device-width/.test(doc.querySelector('meta[name=viewport]')?.getAttribute('content')||'')) add('document','viewport meta missing');
// count summary
const counts={};
for(const p of pages) counts[p.id]={headings:p.querySelectorAll('h1,h2,h3,h4').length, links:p.querySelectorAll('a').length, buttons:p.querySelectorAll('button').length, imgs:p.querySelectorAll('img').length};
console.log('PAGES AUDITED:', pages.length);
console.log(JSON.stringify(counts,null,1));
console.log('\nISSUES ('+issues.length+')');
issues.forEach(i=>console.log('  - '+i));
