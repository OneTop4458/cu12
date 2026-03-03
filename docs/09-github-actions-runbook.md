# GitHub Actions Runbook

## Workflows

1. `ci.yml`
   - install, typecheck, build
2. `db-bootstrap.yml`
   - Prisma schema push (`prisma db push`)
3. `admin-bootstrap.yml`
   - 관리자용 초대코드 발급
4. `auth-reset-bootstrap.yml`
   - 인증/사용자 데이터 전체 초기화 + 관리자 초대코드 발급
5. `deploy-vercel.yml`
   - web app build/deploy (`apps/web`)
6. `sync-schedule.yml`
   - 30분마다 `SYNC` 큐 생성 후 소비
7. `autolearn-dispatch.yml`
   - 수동 `AUTOLEARN` 큐 생성 후 소비
8. `worker-consume.yml`
   - 워커 큐 소비
9. `db-backup.yml`
   - 일일 DB 백업
10. `codeql.yml`
   - JS/TS 정적 보안 분석
11. `labeler.yml`
   - 파일 경로 기반 PR 라벨링
12. `stale.yml`
   - 오래된 issue/PR 정리
13. `dependabot-auto-review.yml`
   - Dependabot 패치/마이너 자동 승인+자동병합
   - 메이저는 `major-update` 라벨 후 수동 검토

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
- `GITHUB_WORKFLOW_ID` (예: `worker-consume.yml`)
- `GITHUB_WORKFLOW_REF` (예: `main`)
- `GITHUB_TOKEN`

## First-Time Cloud Setup

1. GitHub Secrets 설정
2. Vercel 환경변수 설정
3. `DB Bootstrap` 실행
4. 신규 환경이면 `Auth Reset Bootstrap` 실행 후 관리자 초대코드 획득
5. `Deploy Vercel` 실행
6. `https://<vercel-domain>/api/health` 확인
7. `Worker Consume` 수동 실행 1회 확인

## Troubleshooting

### Worker env validation 실패

- 조치:
1. `APP_MASTER_KEY`, `WORKER_SHARED_TOKEN`을 GitHub/Vercel 동일값으로 동기화
2. 웹 재배포
3. 워커 재실행

### Internal API 404

- 조치:
1. Vercel Root Directory=`apps/web` 확인
2. 웹 재배포
3. `/api/health` 확인
4. 워커 재실행

### Dispatch 성공인데 처리 안 됨

- 조치:
1. `/api/jobs`에서 큐 상태 확인
2. `gh run view <run_id> --log-failed`로 실패 스텝 확인
3. `WEB_INTERNAL_BASE_URL`가 프로덕션 도메인인지 확인
