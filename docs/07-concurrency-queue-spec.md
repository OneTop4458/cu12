# Concurrency and Queue Spec

## Queue States

- `PENDING`: queued and eligible once `runAfter <= now`
- `BLOCKED`: waiting for an external prerequisite such as Cyber Campus secondary authentication
- `RUNNING`: claimed by a worker
- `SUCCEEDED`: completed successfully
- `FAILED`: terminal failure after retries or terminal portal error
- `CANCELED`: canceled by operator flow or business rule

## Dispatch and Claim Model

1. Web APIs enqueue jobs with idempotency keys.
2. Manual user actions run a stale-window redispatch check before calling GitHub Actions.
3. Scheduled workflows enqueue jobs first, then call `/internal/worker/dispatch` when they create pending work. Global AUTOLEARN dispatches also run a drain check so stale pending jobs can be reattached to workers.
4. Centralized dispatch fans out user-scoped worker runs and caps parallelism by `WORKER_DISPATCH_MAX_PARALLEL`.
5. Each worker claims runnable `PENDING` jobs atomically through the internal API surface.

## Queue Policy (Current)

- Priority order is `SYNC`, `NOTICE_SCAN`, `AUTOLEARN`, then `MAIL_DIGEST`.
- `SYNC` and `NOTICE_SCAN` can run even when AUTOLEARN exists for the same user.
- `AUTOLEARN` is serialized per user.
- `BLOCKED` AUTOLEARN is reserved for Cyber Campus approval-required flows and is not claimable until approval completion returns it to `PENDING`.
- AUTOLEARN continuation jobs keep mode/target metadata and increment chain-segment metadata.
- Continuation chains are capped by cumulative elapsed time using `AUTOLEARN_CHAIN_MAX_SECONDS`.
- Manual duplicates can force redispatch when:
  - `PENDING` work is stale for at least 5 minutes
  - `RUNNING` work is stale for at least 10 minutes

## Claim Strategy

1. Worker requests the allowed job types for the current run.
2. The queue scans runnable candidates in type-priority order and FIFO creation order.
3. Claim uses an atomic `updateMany where id + status=PENDING`.
4. If another worker wins the race, scanning continues.
5. If AUTOLEARN is claimed but violates per-user execution rules, it is requeued with a short delay.
6. In `--once` mode, the worker requests follow-up dispatch only when matching pending work is currently eligible. Future-only pending work logs the next `runAfter` instead of dispatching another worker.

## Retry Policy

- Up to 4 attempts.
- Backoff schedule: 1 minute -> 5 minutes -> 15 minutes -> 60 minutes.
- Failed-job responses include the queued retry job and `runAfter` when a retry is created.
- A `--once` worker waits in the same run when the retry is due within `WORKER_RETRY_WAIT_MAX_MS`; the heartbeat loop continues while waiting.
- Failure reason remains attached to the queue row for operator review.

## Capacity Guidance

- Keep `WORKER_DISPATCH_MAX_PARALLEL` below the repository's GitHub Actions capacity ceiling.
- The default `12` assumes the same repository also needs room for CI and deploy jobs.
- Reconcile checks are the primary guard against silent divergence between `RUNNING` jobs and active Actions runs.
