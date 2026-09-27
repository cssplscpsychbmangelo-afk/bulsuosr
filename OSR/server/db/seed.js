import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function seedFromFrontend(db) {
  try {
    const frontendPath = path.join(__dirname, '../../osr-website/index.html');
    if (!fs.existsSync(frontendPath)) return;
    const html = fs.readFileSync(frontendPath, 'utf8');

    // Helper to extract const array
    function extractArray(name) {
      const re = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`, 'm');
      const m = html.match(re);
      if (!m) return null;
      try {
        // Use Function to parse JS array (safe because it's our file)
        const code = `return [${m[1]}];`;
        return Function(code)();
      } catch (e) {
        console.log(`[Seed] Failed to parse ${name}:`, e.message);
        return null;
      }
    }

    // Announcements
    const annCount = db.prepare('SELECT COUNT(*) as c FROM announcements').get().c;
    if (annCount === 0) {
      const anns = extractArray('ANNOUNCEMENTS');
      if (anns && anns.length) {
        const stmt = db.prepare('INSERT INTO announcements (id, title, category, date, summary, content, external_link, image, status) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const a of anns) {
          stmt.run(a.id, a.title, a.category, a.date, a.summary, a.content, a.externalLink || '', a.image || '', a._placeholder ? 'Draft' : 'Published');
        }
        console.log(`[Seed] Announcements: ${anns.length}`);
      }
    }

    // Board Meetings
    const boardCount = db.prepare('SELECT COUNT(*) as c FROM board_meetings').get().c;
    if (boardCount === 0) {
      const boards = extractArray('BOARD_MEETINGS');
      if (boards && boards.length) {
        const stmt = db.prepare('INSERT INTO board_meetings (id, meeting_number, date, title, description, type, academic_year, status, minutes_link, related_documents) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (const b of boards) {
          stmt.run(b.id, b.meetingNumber, b.date, b.title, b.description, b.type, b.academicYear, b._placeholder ? 'Draft' : 'Published', b.minutesLink || '', JSON.stringify(b.relatedDocuments || []));
        }
        console.log(`[Seed] Board Meetings: ${boards.length}`);
      }
    }

    // Initiatives
    const initCount = db.prepare('SELECT COUNT(*) as c FROM initiatives').get().c;
    if (initCount === 0) {
      const inits = extractArray('INITIATIVES');
      if (inits && inits.length) {
        const stmt = db.prepare('INSERT INTO initiatives (id, title, description, purpose, status, date, category, image, links, status_public) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (const i of inits) {
          stmt.run(i.id, i.title, i.description, i.purpose, i.status, i.date, i.category, i.image || '', JSON.stringify(i.links || []), i._placeholder ? 'Draft' : 'Published');
        }
        console.log(`[Seed] Initiatives: ${inits.length}`);
      }
    }

    // Resources
    const resCount = db.prepare('SELECT COUNT(*) as c FROM resources').get().c;
    if (resCount === 0) {
      const ress = extractArray('RESOURCES');
      if (ress && ress.length) {
        const stmt = db.prepare('INSERT INTO resources (id, title, description, category, file_url, external_link, status) VALUES (?,?,?,?,?,?,?)');
        for (const r of ress) {
          stmt.run(r.id, r.title, r.description, r.category, r.fileUrl || '', r.externalLink || '', 'Published');
        }
        console.log(`[Seed] Resources: ${ress.length}`);
      }
    }

    // Calendar - extract const ACADEMIC_CALENDAR
    const calCount = db.prepare('SELECT COUNT(*) as c FROM calendar_events').get().c;
    if (calCount === 0) {
      const cals = extractArray('ACADEMIC_CALENDAR');
      if (cals && cals.length) {
        const stmt = db.prepare('INSERT INTO calendar_events (id, title, activity, date, day, month, category, iso, status) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const c of cals) {
          stmt.run(c.id, c.activity || c.title, c.activity, c.date, c.day, c.month, c.category, c.iso, 'Published');
        }
        console.log(`[Seed] Calendar: ${cals.length}`);
      }
    }

    // Pages - About
    const pageCount = db.prepare('SELECT COUNT(*) as c FROM pages WHERE slug=?').get('about')?.c || 0;
    // Use a simple check
    const aboutExists = db.prepare('SELECT COUNT(*) as c FROM pages WHERE slug=?').get('about');
    if ((aboutExists?.c || 0) === 0) {
      db.prepare('INSERT INTO pages (id, slug, title, content, data) VALUES (?,?,?,?,?)').run('page-about', 'about', 'About OSR', 'Office of the Student Regent institutional information', JSON.stringify({ mandate: 'The Student Regent represents the student body in the Bulacan State University Board of Regents.' }));
      console.log('[Seed] Pages: about');
    }

  } catch (e) {
    console.log('[Seed] Error:', e.message);
  }
}
