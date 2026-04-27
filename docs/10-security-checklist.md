# Security Checklist

## Credentials and Secrets

- [ ] CU12 password is encrypted at rest.
- [ ] Pending approval users do not have portal passwords stored.
- [ ] `AUTH_JWT_SECRET` length and entropy are sufficient.
- [ ] `APP_MASTER_KEY` is rotated with a documented procedure.
- [ ] `WORKER_SHARED_TOKEN` is rotated and synchronized.
- [ ] `WORKER_SHARED_TOKEN` is 32+ chars and randomly generated.

## Session and Auth

- [ ] Session cookie is `httpOnly` and `secure` in production.
- [ ] Login responses are normalized enough to avoid account enumeration beyond the approval state the user already created.
- [ ] Login endpoint enforces rate limiting / lockout.
- [ ] Admin approval is enforced before any session cookie is issued to a first-login user.
- [ ] Approval and rejection decisions are audited.
- [ ] Admin APIs check role before read/write.
- [ ] Authenticated state-changing APIs enforce same-origin CSRF validation (`Origin`/`Referer`).

## Transport and Platform

- [ ] HTTPS is enforced on production domain.
- [ ] Internal worker APIs require `x-worker-token`.
- [ ] Internal worker job update APIs validate job ownership (`workerId` binding).
- [ ] Proxy-derived client IP headers are trusted only when explicitly enabled.
- [ ] Baseline security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS in prod) are applied.
- [ ] Error payloads avoid leaking sensitive internals.

## Logging and Audit

- [ ] No password/token/secret appears in logs.
- [ ] Worker errors retain enough context for incident analysis.
- [ ] Deployment and workflow audit trail is retained.
- [ ] GitHub Secret Scanning and Push Protection are enabled for public repo operation.

## Dependency Hygiene

- [ ] CI includes dependency/security scanning (CodeQL/Dependabot).
- [ ] Major dependency upgrades are manually reviewed.
- [ ] Third-party GitHub Actions are pinned to immutable commit SHA.
- [ ] Emergency patch procedure is documented.

## Secret Leak Incident Response

- [ ] Exposed credential is revoked/rotated immediately (do not wait for patch merge).
- [ ] Affected external systems (DB, SMTP, Vercel, GitHub token, worker token) are rotated and validated.
- [ ] Past Actions logs/PR comments/issues are checked for potential secret echo.
- [ ] Public exposure window and impact are documented in incident notes.
- [ ] Post-rotation secret scan (`secret-scan` check) is green before redeploy.
