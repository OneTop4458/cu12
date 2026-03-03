# Session & Token Lifecycle

## Application Session (`cu12_session`)

1. `/api/auth/login` 성공 시 JWT 발급(만료 12시간)
2. 쿠키 옵션: `httpOnly`, `sameSite=lax`, `secure(prod)`
3. 만료/검증 실패 시 401

## Login Verification Flow

1. 서비스가 CU12 로그인 API(`/el/lo/hak_login_proc.acl`)로 매 로그인 실검증
2. 기존 계정(`Cu12Account.cu12Id`)이면 즉시 세션 발급
3. 신규 계정은 `inviteCode` 검증 후 최초 1회 생성

## Invite Token

1. 원문 토큰은 생성 시 1회만 노출
2. DB에는 SHA-256 해시(`tokenHash`)만 저장
3. 만료 또는 사용된 토큰 재사용 금지
4. 토큰은 특정 `cu12Id`에 바인딩되어 ID 불일치 시 거부

## CU12 Session

1. 워커는 실행 시 CU12 로그인 수행
2. 브라우저 컨텍스트 쿠키로 수집/자동수강 작업 수행
3. 로그인 실패 반복 시 `Cu12Account.accountStatus=NEEDS_REAUTH`

## Secret Handling

1. CU12 비밀번호는 AES-256-GCM 암호문으로 저장
2. 복호화는 워커 프로세스 내에서만 수행
3. 로그/에러/메트릭에 비밀번호/토큰 원문 출력 금지

## Rotation

1. `APP_MASTER_KEY`, `AUTH_JWT_SECRET`, `WORKER_SHARED_TOKEN` 정기 교체
2. 키 교체 시 사용자 재로그인 또는 암호문 재암호화 절차 수행
