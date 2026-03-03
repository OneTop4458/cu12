# Cloud Setup Playbook

## Goals

- Run 100% in cloud (no always-on local machine)
- Support around 5 concurrent users safely
- Prioritize stable auto-learning workflow

## Runtime Components

1. Web/API: Vercel (`apps/web`)
2. Worker: GitHub Actions (`apps/worker`)
3. DB: Neon PostgreSQL
4. Queue/State: PostgreSQL (`JobQueue` and snapshots)

## Required Configuration

### GitHub Secrets

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL`
- `CU12_BASE_URL`
- `AUTOLEARN_TIME_FACTOR`
- `AUTOLEARN_MAX_TASKS`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

### Vercel Environment Variables

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `APP_MASTER_KEY`
- `WORKER_SHARED_TOKEN`
- `CU12_BASE_URL`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW_ID`
- `GITHUB_WORKFLOW_REF`
- `GITHUB_TOKEN`

## Setup Order

1. Create Neon project and prepare `DATABASE_URL`
2. Set GitHub Secrets
3. Set Vercel env vars
4. Set Vercel project root to `apps/web`
5. Run `DB Bootstrap`
6. Run `Admin Bootstrap`
7. Run `Deploy Vercel`
8. Verify `GET /api/health`
9. Run `Worker Consume` once and check success

## Operational Endpoints

- public health: `GET /api/health`
- worker heartbeat: `POST /internal/worker/heartbeat`
- worker claim job: `POST /internal/worker/job/start`
- worker finish/fail: `POST /internal/worker/job/finish`, `POST /internal/worker/job/fail`

Internal worker endpoints require `x-worker-token` (`WORKER_SHARED_TOKEN`).

## Concurrency Guidance (about 5 users)

1. Queue claim is DB-based and avoids double processing.
2. Start with `AUTOLEARN_MAX_TASKS=2..5` and tune gradually.
3. Auto-learning is long-running; tune schedule and concurrency together.
4. Keep `concurrency` group in worker workflow to prevent storm.

## Common Failure Cases

### Web 404 on internal endpoints

- likely wrong Vercel root or broken deploy
- fix:
1. set root directory to `apps/web`
2. redeploy
3. verify `/api/health`
4. rerun worker

### Worker env mismatch

- likely shared secrets differ between GitHub and Vercel
- fix:
1. synchronize `APP_MASTER_KEY` and `WORKER_SHARED_TOKEN`
2. redeploy web
3. rerun worker

## Backup and Recovery

1. Keep `db-backup.yml` enabled
2. Roll back to previous Vercel deployment when needed
3. Re-dispatch failed queue jobs after root cause fix
