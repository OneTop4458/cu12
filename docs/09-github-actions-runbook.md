# GitHub Actions Runbook

## Core Workflows

1. `ci.yml`
   - Runs text quality, OpenAPI sync, Prisma generate, lint, typecheck, tests, and `build:web`.

2. `deploy-vercel.yml`
   - Runs the same validation gate as CI, then performs DB safety checks, `prisma db push`, auth-policy backfills, and production Vercel deploy.
   - This workflow must remain the only production deployment path. Direct Vercel Git production deploys can bypass DB sync and ship schema-mismatched code.
   - Triggers on `main` pushes affecting deploy-relevant paths and on manual dispatch.

3. `worker-consume.yml`
   - Main queue consumer workflow.
   - Supports `trigger`, `jobTypes`, and optional `userId` inputs.
   - Resolves required job types and installs Playwright only when the requested job set needs browser automation.
   - Runs the worker in `--once` mode with internal API callbacks and heartbeat reporting.

4. `sync-schedule.yml`
   - Schedule: `0 */12 * * *` UTC.
   - Enqueues provider-aware sync work and requests centralized dispatch only when pending work exists.

5. Daily digest mail
   - Disabled. No scheduled digest workflow should enqueue routine summary mail.
   - `MAIL_DIGEST` remains as the internal queue type for mandatory policy and admin approval mail payloads.

6. `autolearn-dispatch.yml`
   - Schedule: `20 0 * * *` UTC.
   - Queues AUTOLEARN only for users who currently have eligible pending work.
   - Non-user-scoped runs still trigger a global drain check so stale AUTOLEARN `PENDING` rows can attach to a worker again.
   - Manual dispatch keeps operator-trigger behavior for explicit runs.

7. `reconcile-health-check.yml`
   - Schedule: `0 */4 * * *` UTC.
   - Calls `/internal/admin/jobs/reconcile`.
   - Fails when GitHub run visibility is unavailable or when DB `RUNNING` jobs diverge from active Actions runs.

8. `db-retention-cleanup.yml`
   - Scheduled cleanup runs the worker retention task for audit logs, terminal jobs, mail deliveries, and withdrawn accounts older than 6 months.
   - The workflow also removes legacy bogus course notices.
   - Manual `user_repair` mode can target a selected user and clear their notification events during focused repair.

9. `db-bootstrap.yml`
   - Applies Prisma schema and auth-policy post-sync backfills for a new environment.

10. `manual-db-push.yml`
    - Applies Prisma schema and auth-policy post-sync backfills without a web deploy.

11. `auth-reset-bootstrap.yml`
    - Resets auth bootstrap state and pre-approves the initial admin CU12 ID.

## Auxiliary Repository Workflows

1. `secret-scan.yml`
   - Runs gitleaks on pull requests, protected-branch pushes, scheduled scans, and manual dispatch.

2. `codeql.yml`
   - Scheduled static security analysis with manual support.

3. `labeler.yml`
   - Applies labels and controls `automerge` eligibility by changed-path policy.

4. `codex-auto-merge-on-approval.yml`
   - Enables squash auto-merge for safe same-repo AI/Codex PRs and dispatches deploy after merge when appropriate.

5. `actions-usage-forecast.yml`
   - Estimates monthly Actions usage against the repository's current workload.

## Required Configuration

### GitHub repository secrets

- Required for worker or deploy:
  - `DATABASE_URL`
  - `APP_MASTER_KEY`
  - `WORKER_SHARED_TOKEN`
  - `WEB_INTERNAL_BASE_URL`
  - `CU12_BASE_URL`
  - `GITHUB_TOKEN`
- Required for deploy workflow:
  - `VERCEL_TOKEN`
  - `VERCEL_ORG_ID`
  - `VERCEL_PROJECT_ID`
- Optional but commonly used:
  - `CYBER_CAMPUS_BASE_URL`
  - `OPENAI_API_KEY`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM`
  - `AUTOLEARN_TIME_FACTOR`
  - `AUTOLEARN_MAX_TASKS`

### Vercel production environment variables

- Required:
  - `DATABASE_URL`
  - `APP_MASTER_KEY`
  - `AUTH_JWT_SECRET`
  - `WORKER_SHARED_TOKEN`
  - `CU12_BASE_URL`
  - `GITHUB_OWNER`
  - `GITHUB_REPO`
  - `GITHUB_WORKFLOW_ID`
  - `GITHUB_WORKFLOW_REF`
  - `GITHUB_TOKEN`
- Optional:
  - `CYBER_CAMPUS_BASE_URL`
  - `TRUST_PROXY_HEADERS`
  - `WORKER_DISPATCH_MAX_PARALLEL`
  - `AUTOLEARN_CHAIN_MAX_SECONDS`
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM`

### Worker runtime defaults baked into workflow env

- `PLAYWRIGHT_ACCEPT_LANGUAGE`
- `AUTOLEARN_HUMANIZATION_ENABLED`
- `AUTOLEARN_DELAY_MIN_MS`
- `AUTOLEARN_DELAY_MAX_MS`
- `AUTOLEARN_NAV_SETTLE_MIN_MS`
- `AUTOLEARN_NAV_SETTLE_MAX_MS`
- `AUTOLEARN_TYPING_DELAY_MIN_MS`
- `AUTOLEARN_TYPING_DELAY_MAX_MS`
- `POLL_INTERVAL_MS`
- `WORKER_INTERNAL_API_TIMEOUT_MS`
- `WORKER_INTERNAL_API_MAX_RETRIES`
- `WORKER_INTERNAL_API_RETRY_BASE_MS`
- `AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS`
- `AUTOLEARN_STALL_TIMEOUT_SECONDS`
- `AUTOLEARN_CHUNK_TARGET_SECONDS`
- `WORKER_ONCE_IDLE_GRACE_MS`

## Operator Sequence

1. Set GitHub secrets and Vercel env vars.
2. Run `DB Bootstrap`.
3. Run `Auth Reset Bootstrap` with the initial admin CU12 ID.
4. Deploy the web app.
5. Verify `/api/health`.
6. Log in as admin, publish the required policy documents, and approve pending users from `/admin`.
7. Trigger `worker-consume.yml` once and confirm the queue transitions as expected.
8. Review `Reconcile Health Check` before declaring the environment healthy.

## Common Failures

### Worker env validation failed

1. Verify `APP_MASTER_KEY`, `WORKER_SHARED_TOKEN`, `DATABASE_URL`, and `WEB_INTERNAL_BASE_URL`.
2. If quiz auto-solve is expected, verify `OPENAI_API_KEY`.
3. Confirm GitHub and Vercel share the same internal base URL and worker token.

### Vercel deployment returns 404

1. Confirm the Vercel project Root Directory is `apps/web`.
2. Confirm production env vars are present.
3. Re-run `Deploy Vercel` and re-check `/api/health`.

### Production deploy shipped ahead of DB sync

1. Confirm production alias ownership stayed on `deploy-vercel.yml` rather than a direct Vercel Git deploy.
2. Disable direct Vercel Git production deploys so schema changes cannot bypass GitHub Actions DB sync.
3. If code already shipped ahead of schema, run `DB Bootstrap` or `Manual DB Push`, then rerun `Deploy Vercel`.

### Dispatch succeeded but no processing

1. Check queue rows through `/api/jobs` or the admin job view.
2. Confirm `dispatchState` is not `NOT_CONFIGURED`.
3. Review failed workflow logs with `gh run view <run_id> --log-failed`.
4. Run or inspect `Reconcile Health Check` for orphaned jobs and ghost runs.
5. If Cyber Campus jobs remain `BLOCKED`, inspect the related approval session instead of retrying blindly.
