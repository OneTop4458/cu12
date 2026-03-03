# ADR-0001: Cloud Worker Model

## Status

Accepted

## Context

- The project must run in a cloud-only operating model.
- Auto-learning tasks can be long-running due to watch-time requirements.
- Expected scale is small (~5 users), so operational simplicity is preferred.

## Decision

- Host web/API on Vercel.
- Use GitHub Actions for worker execution.
- Persist state and queue in Neon PostgreSQL.
- Trigger worker runs via API-driven workflow dispatch.

## Consequences

### Positive

1. No dependency on an always-on local machine.
2. Clear separation between user-facing app and automation runtime.
3. Straightforward operations through managed platforms.

### Negative

1. Dependent on Actions runtime and usage quotas.
2. Long-running jobs may need conservative throughput tuning.
3. Requires strict secret synchronization between platforms.