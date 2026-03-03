# Test Matrix

## API

1. invite 생성/조회 권한
2. invite 수락 정상/만료/중복
3. 로그인 성공/실패
4. CU12 계정 등록/조회/자동화설정 수정
5. 잡 등록/조회/상세조회
6. 대시보드 요약/강좌/공지/알림 조회

## Worker

1. heartbeat 정상 송신
2. job claim/finish/fail
3. sync 수집 후 DB upsert
4. autolearn 실행 후 learning run 기록
5. 로그인 실패 시 account 상태 전환

## Queue / Concurrency

1. 동일 idempotencyKey 중복 방지
2. 동일 사용자 동시 실행 회피
3. 재시도 백오프 동작

## Integration

1. 요청 -> 큐 -> 워커 -> 결과 반영 end-to-end
2. 워커 미가동 시 pending 누적 확인
3. 워커 재가동 시 pending 처리 확인
