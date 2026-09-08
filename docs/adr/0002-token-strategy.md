# ADR-0002: Token Strategy

## Status

Accepted

Amended on 2026-09-08 to reflect the configurable member-approval policy. The JWT and encrypted-credential strategy is unchanged.

## Context

- Session-only strategies are brittle for long-running automation.
- CU12 access requires recurring authenticated browser sessions.
- First-login onboarding requires verified portal credentials, with administrator approval enabled by default and configurable by administrators.

## Decision

1. Use signed JWT cookie for app session (`cu12_session`).
2. Use `APPROVAL_PENDING` state for first-login users after real-time portal verification when member approval is ON.
3. Pending users have no stored portal password or session cookie. Manual approval requires another verified login; while approval is OFF, successful portal verification automatically approves new and pending users and continues to account linking and required consent.
4. Store CU12 password encrypted after approved login so worker can re-authenticate as needed.

## Consequences

### Positive

- Distinguishes authentication failures cleanly.
- Supports secure first-login gating without registration page.
- Improves resilience when remote session cookies expire.

### Trade-offs

- Adds an administrator approval queue to the login flow when the approval wait is enabled.
- Increases key management responsibility for operators.
