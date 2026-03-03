# Architecture

## Components

1. `apps/web` (Next.js)
   - 인증/대시보드/API
   - 큐 등록 및 GitHub Actions 디스패치
2. `apps/worker` (Node + Playwright)
   - CU12 로그인
   - 동기화/자동 수강
3. `PostgreSQL` (Neon)
   - 사용자, 큐, 스냅샷, 알림, 태스크
4. `GitHub Actions`
   - CI/CD
   - 스케줄 동기화
   - 워커 소비 실행

## Data Flow

1. 사용자 요청 또는 스케줄로 큐 작업 생성
2. 웹 API가 `worker-consume.yml` workflow_dispatch 호출
3. Actions 워커가 큐 선점 -> CU12 처리 -> DB 업데이트
4. 결과를 JobQueue 상태로 반영

## Hosting Model

- 웹앱: Vercel
- DB: Neon(PostgreSQL)
- 워커: GitHub hosted runner 전용

## Failure Handling

- 작업 실패 시 `FAILED` 기록 + 백오프 재시도
- 로그인 실패 누적 시 `NEEDS_REAUTH`
- 디스패치 실패 시 큐는 유지되어 다음 스케줄에서 재시도
