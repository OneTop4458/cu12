# Data Model

## Core Tables

1. `User`
- Application user identity and role (`ADMIN`/`USER`).
- Linked to a single CU12 account in normal operation.

2. `InviteToken`
- One-time onboarding token, bound to `cu12Id`.
- Stores `tokenHash` only (never plaintext token).
- Tracks lifecycle with `expiresAt`, `usedAt`, `usedByUserId`.

3. `Cu12Account`
- External account mapping (`cu12Id`, campus).
- Stores encrypted CU12 password.
- Stores account state (`CONNECTED`, `NEEDS_REAUTH`, `ERROR`).

4. `JobQueue`
- Async task queue for `SYNC`, `AUTOLEARN`, `NOTICE_SCAN`, `MAIL_DIGEST`.
- Includes retry metadata and scheduling (`runAfter`, `attempts`, `status`).

5. Snapshot tables
- `CourseSnapshot`, `CourseNotice`, `NotificationEvent`, `LearningTask`, `LearningRun`.
- `LearningTask.activityType` supports future extension (`VOD`, `QUIZ`, `ASSIGNMENT`, `ETC`).
- Notice and notification rows include read/unread state for UX-level acknowledgement.

6. `MailSubscription`
- One row per user (`userId` unique).
- Stores destination email and per-event toggles:
  - `alertOnNotice`
  - `alertOnDeadline`
  - `alertOnAutolearn`
  - `digestEnabled`, `digestHour`

7. `MailDelivery`
- Immutable log of send attempts (`SENT`, `FAILED`, `SKIPPED`) for audit and troubleshooting.

8. `WorkerHeartbeat`
- Tracks worker liveness for operational visibility.

## Data Boundaries

- Web app writes queue requests and account metadata.
- Worker owns CU12 scraping outputs and job final state transitions.
- Admin-only APIs own invite token issuance.

## Data Protection

- CU12 password: encrypted at rest via app master key.
- Invite token: one-way hash in DB.
- Session token: signed cookie with bounded TTL.
