# CU12 자동화

CU12 자동화는 CU12와 사이버캠퍼스를 대상으로 동작하는 관리자 승인 기반 소규모 운영용 자동화 서비스입니다. 로그인 시 실제 포털 자격 증명을 즉시 검증하고, 강의/공지/메시지 데이터를 동기화하며, 장시간 학습 작업은 GitHub Actions 워커로 분리해 실행합니다.

## 핵심 요약

- 로그인: 실시간 포털 인증 + 최초 관리자 승인 + 정책 동의 단계
- 지원 범위: CU12, Cyber Campus
- 자동 학습: VOD, 자료, 선택적 퀴즈 자동 풀이
- 운영 방식: Vercel 웹 앱 + Neon PostgreSQL + GitHub Actions 워커
- 알림: 대시보드 알림/메시지, 즉시 메일, 시간대 기반 다이제스트

## 빠른 시작

```bash
corepack enable pnpm
corepack pnpm install --frozen-lockfile
corepack pnpm run prisma:generate
corepack pnpm run check:text
corepack pnpm run check:openapi
corepack pnpm run typecheck
corepack pnpm run test:web
corepack pnpm run test:ops
corepack pnpm run build:web
```

## 운영 스케줄

- 동기화: `sync-schedule.yml` 이 2시간마다 실행됩니다.
- 자동 학습 예약: `autolearn-dispatch.yml` 이 매일 `00:20 UTC` 에 실행됩니다.
- 상태 점검: `reconcile-health-check.yml` 이 4시간마다 실행됩니다.

## Codex 작업 흐름

```bash
corepack pnpm run ai:start --task "docs-refresh"
corepack pnpm run ai:ship --commit "docs(platform): refresh architecture and runbooks" --title "docs(platform): refresh architecture and runbooks"
corepack pnpm run ai:clean
```

- 스크립트 인자는 `--task` 처럼 바로 넘깁니다.
- 예전 이중 대시 포워딩 형식은 더 이상 사용하지 않습니다.

## 설정 포인트

- 필수 비밀값: `DATABASE_URL`, `APP_MASTER_KEY`, `AUTH_JWT_SECRET`, `WORKER_SHARED_TOKEN`
- 웹 디스패치: `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_ID`, `GITHUB_WORKFLOW_REF`, `GITHUB_TOKEN`
- 선택적 확장: `CYBER_CAMPUS_BASE_URL`, `WORKER_DISPATCH_MAX_PARALLEL`, `AUTOLEARN_CHAIN_MAX_SECONDS`
- 메일/AI 기능: `SMTP_*`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS`

자세한 변수 설명은 `README.md`, `.env.example`, `apps/web/src/lib/env.ts`, `apps/worker/src/env.ts` 를 함께 확인하면 됩니다.

## 문서

- 문서 인덱스: `docs/00-index.md`
- 아키텍처: `docs/02-architecture.md`
- API 계약: `docs/04-api/openapi.yaml`
- 워크플로/운영: `docs/09-github-actions-runbook.md`
