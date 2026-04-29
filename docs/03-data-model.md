# Data Model

## Core Domains

### Identity, auth, and policy

1. `User`
   - Application identity, role, activity flags, approval state, and last-login metadata.
   - `approvalStatus` distinguishes `PENDING`, `APPROVED`, and `REJECTED` onboarding states.
   - Supports logical withdrawal through `withdrawnAt` instead of destructive hard delete.

2. `Cu12Account`
   - Shared portal-account mapping for the user.
   - Stores encrypted portal password, current provider, campus, account status, and automation toggles such as quiz auto-solve.
   - Pending users do not receive a `Cu12Account` row until they are approved and log in again.

3. `AuthRateLimit`
   - Persistent throttle buckets for login abuse protection.

4. `PolicyDocument`, `PolicyProfile`, `UserPolicyConsent`
   - Published policy versions are append-only by `(type, version)`.
   - `PolicyProfile` supplies rendered placeholders for the legal documents.
   - `UserPolicyConsent` stores immutable per-user version acceptance history.

### Queue, sessions, and operations

5. `JobQueue`
   - Stores `SYNC`, `NOTICE_SCAN`, `AUTOLEARN`, and `MAIL_DIGEST`.
   - Uses `PENDING`, `BLOCKED`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `CANCELED`.
   - `BLOCKED` is used for approval-gated Cyber Campus AUTOLEARN flows.

6. `WorkerHeartbeat`
   - Records active worker liveness for stale-run detection and admin visibility.

7. `PortalSession`
   - Provider-scoped encrypted cookie-state cache for reusable upstream sessions.
   - Used primarily to avoid repeating Cyber Campus approval when a valid session can be reused.

8. `PortalApprovalSession`
   - Provider-scoped approval workflow state tied to one blocked job.
   - Stores encrypted cookie state, available methods, selected method, request/display code, expiry, and terminal status.

9. `AuditLog`
    - Immutable operational log for auth, admin, job, worker, mail, parser, and impersonation actions.

### Snapshot, learning, and communication data

10. `CourseSnapshot`
    - Provider-scoped course roster and progress data.

11. `CourseNotice`
    - Provider-scoped course notice snapshots, unread state, and body content.

12. `NotificationEvent`
    - Provider-scoped notification feed items, unread/archive state, and dashboard history.

13. `PortalMessage`
    - Provider-scoped inbox/message snapshots with read and archive state.

14. `LearningTask`
    - Provider-scoped task inventory across `VOD`, `MATERIAL`, `QUIZ`, `ASSIGNMENT`, and `ETC`.
    - Tracks availability windows, due times, progress counters, and execution eligibility.

15. `LearningRun`
    - Immutable execution log for AUTOLEARN runs, including result metadata.

16. `TaskDeadlineAlert`
    - Dedupe table for deadline notifications by user, provider, task identity, threshold, and due time.

17. `MailSubscription` and `MailDelivery`
    - User-configured action-required mail preferences and immutable delivery history. Daily digest mail is disabled.

18. `SiteNotice`
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
4. Minimal dispute-response records remain only under retention policy rules.
5. The scheduled retention workflow hard-deletes inactive withdrawn users after 6 months. Prisma cascade and set-null relations remove or detach remaining user-linked rows.

## Data Protection and Cleanup

- Portal passwords are encrypted at rest with a server-side key managed outside the database.
- Pending approval users have no stored portal password.
- `PortalSession` and `PortalApprovalSession` store encrypted cookie-state payloads, not plaintext cookies.
- Session cookies are signed JWTs with bounded TTL plus a separate idle-session token.
- The scheduled DB cleanup workflow runs the worker retention cleanup for 30-day audit logs, 14-day terminal jobs, 30-day mail delivery rows, and withdrawn accounts older than 6 months.
- The same workflow still removes legacy bogus course notices. Its manual `user_repair` mode can also clear notification events for a selected user.
