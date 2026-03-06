# Security Checklist

## Credentials and Secrets

- [ ] CU12 password is encrypted at rest.
- [ ] Invite token plaintext is never stored.
- [ ] `AUTH_JWT_SECRET` length and entropy are sufficient.
- [ ] `APP_MASTER_KEY` is rotated with a documented procedure.
- [ ] `WORKER_SHARED_TOKEN` is rotated and synchronized.
- [ ] `WORKER_SHARED_TOKEN` is 32+ chars and randomly generated.

## Session and Auth

- [ ] Session cookie is `httpOnly` and `secure` in production.
- [ ] Login flow distinguishes `CU12_AUTH_FAILED` vs `UNAPPROVED_ID`.
- [ ] Login and invite verification endpoints enforce rate limiting / lockout.
- [ ] One-time invite requirement is enforced for first login.
- [ ] Admin APIs check role before read/write.

## Transport and Platform

- [ ] HTTPS is enforced on production domain.
- [ ] Internal worker APIs require `x-worker-token`.
- [ ] Error payloads avoid leaking sensitive internals.

## Logging and Audit

- [ ] No password/token/secret appears in logs.
- [ ] Worker errors retain enough context for incident analysis.
- [ ] Deployment and workflow audit trail is retained.

## Dependency Hygiene

- [ ] CI includes dependency/security scanning (CodeQL/Dependabot).
- [ ] Major dependency upgrades are manually reviewed.
- [ ] Third-party GitHub Actions are pinned to immutable commit SHA.
- [ ] Emergency patch procedure is documented.
