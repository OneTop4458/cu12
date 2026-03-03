# GitHub Actions Runbook

## Workflows

1. `ci.yml`
- install, typecheck, build
2. `db-bootstrap.yml`
- Neon DB에 Prisma 스키마 1회 반영 (`prisma db push`)
3. `deploy-vercel.yml`
- `apps/web` 기준으로 Vercel pull/build/deploy 수행
4. `sync-schedule.yml`
- 30분마다 SYNC 작업 큐 적재 후 워커 실행
5. `autolearn-dispatch.yml`
- 수동 AUTOLEARN 큐 적재 후 워커 실행
6. `worker-consume.yml`
- 큐 소비 실행(스케줄/수동/API 디스패치 공통)
7. `db-backup.yml`
- 일 1회 백업

## Required Secrets (GitHub)

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

## First-Time Cloud Setup Order

1. GitHub Secrets 설정
2. Vercel Environment Variables 설정
3. `DB Bootstrap` 실행
4. `Deploy Vercel` 실행
5. `https://<vercel-domain>/api/health` 확인
6. `Worker Consume` 수동 실행으로 내부 API 연결 확인

## 404 Troubleshooting

- 증상: `https://<vercel-domain>/internal/worker/heartbeat` 가 404
- 원인: Vercel가 `apps/web`를 빌드하지 못했거나 잘못된 프로젝트 루트로 배포됨
- 조치:
1. Vercel 프로젝트 Root Directory를 `apps/web`로 설정
2. `Deploy Vercel` 재실행
3. `api/health`가 200인지 확인
4. 이후 `Worker Consume` 재실행

## Notes

- self-hosted runner 없이 운영한다.
- 자동 수강은 영상 길이만큼 러너가 점유된다.
- 워커 실행시간이 긴 작업은 Actions 제한(최대 6시간)을 넘지 않도록 `AUTOLEARN_MAX_TASKS`를 조절한다.
