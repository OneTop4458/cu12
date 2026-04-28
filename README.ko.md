# CU12 자동화

영문 기준 문서: [`README.md`](README.md)

CU12 자동화는 CU12와 Cyber Campus를 사용하는 소규모 관리자 승인 그룹을 위한 클라우드 기반 운영 서비스입니다. 로그인할 때 실제 포털 자격 증명을 즉시 검증하고, 강의와 공지 데이터를 동기화하며, 오래 걸리는 학습 작업은 GitHub Actions 워커 큐로 분리해 실행합니다.

## 핵심 요약

| 영역 | 현재 동작 |
| --- | --- |
| 인증 | 실시간 포털 검증, 최초 로그인 관리자 승인, 정책 동의, 세션/유휴 쿠키 |
| 제공자 | CU12와 Cyber Campus 모두 provider-aware 동기화와 대시보드 지원 |
| 학습 자동화 | VOD, 자료, 선택적 OpenAI 기반 퀴즈 자동 실행을 큐 기반으로 처리 |
| 워커 런타임 | GitHub Actions에서 HTTP 동기화와 필요한 Playwright 자동화를 실행 |
| 알림 | 대시보드 활동, 마감/정책/승인/자동 학습 결과용 action-required 메일 |
| 관리자 기능 | 회원 승인, 워커 heartbeat, 큐 cleanup/reconcile, 정책 게시, impersonation |

## 아키텍처 요약

- `apps/web`: Vercel에 배포되는 Next.js App Router UI/API입니다. 인증, 세션, 관리자 도구, 작업 enqueue/dispatch, 공개/법적 페이지를 담당합니다.
- `apps/worker`: GitHub Actions에서 실행되는 큐 소비자입니다. HTTP 기반 스냅샷 동기화와 Playwright 기반 자동 학습을 처리합니다.
- `packages/core`: 파서, provider helper, 공유 타입과 계약을 담습니다.
- `prisma`: 사용자, 작업, 스냅샷, 정책, 포털 세션, 승인 세션, 메일, 감사 로그용 PostgreSQL 스키마입니다.
- `.github/workflows`: CI, 배포, DB bootstrap, 일정 dispatch, reconcile, legacy cleanup, secret scan을 담당합니다.

Cyber Campus 자동 학습은 먼저 저장된 포털 세션 재사용을 시도합니다. 2차 인증이 필요하면 `BLOCKED` AUTOLEARN 작업과 `PortalApprovalSession`을 만들고, 워커가 실제 강의 컨텍스트에서 승인 필요 여부를 확인합니다. 승인이 완료되면 워커가 포털 세션을 저장하고 실행 가능한 AUTOLEARN 작업을 같은 Playwright 세션에서 바로 claim해 이어서 처리할 수 있습니다.

## 빠른 시작과 검증

```bash
corepack enable pnpm
corepack pnpm install --frozen-lockfile
corepack pnpm run check:text
corepack pnpm run check:openapi
corepack pnpm run prisma:generate
corepack pnpm run typecheck
corepack pnpm run test:all
corepack pnpm run build:web
```

- `pnpm-lock.yaml`이 바뀌었거나 Node 버전이 바뀌었거나 현재 worktree에 설치가 없으면 `corepack pnpm install --frozen-lockfile`을 다시 실행합니다.
- fresh install 이후나 `prisma/schema.prisma` 또는 Prisma 모델 사용이 바뀐 경우 `corepack pnpm run prisma:generate`를 다시 실행합니다.
- Windows에서 `pnpm`이 PATH에 없을 수 있으므로 저장소 표준은 `corepack pnpm`입니다.

## Codex 작업 흐름

```bash
corepack pnpm run ai:start --task "docs-refresh"
corepack pnpm run ai:ship --commit "docs(platform): refresh architecture and runbooks" --title "docs(platform): refresh architecture and runbooks"
corepack pnpm run ai:clean
```

- PowerShell 기반 스크립트 인자는 `--task`처럼 바로 전달합니다.
- 예전의 이중 대시 전달 형식은 사용하지 않습니다.

## 운영 스케줄

| 워크플로 | 스케줄 | 현재 동작 |
| --- | --- | --- |
| `sync-schedule.yml` | `0 */2 * * *` UTC | 2시간마다 provider-aware sync 작업을 enqueue하고 중앙 worker dispatch를 요청합니다. |
| `autolearn-dispatch.yml` | `20 0 * * *` UTC | eligible pending work가 있는 사용자에게만 일일 AUTOLEARN을 queue합니다. |
| `reconcile-health-check.yml` | `0 */4 * * *` UTC | DB의 `RUNNING` 작업과 활성 GitHub runs가 어긋나는지 확인합니다. |
| `db-retention-cleanup.yml` | `10 1 * * *` UTC | legacy bogus course notice를 정리합니다. 수동 `user_repair`는 선택한 사용자의 notification event도 정리할 수 있습니다. |

## 설정 포인트

| 구분 | 주요 변수 |
| --- | --- |
| 공통 필수 | `DATABASE_URL`, `APP_MASTER_KEY` |
| Web/Vercel | `AUTH_JWT_SECRET`, `WORKER_SHARED_TOKEN`, `CU12_BASE_URL`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_ID`, `GITHUB_WORKFLOW_REF`, `GITHUB_TOKEN` |
| Worker/GitHub Actions | `WEB_INTERNAL_BASE_URL`, `WORKER_SHARED_TOKEN`, `CU12_BASE_URL`, `DATABASE_URL`, `APP_MASTER_KEY` |
| 선택 provider/dispatch | `CYBER_CAMPUS_BASE_URL`, `TRUST_PROXY_HEADERS`, `WORKER_DISPATCH_MAX_PARALLEL`, `AUTOLEARN_CHAIN_MAX_SECONDS` |
| 메일/AI | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS` |
| 워커 튜닝 | `WORKER_ONCE_IDLE_GRACE_MS`, `AUTOLEARN_CHUNK_TARGET_SECONDS`, `AUTOLEARN_MAX_TASKS`, `AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS`, `AUTOLEARN_STALL_TIMEOUT_SECONDS`, `AUTOLEARN_TIME_FACTOR`, `PLAYWRIGHT_*`, `AUTOLEARN_*` |

정확한 최신 변수 목록은 `.env.example`, `apps/web/src/lib/env.ts`, `apps/worker/src/env.ts`가 기준입니다.

## 운영 빠른 시작

1. GitHub Secrets와 Vercel production environment variables를 설정합니다.
2. `DB Bootstrap`을 실행합니다.
3. 최초 관리자 CU12 ID로 `Auth Reset Bootstrap`을 실행합니다.
4. 웹 애플리케이션을 배포하고 `/api/health`가 `200`을 반환하는지 확인합니다.
5. 관리자로 로그인해 필수 정책 문서를 게시하고 pending 사용자를 승인합니다.
6. `worker-consume.yml`을 한 번 실행해 큐 작업이 terminal state로 진행되는지 확인합니다.
7. 정상 운영 중에는 `Reconcile Health Check`와 `secret-scan` 결과를 확인합니다.

## 문서

- 문서 인덱스: [`docs/00-index.md`](docs/00-index.md)
- 제품 요구사항: [`docs/01-prd.md`](docs/01-prd.md)
- 아키텍처: [`docs/02-architecture.md`](docs/02-architecture.md)
- 데이터 모델: [`docs/03-data-model.md`](docs/03-data-model.md)
- API 계약: [`docs/04-api/openapi.yaml`](docs/04-api/openapi.yaml)
- 워크플로/운영 runbook: [`docs/09-github-actions-runbook.md`](docs/09-github-actions-runbook.md)
