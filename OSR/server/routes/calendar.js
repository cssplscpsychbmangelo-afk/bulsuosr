import { randomUUID } from 'node:crypto';
import express from 'express';
import { authRequired, superAdminRequired } from '../middleware/auth.js';
import { validateContent } from '../middleware/content.js';
import { autoSyncCalendar, getSourceConfig, previewSource, syncCalendarSource, writeSettings, SOURCE_KEYS } from '../lib/calendarSync.js';
const router=express.Router();
async function log(db,a,act,id){ try{(await db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'calendar_event',id));}catch{} }

// Let a broken or slow document never hold up a public page.
function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve({ ok:false, status:'timeout', message:'The document check is taking too long; showing stored events.' }), ms))
  ]);
}

router.get('/public',async (req,res)=>{
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const db=req.app.locals.db;
  try {
    // The calendar adapts to the Google Document on its own: a visitor opening
    // this page is what triggers the (throttled) re-read of the document.
    await withTimeout(autoSyncCalendar(db), 6000);
  } catch {}
  res.json((await db.prepare("SELECT * FROM calendar_events WHERE status='Published' ORDER BY iso ASC").all()));
});

// ── Google Document source ───────────────────────────────────────────────────
function sourcePayload(config, extra = {}){
  return {
    ok: true,
    source: {
      url: config.url,
      label: config.label,
      auto: config.auto,
      prune: config.prune,
      lastSyncAt: config.lastSyncAt,
      lastCheckAt: config.lastCheckAt,
      lastStatus: config.lastStatus,
      lastDetail: config.lastDetail,
      lastCount: config.lastCount,
      connected: Boolean(config.url)
    },
    ...extra
  };
}

router.get('/source', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  res.set('Cache-Control','no-store');
  const config=await getSourceConfig(db);
  const synced=(await db.prepare("SELECT COUNT(*) AS c FROM calendar_events WHERE id LIKE 'gdoc-%'").get()).c;
  res.json(sourcePayload(config,{ syncedEvents:Number(synced)||0 }));
});

// Preview the document without saving anything: this is what the
// "Check document" button uses before an administrator commits.
router.post('/source/preview', authRequired, async (req,res,next)=>{
  try {
    const db=req.app.locals.db;
    const result=await previewSource(db,{ url:req.body?.url });
    res.set('Cache-Control','no-store');
    res.json(result);
  } catch(error){ next(error); }
});

// Attach or change the document. Any administrator can connect one; the
// previous link is replaced only after it has been read successfully.
router.patch('/source', authRequired, superAdminRequired, async (req,res,next)=>{
  try {
    const db=req.app.locals.db;
    const { url=null, auto, prune, label=null } = req.body || {};
    const entries={};
    if (url !== null) {
      const trimmed=String(url).trim();
      if (trimmed) await previewSource(db,{ url:trimmed }); // validates the link before saving
      entries[SOURCE_KEYS.url]=trimmed;
      entries[SOURCE_KEYS.lastHash]='';
      entries[SOURCE_KEYS.lastStatus]=trimmed ? 'pending' : '';
      entries[SOURCE_KEYS.lastDetail]=trimmed ? 'Waiting for the first sync.' : '';
    }
    if (auto !== undefined) entries[SOURCE_KEYS.auto]=auto ? '1' : '0';
    if (prune !== undefined) entries[SOURCE_KEYS.prune]=prune ? '1' : '0';
    if (label !== null) entries[SOURCE_KEYS.label]=String(label).slice(0,160);
    if (!Object.keys(entries).length) return res.status(400).json({error:'Nothing to update'});
    await writeSettings(db, entries);
    const config=await getSourceConfig(db);
    const sync = config.url ? await syncCalendarSource(db, { force:true, admin:req.admin }) : null;
    res.set('Cache-Control','no-store');
    res.json(sourcePayload(config,{ sync }));
  } catch(error){ next(error); }
});

// Sync now (and pick up edits made in the document since the last check).
router.post('/source/sync', authRequired, async (req,res,next)=>{
  try {
    const db=req.app.locals.db;
    const result=await syncCalendarSource(db,{ force:true, admin:req.admin });
    const config=await getSourceConfig(db);
    res.set('Cache-Control','no-store');
    res.json(sourcePayload(config,{ sync:result }));
  } catch(error){ next(error); }
});

router.delete('/source', authRequired, superAdminRequired, async (req,res,next)=>{
  try {
    const db=req.app.locals.db;
    const keep = req.query.keepEvents === '1';
    if (!keep) await db.prepare("DELETE FROM calendar_events WHERE id LIKE 'gdoc-%'").run();
    await writeSettings(db, { [SOURCE_KEYS.url]:'', [SOURCE_KEYS.lastHash]:'', [SOURCE_KEYS.lastStatus]:'', [SOURCE_KEYS.lastDetail]:'Document disconnected.' });
    await log(db, req.admin, 'Disconnected the Google Document calendar', 'document');
    res.set('Cache-Control','no-store');
    res.json({ ok:true, removedEvents: keep ? 0 : true });
  } catch(error){ next(error); }
});
router.get('/',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const {q}=req.query;
  let sql='SELECT * FROM calendar_events WHERE 1=1'; const p=[];
  if(q){ sql+=' AND (activity LIKE ? OR category LIKE ? OR iso LIKE ?)'; p.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY iso ASC';
  res.json((await db.prepare(sql).all(...p)));
});
router.get('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  res.json(row);
});
router.post('/',authRequired,validateContent,async (req,res)=>{
  const db=req.app.locals.db;
  const {id,title,activity,date,day,month,category,iso,start_time,end_time,location,description,link,status}=req.body;
  const act = activity||title;
  if(!act) return res.status(400).json({error:'Activity required'});
  const newId=`cal-${randomUUID()}`;
  (await db.prepare('INSERT INTO calendar_events (id, title, activity, date, day, month, category, iso, start_time, end_time, location, description, link, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId, act, act, date||'', day||'', month||'', category||'', iso||'', start_time||'', end_time||'', location||'', description||'', link||'', status||'Draft', req.admin.id));
  (await log(db,req.admin,`Created calendar event: ${act}`,newId));
  res.json({ok:true,id:newId});
});
router.patch('/:id',authRequired,validateContent,async (req,res)=>{
  const db=req.app.locals.db;
  const ex=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!ex) return res.status(404).json({error:'Not found'});
  const fields=['title','activity','date','day','month','category','iso','start_time','end_time','location','description','link','status'];
  const u=[]; const p=[];
  for(const f of fields) if(req.body[f]!==undefined){u.push(`${f}=?`); p.push(req.body[f]);}
  if(!u.length) return res.status(400).json({error:'No fields'});
  u.push("updated_at=datetime('now')");
  p.push(req.params.id);
  (await db.prepare(`UPDATE calendar_events SET ${u.join(',')} WHERE id=?`).run(...p));
  (await log(db,req.admin,`Updated calendar event: ${req.body.activity||ex.activity}`,req.params.id));
  res.json({ok:true});
});
router.post('/:id/duplicate',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const ex=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!ex) return res.status(404).json({error:'Not found'});
  const newId=`cal-${Date.now()}`;
  (await db.prepare('INSERT INTO calendar_events (id, title, activity, date, day, month, category, iso, start_time, end_time, location, description, link, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(newId, ex.title+' (copy)', ex.activity, ex.date, ex.day, ex.month, ex.category, ex.iso, ex.start_time, ex.end_time, ex.location, ex.description, ex.link, 'Draft', req.admin.id));
  (await log(db,req.admin,`Duplicated calendar event: ${ex.activity}`,newId));
  res.json({ok:true,id:newId});
});
router.delete('/:id',authRequired,async (req,res)=>{
  const db=req.app.locals.db;
  const row=(await db.prepare('SELECT * FROM calendar_events WHERE id=?').get(req.params.id));
  if(!row) return res.status(404).json({error:'Not found'});
  (await db.prepare("UPDATE calendar_events SET status='Archived', updated_at=datetime('now') WHERE id=?").run(req.params.id));
  (await log(db,req.admin,`Deleted calendar event: ${row.activity}`,req.params.id));
  res.json({ok:true});
});
export default router;
