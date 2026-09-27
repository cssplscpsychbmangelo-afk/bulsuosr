// Shared guard for the existing content tables. Fields not used by a table are ignored
// by its route, but all incoming strings and publication states are validated here.
const statuses = new Set(['Draft', 'Published', 'Archived']);
const urls = new Set(['image','external_link','file_url','minutes_link','link']);
export function validateContent(req, res, next) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({error:'Invalid form'});
  for (const [key, value] of Object.entries(req.body)) {
    if (key === 'id') return res.status(400).json({error:'IDs are assigned by the server'});
    if (key === 'related_documents' || key === 'links') {
      if (!Array.isArray(value) || value.length > 30 || value.some(v => !v || typeof v !== 'object' || typeof v.href !== 'string' || v.href.length > 2000 || !['http:', 'https:'].includes(scheme(v.href)) || typeof v.label !== 'string' || v.label.length > 200)) return res.status(400).json({error:'Use valid document links'});
      continue;
    }
    if (typeof value !== 'string' || value.length > 20000) return res.status(400).json({error:`Invalid ${key}`});
    if ((key === 'status' && req.baseUrl !== '/api/initiatives' || key === 'status_public') && !statuses.has(value)) return res.status(400).json({error:'Invalid publication status'});
    if ((key === 'date' || key === 'iso') && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return res.status(400).json({error:'Invalid date'});
    if (urls.has(key) && value && !['http:', 'https:'].includes(scheme(value)) && !/^\/uploads\/[a-zA-Z0-9._-]+$/.test(value)) return res.status(400).json({error:`Invalid ${key} URL`});
  }
  if (req.method === 'POST' && req.baseUrl === '/api/calendar' && !req.body.iso) return res.status(400).json({error:'Event date required'});
  if ('title' in req.body && !req.body.title.trim()) return res.status(400).json({error:'Title required'});
  if (req.baseUrl === '/api/initiatives' && req.body.status && !['ONGOING','PLANNED','COMPLETED','ON_HOLD'].includes(req.body.status)) return res.status(400).json({error:'Invalid initiative status'});
  if (req.baseUrl === '/api/calendar' && req.body.iso && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.iso)) return res.status(400).json({error:'Invalid event date'});
  next();
}
function scheme(url) { try { return new URL(url).protocol; } catch { return ''; } }
