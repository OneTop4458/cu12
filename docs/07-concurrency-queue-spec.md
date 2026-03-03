# Concurrency & Queue Spec

## Queue Basics

- 테이블: `JobQueue`
- 타입: `SYNC`, `AUTOLEARN`, `NOTICE_SCAN`, `MAIL_DIGEST`
- 상태: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELED`

## Claim Strategy

1. 워커가 `PENDING + runAfter <= now` 작업 조회
2. `updateMany(where: id + status=PENDING)`로 원자적 선점
3. 선점 실패 시 다음 폴링에서 재시도

## Per-user Serialization

- 동일 사용자의 동시 `RUNNING` 작업이 이미 있으면 신규 선점 작업을 1분 뒤 재대기
- 목적: 세션 충돌 및 중복 처리 방지

## Retry Policy

- 실패 시 `FAILED` 기록
- 시도 횟수 4 미만이면 새 작업 재큐잉
- 백오프: 1분 -> 5분 -> 15분 -> 60분

## Throughput Target

- 사용자 5명 동시 요청 처리
- `SYNC`: 다중 사용자 병렬 가능
- `AUTOLEARN`: 초기에는 낮은 병렬(1~2) 유지

## Idempotency

- `idempotencyKey`로 중복 요청 병합
- `sync:{userId}:manual`, `autolearn:{userId}:{lecture|all}` 패턴 사용
