# Architecture

## Components

1. `apps/web` (Next.js)
   - CU12 로그인 검증
   - 초대코드 관리(Admin)
   - 대시보드/API
   - 큐 등록 및 GitHub Actions 디스패치
2. `apps/worker` (Node + Playwright)
   - CU12 로그인
   - 동기화/자동 수강
3. `PostgreSQL` (Neon)
   - 사용자, 초대코드, 큐, 스냅샷, 알림, 태스크
4. `GitHub Actions`
   - CI/CD
   - 스케줄 동기화
   - 워커 소비 실행
   - Dependabot 자동 승인/자동병합(패치/마이너)

## Authentication Flow

1. 사용자가 `/login`에서 `cu12Id`, `cu12Password`, `campus` 입력
2. 서버가 `POST /el/lo/hak_login_proc.acl` 호출로 CU12 실검증
3. 기존 `Cu12Account.cu12Id` 사용자는 즉시 로그인
4. 최초 사용자면 `inviteCode` 필수 검증(유효/미사용/ID 일치)
5. 로그인 성공 시 서비스 세션(`cu12_session`) 발급

## Data Flow

1. 사용자 요청 또는 스케줄로 큐 작업 생성
2. 웹 API가 `worker-consume.yml` workflow_dispatch 호출
3. Actions 워커가 큐 선점 -> CU12 처리 -> DB 업데이트
4. 결과를 `JobQueue` 상태로 반영

## Hosting Model

- 웹앱: Vercel
- DB: Neon(PostgreSQL)
- 워커: GitHub hosted runner 전용

## Failure Handling

- 작업 실패 시 `FAILED` 기록 + 백오프 재시도
- 로그인 실패 누적 시 `NEEDS_REAUTH`
- 디스패치 실패 시 큐는 유지되어 다음 스케줄에서 재시도
