# PRD

## Product Goal

CU12 Automation provides a cloud-only operations surface for an administrator-approved group to:

1. Authenticate with real CU12 credentials at sign-in time.
2. Monitor course, notice, notification, and inbox state across CU12 and Cyber Campus.
3. Trigger long-running sync and auto-learning work safely through a queue plus worker model.
4. Operate the service with admin tooling, workflow automation, and documented recovery paths.

## Primary Users

- **End users**: students who sign in, review dashboard state, run sync, and request auto-learning.
- **Admin users**: operators who bootstrap environments, publish policies, approve members, inspect workers, and reconcile jobs.

## Core Requirements

1. **Real-time CU12 credential verification on every login**.
2. **Admin-approved onboarding for first login** after real-time CU12 credential verification.
3. **Policy consent gating** before the final authenticated session when required documents are configured and consent is missing or outdated.
4. **Provider-aware dashboard APIs** covering summary, courses, deadlines, unified activity, site notices, queue state, and Cyber Campus approval state.
5. **Queue-based job orchestration** for `SYNC`, `NOTICE_SCAN`, `AUTOLEARN`, and `MAIL_DIGEST`.
6. **Cloud worker execution** via GitHub Actions with no always-on personal machine requirement.
7. **Optional quiz auto-solve** using OpenAI only when worker credentials are configured and the user has not disabled quiz automation.
8. **Operational mail delivery** only for action-required events: imminent deadlines, auto-learning terminal outcomes, policy publication, and admin approval requests.
9. **Admin operations center** for members, approval requests, workers, jobs, policy publishing, and impersonation.

## Non-Functional Requirements

- **Security**: no plaintext CU12 passwords for pending users, no secret values in docs or workflow logs, and no session before admin approval.
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
2. First-time users can request access by logging in with valid CU12 credentials, wait for administrator approval, and then complete policy consent after re-login.
3. Manual or scheduled sync updates dashboard data within the expected workflow window.
4. Auto-learning requests move through queue, worker, and result logging without duplicate execution for the same in-flight request.
5. Cyber Campus approval-required runs recover cleanly through the approval-session flow without manual DB edits.
6. Operators can bootstrap, deploy, and diagnose the service using only repository docs and workflows.
