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
