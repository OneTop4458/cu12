# GitHub Actions Runbook

## Workflows

1. `ci.yml`
- install, typecheck, build
2. `db-bootstrap.yml`
- one-time Prisma schema push to Neon (`prisma db push`)
3. `admin-bootstrap.yml`
- one-time admin user bootstrap (workflow dispatch)
4. `deploy-vercel.yml`
- build/deploy web app from `apps/web`
5. `sync-schedule.yml`
- create scheduled `SYNC` jobs every 30 minutes and consume queue
6. `autolearn-dispatch.yml`
- create manual `AUTOLEARN` jobs and consume queue
7. `worker-consume.yml`
- worker queue consumer (shared execution flow)
8. `db-backup.yml`
- daily DB backup
9. `codeql.yml`
- static security analysis for JS/TS
10. `labeler.yml`
- automatic PR labeling by changed paths
11. `stale.yml`
- stale issue/PR management

## Required GitHub Secrets

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

## Required Vercel Environment Variables

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `APP_MASTER_KEY`
- `WORKER_SHARED_TOKEN`
- `CU12_BASE_URL`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW_ID` (example: `worker-consume.yml`)
- `GITHUB_WORKFLOW_REF` (example: `main`)
- `GITHUB_TOKEN`

## First-Time Cloud Setup

1. Configure GitHub Secrets
2. Configure Vercel environment variables
3. Run `DB Bootstrap`
4. Run `Admin Bootstrap` to create first ADMIN user
5. Run `Deploy Vercel`
6. Verify `https://<vercel-domain>/api/health`
7. Run `Worker Consume` manually once

## Troubleshooting

### Worker Fails with env validation

- symptom: zod error in worker startup (for example `APP_MASTER_KEY` too short)
- action: sync shared secrets (`APP_MASTER_KEY`, `WORKER_SHARED_TOKEN`) between GitHub and Vercel, then redeploy web and rerun worker

### Internal API returns 404

- symptom: `/internal/worker/heartbeat` returns 404
- action:
1. verify Vercel Root Directory is `apps/web`
2. redeploy web
3. verify `/api/health` = 200
4. rerun worker

### Dispatch succeeds but no worker result

- action:
1. inspect queue status via `/api/jobs`
2. inspect latest run logs: `gh run view <run_id> --log-failed`
3. verify `WEB_INTERNAL_BASE_URL` points to production web URL
