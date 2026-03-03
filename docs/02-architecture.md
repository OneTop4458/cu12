# Architecture

## Runtime Components

1. **Web Application (`apps/web`)**
- Next.js app hosted on Vercel.
- Provides login, dashboard UI, and API routes.
- Writes jobs to queue and dispatches worker workflow.

2. **Worker (`apps/worker`)**
- Node.js + Playwright runtime.
- Logs in to CU12, fetches snapshots, executes auto-learning steps.
- Reports heartbeat and job state transitions.

3. **Database (`prisma/schema.prisma`)**
- PostgreSQL (Neon).
- Stores users, invite tokens, encrypted CU12 credentials, queue, and snapshots.

4. **GitHub Actions (`.github/workflows`)**
- CI validation, cloud deploy, scheduled sync, and worker consumption.
- Optional maintenance workflows (bootstrap, backup, dependabot automation).

## Login and Onboarding Flow

1. Client posts CU12 credentials to `POST /api/auth/login`.
2. Server verifies CU12 credentials in real time.
3. Existing mapped account: session cookie is issued immediately.
4. New account: returns `INVITE_REQUIRED` + short-lived challenge token.
5. Client submits challenge token + invite code to `POST /api/auth/login/invite`.
6. Server validates invite binding (`cu12Id`) and creates user mapping.

## Job Execution Flow

1. User triggers dashboard action (sync or auto-learning).
2. API enqueues a `JobQueue` row with metadata/idempotency key.
3. API dispatches `worker-consume.yml` via GitHub API.
4. Worker claims pending jobs atomically and executes CU12 automation.
5. Worker updates status (`RUNNING` -> `SUCCEEDED`/`FAILED`) and snapshots.

## Why This Model

- Works without dedicated long-running personal server.
- Keeps user-facing app lightweight while offloading browser automation.
- Supports low-scale, high-duration workloads (video watch time) safely.