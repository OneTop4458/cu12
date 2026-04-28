# Operational Runbook

## Daily Checks

1. Confirm the latest `worker-consume` run completed successfully.
2. Review `Reconcile Health Check` and ensure it reports no orphaned running jobs or ghost runs.
3. Check for spikes in `FAILED` or `BLOCKED` jobs.
4. Review accounts marked `NEEDS_REAUTH`.
5. Spot-check recent `MailDelivery` rows if mail features are enabled.

## Manual Sync Procedure

1. Trigger `POST /api/jobs/sync-now`.
2. Optionally narrow the request to specific providers (`CU12`, `CYBER_CAMPUS`) when needed.
3. Confirm the response includes the queued provider list, per-provider results, and `dispatchState`.
4. If `dispatchState` is `SKIPPED_DUPLICATE`, monitor the existing in-flight work before retrying.
5. Track job progression through `/api/jobs` or the admin job view.

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
