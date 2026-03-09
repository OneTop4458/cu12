# Test Matrix

## API and Auth

1. Login with valid CU12 credentials and existing mapping.
2. Login with invalid CU12 credentials -> `AUTH_FAILED`.
3. First login valid CU12 credentials -> `INVITE_REQUIRED`.
4. Login while CU12 upstream is unavailable -> `CU12_UNAVAILABLE` (`503`) without counting as credential failure.
5. Invite step with invalid/expired token -> `LOGIN_CHALLENGE_INVALID`.
6. Invite step with invalid/unbound invite code -> `INVITE_VERIFICATION_FAILED`.
7. Invite step still completes expected response when throttle/audit persistence fails.
8. Consent step still returns expected policy/app errors and does not fail only because audit persistence fails.
9. Admin invite create/list authorization (ADMIN vs USER).
10. Verify detailed auth failure reasons are recorded in audit logs even when API responses are generalized.

## Queue and Worker

1. Queue claim is atomic under concurrent workers.
2. Duplicate idempotency key does not create duplicate effective jobs.
3. Retry/backoff schedule executes as defined.
4. Worker heartbeat updates at expected interval.
5. Auto-learning run records success/failure and metadata.
6. Sync queue stale classification keeps `RUNNING` when worker heartbeat is fresh.
7. Job tracking poll recovers from repeated API fetch failures and resynchronizes dashboard state.
8. Truncated AUTOLEARN result enqueues continuation job with incremented chain segment.
9. AUTOLEARN continuation stops when cumulative chain elapsed reaches configured max cap.
10. Worker `--once` handoff dispatches follow-up consume run when pending AUTOLEARN jobs remain.
11. User-scoped consume run (`--userId`) claims only that user's jobs.
12. Centralized dispatch enforces parallel cap and returns `SKIPPED_CAPACITY` when full.

## Dashboard Data

1. Summary endpoint reflects latest snapshots.
2. Course list and notices align with synced data.
3. Job history endpoint includes latest state transitions.

### Validation Gate (AI-assisted or release validation)

1. `pnpm run check:text`
2. `pnpm run check:openapi`
3. `pnpm run typecheck`
4. `pnpm run build:web`

## End-to-End

1. New environment bootstrap -> admin first login -> invite issuance -> user first login.
2. User sync request -> queue -> worker consume -> dashboard update.
3. User auto-learning request -> queue -> worker consume -> learning log update.
