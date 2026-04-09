# PRD

## Product Goal

CU12 Automation provides a cloud-only operations surface for a small invited group to:

1. Authenticate with real CU12 credentials at sign-in time.
2. Monitor course, notice, notification, and inbox state across CU12 and Cyber Campus.
3. Trigger long-running sync and auto-learning work safely through a queue plus worker model.
4. Operate the service with admin tooling, workflow automation, and documented recovery paths.

## Primary Users

- **End users**: students who sign in, review dashboard state, run sync, and request auto-learning.
- **Admin users**: operators who bootstrap environments, publish policies, issue invite codes, manage members, inspect workers, and reconcile jobs.

## Core Requirements

1. **Real-time CU12 credential verification on every login**.
2. **Invite-only onboarding for first login**, bound to `cu12Id` and single-use.
3. **Policy consent gating** before the final authenticated session when required documents are configured and consent is missing or outdated.
4. **Provider-aware dashboard APIs** covering summary, courses, deadlines, notifications, messages, site notices, queue state, and Cyber Campus approval state.
5. **Queue-based job orchestration** for `SYNC`, `NOTICE_SCAN`, `AUTOLEARN`, and `MAIL_DIGEST`.
6. **Cloud worker execution** via GitHub Actions with no always-on personal machine requirement.
7. **Optional quiz auto-solve** using OpenAI only when worker credentials are configured and the user has not disabled quiz automation.
8. **Operational mail delivery** for notices, deadlines, auto-learning lifecycle events, policy publication, and user-configured digest mail.
9. **Admin operations center** for members, invites, workers, jobs, policy publishing, and impersonation.

## Non-Functional Requirements

- **Security**: no plaintext CU12 passwords, no plaintext invite tokens, and no secret values in docs or workflow logs.
- **Reliability**: duplicate requests must deduplicate cleanly, stale jobs must be recoverable, and workflows must surface drift between DB state and GitHub Actions state.
- **Operability**: bootstrap, deploy, reconcile, and cleanup must be executable through documented scripts or workflows.
- **Scalability target**: support the current small-group workload (about 5 users) without double-processing or runner storms.
- **Documentation discipline**: README, runbooks, OpenAPI, and workflow docs must stay aligned with code.

## Out of Scope (Current Version)

- Automatic assignment, survey, debate, or exam submission beyond the currently supported task types.
- Third-party chat or mobile push notification delivery.
- Open public signup or self-service account creation.
- Anti-bot bypass or portal fingerprint spoofing behavior.

## Success Metrics

1. Existing users can sign in with real portal credentials and receive a valid session without manual operator intervention.
2. First-time users can complete invite verification and required policy consent in one guided flow.
3. Manual or scheduled sync updates dashboard data within the expected workflow window.
4. Auto-learning requests move through queue, worker, and result logging without duplicate execution for the same in-flight request.
5. Cyber Campus approval-required runs recover cleanly through the approval-session flow without manual DB edits.
6. Operators can bootstrap, deploy, and diagnose the service using only repository docs and workflows.
