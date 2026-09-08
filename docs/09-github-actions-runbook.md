# GitHub Actions Runbook

## Core Workflows

1. `ci.yml`
   - Runs text quality, OpenAPI sync, Prisma generate, lint, typecheck, tests, and `build:web`.
   - Runs on PRs and develop pushes; main deployment performs its own exact-commit validation instead of launching the same CI gate twice. New PR updates cancel only older CI runs for that PR.

2. `deploy-vercel.yml`
   - Serializes production runs without canceling in-progress DB work. A plan job finds the latest successful deploy job, skips duplicate successful commits, and diffs all changes since that deployment.
   - Runs the full validation gate once for the deployment commit. DB guards run on first deployment, forced redeployment, or Prisma/DB-script/DB-workflow changes; an ordinary web-only change skips them.
   - Re-runs the idempotent active-job dedupe backfill after deploy to absorb null-key rows created during the old/new application handoff window.
   - Never add `--accept-data-loss`; the prepare step creates the exact Prisma-compatible unique index before schema sync on populated databases.
   - This workflow must remain the only production deployment path. Direct Vercel Git production deploys can bypass DB sync and ship schema-mismatched code.
   - `apps/web/vercel.json` disables native Git deployment for main only; PR previews remain enabled.
   - Triggers on `main` pushes affecting deploy-relevant paths and on manual dispatch.
   - The merged-PR handler covers ordinary close events. `publish-auto-merge.yml` covers bot merges whose push and closed events are suppressed by GITHUB_TOKEN. All entry points use the same serialized duplicate guard. Worker-only changes do not redeploy the web app.
   - Use manual input `force=true` to intentionally redeploy the same successful commit, including environment-only repairs. Lookup failures stop deployment rather than guessing.

3. `worker-consume.yml`
   - Main queue consumer workflow.
   - Supports `trigger`, `jobTypes`, and optional `userId` inputs.
   - Resolves required job types and installs Playwright only when the requested job set needs browser automation.
   - Runs the worker in `--once` mode with internal API callbacks and heartbeat reporting.
   - Uses the GitHub-hosted runner job maximum of 360 minutes so long Cyber Campus runs and same-run retries are not cut off by the repository workflow timeout.
   - Pure sync batches may continue across users for up to ten jobs/ten minutes of claiming and use fifteen-second idle grace. Current collection and retry waits are not interrupted; autolearn timing and limits are unchanged.
   - `worker-sync-handoff.yml` runs a lightweight pending-sync dispatch check after a trusted main Worker Consume run completes. It installs no dependencies. Manual handoff is supported on main for recovery.

4. `sync-schedule.yml`
   - Schedule: `7 */12 * * *` UTC (09:07 and 21:07 KST).
   - Active accounts keep a 720-minute freshness window. Accounts without active provider courses, autolearn, activity detection, digest, or important mail use 1440 minutes. Disabled/unapproved users are excluded.
   - Complete post-autolearn snapshots satisfy the same provider checkpoint after notification processing. Near-deadline mail checks bypass reuse; explicit manual refresh remains immediate.
   - Enqueues provider-aware sync work and requests centralized dispatch only when pending work exists.

5. Daily digest mail
   - Disabled. No scheduled digest workflow should enqueue routine summary mail.
   - `MAIL_DIGEST` remains as the internal queue type for policy publication and admin approval request mail payloads.

6. `autolearn-dispatch.yml`
   - Schedule: `20 0 * * *` UTC.
   - Queues AUTOLEARN only for users who currently have eligible pending work.
   - Non-user-scoped runs still trigger a global drain check so stale AUTOLEARN `PENDING` rows can attach to a worker again.
   - Manual dispatch keeps operator-trigger behavior for explicit runs.

7. `reconcile-health-check.yml`
   - Schedule: `43 */4 * * *` UTC.
   - Calls `/internal/admin/jobs/reconcile`.
   - Automatically POSTs the internal reconcile endpoint when DB `RUNNING` jobs are orphaned, verifies the mismatch is gone, then kicks pending sync workers.
   - Fails when GitHub run visibility is unavailable, repair cannot clear orphaned `RUNNING` jobs, or active ghost runs have no matching DB job.

8. `db-retention-cleanup.yml`
   - Scheduled cleanup removes expired login-throttle buckets, expired or invalid portal sessions, terminal portal-approval history older than 30 days, audit logs, terminal jobs, mail deliveries, and withdrawn accounts older than 6 months.
   - Its JSON summary reports only aggregate deletion counts and failed step names; it must never print user identifiers, cookies, approval codes, or other authentication metadata.
   - The workflow also removes legacy bogus course notices.
   - Manual `user_repair` mode can target a selected user and clear their notification events during focused repair.

### Post-deploy cleanup for legacy login-throttle rows

1. No Prisma schema migration and no new secret are required. The web app derives rate-limit bucket HMACs from the existing `AUTH_JWT_SECRET` with a dedicated domain separator.
2. Rows created by older releases can contain raw portal IDs or IP addresses and are no longer read after the digest-based release is deployed.
3. Wait at least 15 minutes after deployment so every legacy window or block has expired, then manually run `DB Retention Cleanup` once.
4. Confirm only the aggregate `deleted.authRateLimits` count. Do not query, print, or copy legacy bucket keys or identifiers into workflow logs or tickets.
5. Rotating `AUTH_JWT_SECRET` intentionally invalidates current rate-limit buckets together with JWT signatures; follow the normal forced re-login procedure after rotation.

9. `db-bootstrap.yml`
   - Applies Prisma schema and active-job-dedupe/auth-policy post-sync backfills for a new environment.

10. `manual-db-push.yml`
    - Applies Prisma schema and active-job-dedupe/auth-policy post-sync backfills without a web deploy.

11. `auth-reset-bootstrap.yml`
    - Requires `confirmReset=RESET_CU12_AUTH`, truncates user/account, queue, snapshot, learning, and mail data (including related cascading rows), and pre-approves the initial admin CU12 ID. Use only for an intentional environment reset.

12. `admin-bootstrap.yml`
    - Pre-approves or updates the selected admin CU12 ID without truncating other application data. Use this workflow when only admin access needs bootstrapping.

13. `reconcile-orphan-repair.yml`
    - Provides targeted internal orphan repair, verification, and pending sync dispatch. Runs manually and on `main` pushes to the repair-related paths listed in the workflow.

## Auxiliary Repository Workflows

1. `secret-scan.yml`
   - Runs gitleaks on pull requests, protected-branch pushes, scheduled scans, and manual dispatch.

2. `codeql.yml`
   - Scheduled static security analysis with manual support.

3. `labeler.yml`
   - Applies labels and controls `automerge` eligibility by changed-path policy.

4. `codex-auto-merge-on-approval.yml`
   - Despite the filename, this is `PR Auto Merge On CI`: it enables squash auto-merge for non-draft, same-repo, non-Dependabot PRs carrying `automerge`, then relies on required branch checks rather than a Codex review.
   - Changes under `.github/workflows/`, `prisma/`, `scripts/`, or to `AGENTS.md` are excluded. Its closed-PR handler dispatches deployment for merged same-repo PRs into `main` when deploy-relevant files changed.

5. `actions-usage-forecast.yml`
   - Runs weekly at 19:23 Monday UTC (04:23 Tuesday KST), with manual runs available.
   - Lists up to 1,000 runs created in the past seven days and measures jobs for the latest 200, including PRs and all available attempts. The report explicitly labels the sample and provisional running minutes.
   - Reports actual summed job duration and initial workflow wait separately; dependent-job delays are not presented as runner time. It does not forecast a private-repository 2,000-minute budget for this public repository.

### Quiz model compatibility check

`quiz-model-check.yml` is manual-only and does not add scheduled Actions work. It reads the saved quiz model and invokes the existing `OPENAI_API_KEY` for three synthetic choice, Korean text, and sequence questions. It never opens a portal or submits a real quiz. Logs contain only model, aggregate pass count, duration, and sanitized error status/code. Normal API token charges apply. Passing verifies basic access and response compatibility, not accuracy on course questions. See the [quiz AI settings guide](23-quiz-ai-settings.md).

### Publishing bot merges

`Publish Auto Merge` reacts to successful CI, Secret Scan, and repository auto-merge workflow completions. It executes only code checked out from trusted main, resolves the associated same-repository PR, and checks its current head/base.

If auto-merge was already enabled, it may complete the normal head-matched merge while GitHub enforces branch protection. A pending gate or changed head is left for a later check event; a concurrent successful merge is detected. It never enables auto-merge for a manual PR. Once merged, deploy-relevant changes explicitly dispatch Deploy Vercel, including when GITHUB_TOKEN suppresses push/closed events.

The workflow also accepts a main-only manual PR-number input for repair. Multiple check events are coalesced per source head; the deployment workflow prevents duplicate production work. See [GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).

6. `dependabot-auto-review.yml`
   - Verifies the Dependabot author, same-repository source, and `dependabot/` branch before reading update metadata.
   - Approves patch/minor updates and enables squash auto-merge; major updates receive `major-update` and have auto-merge disabled for manual review.

### Dependabot auto-merge prerequisites and recovery

1. Enable repository auto-merge and retain the required `test` and `secret-scan` checks. Enabling auto-merge waits for branch requirements; it does not bypass them. See [GitHub auto-merge configuration](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository).
2. In **Settings > Actions > General > Workflow permissions**, enable **Allow GitHub Actions to create and approve pull requests**. The workflow declares `contents: write` and `pull-requests: write`, but the separate repository/organization approval setting must also permit its review step. See [GitHub Actions repository settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).
3. If approval fails, inspect the failed `Dependabot Auto Review` step before retrying. Correct the repository setting or permission cause, then rerun the failed workflow once.
4. If approval succeeded but the PR remains open, inspect required checks, conflicts, draft state, and update type. Major updates are intentionally held for manual review. Do not weaken branch protection to make a pending update merge.

## Required Configuration

### GitHub repository secrets

- Required for worker or deploy:
  - `DATABASE_URL`
  - `APP_MASTER_KEY`
  - `WORKER_SHARED_TOKEN`
  - `WEB_INTERNAL_BASE_URL`
  - `CU12_BASE_URL`
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

GitHub Actions supplies its job-scoped `GITHUB_TOKEN` automatically; do not create a repository secret with that name. The web application's `GITHUB_TOKEN` is separately configured in Vercel for workflow dispatch.

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

### Vercel function region

- The Vercel project Root Directory is `apps/web`, so its checked-in project configuration is `apps/web/vercel.json`.
- The configuration selects only `sin1` (Singapore). Vercel supports one selected region on the free Hobby plan, so this does not enable a paid add-on or on-demand billing; Hobby usage remains subject to its included limits. Do not add a second region, `functionFailoverRegions`, or a Fluid Compute override.
- After `Deploy Vercel` completes, request `/api/health` and inspect `X-Vercel-Id`; the function-execution region should be `sin1`. The nearest edge PoP may be a different region.
- The same runtime region is available to a Vercel Function as `VERCEL_REGION`. Inspect the invocation metadata or a narrowly scoped diagnostic log; never dump all environment variables.
- To roll back, revert the region configuration through a pull request, let `Deploy Vercel` publish the previous configuration, and verify `X-Vercel-Id` again. Do not change the production project manually.
- References: [Vercel `regions` configuration](https://vercel.com/docs/project-configuration/vercel-json#regions), [Vercel Hobby limits](https://vercel.com/docs/plans/hobby), and [Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-id).

### Worker runtime defaults baked into workflow env

- `PLAYWRIGHT_ACCEPT_LANGUAGE`
- `PLAYWRIGHT_NAVIGATION_TIMEOUT_MS`
- `PLAYWRIGHT_NAVIGATION_RETRIES`
- `PLAYWRIGHT_NAVIGATION_RETRY_BASE_MS`
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
- `CYBER_CAMPUS_AUTOLEARN_CHUNK_TARGET_SECONDS`
- `CYBER_CAMPUS_AUTOLEARN_MAX_TASKS`
- `WORKER_WORKFLOW_STARTED_AT_MS` (set by `worker-consume.yml`)
- `WORKER_ONCE_IDLE_GRACE_MS`
- `WORKER_RETRY_WAIT_MAX_MS`

## Operator Sequence

1. Set GitHub secrets and Vercel env vars.
2. Run `DB Bootstrap`.
3. Run `Auth Reset Bootstrap` with the initial admin CU12 ID.
4. Deploy the web app.
5. Verify `/api/health`.
6. Log in as admin, publish the required policy documents, and approve pending users from `/admin`.
7. Trigger `worker-consume.yml` once and confirm the queue transitions as expected.
8. Review `Reconcile Health Check` before declaring the environment healthy.

### Administrator mail settings rollout

The normal deploy schema-sync stage applies `MailSettings` and `MailTemplate` before publishing the web app; use `DB Bootstrap` if a separate schema application is needed. Existing installations default to ENV mail settings until an administrator saves a CUSTOM configuration. In ENV mode, SMTP secrets remain separate in Vercel and GitHub Actions; CUSTOM shares encrypted database settings and requires the same `APP_MASTER_KEY` in both runtimes. See the [administrator member and mail guide](21-admin-member-mail-guide.md) for save, preview, connection verification, and intentional test-send behavior.

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
4. Run or inspect `Reconcile Health Check` for orphaned jobs and ghost runs; it should self-repair orphaned DB `RUNNING` rows, kick pending sync workers, and fail only if verification still reports a mismatch.
5. If Cyber Campus jobs remain `BLOCKED`, inspect the related approval session instead of retrying blindly.
