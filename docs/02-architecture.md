# Architecture

## Runtime Components

1. **Web application (`apps/web`)**
   - Next.js App Router application hosted on Vercel.
   - Owns login, invite verification, policy consent, dashboard APIs, admin APIs, and public pages.
   - Enqueues jobs, applies manual redispatch policy, and exposes internal endpoints for worker callbacks and centralized dispatch.

2. **Worker (`apps/worker`)**
   - Node.js runtime executed by `worker-consume.yml`.
   - Uses browserless HTTP paths for sync-oriented work where possible.
   - Uses Playwright for CU12 auto-learning playback and Cyber Campus flows that require browser automation.
   - Sends heartbeat, progress, finish, and failure callbacks through internal web APIs.

3. **Shared core (`packages/core`)**
   - Holds parser logic, provider helpers, queue payload types, and cross-runtime contracts.

4. **Database (`prisma/schema.prisma`)**
   - Neon PostgreSQL accessed through Prisma.
   - Stores users, portal-account linkage, policy history, queue state, snapshots, portal sessions, approval sessions, mail subscriptions, and audit logs.

5. **Workflow layer (`.github/workflows`)**
   - Runs CI, deploy, DB bootstrap, scheduled dispatch, reconcile, and retention cleanup.
   - Acts as the execution envelope for the worker runtime.

## Authentication and Onboarding Flow

1. Client calls `POST /api/auth/login` with CU12 credentials and optional provider hint.
2. Server verifies credentials against the portal in real time.
3. Existing approved account:
   - if policy consent is current, session + idle cookies are issued immediately
   - if consent is missing/outdated, server returns `CONSENT_REQUIRED` with a short-lived consent token
4. First login:
   - server returns `INVITE_REQUIRED` with a short-lived login challenge token
   - client exchanges the challenge token plus invite code at `POST /api/auth/login/invite`
   - after account linking, the flow either completes authentication or continues to policy consent
5. `POST /api/auth/consent` records immutable consent rows and issues the final authenticated cookies.

## Dashboard and Data Flow

1. The dashboard bootstrap path (`GET /api/dashboard/bootstrap`) aggregates:
   - session actor/effective context
   - cross-provider summary
   - overall and per-provider sync queue state
   - site notices and maintenance notice
   - account automation settings
   - Cyber Campus portal/approval-session state
   - mail preferences
2. Provider-specific dashboard endpoints such as notifications and messages can resolve provider from either:
   - explicit `?provider=CU12|CYBER_CAMPUS`
   - the user's currently selected provider context
3. First-login users with no successful sync can auto-trigger a single SYNC request from the dashboard shell.

## Queue, Dispatch, and Internal APIs

1. Web APIs enqueue `JobQueue` rows with idempotency keys.
2. Manual user-triggered requests apply a redispatch policy:
   - new jobs dispatch immediately
   - fresh duplicates return `SKIPPED_DUPLICATE`
   - stale pending/running duplicates can trigger forced redispatch
3. Centralized worker fan-out is exposed through `POST /internal/worker/dispatch` and capped by `WORKER_DISPATCH_MAX_PARALLEL`.
4. Worker lifecycle callbacks use internal routes:
   - `/internal/worker/heartbeat`
   - `/internal/worker/job/start`
   - `/internal/worker/job/progress`
   - `/internal/worker/job/finish`
   - `/internal/worker/job/fail`
   - `/internal/worker/job/pending`
5. Reconcile tooling uses `/internal/admin/jobs/reconcile` to compare DB `RUNNING` jobs against live GitHub workflow runs.

## Provider-Specific Auto-Learning Paths

### CU12

1. Worker authenticates with stored encrypted credentials.
2. Sync and notice collection prefer HTTP flows.
3. Auto-learning uses Playwright for VOD playback and interactive tasks.
4. Supported execution currently covers VOD, material, and optional quiz flows.

### Cyber Campus

1. Auto-learning first tries to reuse a valid stored `PortalSession`.
2. If secondary authentication is required, the web app creates:
   - a `BLOCKED` AUTOLEARN job
   - a `PortalApprovalSession` with the available approval methods and encrypted cookie state
3. The user starts and confirms the selected approval method through the approval APIs.
4. On completion, the web app stores a fresh `PortalSession`, unblocks the queued job, and dispatches the worker.

## Why This Model

- It keeps the user-facing app lightweight while isolating long-running automation in workflows.
- It allows provider-specific auth/session rules without forcing the dashboard or DB schema into separate applications.
- It keeps failure handling observable through queue rows, heartbeats, audit logs, and reconcile checks instead of opaque browser-only state.
