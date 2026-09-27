// anti-slop-gate.js - drop-in Delivery Gate checks that can be automated
// Usage: import { runGate } from './anti-slop-gate.js'; runGate({ strict:true })
export function runGate({ strict=false } = {}){
  const fails=[];
  const bodyText = document.body.innerText;
  // R-02: em dash in UI text (outside code)
  const hasEmDash = bodyText.includes("—") && !document.querySelector('code');
  // crude: if body contains em dash and it's not only inside SKILL.md blocks, flag
  if(bodyText.includes("—")){
    // allow if gate is explicitly documenting R-02 itself
    const withoutDocs = bodyText.replace(/R-02[^]*?em dash/gi, "");
    if(withoutDocs.includes("—")) fails.push("R-02 FAIL: em dash found in UI text — replace with comma/period/colon");
  }
  // R-03: horizontal overflow
  if(document.documentElement.scrollWidth > window.innerWidth + 2) fails.push("R-03 FAIL: horizontal overflow detected");
  // R-24: dead nav links
  const navLinks = [...document.querySelectorAll('nav a[href^="#"], header a[href^="#"]')];
  navLinks.forEach(a=>{
    const id=a.getAttribute('href').slice(1);
    if(id && !document.getElementById(id)) fails.push(`R-24 FAIL: nav link #${id} has no destination`);
  });
  // R-25: contrast - sample computed style for main text
  // full audit needs the contrast-checker; here we just warn if low opacity text is found
  const lowContrastEls = [...document.querySelectorAll('[style*="color: #777"], [style*="color:#777"]')];
  if(lowContrastEls.length) fails.push("R-25 WARN: suspected low-contrast text found — run contrast-check.py");

  if(fails.length){
    console.warn("Anti-Slop Gate — FAIL\n" + fails.join("\n"));
    if(strict) console.error("Delivery Gate is FAIL. Do not ship.");
  } else {
    console.log("Anti-Slop Gate — PASS (automated checks). Complete the manual block and run the full Delivery Gate in the workbench.");
  }
  return fails;
}
