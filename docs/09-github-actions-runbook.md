# GitHub Actions Runbook

## Workflows

1. `ci.yml`
   - install, typecheck, build
2. `deploy-vercel.yml`
   - main push 시 Vercel 배포
3. `sync-schedule.yml`
   - 30분마다 SYNC 작업 큐 적재 후 워커 실행
4. `autolearn-dispatch.yml`
   - 수동 AUTOLEARN 큐 적재 후 워커 실행
5. `worker-consume.yml`
   - 큐 소비 실행(스케줄/수동/API 디스패치 공통)
6. `db-backup.yml`
   - 일 1회 백업

## Required Secrets (GitHub)

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL`
- `CU12_BASE_URL`
- `AUTOLEARN_TIME_FACTOR`
- `AUTOLEARN_MAX_TASKS`
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

## Required Env (Vercel)

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `APP_MASTER_KEY`
- `WORKER_SHARED_TOKEN`
- `CU12_BASE_URL`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW_ID` (예: `worker-consume.yml`)
- `GITHUB_WORKFLOW_REF` (예: `main`)
- `GITHUB_TOKEN` (repo/workflow 권한)

## Notes

- self-hosted runner 없이 운영한다.
- 워커 실행시간이 긴 작업은 Actions 제한(최대 6시간)을 넘지 않도록 `AUTOLEARN_MAX_TASKS`를 조절한다.
