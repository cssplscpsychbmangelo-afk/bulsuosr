import express from 'express';
import { authRequired } from '../middleware/auth.js';
const router=express.Router();
router.get('/', authRequired, async (req,res)=>{
  const db=req.app.locals.db;
  const { limit=50 }=req.query;
  const rows=(await db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?').all(Number(limit)));
  res.json(rows);
});
export default router;
