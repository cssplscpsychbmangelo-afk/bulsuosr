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

  function safeLink(url){
    if(!url || typeof url !== 'string' || !url.trim()) return '';
    url = url.trim();
    if(url === '#' || url.startsWith('#')) return url;
    try {
      const u = new URL(url, location.origin);
      return ['http:', 'https:'].includes(u.protocol) ? u.href : '';
    } catch {
      return '';
    }
  }

  async function fetchPublic(type, allowRetry=false){
    if(!backendAvailable && !allowRetry) return null;

    let r;
    try{
      // Try the new /api/public/:type endpoint first, fallback to /api/:type/public
      r = await fetch(`${API_BASE}/api/public/${type}`, {credentials:'include', cache:'no-store'});
      if(!r.ok) r = await fetch(`${API_BASE}/api/${type}/public`, {credentials:'include', cache:'no-store'});
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
    const target = window.ANNOUNCEMENTS || (typeof ANNOUNCEMENTS !== 'undefined' ? ANNOUNCEMENTS : null);
    if(replaceArray(target, mapped)){
      try{ (window.renderAnnouncements || (typeof renderAnnouncements === 'function' ? renderAnnouncements : null))?.(); }catch(e){ console.warn('[CMS] re-render announcements failed', e); }
      try{ (window.renderHomeAnnouncements || (typeof renderHomeAnnouncements === 'function' ? renderHomeAnnouncements : null))?.(); }catch(e){}
      try{ (window.updateDashStats || (typeof updateDashStats === 'function' ? updateDashStats : null))?.(); }catch(e){}
      try{ (window.renderSearch || (typeof renderSearch === 'function' ? renderSearch : null))?.(); }catch(e){}
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
      link: safeLink(r.external_link) || safeLink(r.file_url) || '#'
    }));
    const target = window.RESOURCES || (typeof RESOURCES !== 'undefined' ? RESOURCES : null);
    if(replaceArray(target, mapped)){
      try{ (window.renderResources || (typeof renderResources === 'function' ? renderResources : null))?.(); }catch(e){ console.warn('[CMS] re-render resources failed', e); }
      try{ (window.updateDashStats || (typeof updateDashStats === 'function' ? updateDashStats : null))?.(); }catch(e){}
      try{ (window.updateSavedCounts || (typeof updateSavedCounts === 'function' ? updateSavedCounts : null))?.(); }catch(e){}
      try{ (window.renderSearch || (typeof renderSearch === 'function' ? renderSearch : null))?.(); }catch(e){}
      console.log('[CMS] Resources hydrated:', mapped.length);
    }
    window.__CMS_RESOURCES = data;
  }

  function patchBoard(data){
    if(!Array.isArray(data)) return;
    const mapped = data.map(b => ({
      id: b.id,
      title: b.title,
      meetingNumber: b.meeting_number || '',
      date: b.date || '',
      academicYear: b.academic_year || '',
      type: b.type || '',
      description: b.description || '',
      minutesLink: safeLink(b.minutes_link),
      relatedDocuments: Array.isArray(b.related_documents)
        ? b.related_documents.filter(d => d && (d.href || typeof d === 'string')).map(d => typeof d === 'string' ? { label: 'Document', href: safeLink(d) } : { ...d, href: safeLink(d.href) })
        : []
    }));
    const target = window.BOARD_MEETINGS || (typeof BOARD_MEETINGS !== 'undefined' ? BOARD_MEETINGS : null);
    if(replaceArray(target, mapped)){
      try{ (window.renderBoard || (typeof renderBoard === 'function' ? renderBoard : null))?.(); }catch(e){}
      try{ (window.updateDashStats || (typeof updateDashStats === 'function' ? updateDashStats : null))?.(); }catch(e){}
      try{ (window.renderSearch || (typeof renderSearch === 'function' ? renderSearch : null))?.(); }catch(e){}
    }
    window.__CMS_BOARD = data;
  }

  function patchInitiatives(data){
    if(!Array.isArray(data)) return;
    const mapped = data.map(i => ({
      id: i.id,
      title: i.title,
      description: i.description || '',
      purpose: i.purpose || '',
      status: i.status || 'PLANNED',
      date: i.date || '',
      category: i.category || '',
      image: i.image || '',
      links: Array.isArray(i.links)
        ? i.links.filter(d => d && (d.href || typeof d === 'string')).map(d => typeof d === 'string' ? { label: 'Link', href: safeLink(d) } : { ...d, href: safeLink(d.href) })
        : []
    }));
    const target = window.INITIATIVES || (typeof INITIATIVES !== 'undefined' ? INITIATIVES : null);
    if(replaceArray(target, mapped)){
      try{ (window.renderInitiatives || (typeof renderInitiatives === 'function' ? renderInitiatives : null))?.(); }catch(e){}
      try{ (window.updateDashStats || (typeof updateDashStats === 'function' ? updateDashStats : null))?.(); }catch(e){}
      try{ (window.renderSearch || (typeof renderSearch === 'function' ? renderSearch : null))?.(); }catch(e){}
    }
    window.__CMS_INITIATIVES = data;
  }

  function patchCalendar(data){
    if(!Array.isArray(data)) return;
    const mapped = data.map(e => ({
      ...e,
      activity: e.activity || e.title || '',
      title: e.title || e.activity || '',
      date: e.date || (e.iso ? e.iso.slice(8) : ''),
      month: e.month || (e.iso ? new Date(e.iso + 'T12:00:00').toLocaleString('en', { month: 'long', year: 'numeric' }) : ''),
      day: e.day || (e.iso ? new Date(e.iso + 'T12:00:00').toLocaleString('en', { weekday: 'short' }) : '')
    }));
    const target = window.ACADEMIC_CALENDAR || (typeof ACADEMIC_CALENDAR !== 'undefined' ? ACADEMIC_CALENDAR : null);
    if(replaceArray(target, mapped)){
      const month = document.getElementById('calMonth');
      if(month) {
        month.innerHTML = '<option value="all">All months</option>';
        try{ (window.populateCalMonths || (typeof populateCalMonths === 'function' ? populateCalMonths : null))?.(); }catch(e){}
      }
      try{ (window.renderCalendar || (typeof renderCalendar === 'function' ? renderCalendar : null))?.(); }catch(e){}
      try{ (window.updateUpNext || (typeof updateUpNext === 'function' ? updateUpNext : null))?.(); }catch(e){}
      try{ (window.updateDashStats || (typeof updateDashStats === 'function' ? updateDashStats : null))?.(); }catch(e){}
    }
    window.__CMS_CALENDAR = data;
  }

  // Apply admin-managed site settings (Settings → Website settings) to the
  // footer, brand, and contact cards. Only non-empty values override the built-ins.
  function applySiteSettings(s){
    if(!s || typeof s !== 'object') return;
    const text = (id, v) => { const el = document.getElementById(id); if(el && v) el.textContent = v; };
    const mail = (id, v) => { const el = document.getElementById(id); if(el && v){ el.textContent = v; el.href = 'mailto:' + v; } };
    const tel = (id, v) => { const el = document.getElementById(id); if(el && v){ el.textContent = v; if(el.tagName === 'A') el.href = 'tel:' + String(v).replace(/[^\d+]/g, ''); } };
    const href = (id, v) => { const el = document.getElementById(id); if(el && v) el.href = safeLink(v); };

    if(s.site_title) {
      document.title = s.site_title;
      document.querySelectorAll('.brand__text b').forEach(el => el.textContent = s.site_title);
    }
    if(s.site_description) {
      const meta = document.querySelector('meta[name="description"]');
      if(meta) meta.setAttribute('content', s.site_description);
    }
    if(s.homepage_intro) {
      const intro = document.querySelector('#page-home .hero p, .hero__lead');
      if(intro) intro.textContent = s.homepage_intro;
    }

    if(s.office_address) {
      text('hcOffice', s.office_address);
      text('acAddress', s.office_address);
      const foLine1 = document.getElementById('foLine1');
      if(foLine1) foLine1.textContent = s.office_address;
      const foLine2 = document.getElementById('foLine2');
      if(foLine2) foLine2.style.display = s.office_line2 ? '' : 'none';
      const foCity = document.getElementById('foCity');
      if(foCity) foCity.style.display = s.office_city ? '' : 'none';
    }
    if(s.office_line1) text('foLine1', s.office_line1);
    if(s.office_line2) { const fo2=document.getElementById('foLine2'); if(fo2){ fo2.textContent=s.office_line2; fo2.style.display=''; } }
    if(s.office_city) { const foc=document.getElementById('foCity'); if(foc){ foc.textContent=s.office_city; foc.style.display=''; } }

    text('foHours', s.office_hours_short);
    text('footerCredit', s.footer_credit);
    text('hcHours', s.office_hours);
    text('acHours', s.office_hours);

    mail('foEmail', s.contact_email);
    mail('hcEmail', s.contact_email);
    mail('acEmail', s.contact_email);
    href('hcMailto', s.contact_email ? 'mailto:' + s.contact_email : null);
    href('acMailto', s.contact_email ? 'mailto:' + s.contact_email : null);

    tel('foPhone', s.contact_phone);
    tel('hcPhone', s.contact_phone);
    tel('acPhone', s.contact_phone);

    href('hcPage', safeLink(s.official_page));
    if(s.social_facebook) {
      document.querySelectorAll('a[href*="facebook.com"]').forEach(a => {
        a.href = safeLink(s.social_facebook);
      });
    }

    window.OSR_CONTACT = Object.assign(window.OSR_CONTACT || {}, {
      email: s.contact_email || (window.OSR_CONTACT || {}).email,
      phone: s.contact_phone || (window.OSR_CONTACT || {}).phone,
      office: s.office_address || (window.OSR_CONTACT || {}).office,
      hours: s.office_hours || (window.OSR_CONTACT || {}).hours
    });
    console.log('[CMS] Site settings applied');
  }

  async function fetchSettings(forceRefresh = false){
    if(!backendAvailable && !forceRefresh) return null;
    try{
      const r = await fetch(`${API_BASE}/api/settings/public`, {credentials:'include', cache:'no-store'});
      if(!r.ok || !isJson(r)) return null;
      const j = await r.json();
      if(j && j.available === false) return null; // static-host stub
      return j;
    }catch(e){ return null; }
  }

  // ── About OSR page ────────────────────────────────────────────────────────
  // The About page is structured office information edited in Admin → About
  // OSR. Only values the office actually saved are applied; every empty field
  // keeps the wording built into the page, so a fresh install looks unchanged.
  function aboutEsc(value){
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }
  function aboutText(id, value){
    const el = document.getElementById(id);
    if(el && typeof value === 'string' && value.trim()) el.textContent = value.trim();
  }
  function aboutLines(id, values){
    const el = document.getElementById(id);
    if(!el || !Array.isArray(values) || !values.length) return;
    const items = values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    if(items.length) el.innerHTML = items.map(value => `<li>${aboutEsc(value)}</li>`).join('');
  }
  function aboutValues(id, values){
    const el = document.getElementById(id);
    if(!el || !Array.isArray(values) || !values.length) return;
    const items = values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    if(!items.length) return;
    el.innerHTML = items.map(value => `<span class="ab-value">${aboutEsc(value)}</span>`).join('');
  }
  function aboutKV(id, rows){
    const el = document.getElementById(id);
    if(!el || !Array.isArray(rows) || !rows.length) return;
    const items = rows.filter(row => row && (row.label || row.value));
    if(items.length) el.innerHTML = items.map(row => `<div class="kv"><b>${aboutEsc(row.label || '')}</b> <span>${aboutEsc(row.value || '')}</span></div>`).join('');
  }
  function aboutAnchor(href, label, style){
    const link = document.createElement('a');
    link.textContent = label;
    if(/^https?:\/\//i.test(href)){
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener';
    } else {
      link.href = href || '#';
      link.setAttribute('data-nav', '');
      link.addEventListener('click', () => { if(typeof window.setRoute === 'function') window.setRoute(link.getAttribute('href')); });
    }
    if(style) link.setAttribute('style', style);
    return link;
  }
  function aboutFeatured(id, rows){
    const el = document.getElementById(id);
    if(!el || !Array.isArray(rows) || !rows.length) return;
    const items = rows.filter(row => row && (row.title || row.description));
    if(!items.length) return;
    el.innerHTML = '';
    items.forEach(row => {
      const card = document.createElement('div');
      card.className = 'ab-program';
      const head = document.createElement('div');
      head.className = 'ab-program__head';
      const title = document.createElement('b');
      title.textContent = row.title || '';
      head.appendChild(title);
      if(row.tag){
        const tag = document.createElement('span');
        tag.className = 'ab-tag';
        tag.textContent = row.tag;
        head.appendChild(tag);
      }
      card.appendChild(head);
      if(row.description){
        const text = document.createElement('p');
        text.textContent = row.description;
        card.appendChild(text);
      }
      if(row.link_href){
        const link = aboutAnchor(row.link_href, row.link_label || 'Open');
        link.className = 'ab-program__link';
        card.appendChild(link);
      }
      el.appendChild(card);
    });
  }
  function aboutInitials(name){
    const words = String(name || '').replace(/\[.*?\]/g, '').split(/\s+/).filter(word => /^[A-Za-zÀ-ÿ]/.test(word));
    if(!words.length) return '';
    return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  }
  function aboutPhoto(url){
    return typeof url === 'string' && (/^https:\/\//i.test(url) || url.startsWith('/')) ? url : '';
  }
  function aboutStaff(rows, heading, intro){
    const wrap = document.getElementById('aboutStaffWrap');
    const grid = document.getElementById('aboutStaffGrid');
    if(!wrap || !grid) return;
    const items = Array.isArray(rows) ? rows.filter(row => row && row.name) : [];
    wrap.hidden = !items.length;
    if(!items.length) return;
    aboutText('aboutStaffHeading', heading);
    const introEl = document.getElementById('aboutStaffIntro');
    if(introEl){ introEl.hidden = !(intro && intro.trim()); if(intro) introEl.textContent = intro.trim(); }
    grid.innerHTML = '';
    items.forEach(row => {
      const item = document.createElement('li');
      item.className = 'ab-person';
      const mark = document.createElement('span');
      mark.className = 'ab-person__mark';
      mark.setAttribute('aria-hidden', 'true');
      const photo = aboutPhoto(row.photo);
      if(photo){
        const img = document.createElement('img');
        img.src = photo; img.alt = ''; img.loading = 'lazy';
        mark.appendChild(img);
      } else {
        mark.textContent = aboutInitials(row.name) || '•';
      }
      const body = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = row.name;
      body.appendChild(name);
      [row.role, row.unit].filter(Boolean).forEach(text => {
        const line = document.createElement('span');
        line.textContent = text;
        body.appendChild(line);
      });
      if(row.email){
        const mail = document.createElement('a');
        mail.href = `mailto:${row.email}`;
        mail.textContent = row.email;
        body.appendChild(mail);
      }
      item.append(mark, body);
      grid.appendChild(item);
    });
  }
  function aboutRegentMark(name, photoUrl){
    const mark = document.getElementById('aboutSrMark');
    if(!mark) return;
    const photo = aboutPhoto(photoUrl);
    if(photo){
      mark.innerHTML = '';
      const img = document.createElement('img');
      img.src = photo; img.alt = '';
      mark.appendChild(img);
    } else {
      const initials = aboutInitials(name);
      if(initials) mark.textContent = initials;
    }
  }
  function aboutLinks(id, rows){
    const el = document.getElementById(id);
    if(!el || !Array.isArray(rows) || !rows.length) return;
    const items = rows.filter(row => row && (row.label || row.href));
    if(!items.length) return;
    el.innerHTML = '';
    items.forEach(row => {
      const item = document.createElement('li');
      item.appendChild(aboutAnchor(row.href, row.label || row.href));
      el.appendChild(item);
    });
  }

  function applyAboutContent(a){
    if(!a || typeof a !== 'object') return;
    aboutText('aboutEyebrow', a.eyebrow);
    aboutText('about-title', a.title);
    aboutText('aboutIntro', a.intro);
    aboutText('aboutBadge', a.badge);
    aboutText('aboutOfficeHeading', a.office_heading);
    aboutText('aboutOfficeP1', a.office_p1);
    aboutText('aboutOfficeP2', a.office_p2);
    aboutText('aboutMandateHeading', a.mandate_heading);
    aboutLines('aboutMandateList', a.mandate_items);
    aboutText('aboutMandateNote', a.mandate_note);
    aboutText('aboutSrHeading', a.sr_heading);
    aboutText('aboutSrLabel', a.sr_label);
    aboutText('aboutSrName', a.sr_name);
    aboutText('aboutSrMeta', a.sr_meta);
    aboutText('aboutSrNote', a.sr_note);
    aboutRegentMark(a.sr_name, a.sr_photo);
    aboutStaff(a.staff, a.staff_heading, a.staff_intro);
    aboutText('aboutDirHeading', a.dir_heading);
    aboutText('aboutDirIntro', a.dir_intro);
    aboutText('aboutDirExecName', a.dir_exec_name);
    aboutText('aboutDirExecTag', a.dir_exec_tag);
    aboutText('aboutDirNames', a.dir_names);
    aboutText('aboutDirTag', a.dir_tag);
    aboutText('aboutCollegeTitle', a.college_title);
    aboutText('aboutCollegeDesc', a.college_desc);
    aboutText('aboutCollegeRows', a.college_rows);
    aboutText('aboutVmHeading', a.vm_heading);
    aboutText('aboutVision', a.vision);
    aboutText('aboutMission', a.mission);
    aboutValues('aboutValuesList', a.values);
    aboutText('aboutValuesNote', a.values_note);
    aboutText('aboutInfoHeading', a.info_heading);
    aboutKV('aboutInfoRows', a.info);
    aboutText('aboutInfoNote', a.info_note);
    aboutText('aboutContactHeading', a.contact_heading);
    aboutText('aboutResponseTime', a.response_time);
    aboutText('aboutFeaturedHeading', a.featured_heading);
    aboutText('aboutFeaturedIntro', a.featured_intro);
    aboutFeatured('aboutFeaturedList', a.featured);
    aboutText('aboutFeaturedNote', a.featured_note);
    aboutText('aboutLinksHeading', a.links_heading);
    aboutLinks('aboutLinksList', a.links);
    aboutText('aboutLinksNote', a.links_note);
    console.log('[CMS] About page content applied');
  }

  async function fetchAbout(forceRefresh = false){
    if(!backendAvailable && !forceRefresh) return null;
    try{
      const r = await fetch(`${API_BASE}/api/about/public`, {credentials:'include', cache:'no-store'});
      if(!r.ok || !isJson(r)) return null;
      const j = await r.json();
      if(j && j.available === false) return null; // static-host stub
      return j;
    }catch(e){ return null; }
  }

  function patchNavigation(navs){
    if(!Array.isArray(navs) || !navs.length) return;
    const nav = document.querySelector('nav.nav');
    if(!nav) return;
    const existing = [...nav.querySelectorAll('a[data-nav]')];
    const actions = nav.querySelector('.nav__actions');
    const currentActive = existing.find(a => a.getAttribute('aria-current') === 'page')?.getAttribute('href') || (location.hash || '#home');
    const visibleNavs = navs.filter(item => item.is_visible !== 0 && item.is_visible !== false);
    if(!visibleNavs.length) return;

    existing.forEach(a => a.remove());
    visibleNavs.forEach(item => {
      const a = document.createElement('a');
      a.href = item.href;
      a.setAttribute('data-nav', '');
      a.textContent = item.label;
      if(item.href === currentActive) a.setAttribute('aria-current', 'page');
      a.addEventListener('click', () => {
        if(typeof window.setRoute === 'function') window.setRoute(item.href);
      });
      if(actions) nav.insertBefore(a, actions);
      else nav.appendChild(a);
    });
  }

  // Guide data patch: override perPageGuides if available
  function patchGuides(apiGuides){
    if(!apiGuides || !apiGuides.length) return;
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
    for(const k in perPage) perPage[k].sort((a,b)=>a.step_number-b.step_number);
    if(window.perPageGuides){
      Object.assign(window.perPageGuides, perPage);
    } else if(window.perPageGuide){
      window.perPageGuides = perPage;
    } else {
      window.__CMS_GUIDES = perPage;
    }
  }

  // Pulse: intercept Ideal BulSU / BulSU Pulse submissions
  function patchPulse(){
    const forms = document.querySelectorAll('form, [data-pulse-form]');
    const pulseSection = document.querySelector('#page-ideal-bulsu, #ideal-bulsu, [data-pulse]');
    window.__cmsSubmitPulse = async (allocation)=>{
      try{
        const r = await fetch(`${API_BASE}/api/pulse/submit`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ allocation })
        });
        const j = await r.json();
        if(!r.ok) throw new Error(j.error);
        return j;
      }catch(e){
        throw e;
      }
    };
  }

  let isHydrating = false;
  async function hydrateAll(forceRefresh = false){
    if(isHydrating) return;
    isHydrating = true;
    try {
      if(forceRefresh) backendAvailable = true;
      const anns = await fetchPublic('announcements', forceRefresh);
      if(!backendAvailable) return;

      const results = await Promise.allSettled([
        fetchPublic('board-meetings', forceRefresh),
        fetchPublic('initiatives', forceRefresh),
        fetchPublic('resources', forceRefresh),
        fetchPublic('calendar', forceRefresh),
        fetchPublic('guides', forceRefresh),
        fetchPublic('navigation', forceRefresh),
        fetchSettings(forceRefresh),
        fetchAbout(forceRefresh)
      ]);

      const [boards, inits, ress, cals, guides, navs, settings, about] = results.map(r => r.status==='fulfilled' ? r.value : null);

      window.__CMS_DATA = {
        announcements: anns,
        board_meetings: boards,
        initiatives: inits,
        resources: ress,
        calendar: cals,
        guides: guides,
        navigation: navs,
        settings: settings,
        about: about
      };

      if(guides) patchGuides(guides);
      if(settings) applySiteSettings(settings);
      if(about && Object.keys(about).length) applyAboutContent(about);
      if(anns) patchAnnouncements(anns);
      if(ress) patchResources(ress);
      if(boards) patchBoard(boards);
      if(inits) patchInitiatives(inits);
      if(cals) patchCalendar(cals);
      if(navs) patchNavigation(navs);

      console.log('[CMS] Content fully hydrated', window.__CMS_DATA);
      window.dispatchEvent(new CustomEvent('cms:hydrated', {detail: window.__CMS_DATA}));
    } finally {
      isHydrating = false;
    }
  }

  // Live real-time sync with changes made in admin
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const bc = new BroadcastChannel('osr-cms-sync');
      bc.onmessage = (e) => {
        console.log('[CMS] Real-time sync event received from admin:', e.data);
        hydrateAll(true);
      };
    } catch(e) {}
  }

  window.addEventListener('storage', (e) => {
    if(e.key === 'osr_cms_last_update') {
      console.log('[CMS] LocalStorage sync event triggered');
      hydrateAll(true);
    }
  });

  window.addEventListener('focus', () => {
    hydrateAll(false);
  });

  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') {
      hydrateAll(false);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      patchPulse();
      hydrateAll();
    });
  } else {
    patchPulse();
    hydrateAll();
  }

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
