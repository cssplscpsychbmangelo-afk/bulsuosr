import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
router.get('/', authRequired, (req,res)=>{
  const db=req.app.locals.db;
  const publishedAnn = db.prepare("SELECT COUNT(*) as c FROM announcements WHERE status='Published'").get().c;
  const draftAnn = db.prepare("SELECT COUNT(*) as c FROM announcements WHERE status='Draft'").get().c;
  const upcomingBoard = db.prepare("SELECT COUNT(*) as c FROM board_meetings WHERE status='Published' AND date >= date('now')").get().c;
  const activeInit = db.prepare("SELECT COUNT(*) as c FROM initiatives WHERE status IN ('ONGOING','PLANNED') AND status_public='Published'").get().c;
  const resources = db.prepare("SELECT COUNT(*) as c FROM resources WHERE status='Published'").get().c;
  const upcomingCal = db.prepare("SELECT COUNT(*) as c FROM calendar_events WHERE status='Published' AND iso >= date('now')").get().c;
  const pulseResponses = db.prepare('SELECT COUNT(*) as c FROM pulse_submissions').get().c;
  const lastUpdatedRow = db.prepare("SELECT MAX(updated_at) as last FROM (SELECT updated_at FROM announcements UNION ALL SELECT updated_at FROM board_meetings UNION ALL SELECT updated_at FROM initiatives UNION ALL SELECT updated_at FROM resources UNION ALL SELECT updated_at FROM calendar_events)").get();
  const recent = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 5').all();
  res.json({
    cards: {
      publishedAnn, draftAnn, upcomingBoard, activeInit, resources, upcomingCal, pulseResponses,
      lastUpdated: lastUpdatedRow?.last || null
    },
    recent
  });
});
export default router;
