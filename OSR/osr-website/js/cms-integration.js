// OSR CMS Integration — fetches published content from backend, fixes guide positioning, handles pulse
//
// Runs in two modes:
//   1. Behind the Express API (local / VPS): hydrates published content from /api/public/*.
//   2. On static hosting (Netlify): it detects the missing API and keeps the
//      built-in content. The Pulse panel may retry its one endpoint while open
//      so a recovered backend appears without a page reload.
(function(){
  // Optional direct-API override — set window.OSR_CONFIG = { apiBase: 'https://api.example.org' }
  // (or <meta name="osr-api-base" content="...">) before this script loads. For
  // cross-origin use, that API must allow this site's exact origin via ALLOWED_ORIGINS.
  const cfg = window.OSR_CONFIG || {};
  const metaApi = document.querySelector('meta[name="osr-api-base"]');
  // A backend remembered via the "backend not connected" page lets the public
  // site hydrate live content without the Netlify proxy, as long as the
  // backend's ALLOWED_ORIGINS includes this site's origin.
  let storedBase = '';
  try { storedBase = localStorage.getItem('osr_backend_url') || ''; } catch (e) { storedBase = ''; }
  const API_BASE = (cfg.apiBase || (metaApi && metaApi.getAttribute('content')) || storedBase || '').replace(/\/+$/, '');
  if (storedBase && !cfg.apiBase && !(metaApi && metaApi.getAttribute('content'))) {
    console.info('[CMS] Using remembered backend ' + API_BASE);
  }

  // Flipped to false as soon as we learn there is no backend behind this host.
  let backendAvailable = true;

  function isJson(response){
    const ct = (response.headers.get('content-type') || '').toLowerCase();
    return ct.includes('application/json');
  }

  async function fetchPublic(type, allowRetry=false){
    if(!backendAvailable && !allowRetry) return null;

    let r;
    try{
      // Try the new /api/public/:type endpoint first, fallback to /api/:type/public
      r = await fetch(`${API_BASE}/api/public/${type}`, {credentials:'include'});
      if(!r.ok) r = await fetch(`${API_BASE}/api/${type}/public`, {credentials:'include'});
    }catch(e){
      // Network / CORS failure: no backend reachable from this origin at all.
      noBackend('unreachable — '+e.message);
      return null;
    }

    if(!r.ok){
      // The backend is there but this one type failed — log and keep going.
      console.warn('[CMS] no data for', type, '(HTTP '+r.status+')');
      return null;
    }

    // A SPA fallback answers 200 with index.html — that is not API data.
    if(!isJson(r)){
      noBackend('host answered '+type+' with '+(r.headers.get('content-type')||'a non-JSON response'));
      return null;
    }

    let data;
    try{
      data = await r.json();
    }catch(e){
      noBackend('malformed JSON — '+e.message);
      return null;
    }

    // Static hosts (Netlify) answer /api/* with api-unavailable.json.
    if(data && data.available === false){
      noBackend('this host serves the static stub');
      return null;
    }
    backendAvailable = true;
    return data;
  }

  function publishPulseAggregates(rows){
    const available=Array.isArray(rows);
    window.__CMS_PULSE=available ? rows : null;
    window.dispatchEvent(new CustomEvent('cms:pulse-updated', {
      detail:{available, rows:available ? rows : [], updatedAt:new Date().toISOString()}
    }));
    return available;
  }

  async function refreshPulseAggregates(){
    // Pulse is live: retry transiently unavailable backends when the user refreshes or polls.
    const rows=await fetchPublic('pulse-aggregates', true);
    return publishPulseAggregates(rows);
  }

  window.__cmsRefreshPulse=refreshPulseAggregates;

  // Remember that regular CMS hydration has no backend and short-circuit its
  // remaining requests. Explicit Pulse refreshes pass allowRetry=true.
  function noBackend(reason){
    if(!backendAvailable) return;
    backendAvailable = false;
    console.info('[CMS] No API here ('+reason+') — showing built-in content.');
  }

  // Replace the built-in content arrays with published CMS data and re-render.
  // The inline site script declares ANNOUNCEMENTS/RESOURCES as top-level consts,
  // so we mutate them in place (splice) rather than reassigning.
  function replaceArray(target, items){
    if(!Array.isArray(target) || !Array.isArray(items)) return false;
    target.length = 0;
    target.push(...items);
    return true;
  }

  function patchAnnouncements(data){
    if(!Array.isArray(data)) return;
    const mapped = data.map(a => ({
      id: a.id,
      title: a.title,
      category: a.category || 'Announcement & Letter',
      date: a.date || '',
      summary: a.summary || '',
      content: a.content || '',
      externalLink: safeLink(a.external_link),
      image: a.image || '',
      is_featured: !!a.is_featured
    }));
    if(replaceArray(window.ANNOUNCEMENTS || (typeof ANNOUNCEMENTS !== 'undefined' ? ANNOUNCEMENTS : null), mapped)){
      try{ window.renderAnnouncements && window.renderAnnouncements(); }catch(e){ console.warn('[CMS] re-render announcements failed', e); }
      try{ window.renderHomeAnnouncements && window.renderHomeAnnouncements(); }catch(e){}
      console.log('[CMS] Announcements hydrated:', mapped.length);
    }
    window.__CMS_ANNOUNCEMENTS = data;
  }

  function patchResources(data){
    if(!Array.isArray(data)) return;
    const mapped = data.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category || 'GENERAL',
      description: r.description || '',
      link: safeLink(r.external_link || r.file_url) || '#'
    }));
    if(replaceArray(window.RESOURCES || (typeof RESOURCES !== 'undefined' ? RESOURCES : null), mapped)){
      try{ window.renderResources && window.renderResources(); }catch(e){ console.warn('[CMS] re-render resources failed', e); }
      console.log('[CMS] Resources hydrated:', mapped.length);
    }
    window.__CMS_RESOURCES = data;
  }

  function safeLink(url){ try { const u=new URL(url,location.origin); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
  function patchBoard(data){
    if(!Array.isArray(data)) return;
    replaceArray(typeof BOARD_MEETINGS !== 'undefined' ? BOARD_MEETINGS : null, data.map(b=>({
      id:b.id, title:b.title, meetingNumber:b.meeting_number||'', date:b.date||'',
      academicYear:b.academic_year||'', type:b.type||'', description:b.description||'',
      minutesLink:safeLink(b.minutes_link), relatedDocuments:Array.isArray(b.related_documents)?b.related_documents.filter(d=>safeLink(d.href)).map(d=>({...d,href:safeLink(d.href)})):[]
    })));
    if(typeof renderBoard === 'function') renderBoard();
  }
  function patchInitiatives(data){
    if(!Array.isArray(data)) return;
    replaceArray(typeof INITIATIVES !== 'undefined' ? INITIATIVES : null, data.map(i=>({
      id:i.id, title:i.title, description:i.description||'', purpose:i.purpose||'',
      status:i.status||'PLANNED', date:i.date||'', category:i.category||'', image:i.image||'',
      links:Array.isArray(i.links)?i.links.filter(d=>safeLink(d.href)).map(d=>({...d,href:safeLink(d.href)})):[]
    })));
    if(typeof renderInitiatives === 'function') renderInitiatives();
  }
  function patchCalendar(data){
    if(!Array.isArray(data)) return;
    replaceArray(typeof ACADEMIC_CALENDAR !== 'undefined' ? ACADEMIC_CALENDAR : null, data.map(e=>({
      ...e, date:e.date||e.iso?.slice(8)||'', month:e.month|| (e.iso ? new Date(e.iso+'T12:00:00').toLocaleString('en',{month:'long',year:'numeric'}) : ''),
      day:e.day|| (e.iso ? new Date(e.iso+'T12:00:00').toLocaleString('en',{weekday:'short'}) : '')
    })));
    const month=document.getElementById('calMonth');
    if(month) { month.innerHTML='<option value="all">All months</option>'; if(typeof populateCalMonths === 'function') populateCalMonths(); }
    if(typeof renderCalendar === 'function') renderCalendar();
    if(typeof updateUpNext === 'function') updateUpNext();
  }

  // Apply admin-managed site settings (Settings → Website settings) to the
  // footer and contact cards. Only non-empty values override the built-ins.
  function applySiteSettings(s){
    if(!s || typeof s !== 'object') return;
    const text = (id, v) => { const el = document.getElementById(id); if(el && v) el.textContent = v; };
    const mail = (id, v) => { const el = document.getElementById(id); if(el && v){ el.textContent = v; el.href = 'mailto:' + v; } };
    const tel = (id, v) => { const el = document.getElementById(id); if(el && v){ el.textContent = v; if(el.tagName === 'A') el.href = 'tel:' + String(v).replace(/[^\d+]/g, ''); } };
    const href = (id, v) => { const el = document.getElementById(id); if(el && v) el.href = v; };

    text('foLine1', s.office_line1);
    text('foLine2', s.office_line2);
    text('foCity', s.office_city);
    mail('foEmail', s.contact_email);
    tel('foPhone', s.contact_phone);
    text('foHours', s.office_hours_short);
    text('footerCredit', s.footer_credit);

    mail('hcEmail', s.contact_email);
    text('hcOffice', s.office_address);
    tel('hcPhone', s.contact_phone);
    text('hcHours', s.office_hours);
    href('hcPage', safeLink(s.official_page));
    href('hcMailto', s.contact_email ? 'mailto:' + s.contact_email : null);

    mail('acEmail', s.contact_email);
    tel('acPhone', s.contact_phone);
    text('acAddress', s.office_address);
    text('acHours', s.office_hours);
    href('acMailto', s.contact_email ? 'mailto:' + s.contact_email : null);

    if(s.site_title) document.title = s.site_title;
    if(s.homepage_intro) { const intro=document.querySelector('#page-home .hero p'); if(intro) intro.textContent=s.homepage_intro; }

    // Keep the copy-contact block in sync with whatever the admin saved.
    window.OSR_CONTACT = Object.assign(window.OSR_CONTACT || {}, {
      email: s.contact_email || (window.OSR_CONTACT || {}).email,
      phone: s.contact_phone || (window.OSR_CONTACT || {}).phone,
      office: s.office_address || (window.OSR_CONTACT || {}).office,
      hours: s.office_hours || (window.OSR_CONTACT || {}).hours
    });
    console.log('[CMS] Site settings applied');
  }

  async function fetchSettings(){
    if(!backendAvailable) return null;
    try{
      const r = await fetch(`${API_BASE}/api/settings/public`, {credentials:'include'});
      if(!r.ok || !isJson(r)) return null;
      const j = await r.json();
      if(j && j.available === false) return null; // static-host stub
      return j;
    }catch(e){ return null; }
  }

  // Guide data patch: override perPageGuides if available
  function patchGuides(apiGuides){
    if(!apiGuides || !apiGuides.length) return;
    // The frontend expects perPageGuides as an object {home:[...], about:[...]}
    // Convert array of guide_steps to that format
    const perPage = {};
    for(const g of apiGuides){
      if(!g.is_enabled) continue;
      const page = g.page;
      if(!perPage[page]) perPage[page] = [];
      perPage[page].push({
        sel: g.target_selector,
        label: g.title,
        desc: g.description,
        step_number: g.step_number
      });
    }
    // Sort each page by step_number
    for(const k in perPage) perPage[k].sort((a,b)=>a.step_number-b.step_number);
    // If the frontend has window.perPageGuides, override it
    if(window.perPageGuides){
      Object.assign(window.perPageGuides, perPage);
      console.log('[CMS] Patched perPageGuides from API', perPage);
    } else if(window.perPageGuide){
      // older singular version
      console.log('[CMS] Found perPageGuide, patching');
      // Convert to new format
      window.perPageGuides = perPage;
    } else {
      // Store for later use
      window.__CMS_GUIDES = perPage;
      console.log('[CMS] Stored guides', perPage);
    }
  }

  // Pulse: intercept Ideal BulSU / BulSU Pulse submissions
  function patchPulse(){
    // Find pulse forms and override submit to use backend
    const forms = document.querySelectorAll('form, [data-pulse-form]');
    // Also look for the specific pulse allocation UI
    const pulseSection = document.querySelector('#page-ideal-bulsu, #ideal-bulsu, [data-pulse]');
    if(pulseSection){
      console.log('[CMS] Pulse section found, will intercept submissions');
    }
    // Override any existing pulse submit handler if it uses localStorage
    // We look for buttons that submit pulse
    const submitBtns = document.querySelectorAll('button, a');
    submitBtns.forEach(btn=>{
      if(btn.textContent && btn.textContent.toLowerCase().includes('submit') && btn.closest('#page-ideal-bulsu, #ideal-bulsu, .pulse')){
        // This is heuristic, we will add a listener that captures pulse submissions
      }
    });
    // Add a global handler for pulse submissions via API
    window.__cmsSubmitPulse = async (allocation)=>{
      try{
        const r = await fetch(`${API_BASE}/api/pulse/submit`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ allocation })
        });
        const j = await r.json();
        if(!r.ok) throw new Error(j.error);
        console.log('[CMS] Pulse submitted', j);
        return j;
      }catch(e){
        console.error('[CMS] Pulse submit failed', e);
        throw e;
      }
    };
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    // Wire Pulse submission even when the public-content probe finds no backend.
    patchPulse();
    // Probe with one request first; static hosting keeps the built-in content.
    const anns = await fetchPublic('announcements');
    if(!backendAvailable) return;

    // Backend is there: fetch the rest in parallel.
    const results = await Promise.allSettled([
      fetchPublic('board-meetings'),
      fetchPublic('initiatives'),
      fetchPublic('resources'),
      fetchPublic('calendar'),
      fetchPublic('guides'),
      fetchPublic('navigation')
    ]);

    const [boards, inits, ress, cals, guides, navs] = results.map(r=> r.status==='fulfilled'? r.value : null);

    window.__CMS_DATA = {
      announcements: anns,
      board_meetings: boards,
      initiatives: inits,
      resources: ress,
      calendar: cals,
      guides: guides,
      navigation: navs
    };

    // Patch guides immediately
    if(guides) patchGuides(guides);

    // Apply admin-managed site settings (office, contact, footer credit)
    const settings = await fetchSettings();
    if(settings) applySiteSettings(settings);

    // Patch announcements etc after a delay to let original render finish
    setTimeout(()=>{
      if(anns) patchAnnouncements(anns);
      if(ress) patchResources(ress);
      if(boards) patchBoard(boards);
      if(inits) patchInitiatives(inits);
      if(cals) patchCalendar(cals);
      console.log('[CMS] Data hydrated', window.__CMS_DATA);

      // Trigger a custom event so the original script could react if it listens
      window.dispatchEvent(new CustomEvent('cms:hydrated', {detail: window.__CMS_DATA}));
    }, 1000);

  });

  // --- GUIDE POSITIONING FIX (robust) ---
  function getPreviewContainer(){
    try{
      if(window.self !== window.top){
        const pc = window.top.document.getElementById('previewContainer') || window.top.document.querySelector('.preview-container');
        if(pc) return pc;
      }
    }catch{}
    // Also check if we're in admin preview via URL param
    if(new URLSearchParams(location.search).has('preview')) {
      return document.querySelector('.preview-container, #previewContainer');
    }
    return null;
  }

  const originalPositionGuideTooltip = window.positionGuideTooltip;
  
  function improvedPositionGuideTooltip(target){
    if(!target){
      if(typeof originalPositionGuideTooltip === 'function') return originalPositionGuideTooltip(target);
      return;
    }
    const tooltip = document.getElementById('guideTooltip');
    if(!tooltip){
      if(typeof originalPositionGuideTooltip === 'function') return originalPositionGuideTooltip(target);
      return;
    }

    // Modal detection: hide if modal is open and target is behind it
    const modal = document.querySelector('.modal.open, [role="dialog"]:not([hidden]), .welcome-overlay.is-open, #welcomeOverlay.is-open');
    if(modal && !target.closest('.modal, [role="dialog"], .welcome-overlay, #welcomeOverlay')){
      if(modal.contains(target) === false && getComputedStyle(modal).display !== 'none'){
        // If modal is open and guide is not inside modal, hide guide to avoid overlap
        const modalRect = modal.getBoundingClientRect();
        if(modalRect.width > 100 && modalRect.height > 100){
          tooltip.hidden = true;
          return;
        }
      }
    }

    // Target visibility
    const style = window.getComputedStyle(target);
    if(style.display==='none' || style.visibility==='hidden' || target.offsetParent===null){
      const pageKey = (location.hash||'#home').replace('#','').split('?')[0].split('/')[0] || 'home';
      const alt = document.querySelector(`a[href="#${pageKey}"]`);
      if(alt && alt.offsetParent!==null){
        target = alt;
      } else {
        tooltip.hidden = true;
        return;
      }
    }

    const rect = target.getBoundingClientRect();
    const header = document.getElementById('header') || document.querySelector('header');
    const headerH = header ? header.offsetHeight : 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollY = window.scrollY;
    const gap = 12;

    const previewContainer = getPreviewContainer();
    let containerRect = null;
    let isPreviewAnchored = false;
    if(previewContainer){
      containerRect = previewContainer.getBoundingClientRect();
      isPreviewAnchored = true;
    }

    // Measure tooltip
    tooltip.style.left = '-9999px';
    tooltip.style.top = '0';
    tooltip.style.transform = 'none';
    tooltip.hidden = false;
    // Force reflow
    void tooltip.offsetWidth;
    const ttRect = tooltip.getBoundingClientRect();

    let top, left;

    // Check if target is inside hero/cover
    const hero = target.closest('.hero, .cover, #page-home .hero, .welcome-overlay, #welcomeOverlay');
    const isInHero = !!hero && rect.top < headerH + 280;

    if(isInHero){
      // Avoid covering hero: position to side or below hero
      const heroRect = hero.getBoundingClientRect();
      if(vh - heroRect.bottom >= ttRect.height + gap + 16){
        top = heroRect.bottom + gap;
        left = heroRect.left + (heroRect.width - ttRect.width)/2;
      } else if(heroRect.top - headerH >= ttRect.height + gap){
        top = heroRect.top - ttRect.height - gap;
        left = heroRect.left + (heroRect.width - ttRect.width)/2;
      } else {
        // Side
        top = rect.top + (rect.height - ttRect.height)/2;
        left = rect.right + gap;
        if(left + ttRect.width > vw - 10) left = rect.left - ttRect.width - gap;
      }
    } else {
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top - headerH;
      const spaceRight = vw - rect.right;
      const spaceLeft = rect.left;

      if(spaceBelow >= ttRect.height + gap + 8){
        top = rect.bottom + gap;
        left = rect.left + (rect.width - ttRect.width)/2;
      } else if(spaceAbove >= ttRect.height + gap + 8){
        top = rect.top - ttRect.height - gap;
        left = rect.left + (rect.width - ttRect.width)/2;
      } else if(spaceRight >= ttRect.width + gap + 8){
        top = rect.top + (rect.height - ttRect.height)/2;
        left = rect.right + gap;
      } else if(spaceLeft >= ttRect.width + gap + 8){
        top = rect.top + (rect.height - ttRect.height)/2;
        left = rect.left - ttRect.width - gap;
      } else {
        top = Math.min(vh - ttRect.height - 12, rect.bottom + gap);
        left = rect.left + (rect.width - ttRect.width)/2;
      }
    }

    if(isPreviewAnchored && containerRect){
      const minLeft = containerRect.left + 8;
      const maxLeft = containerRect.right - ttRect.width - 8;
      const minTop = containerRect.top + 8;
      const maxTop = containerRect.bottom - ttRect.height - 8;
      left = Math.max(minLeft, Math.min(maxLeft, left));
      top = Math.max(minTop, Math.min(maxTop, top));
      if(rect.right < containerRect.left || rect.left > containerRect.right || rect.bottom < containerRect.top || rect.top > containerRect.bottom){
        tooltip.hidden = true;
        return;
      }
    } else {
      left = Math.max(10, Math.min(vw - ttRect.width - 10, left));
      top = Math.max(headerH + 8, Math.min(vh - ttRect.height - 10, top));
    }

    // Final overlap check
    if(top < rect.bottom && top + ttRect.height > rect.top && left < rect.right && left + ttRect.width > rect.left){
      if(vh - rect.bottom > rect.top - headerH){
        top = Math.min(vh - ttRect.height - 10, rect.bottom + gap);
      } else {
        top = Math.max(headerH + 8, rect.top - ttRect.height - gap);
      }
      if(isPreviewAnchored && containerRect){
        top = Math.max(containerRect.top + 8, Math.min(containerRect.bottom - ttRect.height - 8, top));
      } else {
        top = Math.max(headerH + 8, Math.min(vh - ttRect.height - 10, top));
      }
    }

    if(left < 0) left = 10;
    if(left + ttRect.width > vw) left = vw - ttRect.width - 10;

    tooltip.style.left = left + 'px';
    tooltip.style.top = (top + scrollY) + 'px';
    document.documentElement.style.overflowX = 'hidden';
  }

  // Patch after original is defined
  let attempts = 0;
  const interval = setInterval(()=>{
    attempts++;
    const hasOriginal = typeof window.positionGuideTooltip === 'function';
    if(hasOriginal || attempts > 60){
      clearInterval(interval);
      if(hasOriginal){
        window._originalPositionGuideTooltip = window.positionGuideTooltip;
      }
      window.positionGuideTooltip = improvedPositionGuideTooltip;
      console.log('[CMS] Guide positioning patched (robust + preview-anchored)');

      // Re-position on resize/scroll
      let resizeTimeout;
      window.addEventListener('resize', ()=>{
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(()=>{
          const tt = document.getElementById('guideTooltip');
          if(tt && !tt.hidden){
            const hl = document.querySelector('.guide-highlight');
            if(hl) improvedPositionGuideTooltip(hl);
          }
        }, 80);
      });
      window.addEventListener('scroll', ()=>{
        const tt = document.getElementById('guideTooltip');
        if(tt && !tt.hidden){
          const hl = document.querySelector('.guide-highlight');
          if(hl) improvedPositionGuideTooltip(hl);
        }
      }, {passive:true});

      // Patch setRoute to clear old guide position on navigation
      const origSetRoute = window.setRoute;
      if(origSetRoute && !origSetRoute._cmsPatched){
        window.setRoute = function(hash){
          const tt = document.getElementById('guideTooltip');
          if(tt) tt.hidden = true;
          document.querySelectorAll('.guide-highlight').forEach(el=> el.classList.remove('guide-highlight','guide-highlight--pulse'));
          // Close guideActive flag if exists
          try{ if(typeof guideActive !== 'undefined') guideActive = false; }catch{}
          return origSetRoute.call(this, hash);
        };
        window.setRoute._cmsPatched = true;
      }

      // Also listen to hashchange as fallback
      window.addEventListener('hashchange', ()=>{
        const tt = document.getElementById('guideTooltip');
        if(tt) tt.hidden = true;
        document.querySelectorAll('.guide-highlight').forEach(el=> el.classList.remove('guide-highlight','guide-highlight--pulse'));
      });
    }
  }, 100);

  // Prevent guide from causing horizontal scroll
  const style = document.createElement('style');
  style.textContent = `
    #guideTooltip{ width:min(260px, calc(100vw - 24px)) !important; max-width:min(260px, calc(100vw - 24px)) !important; box-sizing:border-box !important; }
    @media(max-width:640px){ #guideTooltip{ width:min(260px, calc(100vw - 20px)) !important; max-width:min(260px, calc(100vw - 20px)) !important; } }
    html{ overflow-x:hidden; }
    body{ overflow-x:hidden; }
    .guide-highlight{ position:relative !important; z-index:2 !important; }
  `;
  document.head.appendChild(style);

  console.log('[CMS] Integration loaded');
})();
