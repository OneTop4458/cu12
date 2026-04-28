# Session and Token Lifecycle

## Application Session (`cu12_session`)

1. Issued only after the login flow has fully completed.
2. Stored as `httpOnly`, `sameSite=lax`, and `secure` in production.
3. Default TTL is 12 hours, or 30 days when `rememberSession=true`.
4. Protected APIs require a valid `cu12_session` together with a valid `cu12_idle`.

## Idle Session (`cu12_idle`)

1. Issued together with `cu12_session`.
2. Sliding TTL is 30 minutes.
3. Extended only by explicit session-refresh activity.
4. Used to force active-browser presence for protected APIs even when the long session is still valid.

## Admin Impersonation Token (`cu12_impersonation`)

1. Issued only through `POST /api/admin/impersonation`.
2. Contains actor user id, target user id, and purpose marker.
3. TTL is 6 hours unless explicitly cleared sooner.
4. Effective impersonation applies only when the actor session is still a valid admin session.

## Pending Approval State

1. Created when portal credentials are valid but no approved linked account can be authenticated yet.
2. Stored on `User` as `approvalStatus=PENDING` with `approvalRequestedAt`.
3. Does not issue session cookies and does not store the portal password.
4. After an administrator approves the user, the next successful login stores the encrypted portal password and continues to consent/session issuance.

## Policy Consent Challenge Token

1. Issued after portal verification and account resolution when required policies are configured but the user's consent is missing or outdated.
2. Contains `userId`, `email`, `role`, `rememberSession`, `firstLogin`, and purpose marker.
3. TTL is 30 minutes.
4. Exchanged only through `POST /api/auth/consent`.
5. The final authenticated cookies are not issued until this step succeeds.

## Portal Session (`PortalSession`)

1. Provider-scoped encrypted cookie-state cache stored in the database.
2. Used to reuse validated upstream sessions, especially for Cyber Campus.
3. Tracks `ACTIVE`, `EXPIRED`, and `INVALID`.
4. Marked invalid when reuse checks fail or expiry has passed.

## Portal Approval Session (`PortalApprovalSession`)

1. Created when Cyber Campus AUTOLEARN requires secondary authentication.
2. Tied one-to-one to a `BLOCKED` AUTOLEARN job.
3. Stores encrypted cookie state, available methods, selected method, request/display code, expiry, and terminal state.
4. Starts as `PENDING`, moves to `ACTIVE` after a method is started, and ends as `COMPLETED`, `EXPIRED`, or `CANCELED`.
5. Successful confirmation is completed by the approval worker, which stores the refreshed `PortalSession` and can claim the blocked AUTOLEARN job directly in the same live Playwright session when runnable.
6. If the approval worker finds no runnable target tasks, it closes the blocked AUTOLEARN job as a no-op instead of returning it to `PENDING`.

## CU12 Credential Lifecycle

1. Portal credentials are re-verified at every login.
2. Stored encrypted credentials are refreshed on successful verified login.
3. Worker decrypts credentials only during job execution.
4. Repeated upstream-login failures can move account state to `NEEDS_REAUTH`.
