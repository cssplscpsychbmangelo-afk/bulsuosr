/* Parses the stylesheet in jsdom to prove it is valid CSS: npm i jsdom && node tools/osr-css-check.mjs */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const s=html.indexOf('<style>'); const e=html.indexOf('</style>', s);
const css=html.slice(s+7, e);
function bad(text){
  let error=false;
  const vc=new VirtualConsole();
  vc.on('jsdomError', () => { error=true; });
  new JSDOM(`<!doctype html><html><head><style>${text}</style></head><body></body></html>`, {virtualConsole: vc});
  return error;
}
console.log('whole stylesheet bad?', bad(css));
// bisect by top-level chunks
const chunks=[]; let depth=0, start=0, inC=false;
for (let i=0;i<css.length;i++){
  const c=css[i];
  if (inC){ if (c==='*'&&css[i+1]==='/'){inC=false;i++;} continue; }
  if (c==='/'&&css[i+1]==='*'){inC=true;i++;continue;}
  if (c==='{') depth++;
  else if (c==='}'){ depth--; if (depth===0){ chunks.push(css.slice(start,i+1)); start=i+1; } }
}
chunks.push(css.slice(start));
console.log('top-level chunks:', chunks.length);
const badOnes=[];
let acc='';
for (const ch of chunks){
  if (bad(ch)) badOnes.push(ch.slice(0,120).replace(/\n/g,' '));
}
console.log('individually bad chunks:', badOnes.length);
badOnes.slice(0,6).forEach(x=>console.log('   ✗', x));
