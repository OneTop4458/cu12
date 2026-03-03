# GitHub Actions Runbook

## Core Workflows

1. `ci.yml`
- Runs text quality checks, type checks, and build validation.

2. `deploy-vercel.yml`
- Deploys web application to Vercel from `main`.

3. `worker-consume.yml`
- Claims and processes queue jobs via worker runtime.
- Can be scheduled or manually dispatched.

4. `sync-schedule.yml`
- Dispatches periodic `SYNC` jobs and then calls `worker-consume.yml`.

5. `mail-digest-schedule.yml`
- Dispatches daily `MAIL_DIGEST` jobs and then calls `worker-consume.yml`.

6. `db-bootstrap.yml`
- Applies DB schema initialization (`prisma db push`).

7. `auth-reset-bootstrap.yml`
- Resets auth-related data and issues fresh admin invite code.

## Required Secrets

### GitHub

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL`
- `CU12_BASE_URL`
- `GITHUB_TOKEN` (or PAT for workflow dispatch when required)
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

### Vercel

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `CU12_BASE_URL`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW_ID`
- `GITHUB_WORKFLOW_REF`
- `GITHUB_TOKEN`

## Operator Sequence

1. Run `DB Bootstrap`.
2. Run `Auth Reset Bootstrap` on new environment.
3. Deploy web app (`Deploy Vercel`).
4. Confirm `/api/health`.
5. Trigger `Worker Consume` once and validate queue updates.

## Common Failures

### Worker env validation failed

1. Verify `APP_MASTER_KEY`, `WORKER_SHARED_TOKEN`, `DATABASE_URL`.
2. Ensure values are aligned across GitHub and Vercel.
3. Redeploy web app and rerun worker.

### Vercel deployment returns 404

1. Verify Vercel project Root Directory is `apps/web`.
2. Confirm environment variables exist in production scope.
3. Redeploy and check `/api/health`.

### Dispatch succeeded but no processing

1. Check queue status via `/api/jobs`.
2. Review failed logs with `gh run view <run_id> --log-failed`.
3. Confirm `WEB_INTERNAL_BASE_URL` points to production URL.
