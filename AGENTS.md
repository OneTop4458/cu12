# AGENTS Playbook

## Mission

Keep implementation, API contracts, workflows, and operational docs consistent for CU12 Automation.

## Architecture Summary

1. `apps/web`: Next.js API + UI (Vercel)
2. `apps/worker`: Playwright worker (GitHub Actions)
3. `packages/core`: shared parser/types
4. `prisma`: PostgreSQL schema (Neon)
5. `.github/workflows`: CI/CD and ops workflows

## Authentication Model

1. Every login starts with real-time CU12 credential verification.
2. New users must complete one-time invite verification.
3. Invite token is bound to `cu12Id` and single-use.
4. Invite code entry is handled in the post-login modal stage.
5. Registration page flow is not used.

## Documentation Policy

1. Default documentation language is English.
2. Korean summary is allowed only in `README.ko.md`.
3. Keep `docs/04-api/openapi.yaml` synchronized with route behavior.

## Required Commands

```bash
npm install
npm run check:text
npm run prisma:generate
npm run typecheck
npm run build:web
```

## Deployment Baseline

1. DB update: `DB Bootstrap` or `npm run prisma:push`
2. Fresh auth setup: run `Auth Reset Bootstrap`
3. Web deploy: Vercel production deploy (`apps/web`)
4. Worker run: `worker-consume.yml` (manual/scheduled)
5. Validation:
   - `/api/health` returns 200
   - recent worker consume run succeeded

## Change Checklist

1. Code and docs must be updated together.
2. API/schema changes require OpenAPI updates.
3. `npm run check:text` must pass.
4. `npm run typecheck` must pass.
5. Run `npm run build:web` when touching web code.

## Prohibited Actions

- Manual production DB mutation without runbook/workflow.
- Re-running failed workflows repeatedly without root-cause analysis.
- Printing secrets/passwords/tokens in logs.

## Incident Baseline

- Worker failure:
  1. Inspect logs: `gh run view <run_id> --log-failed`
  2. Verify `APP_MASTER_KEY`, `DATABASE_URL`, `WEB_INTERNAL_BASE_URL`
  3. Fix and rerun `worker-consume.yml`

- Vercel 404:
  1. Check Root Directory is `apps/web`
  2. Re-check env variables and redeploy
  3. Validate `/api/health`