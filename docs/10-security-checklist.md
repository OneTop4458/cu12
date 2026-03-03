# Security Checklist

## Credentials

- [ ] CU12 비밀번호 암호화 저장 확인
- [ ] JWT secret 32자 이상 사용
- [ ] Worker shared token 16자 이상 사용
- [ ] 관리자 토큰/초대코드 출력은 최소화(로그 보관 정책 포함)

## Transport

- [ ] HTTPS 강제
- [ ] session cookie secure 설정(prod)
- [ ] 내부 워커 엔드포인트 토큰 검증

## Data Protection

- [ ] 민감정보 로그 마스킹
- [ ] invite token 원문 비저장(해시 저장)
- [ ] 최소 권한 원칙 적용

## Access Control

- [ ] 최초 1회 초대코드 인증 강제
- [ ] 초대코드와 `cu12Id` 일치 검증
- [ ] 관리자 API role check
- [ ] 사용자 데이터는 본인 계정으로만 조회 가능

## Ops

- [ ] 의존성 취약점 점검(Dependabot + CodeQL)
- [ ] 키 회전 절차 문서화
- [ ] 장애 대응 런북 유지
