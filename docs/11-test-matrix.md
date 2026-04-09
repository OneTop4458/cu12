# Test Matrix

## API and Auth

1. Login with valid portal credentials and an existing mapping.
2. Login with invalid credentials returns generalized `AUTH_FAILED`.
3. First login with valid credentials returns `INVITE_REQUIRED`.
4. Invite verification rejects invalid, expired, inactive, mismatched, or already-used invite codes with generalized failure responses.
5. Policy consent returns:
   - `LOGIN_CHALLENGE_INVALID` for expired/invalid consent token
   - `POLICY_VERSION_MISMATCH` when the client submits a stale version
   - `POLICY_NOT_CONFIGURED` for non-admin bootstrap cases where documents are missing
6. Upstream portal unavailability returns the expected temporary error behavior and does not count as a credential failure.

## Queue and Worker

1. Queue claim is atomic under concurrent workers.
2. Duplicate idempotency keys do not create duplicate effective jobs.
3. Manual redispatch respects the stale duplicate windows.
4. `BLOCKED` AUTOLEARN jobs are used only for approval-required Cyber Campus flows and return to `PENDING` after approval completion.
5. Worker heartbeat updates at the expected interval.
6. Reconcile detects mismatches between DB `RUNNING` jobs and live workflow runs.
7. AUTOLEARN continuation stops when the chain cap is reached.
8. `--once` handoff requests follow-up dispatch when matching pending work remains.

## Dashboard Data

1. Bootstrap payload includes actor/effective context, provider summaries, queue state, account settings, Cyber Campus state, and mail preference.
2. Notifications and messages respect explicit or inferred provider scope.
3. Site notices and maintenance notice surfaces align with the active visibility window.

## Provider-Specific Automation

1. CU12 parser maps current task/link contracts to `VOD`, `MATERIAL`, `QUIZ`, `ASSIGNMENT`, or `ETC`.
2. CU12 AUTOLEARN completes pending material items through the page flow, not hidden side effects.
3. Quiz retry logic stops when attempts are exhausted or the contract is unsupported.
4. Cyber Campus AUTOLEARN returns `approvalRequired=true` when secondary auth is needed, then resumes after approval confirmation.

## Validation Gate

1. `corepack pnpm run check:text`
2. `corepack pnpm run check:openapi`
3. `corepack pnpm run prisma:generate`
4. `corepack pnpm run typecheck`
5. `corepack pnpm run test:web`
6. `corepack pnpm run test:ops`
7. `corepack pnpm run build:web`
