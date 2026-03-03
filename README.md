# CU12 Automation

가톨릭 공유대(CU12) 수강 현황/공지 확인과 자동 수강을 위한 TypeScript monorepo입니다.

## Monorepo Structure

- `apps/web`: Next.js web app + API (Vercel)
- `apps/worker`: Playwright worker (GitHub Actions)
- `packages/core`: shared types and parser
- `prisma`: PostgreSQL schema
- `docs`: architecture, API, runbooks

## Authentication Model

- 로그인은 `CU12 아이디/비밀번호`로 매번 실검증합니다.
- 신규 사용자는 최초 1회만 초대코드가 필요합니다.
- 초대코드는 `cu12Id`에 1:1 바인딩되며 재사용할 수 없습니다.

## Local Development

```bash
npm install
npm run prisma:generate
npm run typecheck
npm run build:web
```

## Cloud Runtime Model

- Web/API: Vercel
- DB: Neon PostgreSQL
- Worker: GitHub Actions (`worker-consume.yml`)
- Scheduled sync: GitHub Actions (`sync-schedule.yml`)
- Auto-learn trigger: API -> GitHub Actions workflow dispatch

## Essential GitHub Secrets

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL` (예: `https://cu12-psi.vercel.app`)
- `CU12_BASE_URL`
- `AUTOLEARN_TIME_FACTOR`
- `AUTOLEARN_MAX_TASKS`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## Essential Vercel Environment Variables

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `APP_MASTER_KEY`
- `WORKER_SHARED_TOKEN`
- `CU12_BASE_URL`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW_ID` (`worker-consume.yml`)
- `GITHUB_WORKFLOW_REF` (`main`)
- `GITHUB_TOKEN`

## Quick Setup

1. Neon DB URL(`DATABASE_URL`) 준비
2. GitHub secrets 설정
3. Vercel project 설정
   - Root Directory: `apps/web`
   - Build Command: `npm run build`
   - Install Command: `npm install`
4. Vercel 환경변수 설정
5. `DB Bootstrap` 실행
6. 신규 환경이면 `Auth Reset Bootstrap` 실행(관리자 초대코드 발급)
7. `Deploy Vercel` 실행
8. `/api/health` 확인
9. 관리자 최초 로그인 후 사용자 초대코드 발급

## Notes

- 자동수강은 실제 영상 길이에 비례해 GitHub Actions 러너 시간을 사용합니다.
- `AUTOLEARN_MAX_TASKS`를 작게 시작해서 단계적으로 늘리는 것을 권장합니다.
