# ADR-0002: Token Strategy

## Status

Accepted

## Context

- 세션 토큰만 의존하면 만료/무효화 시 자동화 실패가 증가한다.
- CU12는 쿠키 세션 기반이며 로그인 재시도가 가능하다.

## Decision

- 앱 세션은 JWT 쿠키(`cu12_session`) 사용
- CU12 자격증명은 암호화 저장 후 워커가 필요 시 로그인 재수행
- invite token은 해시 저장

## Consequences

- 장점: 토큰 만료에 강함, 복구 쉬움
- 단점: 워커에서 복호화/로그인 책임 증가
