# Test Matrix

## API and Auth

1. Login with valid CU12 credentials and existing mapping.
2. Login with invalid CU12 credentials -> `CU12_AUTH_FAILED`.
3. First login valid CU12 credentials -> `INVITE_REQUIRED`.
4. Invite step with invalid/expired token -> `LOGIN_CHALLENGE_INVALID`.
5. Invite step with invalid/unbound invite code -> `UNAPPROVED_ID`.
6. Admin invite create/list authorization (ADMIN vs USER).

## Queue and Worker

1. Queue claim is atomic under concurrent workers.
2. Duplicate idempotency key does not create duplicate effective jobs.
3. Retry/backoff schedule executes as defined.
4. Worker heartbeat updates at expected interval.
5. Auto-learning run records success/failure and metadata.

## Dashboard Data

1. Summary endpoint reflects latest snapshots.
2. Course list and notices align with synced data.
3. Job history endpoint includes latest state transitions.

## End-to-End

1. New environment bootstrap -> admin first login -> invite issuance -> user first login.
2. User sync request -> queue -> worker consume -> dashboard update.
3. User auto-learning request -> queue -> worker consume -> learning log update.