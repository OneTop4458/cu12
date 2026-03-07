# PRD

## Product Goal

CU12 Automation provides a cloud-only control plane for a small group (about 5 users) to:

1. Sign in using real CU12 credentials.
2. Check learning progress and notices.
3. Trigger auto-learning jobs safely.
4. Receive operational updates through dashboard status and queued job results.

## Primary Users

- **End users**: students monitoring courses and requesting sync/auto-learning.
- **Admin users**: issue invite codes, monitor queue health, bootstrap environment.

## Core Requirements

1. **Real-time CU12 credential verification on every login**.
2. **One-time invite verification for first-time users only**.
3. **Dashboard APIs** for summary, courses, notices, and job history.
4. **Auto-learning orchestration** through queue + worker model.
5. **Cloud-first runtime** with no always-on local server dependency.

## Non-Functional Requirements

- Concurrency: handle at least 5 simultaneous users without double-processing jobs.
- Security: never store CU12 password in plaintext.
- Reliability: queue retries with backoff on transient failures.
- Operability: workflows and runbooks must be enough for recovery by operators.

## Out of Scope (Current Version)

- Automatic quiz/exam/assignment submission.
- Fully autonomous AI submission.
- Real-time push notifications to third-party channels.

## Success Metrics

1. Dashboard reflects latest course sync within expected schedule window.
2. Auto-learning request results in queued and executed worker job.
3. Login/invite failure handling is safe for users (generalized failure responses) while operators can diagnose detailed causes via audit logs.
4. Cloud deployment can be bootstrapped from docs without local-only steps.
