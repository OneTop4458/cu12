# Cloud Setup Playbook

## Objective

Run CU12 Automation as a **100% cloud-based system** with no always-on local machine.

## Target Stack

1. Web/API: Vercel (`apps/web`)
2. DB: Neon PostgreSQL
3. Worker runtime: GitHub Actions (`apps/worker`)
4. Source control and automation: GitHub

## Prerequisites

- GitHub repository connected.
- Vercel project linked to repository.
- Neon database URL available.
- Required secrets available (see `docs/09-github-actions-runbook.md`).

## Setup Steps

1. Configure GitHub repository secrets.
2. Configure Vercel project environment variables.
3. Ensure Vercel Root Directory is `apps/web`.
4. Run `DB Bootstrap` workflow.
5. If fresh environment, run `Auth Reset Bootstrap`.
6. Deploy web app and verify `/api/health`.
7. Trigger `Worker Consume` and verify queue processing.

## Concurrency Guidance (~5 users)

1. Keep per-user job serialization enabled.
2. Start with conservative auto-learning throughput.
3. Keep scheduled sync at 2-hour interval for free-tier stability.
4. Monitor run durations and runner quota.
5. Keep daily retention cleanup enabled to prevent DB growth.
6. Increase capacity incrementally after stability confirmation.

## Rollback Basics

1. Roll back Vercel deployment if web regression occurs.
2. Re-run worker after env correction.
3. Rebuild derived CU12 data by running sync/scan workflows after service recovery.
