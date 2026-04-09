# Data Model

## Core Tables

1. `User`
- Application user identity and role (`ADMIN`/`USER`).
- Linked to a single CU12 account in normal operation.
- Includes `isTestUser` for admin-driven test onboarding.
- Uses `withdrawnAt` to mark withdrawn members without hard-deleting the identity row.
- Admin withdrawal flow anonymizes identity fields (`email`, `name`, `passwordHash`) and clears login traces (`lastLoginAt`, `lastLoginIp`).

2. `InviteToken`
- One-time onboarding token, bound to `cu12Id`.
- Stores `tokenHash` only (never plaintext token).
- Tracks lifecycle with `expiresAt`, `usedAt`, `usedByUserId`.

3. `Cu12Account`
- External account mapping (`cu12Id`, campus).
- Stores encrypted CU12 password.
- Stores account state (`CONNECTED`, `NEEDS_REAUTH`, `ERROR`).
- Stores user automation flags such as scheduled auto-learn and quiz auto-solve opt-in.

4. `JobQueue`
- Async task queue for `SYNC`, `AUTOLEARN`, `NOTICE_SCAN`, `MAIL_DIGEST`.
- Includes retry metadata and scheduling (`runAfter`, `attempts`, `status`).

5. `SiteNotice`
- Admin-managed public/internal notice board content (`BROADCAST`, `MAINTENANCE`).
- Supports active flag, visibility window, priority, and creator traceability.

6. `PolicyDocument` and `PolicyProfile`
- `PolicyDocument` is append-only by `(type, version)` and stores both admin template text and immutable published snapshot text.
- Only one latest active version per policy type is used for public pages and consent checks.
- `PolicyProfile` still stores placeholder variables, and profile changes can publish a new policy snapshot version when rendered output changes.
- Supports admin update traceability via `updatedByUserId`.
- Production rollout must preflight duplicate `(type, version)` groups before enforcing the unique key during schema sync.

7. `UserPolicyConsent`
- Immutable per-user consent version history keyed by `(userId, policyType, policyVersion)`.
- Tracks consent time and source IP.
- Consent rows for withdrawn users are retained for policy/audit purposes and deleted by retention cleanup after 3 years from `User.withdrawnAt`.
- Production rollout must preflight duplicate `(userId, policyType, policyVersion)` groups before enforcing the unique key during schema sync.

8. `AuthRateLimit`
- Persistent throttle buckets for login/invite failure windows and temporary blocks.

9. Snapshot tables
- `CourseSnapshot`, `CourseNotice`, `NotificationEvent`, `LearningTask`, `LearningRun`.
- `LearningTask.activityType` supports future extension (`VOD`, `QUIZ`, `ASSIGNMENT`, `ETC`).
- Notice and notification rows include read/unread state for UX-level acknowledgement.

10. `MailSubscription`
- One row per user (`userId` unique).
- Stores destination email and per-event toggles:
  - `alertOnNotice`
  - `alertOnDeadline`
  - `alertOnAutolearn`
  - `digestEnabled`, `digestHour`

11. `MailDelivery`
- Immutable log of send attempts (`SENT`, `FAILED`, `SKIPPED`) for audit and troubleshooting.
- Includes mandatory legal-notice deliveries triggered by policy version publication.

12. `WorkerHeartbeat`
- Tracks worker liveness for operational visibility.

13. `TaskDeadlineAlert`
- Dedupe table for deadline alert notifications.
- Unique key: `(userId, lectureSeq, courseContentsSeq, thresholdDays, dueAt)`.
- Prevents duplicate D-7/3/1/0 notifications.

14. `AuditLog`
- Immutable operational log for `AUTH`, `ADMIN`, `JOB`, `WORKER`, `MAIL`, `IMPERSONATION`, etc.
- Supports actor/target user linkage and optional JSON metadata.

## Data Boundaries

- Web app writes queue requests and account metadata.
- Worker owns CU12 scraping outputs and job final state transitions.
- Admin-only APIs own invite token issuance, member management, and impersonation control.
- Audit logging is shared: both web and worker append logs.

## Withdrawal Lifecycle

- Member withdrawal is implemented as logical withdrawal plus cleanup, not hard delete of `User`.
- Immediate cleanup removes service-linked personal activity data:
  - `Cu12Account`
  - `MailSubscription`
  - `TaskDeadlineAlert`
  - `CourseSnapshot`
  - `CourseNotice`
  - `LearningTask`
  - `LearningRun`
  - `NotificationEvent`
- Pending/running `JobQueue` rows are canceled during withdrawal.
- `UserPolicyConsent` and `AuditLog` are retained under retention policy windows.

## Data Protection

- CU12 password: encrypted at rest via app master key.
- Invite token: one-way hash in DB.
- Session token: signed cookie with bounded TTL.
