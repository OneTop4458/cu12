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
- Course, notice, task, and learning-run records used by dashboard and audit.

6. `WorkerHeartbeat`
- Tracks worker liveness for operational visibility.

## Data Boundaries

- Web app writes queue requests and account metadata.
- Worker owns CU12 scraping outputs and job final state transitions.
- Admin-only APIs own invite token issuance.

## Data Protection

- CU12 password: encrypted at rest via app master key.
- Invite token: one-way hash in DB.
- Session token: signed cookie with bounded TTL.