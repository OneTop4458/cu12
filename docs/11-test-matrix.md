# Test Matrix

## Coverage Basis

Test cases are kept when they protect a documented product or operational contract in:

1. `docs/01-prd.md`
2. `docs/02-architecture.md`
3. `docs/04-api/openapi.yaml`
4. This matrix

Implementation-detail tests are still valid when they guard an externally observable workflow, safety invariant, parser contract, or release gate.

## API and Auth

1. Login with valid portal credentials and an existing mapping.
2. Login with invalid credentials returns generalized `AUTH_FAILED`.
3. With member approval ON, first login with valid credentials creates a pending user and returns `APPROVAL_PENDING` without a session cookie or stored portal password.
4. With member approval OFF, valid portal login automatically approves new and pending users; rejected, withdrawn, and approved-but-disabled accounts remain blocked.
5. Manually approved first-login users must log in again before credentials are encrypted and account linking completes; automatically approved users continue this flow during the verified login.
6. Policy consent returns:
   - `LOGIN_CHALLENGE_INVALID` for expired/invalid consent token
   - `POLICY_VERSION_MISMATCH` when the client submits a stale version
   - `POLICY_NOT_CONFIGURED` for non-admin bootstrap cases where documents are missing
7. Upstream portal unavailability returns the expected temporary error behavior and does not count as a credential failure.

## Queue and Worker

1. Queue claim is atomic under concurrent workers.
2. Duplicate idempotency keys do not create duplicate effective jobs.
3. Manual redispatch respects the stale duplicate windows.
4. `BLOCKED` AUTOLEARN jobs cover Cyber Campus approval probing and required secondary authentication. New requests return `approvalRequired=false`; reusing an active approval can return `true` before user input is needed, so runtime state and available methods drive the prompt. After verification, the worker either claims the job for same-session continuation or closes it as a no-op when no runnable target tasks remain.
5. Worker heartbeat updates at the expected interval.
6. Reconcile detects mismatches between DB `RUNNING` jobs and live workflow runs.
7. AUTOLEARN continuation stops when the chain cap is reached.
8. `--once` handoff requests follow-up dispatch when matching pending work remains.

## Dashboard Data

1. Bootstrap payload includes actor/effective context, provider summaries, queue state, account settings, Cyber Campus state, and mail preference.
2. Unified activity merges notices, notifications, messages, and urgent deadline items while respecting explicit or inferred provider scope.
3. Site notices and maintenance notice surfaces align with the active visibility window, including fixed maintenance exposure on login and dashboard top.
4. `BROADCAST` display targets route notices correctly across login-only, topbar-only, and dual-surface modes.
5. Broadcast notice accordions start collapsed and preserve multiline bodies when expanded, while dashboard maintenance warning copy stays visible by default.
6. Successful empty course data returns `200` with an empty list; an unrecoverable course-load error returns `503 DASHBOARD_COURSES_FAILED` so the interface can distinguish unavailable data from a verified empty result.
7. Korean state presentation covers known, missing, and unknown job/sync/approval/account values. Course messages distinguish loading, initial sync, known empty data, missing/inconsistent summary, and named provider failures; failed refreshes warn about retained rows and clear after recovery.

## Provider-Specific Automation

1. CU12 parser maps current task/link contracts to `VOD`, `MATERIAL`, `QUIZ`, `ASSIGNMENT`, or `ETC`.
2. CU12 AUTOLEARN completes pending material items through the page flow, not hidden side effects.
3. Quiz retry logic stops when attempts are exhausted or the contract is unsupported.
4. Cyber Campus AUTOLEARN exposes approval state when secondary auth is needed, then resumes after approval confirmation without losing the approved browser session.

## Administrator Member Editing

1. Admin-only, same-origin requests can update profile, linked-account settings, and the complete active mail preference together. Unknown keys, empty patches, invalid campus, and malformed preferences are rejected.
2. Missing linked accounts reject account-setting changes without saving profile changes. Mail preferences can be saved for a member without a linked account.
3. Saving mail preferences disables legacy notice/digest flags. Optional alert preferences do not opt out of policy publication mail.
4. Own-account deactivation/demotion/type changes and activation before approval are rejected. Withdrawn or concurrently changed approval/test-user state cannot be overwritten by a stale edit.
5. Normal-to-test conversion requires a valid local password. Blank passwords preserve existing credentials; nonblank local passwords are rejected for normal users.
6. A failed preference write rolls back profile/account writes. Responses and audit metadata never return or record local passwords.

## Administrator Mail Configuration

1. Settings and templates enforce admin access and same-origin mutations. Strict requests reject extra fields, invalid SMTP fields, and unsupported template kinds.
2. Missing settings/template rows preserve ENV/default behavior; storage failures do not silently bypass the saved delivery switch. CUSTOM never merges environment credentials.
3. Passwords are encrypted, omitted from responses and audit metadata, preserved by blank input, and removed only by explicit clear. Host/username changes require an explicit credential choice.
4. All active mail kinds use shared settings and their selected template. Global delivery OFF prevents SMTP sends, including policy, approval, and test mail.
5. Templates require exactly one content placeholder, escape editable HTML, reject malformed placeholders/header injection, and reset to defaults without sending mail.
6. Verification uses saved settings and does not send mail; test delivery requires an explicit recipient. Both use bounded, closed transports and sanitized failures. Automated checks mock SMTP and do not contact real recipients.

## Validation Gate

1. `corepack pnpm run check:text`
2. `corepack pnpm run check:openapi`
3. `corepack pnpm run prisma:generate`
4. `corepack pnpm run typecheck`
5. `corepack pnpm run test:all`
6. `corepack pnpm run build:web`

`test:all` is the required all-pass regression gate for pull requests, AI shipping, and deployment verification. It runs:

1. `corepack pnpm run test:web`
2. `corepack pnpm run test:worker`
3. `corepack pnpm run test:ops`
