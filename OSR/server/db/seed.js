import fs from 'fs';
import { frontendSource } from '../paths.js';

export async function seedFromFrontend(db, sourcePath) {
  try {
    const frontendPath = sourcePath || frontendSource;
    if (!fs.existsSync(frontendPath)) throw new Error('Bundled frontend seed source is missing');
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
    const annCount = (await db.prepare('SELECT COUNT(*) as c FROM announcements').get()).c;
    if (annCount === 0) {
      const anns = extractArray('ANNOUNCEMENTS');
      if (anns && anns.length) {
        const stmt = db.prepare('INSERT INTO announcements (id, title, category, date, summary, content, external_link, image, status) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const a of anns) {
          (await stmt.run(a.id, a.title, a.category, a.date, a.summary, a.content, a.externalLink || '', a.image || '', 'Published'));
        }
        console.log(`[Seed] Announcements: ${anns.length}`);
      }
    } else {
      // Ensure seeded announcements are published so they appear on public site
      await db.prepare("UPDATE announcements SET status='Published' WHERE status='Draft' AND (created_by IS NULL OR created_by='')").run();
    }

    // Board Meetings
    const boardCount = (await db.prepare('SELECT COUNT(*) as c FROM board_meetings').get()).c;
    if (boardCount === 0) {
      const boards = extractArray('BOARD_MEETINGS');
      if (boards && boards.length) {
        const stmt = db.prepare('INSERT INTO board_meetings (id, meeting_number, date, title, description, type, academic_year, status, minutes_link, related_documents) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (const b of boards) {
          (await stmt.run(b.id, b.meetingNumber, b.date, b.title, b.description, b.type, b.academicYear, 'Published', b.minutesLink || '', JSON.stringify(b.relatedDocuments || [])));
        }
        console.log(`[Seed] Board Meetings: ${boards.length}`);
      }
    } else {
      // Ensure seeded board meetings are published so they appear on public site
      await db.prepare("UPDATE board_meetings SET status='Published' WHERE status='Draft' AND (created_by IS NULL OR created_by='')").run();
    }

    // Initiatives
    const initCount = (await db.prepare('SELECT COUNT(*) as c FROM initiatives').get()).c;
    if (initCount === 0) {
      const inits = extractArray('INITIATIVES');
      if (inits && inits.length) {
        const stmt = db.prepare('INSERT INTO initiatives (id, title, description, purpose, status, date, category, image, links, status_public) VALUES (?,?,?,?,?,?,?,?,?,?)');
        for (const i of inits) {
          (await stmt.run(i.id, i.title, i.description, i.purpose, i.status, i.date, i.category, i.image || '', JSON.stringify(i.links || []), 'Published'));
        }
        console.log(`[Seed] Initiatives: ${inits.length}`);
      }
    } else {
      // Ensure seeded initiatives are published so they appear on public site
      await db.prepare("UPDATE initiatives SET status_public='Published' WHERE status_public='Draft' AND (created_by IS NULL OR created_by='')").run();
    }

    // Resources
    const resCount = (await db.prepare('SELECT COUNT(*) as c FROM resources').get()).c;
    if (resCount === 0) {
      const ress = extractArray('RESOURCES');
      if (ress && ress.length) {
        const stmt = db.prepare('INSERT INTO resources (id, title, description, category, file_url, external_link, status) VALUES (?,?,?,?,?,?,?)');
        for (const r of ress) {
          (await stmt.run(r.id, r.title, r.description, r.category, r.fileUrl || '', r.link || r.externalLink || '', 'Published'));
        }
        console.log(`[Seed] Resources: ${ress.length}`);
      }
    } else {
      // Keep existing databases in sync when the built-in resources gain real
      // links. Only fills empty external_link values — rows edited through the
      // admin CMS are never overwritten.
      const ress = extractArray('RESOURCES');
      if (ress && ress.length) {
        const stmt = db.prepare('UPDATE resources SET external_link=? WHERE id=? AND (external_link IS NULL OR external_link=?)');
        let filled = 0;
        for (const r of ress) {
          const link = r.link || r.externalLink || '';
          if (!link) continue;
          filled += (await stmt.run(link, r.id, '')).changes;
        }
        if (filled) console.log(`[Seed] Resources: filled ${filled} missing link(s) from the website`);
      }
    }

    // Calendar - extract const ACADEMIC_CALENDAR
    const calCount = (await db.prepare('SELECT COUNT(*) as c FROM calendar_events').get()).c;
    if (calCount === 0) {
      const cals = extractArray('ACADEMIC_CALENDAR');
      if (cals && cals.length) {
        const stmt = db.prepare('INSERT INTO calendar_events (id, title, activity, date, day, month, category, iso, status) VALUES (?,?,?,?,?,?,?,?,?)');
        for (const c of cals) {
          (await stmt.run(c.id, c.activity || c.title, c.activity, c.date, c.day, c.month, c.category, c.iso, 'Published'));
        }
        console.log(`[Seed] Calendar: ${cals.length}`);
      }
    }

    // Site settings — prefill the verified office/contact details so the
    // admin Settings form starts with real values (all editable from the CMS).
    const settingsCount = (await db.prepare('SELECT COUNT(*) as c FROM site_settings').get()).c;
    if (settingsCount === 0) {
      const defaults = {
        site_title: 'Office of the Student Regent - Bulacan State University',
        footer_text: 'Verified announcements, Board Meeting records, initiatives, and student resources.',
        contact_email: 'bulsusg1983@gmail.com',
        contact_phone: '+63 44 796 3817',
        office_line1: 'Student Government (SG) Office',
        office_line2: 'BulSU Main Campus, Guinhawa',
        office_city: 'City of Malolos, Bulacan',
        office_address: 'Student Government (SG) Office, BulSU Main Campus, Guinhawa, City of Malolos, Bulacan',
        office_hours: 'Monday to Friday, within office hours',
        office_hours_short: 'Office hours • Within office hours',
        official_page: 'https://www.facebook.com/BulSUSG1983/',
        social_facebook: 'https://www.facebook.com/BulSUSG1983/',
        social_messenger: 'https://m.me/BulSUSG1983',
        footer_credit: 'OSR™ 2026–2027 • Made by Angelo Alvarado'
      };
      const stmt = db.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?,?)');
      for (const [k, v] of Object.entries(defaults)) (await stmt.run(k, v));
      console.log('[Seed] Site settings: defaults');
    }

    // Restore the author credit on databases that still carry the stripped
    // default; preserve any footer text an admin customized.
    (await db.prepare('UPDATE site_settings SET value=? WHERE key=? AND value=?').run(
      'OSR™ 2026–2027 • Made by Angelo Alvarado',
      'footer_credit',
      'OSR 2026-2027™'
    ));

    // Pages - About
    const pageCount = (await db.prepare('SELECT COUNT(*) as c FROM pages WHERE slug=?').get('about'))?.c || 0;
    // Use a simple check
    const aboutExists = (await db.prepare('SELECT COUNT(*) as c FROM pages WHERE slug=?').get('about'));
    if ((aboutExists?.c || 0) === 0) {
      (await db.prepare('INSERT INTO pages (id, slug, title, content, data) VALUES (?,?,?,?,?)').run('page-about', 'about', 'About OSR', 'Office of the Student Regent institutional information', JSON.stringify({ mandate: 'The Student Regent represents the student body in the Bulacan State University Board of Regents.' })));
      console.log('[Seed] Pages: about');
    }

  } catch (e) {
    throw e;
  }
}
