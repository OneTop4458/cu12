# Cloud Setup Playbook

## Objective

Run CU12 Automation as a fully cloud-hosted system with:

- Vercel for the Next.js web application
- Neon PostgreSQL for persistence
- GitHub Actions for scheduled and on-demand worker execution

## Target Stack

1. Web/API: Vercel (`apps/web`)
2. Database: Neon PostgreSQL
3. Worker runtime: GitHub Actions (`worker-consume.yml`)
4. Source control, CI, and operations: GitHub

## Prerequisites

- GitHub repository and Actions enabled
- Vercel project linked to the repository with Root Directory set to `apps/web`
- `apps/web/vercel.json` retained as the Vercel project configuration so the free single-region setting is applied
- Neon database URL
- Required GitHub secrets and Vercel env vars configured

## Setup Steps

1. Configure GitHub secrets:
   - `DATABASE_URL`
   - `APP_MASTER_KEY`
   - `WORKER_SHARED_TOKEN`
   - `WEB_INTERNAL_BASE_URL`
   - `CU12_BASE_URL`
   - deploy secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`)
2. Configure Vercel env vars:
   - `DATABASE_URL`
   - `APP_MASTER_KEY`
   - `AUTH_JWT_SECRET`
   - `WORKER_SHARED_TOKEN`
   - `CU12_BASE_URL`
   - GitHub dispatch vars (`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_ID`, `GITHUB_WORKFLOW_REF`, `GITHUB_TOKEN`)
3. Add optional overrides only when needed:
   - `CYBER_CAMPUS_BASE_URL`
   - `WORKER_DISPATCH_MAX_PARALLEL`
   - `AUTOLEARN_CHAIN_MAX_SECONDS`
   - `CYBER_CAMPUS_AUTOLEARN_CHUNK_TARGET_SECONDS`
   - `CYBER_CAMPUS_AUTOLEARN_MAX_TASKS`
   - `WORKER_WORKFLOW_STARTED_AT_MS` (set by `worker-consume.yml`)
   - `SMTP_*`
   - `OPENAI_API_KEY` for worker quiz automation
4. Keep `apps/web/vercel.json` set to the single `sin1` region. This stays within the free Hobby plan's included limits and does not enable on-demand billing; do not configure paid multi-region deployment, function failover, or a Fluid Compute override.
5. Run `DB Bootstrap`.
6. Run `Auth Reset Bootstrap`.
7. Deploy the web app with `Deploy Vercel`.
8. Verify `/api/health`, then inspect `X-Vercel-Id` or the Function invocation's `VERCEL_REGION` metadata for `sin1`.
9. Log in as admin, publish the required policy documents, and approve pending users.
10. Trigger `worker-consume.yml` once to confirm the worker can claim and finish queued work.

## Concurrency Guidance (~5 users)

1. Keep centralized dispatch capped with `WORKER_DISPATCH_MAX_PARALLEL`.
2. Keep scheduled sync at the current 2-hour cadence unless actual latency requires change.
3. Keep AUTOLEARN chunking enabled. CU12 runs hand off through continuation jobs; Cyber Campus runs cap each request at the configured runtime budget.
4. Watch reconcile output before raising concurrency.

## Rollback Basics

1. Roll back the latest Vercel deployment if the web app regresses.
2. Re-run `DB Bootstrap` only when schema sync actually failed; do not mutate production DB manually first.
3. Correct secrets/env drift before rerunning worker or deploy workflows.
4. Rebuild derived course data through sync workflows after service recovery.
