import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
function log(db,a,act,id){ try{db.prepare('INSERT INTO activity_logs (admin_id, admin_email, action, content_type, content_id) VALUES (?,?,?,?,?)').run(a?.id||null,a?.email||'system',act,'pulse',id);}catch{} }

// Public: submit anonymous pulse (10 points distributed)
router.post('/submit', (req,res)=>{
  const db=req.app.locals.db;
  const { allocation } = req.body; // { "Academic Support": 3, "Student Services": 2, ... }
  if(!allocation || typeof allocation !== 'object') return res.status(400).json({error:'Allocation required'});
  const total = Object.values(allocation).reduce((s,v)=> s+ Number(v||0),0);
  if(total !== 10) return res.status(400).json({error:'Must distribute exactly 10 points'});
  const categories = Object.keys(allocation);
  if(categories.length===0) return res.status(400).json({error:'No categories'});
  const id=`pulse-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const period = new Date().toISOString().slice(0,7); // 2026-09
  db.prepare('INSERT INTO pulse_submissions (id, allocation, total_points, period) VALUES (?,?,?,?)').run(id, JSON.stringify(allocation), total, period);
  // update aggregates
  for(const [cat, pts] of Object.entries(allocation)){
    const existing=db.prepare('SELECT * FROM pulse_aggregates WHERE period=? AND category=?').get(period, cat);
    if(existing){
      db.prepare('UPDATE pulse_aggregates SET total_points=total_points+?, response_count=response_count+1, updated_at=datetime("now") WHERE period=? AND category=?').run(Number(pts), period, cat);
    } else {
      db.prepare('INSERT INTO pulse_aggregates (period, category, total_points, response_count) VALUES (?,?,?,?)').run(period, cat, Number(pts), 1);
    }
    // all-time
    const allExisting=db.prepare('SELECT * FROM pulse_aggregates WHERE period=? AND category=?').get('all-time', cat);
    if(allExisting){
      db.prepare('UPDATE pulse_aggregates SET total_points=total_points+?, response_count=response_count+1 WHERE period=? AND category=?').run(Number(pts), 'all-time', cat);
    } else {
      db.prepare('INSERT INTO pulse_aggregates (period, category, total_points, response_count) VALUES (?,?,?,?)').run('all-time', cat, Number(pts), 1);
    }
  }
  res.json({ok:true, id});
});

// Public: get aggregates (only aggregated, not individual)
router.get('/aggregates', (req,res)=>{
  const db=req.app.locals.db;
  const { period='all-time' } = req.query;
  let rows;
  if(period==='all'){
    rows=db.prepare('SELECT * FROM pulse_aggregates ORDER BY period DESC').all();
  } else {
    rows=db.prepare('SELECT * FROM pulse_aggregates WHERE period=? ORDER BY total_points DESC').all(period);
  }
  // If no real data, return demo preview flag
  const totalResponses = rows.reduce((s,r)=> s+ r.response_count,0);
  // For demo: if no data, return sample preview
  let isPreview = false;
  if(rows.length===0){
    isPreview = true;
    rows = [
      { period: 'preview', category: 'Academic Support', total_points: 42, response_count: 18 },
      { period: 'preview', category: 'Student Services', total_points: 38, response_count: 18 },
      { period: 'preview', category: 'Facilities', total_points: 35, response_count: 18 },
      { period: 'preview', category: 'Governance', total_points: 30, response_count: 18 },
    ];
  }
  const totalPoints = rows.reduce((s,r)=> s+ r.total_points,0);
  const withPct = rows.map(r=> ({...r, percentage: totalPoints? Math.round(r.total_points/totalPoints*100):0 }));
  res.json({ period, isPreview, totalResponses: isPreview? 0: totalResponses, totalPoints, categories: withPct });
});

// Admin: list submissions (aggregated only, not individual builds for privacy)
router.get('/', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  const { period, view='monthly' } = req.query;
  let rows;
  if(view==='all-time' || period==='all-time'){
    rows=db.prepare("SELECT * FROM pulse_aggregates WHERE period='all-time' ORDER BY total_points DESC").all();
  } else if(view==='yearly'){
    const year = period || new Date().getFullYear().toString();
    rows=db.prepare("SELECT category, SUM(total_points) as total_points, SUM(response_count) as response_count FROM pulse_aggregates WHERE period LIKE ? AND period!='all-time' GROUP BY category ORDER BY total_points DESC").all(`${year}%`);
  } else {
    const p = period || new Date().toISOString().slice(0,7);
    rows=db.prepare('SELECT * FROM pulse_aggregates WHERE period=? ORDER BY total_points DESC').all(p);
  }
  const totalResponses = db.prepare('SELECT COUNT(*) as c FROM pulse_submissions').get().c;
  const monthly = db.prepare("SELECT period, COUNT(*) as count FROM pulse_submissions GROUP BY period ORDER BY period DESC LIMIT 12").all();
  const yearly = db.prepare("SELECT substr(period,1,4) as year, COUNT(*) as count FROM pulse_submissions GROUP BY year ORDER BY year DESC").all();
  res.json({ aggregates: rows, totalResponses, monthly, yearly, isPreview: rows.length===0 });
});

// Admin: export
router.get('/export', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  const rows=db.prepare('SELECT * FROM pulse_aggregates ORDER BY period, total_points DESC').all();
  res.json(rows);
});

router.delete('/reset', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  db.exec("DELETE FROM pulse_submissions; DELETE FROM pulse_aggregates;");
  log(db, req.admin, 'Reset BulSU Pulse data', 'reset');
  res.json({ok:true});
});

export default router;
