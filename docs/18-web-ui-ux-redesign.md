# Web UI/UX Modernization (2026-03-04)

> Historical note: This document captures the 2026-03-04 redesign pass. Use `README.md` and the living docs for the current product and operational baseline.

## Scope

- Modernized web experience inside `apps/web` while keeping existing behavior and API contracts intact.
- Added a consistent theme system and top-level chrome used by dashboard and admin pages.
- Standardized user interaction affordances around modern components (Radix, icon actions, and toast-ready UI shell).

## Updated Components

- `apps/web/components/theme/theme-provider.tsx`
- `apps/web/components/theme/theme-toggle.tsx`
- `apps/web/components/layout/user-menu.tsx`
- `apps/web/components/notifications/notification-center.tsx`
- `apps/web/lib/cn.ts`

## Page Updates

- `apps/web/app/login/page.tsx` now uses a refreshed auth shell and shared theme control.
- `apps/web/app/dashboard/dashboard-client.tsx` now uses a unified topbar with refresh, theme, notification, and user menu.
- `apps/web/app/admin/admin-client.tsx` now has the same modernized topbar and user workflow controls.

## Styling Refresh

- `apps/web/app/globals.css` moved to token-based styling, with new utilities for:
  - `topbar`, `notification-trigger`, `user-menu`, and `icon-btn` interactions
  - consistent dashboard/admin card and section spacing
  - responsive breakpoints for modern layout behavior

## Verification

- Required commands were run:
  - `pnpm run check:text`
  - `pnpm run check:openapi` (current baseline requirement)
  - `pnpm run prisma:generate`
  - `pnpm run typecheck`
  - `pnpm run build:web`

## 2026-04-27 shadcn/ui Follow-up

- Added Tailwind CSS v4 and shadcn/ui source components to `apps/web`.
- Kept the existing App Router routes, API contracts, authentication stages, and Prisma schema unchanged.
- Added a shared mobile sheet navigation component for dashboard and admin surfaces.
- Updated the shared theme toggle, notification center, user menu, and login shell to use shadcn primitives while preserving the existing data flow.
- Shifted the visual system toward a compact operational dashboard style: neutral background, tighter radius, reduced decorative motion, clearer card/table density, and token-based light/dark colors.

## Codex Skills Review

- Installed official `openai/skills` curated skills: `figma`, `figma-use`, `figma-implement-design`, `figma-generate-design`, `figma-create-design-system-rules`, `screenshot`, `playwright`, `playwright-interactive`, `security-best-practices`, `security-threat-model`, `gh-address-comments`, `gh-fix-ci`, and `vercel-deploy`.
- Did not install third-party skill repositories. Review status:
  - `ComposioHQ/awesome-codex-skills`: active repository, no detected repository-level license metadata from GitHub API, hold for manual license review.
  - `mxyhi/ok-skills`: active repository with Apache-2.0 metadata, still requires folder-level `SKILL.md` and dependency review before install.
  - `proflead/codex-skills-library`: older activity than the other candidates and no detected repository-level license metadata, hold for manual review.
