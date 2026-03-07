# GitHub Actions Runbook

## Core Workflows

1. `ci.yml`
- Runs text quality checks, type checks, and build validation.

2. `deploy-vercel.yml`
- Deploys web application to Vercel from `main`.

3. `worker-consume.yml`
- Claims and processes queue jobs via worker runtime.
- Can be scheduled or manually dispatched.
- Job timeout is capped at 120 minutes.
- Uses queue-level concurrency control in `/apps/web/src/server/queue.ts` as the primary guard.
- No workflow-level concurrency lock is configured, so multiple runners can process different job types in parallel when triggered.
- Uses `npm ci --prefer-offline --no-audit` and Playwright cache for faster startup.
- Supports `WORKER_ONCE_IDLE_GRACE_MS` to shorten idle tail when running `--once`.
- Supports auto-learn heartbeat/stall controls (`AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS`, `AUTOLEARN_STALL_TIMEOUT_SECONDS`).
- Supports AUTOLEARN chunk controls (`AUTOLEARN_CHUNK_TARGET_SECONDS`, `AUTOLEARN_MAX_TASKS`) and continuation chain cap (`AUTOLEARN_CHAIN_MAX_SECONDS`).
- Internal API calls are protected by timeout/retry controls (`WORKER_INTERNAL_API_TIMEOUT_MS`, `WORKER_INTERNAL_API_MAX_RETRIES`, `WORKER_INTERNAL_API_RETRY_BASE_MS`).
- Supports conservative browser/session realism controls (`PLAYWRIGHT_ACCEPT_LANGUAGE`, `AUTOLEARN_HUMANIZATION_ENABLED`, delay ranges).
- In `--once`, AUTOLEARN run exits after one completed chunk and hands off pending AUTOLEARN work by requesting a follow-up dispatch.
- Manual action dispatch treats SYNC as priority: if a job is duplicate and still running/pending within stale windows, dispatch can be skipped (`SKIPPED_DUPLICATE`) to avoid storming GitHub API; stale duplicates are force-redispatched.

4. `sync-schedule.yml`
- Dispatches periodic `SYNC` jobs every 2 hours.
- Calls `worker-consume.yml` only when new jobs were enqueued or pending jobs already exist from an earlier incomplete run.

5. `mail-digest-schedule.yml`
- Dispatches hourly `MAIL_DIGEST` jobs and then calls `worker-consume.yml`.
- Worker dispatch filters users by KST hour (`digestHour`) so each user receives digest at the configured hour.
- Calls `worker-consume.yml` only when new digest jobs were enqueued or pending jobs already exist from an earlier incomplete run.
- Digest and alert mails are rendered as HTML with actionable detail blocks (last 24h notice/notification changes, upcoming deadlines) and dashboard deep links.

6. `autolearn-dispatch.yml`
- Dispatches periodic AUTOLEARN jobs daily (`20 0 * * *`, UTC) and supports manual dispatch.
- Scheduled dispatch uses `--min-interval-minutes=1440` and `--eligible-window-only=true` so only users with currently available pending VOD tasks are queued.
- Manual dispatch keeps operator-trigger behavior for explicit AUTOLEARN execution.
- Calls `worker-consume.yml` only when new jobs were enqueued or pending jobs already exist from an earlier incomplete run.

7. `reconcile-health-check.yml`
- Calls `/internal/admin/jobs/reconcile` every 4 hours using `WORKER_SHARED_TOKEN`.
- Fails the workflow when active job/run divergence is detected (`orphanedRunningJobsCount > 0` or `ghostRunsCount > 0`).
- Fails also when reconciliation could not be performed with GitHub API (`canReconcileWithGitHub = false`).
- Includes workflow schedule consistency checks for `sync-schedule.yml` and `autolearn-dispatch.yml` in reconcile payload (`scheduleChecks`).

8. `db-retention-cleanup.yml`
- Deletes old rows by retention policy:
  - `AuditLog`: 30 days
  - `JobQueue` terminal states: 14 days
  - `MailDelivery`: 30 days

9. `actions-usage-forecast.yml`
- Forecasts monthly Actions usage and writes utilization summary.

10. `db-bootstrap.yml`
- Applies DB schema initialization (`prisma db push`).

11. `auth-reset-bootstrap.yml`
- Resets auth-related data and creates a fresh admin invite record from a provided invite code hash.

## Auxiliary/Repository Workflows

1. `codeql.yml`
- Weekly static security analysis with manual run support.

2. `dependabot-auto-review.yml`
- Applies automated review/label flow for Dependabot pull requests.

3. `labeler.yml`
- Applies PR labels based on changed paths.

4. `secret-scan.yml`
- Runs gitleaks-based secret scan on pull requests, protected branch pushes, daily schedule, and manual dispatch.
- Uploads SARIF findings and fails the check when leaks are detected.

5. `stale.yml`
- Marks and closes stale issues/PRs according to repository policy.

## Bootstrap Invite Hash Input

For `admin-bootstrap.yml` and `auth-reset-bootstrap.yml`, set `inviteCodeHash` with SHA-256 (lowercase hex) of your intended invite code.

Example (Node.js):

```bash
node -e "const c=require('node:crypto');const code='replace-with-invite-code';console.log(c.createHash('sha256').update(code).digest('hex'))"
```

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
2. Run `Auth Reset Bootstrap` on new environment with `inviteCodeHash`.
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
5. If job state and Actions are mismatched, call `GET /internal/admin/jobs/reconcile` (or `GET /api/admin/jobs/reconcile` in admin UI) to identify orphaned `RUNNING` jobs or ghost runs.
6. `RUNNING_STALE` for sync queue now requires both elapsed-time threshold and stale/missing worker heartbeat.
