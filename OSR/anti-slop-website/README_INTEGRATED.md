# Anti-Slop — Integrated Website (All Skills)

This folder is a **ready-to-integrate** copy of https://github.com/miqdadbadjuber/anti-slop with a working website that runs **all 6 skills** in one workbench.

## What's inside

- `index.html` — The integrated command center. Serves as your website's anti-slop workbench. All skills are live: copy, UI, human, mobile, code, plus the core filter and Delivery Gate.
- `anti-slop-gate.js` — Drop-in module to run automated gate checks (`R-02`, `R-03`, `R-24`, `R-25`) on any page.
- `skills/` — All 6 skills, each a folder with `SKILL.md` (the source of truth, no copies to sync):
  - `antislop` — core filter, 38 rules R-01 to R-38, Liveliness Toolkit, Delivery Gate
  - `antislop-ui` — visual, color, layout, decoration, motion
  - `antislop-copywriting` — tone, rhythm, honesty, hygiene
  - `antislop-human` — contrast, keyboard, focus, states (includes `contrast-check.py` + `contrast-mcp.py`)
  - `antislop-layoutmobile` — breakpoints, scale, grids, overflow, tap targets
  - `antislop-code` — comment hygiene, keeps valuable comments only
- `antislop.md` — single-file core (works anywhere, even in a chat window)
- `DESIGN.md` — design direction for this site (ENERGY 2 / RHYTHM 3 / MOTION 1, paper/ink/vermillion, one deliberate accent)
- `rules/` — `antislop.md` + `antislop.mdc` for Antigravity/Cursor
- `antislop-skills.zip` — same contents as a zip for download buttons

## Run it now

```bash
# from this folder
python3 -m http.server 8000
# open http://localhost:8000
# or
npx serve .
```

No build step. No framework. Works as `file://` as well.

## Integrate into your own website (3 steps)

### 1. Copy the skills into your repo

Pick one path:

```bash
# picker (recommended) — asks which skills + where + which agents
npx antislop-ai
# choose ALL when prompted

# or via skills.sh
npx skills add miqdadbadjuber/anti-slop --all

# or manual — this folder already has them
cp -r skills/ /your/project/skills/
cp antislop.md /your/project/
```

### 2. Route your agent (AGENTS.md / CLAUDE.md / GEMINI.md)

Add at the end of your entry file:

```md
<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:
- UI / visual: `skills/antislop-ui/SKILL.md`
- Copy & text: `skills/antislop-copywriting/SKILL.md`
- People: `skills/antislop-human/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`
Before starting, ask the user when antislop applies: during the work, or after it is done.
<!-- antislop:end -->
```

### 3. Add design direction + gate to your pages

Create `DESIGN.md` in your project (identity, palette, typography, dials). Without it, output is labeled `draft without direction` per R-37.

Add the automated gate to any page during development:

```html
<script type="module">
  import { runGate } from './anti-slop-gate.js'
  if (location.hostname === 'localhost') runGate({ strict: true })
</script>
```

For full coverage, open `index.html` in this folder, paste your copy/design into the Studio tabs, and run the Delivery Gate before you ship.

## How this site uses each skill (live)

- **Copywriting tab** — Paste headline/CTA, get R-02 (em dash), R-15 (generic CTA), R-16 (buzzwords), R-17/R-36 (fabricated stats) findings with a minimal fix that never invents facts.
- **UI tab** — Palette cap R-29, purpose test R-01/R-10/R-13 with required one-line reason R-31, plus R-14 card hierarchy preview.
- **People tab** — Real WCAG contrast math from `contrast-check.py` (same linearization + luminance), plus R-32 keyboard and R-27 empty/loading/error demos.
- **Mobile tab** — Emulator from 320 to 1180, R-03 overflow detection, R-05 two-state trap, tap target 44px.
- **Code tab** — Flags decorative separators, workflow narration, vague TODOs, emoji decoration per `antislop-code`, then cleans comments only.

## Deploy

This is static. Deploy `index.html` + `skills/` + `antislop-gate.js` to any host: Vercel, Netlify, Cloudflare Pages, GitHub Pages, or your own Nginx. The site itself passes its own Delivery Gate (vermillion is the one accent, IBM Plex chosen for legibility with reason, radius varies, no bento/fake terminal, every nav has a real destination, contrast passes AA, mobile reflows cleanly).

---
Source: https://github.com/miqdadbadjuber/anti-slop • MIT • v3.2.8
