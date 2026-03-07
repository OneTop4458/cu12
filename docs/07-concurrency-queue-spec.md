# Concurrency and Queue Spec

## Queue States

- `PENDING`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `CANCELED`

## Claim Strategy

1. Worker polls runnable jobs (`PENDING` and `runAfter <= now`).
2. Claim is atomic (`updateMany where id + status=PENDING`).
3. If claim fails, worker skips and retries next poll.

## Queue Policy (Current)

- Priority order (when a worker receives multiple types): `SYNC` and `NOTICE_SCAN` first, then `AUTOLEARN`, then `MAIL_DIGEST`.
- `SYNC` and `NOTICE_SCAN` jobs are not blocked by any other job type for the same user.
- `AUTOLEARN` is restricted to one concurrent job per user. If another AUTOLEARN job is already `RUNNING` for that user, the job is delayed with a short retry backoff.
- `AUTOLEARN` can chain continuation jobs when a chunk is truncated; continuation keeps mode/target lecture and increments chain segment metadata.
- Continuation chain is capped by cumulative elapsed seconds (`AUTOLEARN_CHAIN_MAX_SECONDS`, default 12h). When cap is reached, no further continuation job is created.
- Multiple workers can run SYNC jobs for different users (and the same user when deduplication allows a new row) while AUTOLEARN is running.
- Manual SYNC/AUTOLEARN API requests use idempotency keys but are always evaluated against a re-dispatch policy:
  - If the same request is duplicated while a related job is still `RUNNING` or `PENDING` for a short window, no new Actions dispatch is sent.
  - `PENDING` stale for 5 minutes or `RUNNING` stale for 10 minutes triggers a forced re-dispatch of the same trigger (to recover worker stalls).
  - This keeps queue pressure controlled while still allowing recovery from stuck jobs.

## Claim Strategy

1. Worker polls runnable jobs (`PENDING` and `runAfter <= now`) for requested types.
2. Candidates are scanned using type-priority then FIFO (`createdAt`) ordering.
3. Claim is attempted atomically (`updateMany where id + status=PENDING`) for each candidate.
4. If claim fails due to race, worker scans the next candidate.
5. If claim succeeds but the AUTOLEARN user-level policy blocks it, the job is requeued after a short delay.
6. If claim succeeds without conflict, worker starts execution.
7. In `--once` mode, worker performs handoff dispatch when pending jobs remain for the requested type set.

## Retry Policy

- Retry up to 4 attempts.
- Backoff schedule: 1m -> 5m -> 15m -> 60m.
- Persist failure reason for operator visibility.

## Idempotency

- Queue creation includes `idempotencyKey`.
- Prevents duplicate enqueue when repeated button clicks or retries occur.
- In manual user actions, idempotency is supplemented by stale-window checks before dispatch:
  - `SYNC` and `AUTOLEARN` requests call Actions dispatch only when either:
    - request is a new unique job, or
    - duplicate request maps to a stale `PENDING` (`>=5m`) or stale `RUNNING` (`>=10m`) row.
- Reconciliation checks (`/internal/admin/jobs/reconcile`) are treated as read-only; any mismatch (`orphanedRunningJobs` or `ghostRuns`) is surfaced to operators and the `reconcile-health-check` workflow.


## Capacity Guidance

- Designed for around 5 users.
- Keep auto-learning concurrency conservative and scale based on runner budget.
