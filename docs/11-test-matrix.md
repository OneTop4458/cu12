# Test Matrix

## API

1. CU12 로그인 성공/실패
2. 최초 로그인 시 초대코드 필수/정상/만료/재사용/ID 불일치
3. 초대코드 생성/조회 권한(ADMIN/USER)
4. CU12 계정 조회/자동화 설정 수정
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

1. 로그인 -> 대시보드 -> 큐 요청 -> 워커 처리 end-to-end
2. 워커 미가동 시 pending 누적 확인
3. 워커 재가동 시 pending 처리 확인
4. 신규 사용자 최초 로그인(초대코드) 후 자동수강 요청 검증
