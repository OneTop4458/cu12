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

## Per-User Serialization

- A user should not run concurrent heavy jobs that compete for CU12 session state.
- If another job is already `RUNNING` for that user, requeue with short delay.

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