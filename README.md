# Catholic University Automation

Catholic University Automation is a cloud-first service that verifies portal credentials, tracks course and notice status, and executes queue-based auto-learning jobs across CU12 and Cyber Campus.

## 1. Product Summary

The project is designed for a small private group (about 5 users) where only approved CU12 IDs can access the system.

Core goals:

1. Real CU12 login verification on every sign-in.
2. One-time invite verification for first login only.
3. Dashboard visibility for progress/notices/jobs.
4. Cloud-only execution for long-running auto-learning tasks.
5. Email alerts for new notices, deadline risk, and auto-learning lifecycle (start + end).

## 2. Architecture at a Glance

```text
Browser (User)
  -> Next.js Web App (Vercel)
     -> PostgreSQL (Neon)
     -> GitHub API (workflow_dispatch)
           -> GitHub Actions Worker (Playwright)
                -> CU12 Website
```

### Components

1. `apps/web`
- Next.js App Router UI + API endpoints.
- Auth/session management (`session`, login challenge, admin impersonation).
- Queue writes and worker dispatch calls.
- User dashboard + admin operations center.

2. `apps/worker`
- Node.js + Playwright automation runtime.
- CU12 login, snapshot sync, auto-learning execution.
- Notice detail fetch + deadline alert evaluation + mail dispatch.

3. `prisma`
- Shared PostgreSQL schema.
- Queue state, account state, invite tokens, snapshots, audit logs, deadline alert dedupe.

4. `.github/workflows`
- CI validation, DB bootstrap, deploy, scheduled/manual worker execution.

## 3. Authentication Model

### Step 1: CU12 Credential Verification

`POST /api/auth/login`

- Validates `cu12Id + cu12Password + campus` against CU12.
- Existing account mapping returns `AUTHENTICATED` and sets `cu12_session` cookie.
- New account returns `INVITE_REQUIRED` + short-lived `challengeToken`.

### Step 2: Invite Verification (First Login Only)

`POST /api/auth/login/invite`

- Validates `challengeToken + inviteCode`.
- Invite code must be unexpired, unused, and bound to the same `cu12Id`.
- On success, creates user mapping and sets session cookie.

### Error Handling Policy

- Login API responses use generalized auth failure codes to reduce account/enrollment enumeration risk.
- `POST /api/auth/login` returns `errorCode = AUTH_FAILED` for authentication failures.
- `POST /api/auth/login/invite` returns `errorCode = INVITE_VERIFICATION_FAILED` for invite validation failures.
- Expired/invalid challenge tokens remain explicit as `errorCode = LOGIN_CHALLENGE_INVALID`.
- Detailed root causes (invalid CU12 credentials, inactive/expired invite, unapproved CU12 ID) are captured in audit logs for operators.

## 4. Queue and Concurrency

Queue table: `JobQueue`

Supported job types:

- `SYNC`
- `AUTOLEARN`
- `NOTICE_SCAN`
- `MAIL_DIGEST`

Concurrency model:

1. Worker claims jobs atomically (`PENDING -> RUNNING`).
2. Per-user serialization avoids session collisions.
3. Retry policy uses backoff for transient failures.
4. Idempotency keys reduce duplicate queue requests.
5. Auto-learning progress is persisted to job `result` during RUNNING state.

## 5. Runtime Features

1. First-login auto sync: the dashboard auto-queues one SYNC job if no successful sync exists.
2. Smart polling refresh: dashboard data refreshes adaptively (120s active / 300s idle/background) and on tab re-focus.
3. Auto-learning modes:
- `ALL_COURSES`
- `SINGLE_ALL`
- `SINGLE_NEXT`
4. Scheduled auto-learning dispatch:
- Runs every 2 hours (`20 */2 * * *`, UTC).
- Scheduled dispatch only enqueues users who currently have available pending VOD tasks.
5. In-dashboard email preferences:
- destination email
- notice/deadline/autolearn immediate alerts (autolearn start + end)
- daily digest toggle + digest hour (KST, dispatched hourly and filtered by user digest hour)
6. Admin-only capabilities:
- member creation/update with CU12 credential verification
- one-time invite code issue and tracking
- admin-to-user impersonation view for troubleshooting
- audit log search (`AUTH`, `ADMIN`, `JOB`, `WORKER`, `MAIL`, `IMPERSONATION`, etc.)

## 6. Cloud Deployment Topology

- **Web/API**: Vercel (`apps/web`)
- **DB**: Neon PostgreSQL
- **Worker**: GitHub Actions (`worker-consume.yml`)
- **Source + CI/CD**: GitHub

No always-on local server is required.

## 7. Repository Layout

```text
apps/
  web/       # Next.js UI + API
  worker/    # Playwright worker
packages/
  core/      # shared parser/types
prisma/      # schema and migrations
.github/
  workflows/ # CI/CD and operations automation
docs/        # architecture, API, runbooks, ADRs
```

## 8. Local Validation Commands

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run check:text
pnpm run check:openapi
pnpm run typecheck
pnpm run test:web
pnpm run test:ops
pnpm run build:web
```

Reuse the existing install between worktrees unless `pnpm-lock.yaml` or the active Node version changes.
Re-run `pnpm run prisma:generate` after a fresh install and whenever `prisma/schema.prisma` or Prisma model usage changes.

### Codex Worktree Workflow

- In a Codex-linked worktree, `pnpm run ai:start -- --task "<task-slug>"` reuses the current linked worktree and creates or reuses `ai/session-<thread-id>` instead of nesting another repo-local worktree.
- Use `pnpm run ai:worktree -- --task "<task-slug>"` only for manual fallback parallel work outside the default Codex flow.
- After merge or abandonment, run `pnpm run ai:clean` to remove merged clean repo-local worktrees and stale locks.

When changes are made by AI-assisted workflows, commits and pushes must only happen after:
- `pnpm run check:text`
- `pnpm run check:openapi`
- `pnpm run typecheck`
- `pnpm run test:web`
- `pnpm run test:ops`
- `pnpm run build:web` (when web scope is touched)

## 2026-03-04 UI/UX Modernization
- Added a modernized web shell in `apps/web` with shared visual tokens in `apps/web/app/globals.css`.
- Added theme system support with `next-themes` (`light`, `dark`, `system`) and a reusable theme provider.
- Modernized dashboard and admin headers into a unified topbar with quick actions, notification center, and user menu.
- Introduced reusable UI modules:
  - `apps/web/components/theme/theme-provider.tsx`
  - `apps/web/components/theme/theme-toggle.tsx`
  - `apps/web/components/layout/user-menu.tsx`
  - `apps/web/components/notifications/notification-center.tsx`
- Updated login shell for consistent visual framing and preserved core auth flow behavior.
- Validation commands executed:
  - `pnpm run check:text`
  - `pnpm run check:openapi` (current baseline requirement)
  - `pnpm run prisma:generate`
  - `pnpm run typecheck`
  - `pnpm run build:web`

## 9. Required Environment Variables

### Common

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `CU12_BASE_URL`

### Web Dispatch

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW_ID`
- `GITHUB_WORKFLOW_REF`
- `GITHUB_TOKEN`

### SMTP (optional but recommended for alerts)

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## 10. Operations Quick Start

1. Configure GitHub Secrets and Vercel environment variables.
2. Run `DB Bootstrap` workflow.
3. For fresh setup, run `Auth Reset Bootstrap` with `inviteCodeHash` (SHA-256 hash of your chosen invite code).
4. Deploy web app and verify `/api/health`.
5. Trigger `worker-consume.yml` once to validate queue consumption.
6. Admin logs in and issues invite codes for users.

## 11. Documentation

- Main docs index: [`docs/00-index.md`](docs/00-index.md)
- API contract: [`docs/04-api/openapi.yaml`](docs/04-api/openapi.yaml)
- Korean summary: [`README.ko.md`](README.ko.md)
