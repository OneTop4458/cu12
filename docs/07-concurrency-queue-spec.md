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

## Claim Strategy

1. Worker polls runnable jobs (`PENDING` and `runAfter <= now`) for requested types.
2. Candidates are scanned using type-priority then FIFO (`createdAt`) ordering.
3. Claim is attempted atomically (`updateMany where id + status=PENDING`) for each candidate.
4. If claim fails due to race, worker scans the next candidate.
5. If claim succeeds but the AUTOLEARN user-level policy blocks it, the job is requeued after a short delay.
6. If claim succeeds without conflict, worker starts execution.

## Retry Policy

- Retry up to 4 attempts.
- Backoff schedule: 1m -> 5m -> 15m -> 60m.
- Persist failure reason for operator visibility.

## Idempotency

- Queue creation includes `idempotencyKey`.
- Prevents duplicate enqueue when repeated button clicks or retries occur.

## Capacity Guidance

- Designed for around 5 users.
- Keep auto-learning concurrency conservative and scale based on runner budget.
