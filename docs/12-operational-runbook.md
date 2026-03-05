# Operational Runbook

## Daily Checks

1. Confirm latest `worker-consume` run succeeded.
2. Check count of `FAILED` jobs and retry trend.
3. Check accounts marked `NEEDS_REAUTH`.
4. Review error spikes in deployment/workflow logs.

## Manual Sync Procedure

1. User triggers `POST /api/jobs/sync-now`.
2. Confirm response includes `jobId` and `dispatchState`.
3. If `dispatchState` is `SKIPPED_DUPLICATE`, check after 5~10 minutes depending on request state and then retry if needed.
3. Track progression in `/api/jobs/{jobId}`.
4. SYNC jobs are high priority in worker claim order and can run even if AUTOLEARN is already running for the same user.

## Manual Auto-learning Procedure

1. User triggers `POST /api/jobs/autolearn-request`.
2. Confirm queue entry and dispatch status (`dispatchState`).
3. Validate worker logs and learning run records.
4. AUTOLEARN is limited to one concurrent job per user; additional AUTOLEARN jobs for the same user are delayed by the queue.
5. If `dispatchState` is `SKIPPED_DUPLICATE`, use the existing queue row and monitor `RUNNING` job completion before retrying.

## New Environment Bootstrap

1. Run `DB Bootstrap`.
2. Run `Auth Reset Bootstrap` and capture admin invite code.
3. Admin logs in (step-1 + invite modal step-2).
4. Admin issues invite codes for regular users.

## Incident Response

### Login failures spike

- Check CU12 login endpoint or form contract changes.
- Validate CU12 base URL and parser assumptions.

### Auto-learning failures spike

- Inspect VOD page contract changes and modal behavior.
- Review timeout/factor settings.
- If error is `AUTOLEARN_STALLED`, check whether heartbeat updates stopped for 20 minutes and inspect the worker log around the last heartbeat line.

### Workflow failures

- Validate secrets and internal URL alignment.
- Review runner quota and runtime constraints.
- If queue stays `PENDING`, inspect dispatch responses first (`NOT_CONFIGURED` or `FAILED`).
- If Actions and job status diverge, run `GET /api/admin/jobs/reconcile` and compare with `/api/admin/jobs` before manual cancellation.
