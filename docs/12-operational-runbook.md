# Operational Runbook

## Daily Checks

1. Confirm the latest `worker-consume` run completed successfully.
2. Review `Reconcile Health Check` and ensure it reports no orphaned running jobs or ghost runs.
3. Check for spikes in `FAILED` or `BLOCKED` jobs.
4. Review accounts marked `NEEDS_REAUTH`.
5. Spot-check recent `MailDelivery` rows if mail features are enabled.
6. Confirm the latest DB retention cleanup reports aggregate rate-limit, portal-session, and portal-approval deletion counts without authentication payloads or identifiers.

## Manual Sync Procedure

1. Trigger `POST /api/jobs/sync-now`.
2. Optionally narrow the request to specific providers (`CU12`, `CYBER_CAMPUS`) when needed.
3. Confirm the response includes the queued provider list, per-provider results, and `dispatchState`.
4. If `dispatchState` is `SKIPPED_DUPLICATE`, monitor the existing in-flight work before retrying.
5. Track job progression through `/api/jobs` or the admin job view.

## Active Job Dedupe Rollout

1. Failure baseline: [Deploy Vercel run 33591065134](https://github.com/OneTop4458/cu12/actions/runs/33591065134) stopped because `prisma db push` saw the new unique index before the post-push backfill and refused its data-loss warning.
2. Merge the rollout fix through a pull request. Do not run the prepare/finalize script directly against production from a local shell, and never use `--accept-data-loss`.
3. Re-run `Deploy Vercel`. Its prepare step is a no-op when `JobQueue` does not exist; otherwise it adds the nullable column, locks the table, keeps one `RUNNING` row when possible (otherwise the oldest `PENDING` row), cancels other active duplicates, and backfills all active keys.
4. After both verification counts reach zero, prepare creates `JobQueue_activeDedupeKey_key` only when missing. An existing index with a different definition fails without being dropped or recreated.
5. `prisma db push` now sees the expected nullable column and unique index. The post-sync finalize step verifies/backfills fresh databases after schema creation.
6. After the new web deployment, the workflow runs finalize again to absorb null-key rows created during the deployment handoff.
7. Confirm prepare and both finalize summaries report `remainingUnkeyedActiveRows: 0`, `remainingDuplicateGroups: 0`, and `indexReady: true`. Do not print job payloads, dedupe keys, or user identifiers while investigating.
8. Verify new manual and scheduled duplicate requests return one active job ID. Terminal history remains stored, and the same logical key may create a new job after completion.

## Course Roster Reconciliation Rollout

1. Deploy the roster reconciliation change through the normal pull request and `Deploy Vercel` workflow path.
2. Manually dispatch `Scheduled Sync Dispatch` once with `minIntervalMinutes=0`. This queues a full provider-aware sync for every connected non-test user instead of waiting for the next scheduled interval.
3. Monitor the resulting sync jobs and confirm successful worker audit metadata reports `endedCourseCount`. The count is aggregate-only and must not be expanded with user or course names in public workflow logs.
4. Confirm current dashboard course, deadline, notice, and activity views no longer include ended courses. Historical course rows and related records remain stored.
5. Accounts in `NEEDS_REAUTH` cannot produce a verified roster. Have those users reauthenticate and complete a full sync later; do not infer course state from IDs, titles, dates, or manual database updates.

## Manual Auto-learning Procedure

1. Trigger `POST /api/jobs/autolearn-request`.
2. For CU12, expect immediate queueing unless the request deduplicates against existing work.
3. For Cyber Campus:
   - if a reusable provider session exists, expect immediate queueing
   - if secondary auth is required, expect `approvalRequired=true` and a `BLOCKED` job
4. Complete approval with:
   - `POST /api/cyber-campus/approval/{approvalId}/start`
   - `POST /api/cyber-campus/approval/{approvalId}/confirm`
5. After approval completion, confirm the approval session reaches `COMPLETED` and the blocked job either moves into same-session AUTOLEARN execution or closes as a no-op when no runnable target tasks remain.
6. Monitor `LearningRun` results and dashboard task updates.

## New Environment Bootstrap

1. Run `DB Bootstrap`.
2. Run `Auth Reset Bootstrap` with the initial admin CU12 ID.
3. Deploy the web app and verify `/api/health`.
4. Log in as admin and publish the required policy documents.
5. Approve pending end users from `/admin` after they complete first-login credential verification.
6. Trigger `worker-consume.yml` once to verify queue processing.

## Incident Response

### Login failures spike

1. Check CU12 and Cyber Campus upstream availability.
2. Review recent auth audit logs and throttling behavior.
3. Validate base URL overrides and portal contract changes.

### Auto-learning failures spike

1. Check whether failures are concentrated in `CU12` or `CYBER_CAMPUS`.
2. For `BLOCKED` Cyber Campus jobs, inspect approval-session expiry or user confirmation state before retrying.
3. For CU12 AUTOLEARN stalls, inspect heartbeat cadence and worker logs around the last progress event.
4. Re-check Playwright-related env tuning only after confirming the upstream contract has not changed.

### Workflow failures

1. Validate secrets and internal URL alignment.
2. Confirm GitHub Actions capacity has not been saturated.
3. If queue rows remain `PENDING` without active runs, inspect reconcile output and dispatch configuration.
4. If queue rows remain `BLOCKED`, resolve or cancel the approval session instead of manually mutating the DB.
