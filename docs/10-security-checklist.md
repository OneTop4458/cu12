# Security Checklist

## Credentials

- [ ] CU12 비밀번호 암호화 저장 확인
- [ ] JWT secret 32자 이상 사용
- [ ] Worker shared token 16자 이상 사용

## Transport

- [ ] HTTPS 강제
- [ ] session cookie secure 설정(prod)
- [ ] 내부 워커 엔드포인트 토큰 검증

## Data Protection

- [ ] 민감정보 로그 마스킹
- [ ] invite token 원문 비저장
- [ ] 최소 권한 계정 사용

## Access Control

- [ ] 초대코드 기반 가입 제한
- [ ] 관리자 API role check
- [ ] 사용자 데이터 사용자 본인만 조회 가능

## Ops

- [ ] 의존성 취약점 점검
- [ ] 키 회전 절차 문서화
- [ ] 장애 대응 런북 유지
