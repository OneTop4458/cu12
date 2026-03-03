# ADR-0002: Token Strategy

## Status

Accepted

## Context

- Session-only strategies are brittle for long-running automation.
- CU12 access requires recurring authenticated browser sessions.
- First-login onboarding must be restricted to approved CU12 IDs.

## Decision

1. Use signed JWT cookie for app session (`cu12_session`).
2. Use short-lived login challenge token for step handoff (`/api/auth/login` -> `/api/auth/login/invite`).
3. Use one-time invite token hashed in DB and bound to `cu12Id`.
4. Store CU12 password encrypted so worker can re-authenticate as needed.

## Consequences

### Positive

- Distinguishes authentication failures cleanly.
- Supports secure first-login gating without registration page.
- Improves resilience when remote session cookies expire.

### Trade-offs

- Adds complexity to login flow and token validation.
- Increases key management responsibility for operators.