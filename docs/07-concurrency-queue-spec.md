# Concurrency and Queue Spec

## Queue States

OpenAI quota/billing failures (`insufficient_quota`, exhausted credits, and organization/project spend or usage limits) do not enqueue another AUTOLEARN retry. Temporary rate limits and service failures remain retryable.

- `PENDING`: queued and eligible once `runAfter <= now`
- `BLOCKED`: waiting for an external prerequisite such as Cyber Campus secondary authentication
- `RUNNING`: claimed by a worker
- `SUCCEEDED`: completed successfully
- `FAILED`: terminal failure after retries or terminal portal error
- `CANCELED`: canceled by operator flow or business rule

## Dispatch and Claim Model

1. Web APIs and scheduled dispatchers derive the same `activeDedupeKey` from user, type, and idempotency key. Full SYNC uses `sync:<user>:<provider>:full` regardless of manual or scheduled origin. Existing legacy active jobs are reused while the previous release drains; new inserts retain database-enforced deduplication.
2. Manual user actions run a stale-window redispatch check before calling GitHub Actions.
3. Scheduled workflows enqueue jobs first, then call `/internal/worker/dispatch` for new work or existing pending sync work. Global AUTOLEARN dispatches also run a drain check so stale pending jobs can be reattached to workers.
4. Centralized dispatch starts workers with a preferred user and caps parallelism by `WORKER_DISPATCH_MAX_PARALLEL`. Pure sync workers subsequently drain bounded work across users; autolearn remains user-scoped.
5. Each worker claims runnable `PENDING` jobs atomically through the internal API surface.

## Queue Policy (Current)

- Priority order is `SYNC`, `NOTICE_SCAN`, `AUTOLEARN`, then `MAIL_DIGEST`.
- `SYNC` and `NOTICE_SCAN` can run even when AUTOLEARN exists for the same user.
- `AUTOLEARN` is serialized per user.
- `BLOCKED` AUTOLEARN is reserved for Cyber Campus approval probing and secondary-authentication flows. The normal queue consumer cannot claim it; after verification, the approval worker can claim it directly for same-session continuation or close it as a no-op when no runnable tasks remain.
- A nullable unique `activeDedupeKey` permits only one keyed `PENDING` or `RUNNING` row for a logical job. `BLOCKED` and terminal rows keep this field null.
- Unique conflicts return the existing active job. `idempotencyKey` remains on every historical row.
- `SUCCEEDED`, `FAILED`, and `CANCELED` transitions release the active key. A later request with the same idempotency key can create a fresh row.
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
- Failure-to-retry and success-to-continuation transitions release the source key and reserve the next active key in one transaction.
- A `--once` worker waits in the same run when the retry is due within `WORKER_RETRY_WAIT_MAX_MS`; the heartbeat loop continues while waiting.
- Failure reason remains attached to the queue row for operator review.

## Capacity Guidance

- Keep `WORKER_DISPATCH_MAX_PARALLEL` below the repository's GitHub Actions capacity ceiling.
- The default `12` assumes the same repository also needs room for CI and deploy jobs. Active-run lookup pages every nonterminal GitHub status instead of inspecting only the most recent 100 runs.
- Sync-family claims use a transaction-scoped PostgreSQL advisory lock per user before checking RUNNING siblings and claiming. Different batch workers cannot concurrently collect SYNC/NOTICE_SCAN for the same user.
- The claim response advertises `syncBatchSupported`; a newly started worker remains user-scoped against an older web deployment until it observes this capability.
- A pure SYNC/NOTICE_SCAN one-shot batch stops new claims at ten jobs or ten elapsed minutes, allowing the current collection/retry wait to finish. Idle grace is fifteen seconds; autolearn and mail policies are unchanged.
- In Actions, sync handoff happens in `worker-sync-handoff.yml` after Worker Consume completes, avoiding a capacity check that counts the exiting run. The handoff creates no queue jobs and safely does nothing when no eligible sync work remains.
- Reconcile checks are the primary guard against silent divergence between `RUNNING` jobs and active Actions runs.
