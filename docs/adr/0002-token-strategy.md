# ADR-0002: Token Strategy

## Status

Accepted

## Context

- Session-only strategies are brittle for long-running automation.
- CU12 access requires recurring authenticated browser sessions.
- First-login onboarding must be restricted to administrator-approved CU12 users.

## Decision

1. Use signed JWT cookie for app session (`cu12_session`).
2. Use `APPROVAL_PENDING` state for first-login users after real-time portal verification.
3. Do not store portal passwords or issue session cookies until an administrator approves the user and the user logs in again.
4. Store CU12 password encrypted after approved login so worker can re-authenticate as needed.

## Consequences

### Positive

- Distinguishes authentication failures cleanly.
- Supports secure first-login gating without registration page.
- Improves resilience when remote session cookies expire.

### Trade-offs

- Adds an administrator approval queue to the login flow.
- Increases key management responsibility for operators.
