# CU12 Automation

CU12 수강 상태/공지 탐지 및 자동 수강을 위한 TypeScript 모노레포입니다.

## 구성

- `apps/web`: Next.js 웹앱 + API
- `apps/worker`: Playwright 기반 CU12 동기화/자동 수강 워커
- `packages/core`: 파서/공용 타입
- `prisma`: PostgreSQL 스키마
- `docs`: 요구사항/아키텍처/API/운영 문서

## 로컬 개발

```bash
npm install
npm run prisma:generate
npm run dev:web
```

## 100% Cloud 운영 모델

- 웹/API: Vercel
- DB: Neon PostgreSQL
- 워커 실행: GitHub Actions (`worker-consume.yml`)
- 정기 동기화: GitHub Actions (`sync-schedule.yml`)
- 수동/요청형 자동수강: API에서 GitHub Actions workflow_dispatch 호출

## 필수 시크릿

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL` (Vercel URL)
- `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_WORKFLOW_ID`, `GITHUB_WORKFLOW_REF`, `GITHUB_TOKEN`
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

## 주의

- 자동 수강은 영상 길이만큼 워커 실행 시간이 필요합니다.
- GitHub hosted runner 제한(잡당 최대 6시간, 동시성/쿼터)을 고려해야 합니다.
