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

## 빠른 클라우드 시작

1. Neon에서 DB URL 발급 (`DATABASE_URL`)
2. GitHub Secrets 설정 (`DATABASE_URL`, 앱/워커/Vercel 관련 시크릿)
3. Vercel 프로젝트 설정
- Root Directory: `apps/web`
- Build Command: `npm run build`
- Install Command: `npm install`
4. Vercel Environment Variables 설정 (`docs/09-github-actions-runbook.md` 참고)
5. GitHub Actions에서 `DB Bootstrap` 1회 실행
6. GitHub Actions에서 `Deploy Vercel` 실행
7. `https://<your-domain>/api/health` 확인

로컬 PC에 PostgreSQL 설치는 필요 없습니다. Neon만 사용하면 됩니다.

## 필수 시크릿 (GitHub)

- `DATABASE_URL`
- `APP_MASTER_KEY`
- `AUTH_JWT_SECRET`
- `WORKER_SHARED_TOKEN`
- `WEB_INTERNAL_BASE_URL` (예: `https://cu12-psi.vercel.app`)
- `CU12_BASE_URL`
- `AUTOLEARN_TIME_FACTOR`
- `AUTOLEARN_MAX_TASKS`
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

## 필수 환경변수 (Vercel)

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `APP_MASTER_KEY`
- `WORKER_SHARED_TOKEN`
- `CU12_BASE_URL`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_WORKFLOW_ID` (`worker-consume.yml`)
- `GITHUB_WORKFLOW_REF` (`main`)
- `GITHUB_TOKEN` (repo/workflow 권한)

## 주의

- 자동 수강은 영상 길이만큼 워커 실행 시간이 필요합니다.
- GitHub hosted runner 제한(잡당 최대 6시간, 동시성/쿼터)을 고려해야 합니다.
