# Cloud Setup Playbook

## 목표

- 로컬 PC 상시 실행 없이 100% 클라우드 동작
- 약 5명 동시 사용 시에도 큐 기반으로 안정 처리
- 핵심 기능(자동 수강) 우선 보장

## 구성 요약

1. Web/API: Vercel (`apps/web`)
2. Worker: GitHub Actions (`apps/worker`)
3. DB: Neon PostgreSQL
4. Queue/State: PostgreSQL JobQueue

## 필수 설정값

### GitHub Secrets

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL` (예: `https://cu12-psi.vercel.app`)
- `CU12_BASE_URL` (`https://www.cu12.ac.kr`)
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
- `GITHUB_WORKFLOW_ID` (`worker-consume.yml`)
- `GITHUB_WORKFLOW_REF` (`main`)
- `GITHUB_TOKEN`

## 초기 셋업 절차

1. Neon 프로젝트 생성 후 `DATABASE_URL` 준비
2. GitHub Secrets 입력
3. Vercel 프로젝트 생성 후 Root Directory를 `apps/web`로 지정
4. Vercel Environment Variables 입력
5. GitHub Actions `DB Bootstrap` 실행 (스키마 반영)
6. GitHub Actions `Deploy Vercel` 실행
7. `GET /api/health` 확인
8. `Worker Consume` 수동 실행으로 내부 API 연결 확인

## 운영 API 체크포인트

- 공개 헬스체크: `GET /api/health`
- 워커 헬스 하트비트: `POST /internal/worker/heartbeat`
- 워커 큐 claim: `POST /internal/worker/job/start`
- 워커 완료/실패: `POST /internal/worker/job/finish`, `POST /internal/worker/job/fail`

내부 워커 API는 `x-worker-token` 헤더(`WORKER_SHARED_TOKEN`)가 필요하다.

## 동시성(약 5명) 운영 기준

1. 큐 소비는 DB 선점 기반으로 동시 실행 충돌을 방지한다.
2. `AUTOLEARN_MAX_TASKS`를 2~5 범위에서 시작하고 점진 조정한다.
3. 장시간 작업(실제 영상 길이만큼)은 러너 점유가 길어지므로, 스케줄 간격과 동시성 제한을 함께 튜닝한다.
4. GitHub Actions `concurrency` 그룹으로 중복 실행 폭주를 억제한다.

## 자주 발생하는 문제

### Vercel 404

- 원인: `apps/web`가 아니라 잘못된 루트가 배포됨
- 조치:
1. Root Directory를 `apps/web`로 재확인
2. `Deploy Vercel` 재실행
3. `/api/health` 200 확인 후 워커 실행

### Worker가 Internal API 404

- 원인: `WEB_INTERNAL_BASE_URL` 오입력 또는 웹 배포 미완료
- 조치:
1. `WEB_INTERNAL_BASE_URL`에 실제 프로덕션 도메인 입력
2. 웹 배포 재실행
3. 워커 재실행

## 백업/복구

1. `db-backup.yml`로 정기 백업
2. 배포 실패 시 이전 Vercel 배포로 즉시 롤백
3. 큐 실패 작업은 상태/에러 로그 확인 후 재디스패치
