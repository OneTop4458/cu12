# GitHub Actions Runbook

## Core Workflows

1. `ci.yml`
- Runs text quality checks, type checks, and build validation.

2. `deploy-vercel.yml`
- Deploys web application to Vercel from `main`.

3. `worker-consume.yml`
- Claims and processes queue jobs via worker runtime.
- Can be scheduled or manually dispatched.
- Uses trigger-scoped concurrency group (`sync` / `autolearn` / `digest`) to avoid global queue blocking.
- Uses queue-level concurrency control in `/apps/web/src/server/queue.ts` as the primary guard.
- No workflow-level trigger concurrency lock is used now so multiple runners can work across job types in parallel when triggered.
- Uses `npm ci --prefer-offline --no-audit` and Playwright cache for faster startup.
- Supports `WORKER_ONCE_IDLE_GRACE_MS` to shorten idle tail when running `--once`.
- Supports auto-learn heartbeat/stall controls (`AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS`, `AUTOLEARN_STALL_TIMEOUT_SECONDS`).
- Manual action dispatch treats SYNC as priority: if a job is duplicate and still running/pending within stale windows, dispatch can be skipped (`SKIPPED_DUPLICATE`) to avoid storming GitHub API; stale duplicates are force-redispatched.

4. `sync-schedule.yml`
- Dispatches periodic `SYNC` jobs every 2 hours.
- Calls `worker-consume.yml` only when new jobs were actually enqueued.

5. `mail-digest-schedule.yml`
- Dispatches daily `MAIL_DIGEST` jobs and then calls `worker-consume.yml`.
- Calls `worker-consume.yml` only when new digest jobs were enqueued.

6. `reconcile-health-check.yml`
- Calls `/internal/admin/jobs/reconcile` every 30 minutes using `WORKER_SHARED_TOKEN`.
- Fails the workflow when active job/run divergence is detected (`orphanedRunningJobsCount > 0` or `ghostRunsCount > 0`).
- Fails also when reconciliation could not be performed with GitHub API (`canReconcileWithGitHub = false`).

7. `db-retention-cleanup.yml`
- Deletes old rows by retention policy:
  - `AuditLog`: 30 days
  - `JobQueue` terminal states: 14 days
  - `MailDelivery`: 30 days

8. `actions-usage-forecast.yml`
- Forecasts monthly Actions usage and writes utilization summary.

9. `db-bootstrap.yml`
- Applies DB schema initialization (`prisma db push`).

10. `auth-reset-bootstrap.yml`
- Resets auth-related data and issues fresh admin invite code.

## Required Secrets

### GitHub

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL`
- `CU12_BASE_URL`
- `GITHUB_TOKEN` (or PAT for workflow dispatch when required)
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### Vercel

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

## Operator Sequence

1. Run `DB Bootstrap`.
2. Run `Auth Reset Bootstrap` on new environment.
3. Deploy web app (`Deploy Vercel`).
4. Confirm `/api/health`.
5. Trigger `Worker Consume` once and validate queue updates.
6. Verify `Actions Usage Forecast` summary stays below monthly threshold.

## Common Failures

### Worker env validation failed

1. Verify `APP_MASTER_KEY`, `WORKER_SHARED_TOKEN`, `DATABASE_URL`.
2. Ensure values are aligned across GitHub and Vercel.
3. Redeploy web app and rerun worker.

### Vercel deployment returns 404

1. Verify Vercel project Root Directory is `apps/web`.
2. Confirm environment variables exist in production scope.
3. Redeploy and check `/api/health`.

### Dispatch succeeded but no processing

1. Check queue status via `/api/jobs`.
2. Confirm API response `dispatchState` is `DISPATCHED` (not `NOT_CONFIGURED` / `FAILED`).
3. Review failed logs with `gh run view <run_id> --log-failed`.
4. Confirm `WEB_INTERNAL_BASE_URL` points to production URL.
5. If job state and Actions are mismatched, call `GET /internal/admin/jobs/reconcile` (or `/api/admin/jobs/reconcile` in admin UI) to identify orphaned `RUNNING` jobs or ghost runs.
