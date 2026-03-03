# AGENTS Playbook

## 목적

- CU12 자동화 프로젝트에서 사람/에이전트가 동일한 운영 규칙으로 작업하도록 한다.
- 변경 시 문서, 워크플로우, 시크릿 요구사항을 항상 함께 맞춘다.

## 아키텍처 요약

1. `apps/web`: Next.js API + UI (Vercel 배포)
2. `apps/worker`: Playwright 워커 (GitHub Actions 실행)
3. `packages/core`: 공용 타입/파서
4. `prisma`: PostgreSQL(Neon) 스키마
5. `.github/workflows`: CI/CD, 스케줄 동기화, 워커 실행

## 필수 명령어

```bash
npm install
npm run typecheck
npm run build:web
npm run prisma:generate
npm run prisma:push
npm --workspace @cu12/worker run once
```

## 배포/운영 기본 절차

1. DB 반영: `DB Bootstrap` 또는 `npm run prisma:push`
2. 웹 배포: Vercel 프로덕션 배포 (`apps/web` 루트)
3. 워커 실행: `worker-consume.yml` 수동 실행 또는 스케줄 실행
4. 상태 확인:
- `/api/health` 200
- Actions 최근 `Worker Consume` 성공

## 시크릿/환경변수 규칙

- 민감정보는 코드/문서에 하드코딩 금지.
- GitHub Secrets와 Vercel Env에서 공유 키(`APP_MASTER_KEY`, `WORKER_SHARED_TOKEN`)는 동일 값 유지.
- 변경 시 즉시 재배포/재실행으로 반영 여부 확인.

## 금지 사항

- 프로덕션 DB에 임의 SQL 직접 수정(정식 마이그레이션/런북 없는 변경) 금지.
- 워크플로우 실패 상태에서 반복 트리거만 수행하고 원인 분석 생략 금지.
- 보안 검토 없이 공개 부트스트랩/우회 인증 엔드포인트 추가 금지.

## 변경 시 체크리스트

1. 코드 변경과 문서 변경 동시 반영 (`docs`, `README`)
2. API/스키마 변경 시 `docs/04-api/openapi.yaml` 갱신
3. `npm run typecheck` 통과
4. 필요 시 `npm run build:web` 통과
5. 워크플로우/배포 영향 범위 명시

## 장애 대응 가이드

- 워커 실패:
1. `gh run view <run_id> --log-failed`로 실패 스텝 확인
2. 시크릿 길이/누락 확인 (`APP_MASTER_KEY`, `DATABASE_URL`, `WEB_INTERNAL_BASE_URL`)
3. 수정 후 `worker-consume.yml` 재실행

- Vercel 404:
1. 프로젝트 Root Directory가 `apps/web`인지 확인
2. env 누락 확인 후 재배포
3. `/api/health` 응답 확인
