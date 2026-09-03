# CU12 Web Design Contract

## Purpose

This document is the source of truth for the existing CU12 web interface. It protects the current product identity, information architecture, responsive behavior, and interaction patterns from accidental visual drift.

It is a preservation contract, not an authorization to redesign the product. A user request that explicitly asks for a redesign may change this contract, but the same pull request must update this file and explain the intended differences.

## Scope

This contract applies to user-facing code in `apps/web`, including the dashboard, administration pages, authentication pages, shared layout, notifications, dialogs, sheets, and global styles.

## Product Character

### Visual thesis

CU12 is a restrained academic operations console: institutional, calm, compact, and trustworthy, with strong Catholic University branding and a single clear action accent.

### Content thesis

Prefer orientation, current status, deadlines, and explicit actions over promotional language or decorative content. Korean interface copy must remain direct and readable.

### Interaction thesis

1. Async work must visibly move through pending, running, success, and failure states without surprising layout shifts.
2. Secondary detail belongs in the existing disclosure patterns such as popovers, dialogs, sheets, and expandable course detail.
3. Motion is functional feedback only. Do not add decorative entrance, parallax, bounce, or ambient animation.

## Existing Visual System

### Color roles

Use the existing semantic CSS variables. Do not introduce a competing palette or repeat literal colors when a suitable token exists.

| Role | Token | Current value |
| --- | --- | --- |
| University primary | `--cuk-blue` | `#0c2e86` |
| Institutional secondary | `--cuk-bronze` | `#60513a` |
| Primary text | `--cuk-ink` | `#231816` |
| Page background | `--cuk-ivory` | `#f7f6f4` |
| Topbar | `--cuk-black` | `#050505` |
| Interactive link | `--cuk-link` | `#073cff` |
| Success | `--success` | `#007c72` |
| Danger | `--danger` | `#b42318` |

CUK blue is the primary action color. Bronze is a restrained supporting or warning color. Success and danger colors communicate state and must not become decorative accents.

### Typography

- Keep Pretendard as the product typeface for Korean and Latin interface text.
- Preserve the existing platform fallback stack.
- Use weight, spacing, and hierarchy before introducing another typeface.
- Do not add a display font or external font dependency without an explicit design request and a performance review.
- Product copy uses sentence case and concrete action labels.

### Shape and elevation

- Keep the compact radius system: 8px for primary surfaces and 6px for smaller controls.
- Routine dashboard and administration surfaces remain flat, with borders instead of decorative shadows.
- Do not create nested cards solely for visual decoration.
- Use icons only when they improve recognition or scanning. Every icon-only control requires an accessible name.

## Structural Invariants

### Shared topbar

- `AppTopbar` remains the shared top-level chrome for dashboard and administration pages.
- The brand and primary utility actions belong in `topbar-main`.
- The active site notice belongs in its own full-width `topbar-notice-row`; do not place it inside `topbar-actions`.
- The administration navigation remains a separate horizontally scrollable row.
- The topbar must stay within its parent width and must never enlarge the page grid.
- Long notice titles, email addresses, badges, and translated labels must wrap or truncate without overlapping adjacent controls.

### Dashboard

Unless an explicit request changes the information architecture, preserve this section order:

1. Shared topbar
2. Overall KPI summary
3. Provider summary
4. Learning data synchronization
5. Automatic learning controls
6. Upcoming lessons
7. Course status

Preserve the distinction between CU12 shared-campus data and Cyber Campus data. Do not merge provider state in a way that hides which source produced a status, action, or error.

`차시 이수율`, current-week completion, pending lesson types, unread notices, and synchronization state must remain visually distinguishable. A completed current week must not be styled as pending.

### Administration

- Administration pages share the same brand chrome but retain their dedicated subnavigation.
- Dense operational data uses tables, filters, status chips, and explicit actions.
- Do not replace operational tables with decorative card mosaics.
- Destructive actions must remain visually distinct from routine and primary actions.

### Authentication and overlays

- Keep the existing staged authentication flow and consent hierarchy.
- Dialog, sheet, popover, toast, and loading-overlay behavior must remain consistent with the existing Radix/shadcn-based primitives.
- Loading states must explain what is happening and must not expose credentials or internal secrets.

## Responsive Contract

Every user-facing UI change must be rendered at these widths:

- 1440px: wide desktop
- 1024px: compact desktop
- 719px: Codex/in-app desktop panel and narrow tablet
- 390px: mobile

At every required width:

- The document must not have horizontal overflow. Verify that the document scroll width does not exceed the body client width.
- The topbar, active notice, activity controls, and user menu must not overlap.
- Primary actions must remain visible and operable.
- Tables may use an intentional internal horizontal scroll container, but they must not widen the document.
- Korean labels must not be clipped or replaced with icon-only controls unless an accessible name remains.
- Sheets, dialogs, and popovers must fit within the viewport and retain a reachable close action.

Keep the page grid shrinkable with a zero-minimum track. Avoid child `min-width`, unbroken text, or percentage sizing that can force the root layout wider than the viewport.

## Change Boundaries

Without an explicit user request, do not:

- change the dashboard section order or primary information hierarchy;
- replace the university palette, crest, product name, or product tone;
- move the active notice back into the primary action cluster;
- introduce a new component library, icon library, CSS architecture, or font;
- perform a broad conversion between existing CSS and utility classes;
- add decorative gradients, glass effects, oversized radii, floating icon tiles, or ornamental motion;
- change desktop behavior based only on a mobile screenshot, or mobile behavior based only on a desktop screenshot;
- use broad global button or layout selectors without rendering all required widths;
- duplicate an existing topbar, card, or media-query rule instead of modifying the authoritative rule.

Third-party design skills and generated design systems are advisory. Review their instructions, scripts, hooks, dependencies, and licenses before use. They must follow this contract and may not silently replace the established visual system.

## UI Change Workflow

1. Read this file before inspecting or editing UI code.
2. Render the current implementation and record the exact problem before changing it.
3. State whether the change preserves or intentionally updates this contract.
4. Make the smallest scoped change that solves the requested problem.
5. Render the real component or page at all required widths.
6. Check loading, empty, success, failure, long-text, and translated-label states that are relevant to the change.
7. Run repository text, type, test, and web-build validation.
8. Include the rendered widths and overflow result in the pull request summary.

If an intentional visual change makes any rule here inaccurate, update `DESIGN.md` in the same pull request.
