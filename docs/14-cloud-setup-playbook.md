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
   - `SMTP_*`
   - `OPENAI_API_KEY` for worker quiz automation
4. Run `DB Bootstrap`.
5. Run `Auth Reset Bootstrap`.
6. Deploy the web app with `Deploy Vercel`.
7. Verify `/api/health`.
8. Log in as admin, publish the required policy documents, and approve pending users.
9. Trigger `worker-consume.yml` once to confirm the worker can claim and finish queued work.

## Concurrency Guidance (~5 users)

1. Keep centralized dispatch capped with `WORKER_DISPATCH_MAX_PARALLEL`.
2. Keep scheduled sync at the current 2-hour cadence unless actual latency requires change.
3. Keep AUTOLEARN chunking enabled so long-running sessions hand off instead of monopolizing one run.
4. Watch reconcile output before raising concurrency.

## Rollback Basics

1. Roll back the latest Vercel deployment if the web app regresses.
2. Re-run `DB Bootstrap` only when schema sync actually failed; do not mutate production DB manually first.
3. Correct secrets/env drift before rerunning worker or deploy workflows.
4. Rebuild derived course data through sync workflows after service recovery.
