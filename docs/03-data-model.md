# Data Model

## Core Domains

### Identity, auth, and policy

1. `User`
   - Application identity, role, activity flags, and last-login metadata.
   - Supports logical withdrawal through `withdrawnAt` instead of destructive hard delete.

2. `InviteToken`
   - One-time onboarding token bound to `cu12Id`.
   - Stores only `tokenHash`, lifecycle timestamps, and role assignment.

3. `Cu12Account`
   - Shared portal-account mapping for the user.
   - Stores encrypted portal password, current provider, campus, account status, and automation toggles such as quiz auto-solve and digest enablement.

4. `AuthRateLimit`
   - Persistent throttle buckets for login/invite abuse protection.

5. `PolicyDocument`, `PolicyProfile`, `UserPolicyConsent`
   - Published policy versions are append-only by `(type, version)`.
   - `PolicyProfile` supplies rendered placeholders for the legal documents.
   - `UserPolicyConsent` stores immutable per-user version acceptance history.

### Queue, sessions, and operations

6. `JobQueue`
   - Stores `SYNC`, `NOTICE_SCAN`, `AUTOLEARN`, and `MAIL_DIGEST`.
   - Uses `PENDING`, `BLOCKED`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `CANCELED`.
   - `BLOCKED` is used for approval-gated Cyber Campus AUTOLEARN flows.

7. `WorkerHeartbeat`
   - Records active worker liveness for stale-run detection and admin visibility.

8. `PortalSession`
   - Provider-scoped encrypted cookie-state cache for reusable upstream sessions.
   - Used primarily to avoid repeating Cyber Campus approval when a valid session can be reused.

9. `PortalApprovalSession`
   - Provider-scoped approval workflow state tied to one blocked job.
   - Stores encrypted cookie state, available methods, selected method, request/display code, expiry, and terminal status.

10. `AuditLog`
    - Immutable operational log for auth, admin, job, worker, mail, parser, and impersonation actions.

### Snapshot, learning, and communication data

11. `CourseSnapshot`
    - Provider-scoped course roster and progress data.

12. `CourseNotice`
    - Provider-scoped course notice snapshots, unread state, and body content.

13. `NotificationEvent`
    - Provider-scoped notification feed items, unread/archive state, and dashboard history.

14. `PortalMessage`
    - Provider-scoped inbox/message snapshots with read state.

15. `LearningTask`
    - Provider-scoped task inventory across `VOD`, `MATERIAL`, `QUIZ`, `ASSIGNMENT`, and `ETC`.
    - Tracks availability windows, due times, progress counters, and execution eligibility.

16. `LearningRun`
    - Immutable execution log for AUTOLEARN runs, including result metadata.

17. `TaskDeadlineAlert`
    - Dedupe table for deadline notifications by user, provider, task identity, threshold, and due time.

18. `MailSubscription` and `MailDelivery`
    - User-configured mail delivery preferences and immutable delivery history.

19. `SiteNotice`
    - Admin-managed notices shown on login and dashboard surfaces.
    - `BROADCAST` notices include a persisted `displayTarget` (`LOGIN`, `TOPBAR`, `BOTH`).
    - `MAINTENANCE` notices are persisted and normalized as login-and-dashboard fixed notices.

## Data Boundaries

- The web app owns user/session/auth state, admin writes, job enqueue, policy publishing, and provider-session orchestration.
- The worker owns scraping outputs, learning execution, mail generation side effects, and job terminal transitions.
- `packages/core` defines shared parser/type contracts but does not own persistence.
- Internal web APIs are the boundary between GitHub Actions execution and persistent application state.

## Withdrawal Lifecycle

1. User withdrawal is logical first (`User.withdrawnAt`).
2. Immediate cleanup removes service-linked operational data such as:
   - `Cu12Account`
   - `MailSubscription`
   - `TaskDeadlineAlert`
   - snapshot and task tables
3. Pending or running jobs are canceled during withdrawal.
4. Policy-consent history and audit data remain under retention policy rules.

## Data Protection and Retention

- Portal passwords are encrypted at rest using `APP_MASTER_KEY`.
- Invite codes are stored only as hashes.
- `PortalSession` and `PortalApprovalSession` store encrypted cookie-state payloads, not plaintext cookies.
- Session cookies are signed JWTs with bounded TTL plus a separate idle-session token.
- Retention cleanup removes old terminal job rows, mail logs, and aged withdrawn-user consent history according to the scheduled workflow.
