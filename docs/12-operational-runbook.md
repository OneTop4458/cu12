# Operational Runbook

## Daily Checks

1. 최근 워커 실행(`worker-consume`) 성공 여부
2. 실패 잡 수(`FAILED`) 확인
3. `NEEDS_REAUTH` 계정 확인
4. 메일 발송 실패 로그 확인

## Manual Sync

1. 사용자 `POST /api/jobs/sync-now`
2. 응답의 `dispatched` 확인
3. `/api/jobs/{jobId}` 상태 확인

## Manual Auto-learning

1. 사용자 `POST /api/jobs/autolearn-request`
2. 응답의 `dispatched` 확인
3. `worker-consume` 실행 로그와 `learning_runs` 확인

## Incident Response

1. 로그인 실패 급증: CU12 로그인 UI/정책 변경 확인
2. 자동수강 실패 급증: 플레이어/출석 엔드포인트 변경 확인
3. Actions 실패: 시크릿 누락/Playwright 설치 실패/러너 제한 확인

## Backup

- DB 백업 일 1회
- 복구 리허설 월 1회
