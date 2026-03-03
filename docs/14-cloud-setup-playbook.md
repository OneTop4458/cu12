# Cloud Setup Playbook

## Goals

- 100% cloud 운영 (상시 로컬 서버 없음)
- 동시 사용자 약 5명 처리
- 자동수강 안정 운영

## Runtime Components

1. Web/API: Vercel (`apps/web`)
2. Worker: GitHub Actions (`apps/worker`)
3. DB: Neon PostgreSQL
4. Queue/State: PostgreSQL (`JobQueue`, snapshot 테이블)

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

1. Neon `DATABASE_URL` 준비
2. GitHub Secrets 설정
3. Vercel 환경변수 설정
4. Vercel Root Directory=`apps/web` 설정
5. `DB Bootstrap` 실행
6. 신규 배포면 `Auth Reset Bootstrap` 실행(관리자 초대코드 발급)
7. `Deploy Vercel` 실행
8. `/api/health` 확인
9. 관리자 최초 로그인(초대코드 사용)
10. 관리자 화면에서 일반 사용자 초대코드 발급
11. `Worker Consume` 1회 실행 확인

## Operational Endpoints

- health: `GET /api/health`
- worker heartbeat: `POST /internal/worker/heartbeat`
- worker claim job: `POST /internal/worker/job/start`
- worker finish/fail: `POST /internal/worker/job/finish`, `POST /internal/worker/job/fail`

내부 워커 엔드포인트는 `x-worker-token`(`WORKER_SHARED_TOKEN`) 필요.

## Concurrency Guidance (약 5명)

1. Queue claim은 DB 기반 원자 처리
2. `AUTOLEARN_MAX_TASKS=2..5`로 시작 후 점진 조정
3. 자동수강은 장시간 작업이므로 스케줄/동시성 함께 튜닝
4. `worker-consume.yml`의 `concurrency` 그룹 유지

## Common Failure Cases

### Web 404 on internal endpoints

1. Root Directory=`apps/web` 확인
2. 재배포
3. `/api/health` 확인
4. 워커 재실행

### Worker env mismatch

1. GitHub/Vercel의 `APP_MASTER_KEY`, `WORKER_SHARED_TOKEN` 동기화
2. 웹 재배포
3. 워커 재실행

## Backup and Recovery

1. `db-backup.yml` 유지
2. 필요 시 이전 Vercel 배포로 롤백
3. 원인 수정 후 실패 큐 재처리
