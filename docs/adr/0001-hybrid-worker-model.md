# ADR-0001: Cloud-only Worker Model

## Status

Accepted

## Context

- 사용자 요구사항은 로컬/상시 서버 없이 100% cloud 운영이다.
- 자동 수강은 영상 재생 시간을 실제 소비해야 한다.
- 사용자는 소규모(약 5명)이며 운영 단순성이 중요하다.

## Decision

- 웹/API는 Vercel에서 운영한다.
- DB는 Neon(PostgreSQL) 사용.
- 워커는 GitHub hosted runner에서만 실행한다.
- 요청 시 웹 API가 GitHub Actions workflow_dispatch로 워커를 즉시 실행한다.

## Consequences

- 장점: 로컬 의존 제거, 운영 일관성 확보
- 단점: Actions 실행시간/쿼터 제한에 영향 받음
