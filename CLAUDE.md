# CLAUDE.md — Project Instructions for BulSU OSR

This file provides mandatory guidance for Claude/Agent work in this repository.

## Mandatory Skill: UI/UX Pro Max

The **UI/UX Pro Max** skill is installed at `.claude/skills/ui-ux-pro-max/` and is **MANDATORY** for **all changes** that touch any user-facing surface. You MUST apply it to every such change before delivering.

### When it applies (mandatory trigger)

Apply the skill for **any** change that modifies, adds, removes, or refactors:

- HTML, CSS, SCSS, Tailwind classes, styled-components, or any visual styling
- UI components (React/Vue/Svelte/Astro components, Blade templates, server-rendered markup, etc.)
- Pages, layouts, navigation, routing structure, dialogs, modals, toasts, menus
- Forms, inputs, validation feedback, error/success states
- Animations, transitions, micro-interactions, scroll/hover effects
- Images, icons, fonts, color tokens, typography, spacing, theming (including dark mode)
- Charts, data visualizations, dashboards
- Responsive behavior, mobile layouts, touch targets, safe-area handling
- Accessibility attributes (`aria-*`, `role`, `alt`, `tabindex`, focus styles, keyboard nav)
- Loading states, skeletons, empty states, error boundaries as they appear to users
- Any change that affects how something **looks, feels, moves, or is interacted with**

You may skip it only for changes that are **purely** non-visual (backend-only logic, DB migrations, server-only routes, infrastructure config, build scripts, secret/env management) — and even then, if the change surfaces anything new to the UI (a new API response shape consumed by a page, a new status code shown to the user, a new config flag that alters rendering), the skill applies.

### How to apply (required steps)

1. **Identify the stack.** Inspect `OSR/*/package.json`, framework markers, or file extensions. The repo includes an `osr-website`, `anti-slop-website`, and `admin` folder plus a `server` — detect which subproject(s) the change touches and use the matching stack preset when querying.
2. **Run the search script** for every UI/UX concern the change introduces. Use the absolute path:
   ```bash
   python3 "/home/user/bulsuosr/.claude/skills/ui-ux-pro-max/scripts/search.py" "<query>" --domain <domain>
   ```
   Domains you will commonly need: `ux` (priority rules, accessibility, interaction, layout, forms, nav), `style`, `product`, `color`, `typography`, `icons`, `landing`, `gsap`, `chart`, `react`, plus stack presets via `--stack <stack>` (e.g. `--stack react`, `--stack html-tailwind`, `--stack laravel`).
3. **For new pages or system-wide visual changes**, run a design-system query first:
   ```bash
   python3 "/home/user/bulsuosr/.claude/skills/ui-ux-pro-max/scripts/search.py" "<product keywords>" --design-system -p "<Project>"
   ```
   Persist with `--persist --output-dir /home/user/bulsuosr/<subproject>` only when starting a new visual direction; never `--force` without user authorization.
4. **Follow the priority order from the skill** (1 Accessibility → 10 Charts). Accessibility and touch/interaction are CRITICAL and must be satisfied before polishing color or animation.
5. **Before delivering**, read `.claude/skills/ui-ux-pro-max/references/pro-rules.md` and walk through its Pre-Delivery Checklist for every UI change.
6. **Do not fabricate** results. If a search returns 0 results, retry once with a narrower query; if still empty, label the recommendation as a default/fallback rather than presenting it as matched data.

### Quick anti-patterns to always reject

- Removing focus outlines, icon-only buttons without accessible labels, placeholder-only form labels
- Text below 12px body, gray-on-gray low-contrast text (must meet 4.5:1 contrast)
- Hover-only interactions (no touch/keyboard equivalent), touch targets smaller than 44×44px
- Instant 0ms state changes, one duration fits all transitions, animating `width`/`height`, ignoring `prefers-reduced-motion`
- Horizontal scroll on mobile, fixed pixel container widths, disabling user zoom
- Emoji as icons, mixing flat and skeuomorphic styles randomly, raw hex colors in components (use tokens)
- Errors shown only at the top of a form (place them near the field), overwhelming users with upfront disclosure
- Overloaded navigation, broken back-button behavior, missing deep links
- Using color alone to convey meaning in charts/data

### Repository layout (for context)

- `OSR/osr-website/` — main public website
- `OSR/anti-slop-website/` — anti-slop campaign site
- `OSR/admin/` — admin interface
- `OSR/server/` — backend server (Node/Express-style, verify from package.json)
- `OSR/uploads/` — user-uploaded assets
- `netlify.toml`, `OSR/netlify.toml` — build/deploy config
- `.claude/skills/ui-ux-pro-max/` — the mandatory UI/UX skill (data, references, scripts)

When working across multiple subprojects, apply the skill per subproject since each may use a different stack or visual direction.
