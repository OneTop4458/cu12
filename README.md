# CU12 Automation

CU12 수강 상태/공지 탐지 및 자동 수강을 위한 TypeScript monorepo입니다.

## Monorepo Structure

- `apps/web`: Next.js web app + API (Vercel)
- `apps/worker`: Playwright worker (GitHub Actions)
- `packages/core`: shared types and parser
- `prisma`: PostgreSQL schema
- `docs`: architecture, API, runbooks

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
- `WEB_INTERNAL_BASE_URL` (example: `https://cu12-psi.vercel.app`)
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

1. Set Neon DB URL (`DATABASE_URL`)
2. Configure GitHub secrets
3. Configure Vercel project:
- Root Directory: `apps/web`
- Build Command: `npm run build`
- Install Command: `npm install`
4. Configure Vercel environment variables
5. Run `DB Bootstrap` workflow once
6. Deploy Vercel
7. Verify `GET /api/health` is `200`

## Notes

- Auto-learning consumes runner time close to real video length.
- Tune `AUTOLEARN_MAX_TASKS` with GitHub Actions runtime limits in mind.
