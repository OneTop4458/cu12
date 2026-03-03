# Operational Runbook

## Daily Checks

1. 최근 `worker-consume` 성공 여부
2. `FAILED` 잡 개수 확인
3. `NEEDS_REAUTH` 계정 확인
4. 메일 발송 실패 로그 확인

## Manual Sync

1. 사용자 `POST /api/jobs/sync-now`
2. 응답 `dispatched` 확인
3. `/api/jobs/{jobId}` 상태 확인

## Manual Auto-learning

1. 사용자 `POST /api/jobs/autolearn-request`
2. 응답 `dispatched` 확인
3. `worker-consume` 로그와 `LearningRun` 확인

## First Admin Onboarding

1. 신규 환경이면 `Auth Reset Bootstrap` 실행
2. 로그에서 출력된 관리자 초대코드 확보
3. `/login`에서 관리자 `cu12Id/cu12Password + inviteCode`로 최초 로그인
4. 대시보드에서 사용자별 초대코드 발급

## Incident Response

1. 로그인 실패 급증: CU12 로그인 API/폼 정책 변경 여부 확인
2. 자동수강 실패 급증: 플레이어/출석 엔드포인트 변경 여부 확인
3. Actions 실패: 시크릿 누락/Playwright 설치 실패/러너 제한 확인

## Backup

- DB 백업 일 1회
- 복구 리허설 월 1회
