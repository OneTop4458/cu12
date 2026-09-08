# Data Model

## Core Domains

`AppSettings` stores the singleton `default` row with `memberApprovalRequired` (default `true`) and `updatedAt`. A missing row or table keeps approval enabled. Apply the schema with DB Bootstrap before administrators change this setting; the settings API reports a save failure if the table is unavailable.

`MailSettings` stores the singleton `default` configuration shared by web and worker delivery: enabled state, ENV/CUSTOM source, SMTP connection/TLS fields, sender, encrypted password, and update timestamp. `MailTemplate` stores optional subject/body overrides by active mail kind. Missing rows retain ENV/default-template behavior; missing tables or other storage failures require schema repair. SMTP passwords use `APP_MASTER_KEY` and never appear in the public settings view. See the [administrator mail guide](21-admin-member-mail-guide.md).

### Identity, auth, and policy

1. `User`
   - Application identity, role, activity flags, approval state, and last-login metadata.
   - `approvalStatus` distinguishes `PENDING`, `APPROVED`, and `REJECTED` onboarding states.
   - Supports logical withdrawal through `withdrawnAt` instead of destructive hard delete.

2. `Cu12Account`
   - Shared portal-account mapping for the user.
   - Stores encrypted portal password, current provider, campus, account status, and automation toggles such as quiz auto-solve.
   - Pending users do not receive a `Cu12Account` row. Manual approval requires another verified login; automatic approval while approval wait is OFF can link the account during the same login.

3. `AuthRateLimit`
   - Persistent throttle buckets for login abuse protection.
   - Stores only domain-separated HMAC-SHA256 digests derived from `AUTH_JWT_SECRET`; portal IDs and IP addresses are never stored in bucket keys or identifiers.
   - Failure increments use one PostgreSQL atomic upsert, and expired windows or blocks are removed by scheduled retention.

4. `PolicyDocument`, `PolicyProfile`, `UserPolicyConsent`
   - Published policy versions are append-only by `(type, version)`.
   - `PolicyProfile` supplies rendered placeholders for the legal documents.
   - `UserPolicyConsent` stores immutable per-user version acceptance history.

### Queue, sessions, and operations

`ProviderSyncState` has a composite user/provider primary key, `lastFullSyncAt`, and source job type. Only a complete authoritative provider snapshot persisted with notification processing advances this checkpoint. It survives terminal-job retention and supports authoritative empty rosters. Provision it with DB Bootstrap before promoting the sync optimization release.

5. `JobQueue`
   - Stores `SYNC`, `NOTICE_SCAN`, `AUTOLEARN`, and `MAIL_DIGEST`.
   - Uses `PENDING`, `BLOCKED`, `RUNNING`, `SUCCEEDED`, `FAILED`, and `CANCELED`.
   - `BLOCKED` is used for approval-gated Cyber Campus AUTOLEARN flows.
   - Preserves `idempotencyKey` as history and uses nullable unique `activeDedupeKey` only while keyed work is `PENDING` or `RUNNING`.
   - Terminal transitions clear `activeDedupeKey`, allowing the same logical key to create a later job without deleting history.

6. `WorkerHeartbeat`
   - Records active worker liveness for stale-run detection and admin visibility.

7. `PortalSession`
   - Provider-scoped encrypted cookie-state cache for reusable upstream sessions.
   - Used primarily to avoid repeating Cyber Campus approval when a valid session can be reused.
   - Expired or invalid rows are removed by the scheduled retention cleanup.

8. `PortalApprovalSession`
   - Provider-scoped approval workflow state tied to one blocked job.
   - Stores encrypted cookie state and secondary-auth metadata only while the workflow is pending or active.
   - On `COMPLETED`, `EXPIRED`, or `CANCELED`, cookie state, methods, codes, selections, and worker lease metadata are scrubbed immediately. Non-sensitive terminal history is retained for 30 days.

9. `AuditLog`
    - Immutable operational log for auth, admin, job, worker, mail, parser, and impersonation actions.

### Snapshot, learning, and communication data

10. `CourseSnapshot`
    - Provider-scoped course roster and progress data.
    - The stored provider progress remains available for reference, while dashboard lesson completion is derived consistently from currently available `LearningTask` rows across providers.
    - A verified full provider roster marks previously `ACTIVE` courses that are no longer returned as `ENDED`; ended rows remain stored for history but are excluded from current dashboard reads.
    - CU12 synchronization excludes courses whose course period, or latest dated task when the course period is unavailable, ended before the current Korean academic term window.

11. `CourseNotice`
    - Provider-scoped course notice snapshots, unread state, and body content.
    - Read state is monotonic across equivalent parser aliases so synchronization cannot make an already-read notice unread again.

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
    - The active optional delivery controls are recipient email, `enabled`, `alertOnDeadline`, and `alertOnAutolearn`. Legacy digest and notice flags do not enable routine digest or notice-only mail in the current worker.
    - Policy publication mail uses a saved subscription address independently of optional alert switches. Admin approval request mail requires an enabled subscription for an active approved administrator.
    - An administrator's member update saves profile, linked-account settings, and optional mail preferences in one transaction. Saving mail preferences resets legacy notice/digest flags to false; concurrent withdrawal or approval/test-user changes reject the update instead of partially saving it.

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
- Active `PortalSession` and non-terminal `PortalApprovalSession` rows store encrypted cookie-state payloads, not plaintext cookies. A successful approval keeps the latest reusable cookie state only in `PortalSession`.
- Session cookies are signed JWTs with bounded TTL plus a separate idle-session token.
- The scheduled DB cleanup workflow runs the worker retention cleanup for expired login-throttle buckets, expired or invalid portal sessions, 30-day terminal portal-approval history, 30-day audit logs, 14-day terminal jobs, 30-day mail delivery rows, and withdrawn accounts older than 6 months.
- The same workflow still removes legacy bogus course notices. Its manual `user_repair` mode can also clear notification events for a selected user.
