# AGENTS Playbook

## Mission

Keep implementation, API contracts, workflows, and operational docs consistent for CU12 Automation.

## Architecture Summary

1. `apps/web`: Next.js API + UI (Vercel)
2. `apps/worker`: Playwright worker (GitHub Actions)
3. `packages/core`: shared parser/types
4. `prisma`: PostgreSQL schema (Neon)
5. `.github/workflows`: CI/CD and ops workflows

## Encoding Rule

1. All repository files must be encoded as **UTF-8 (no BOM)**.
2. Korean copy (UI labels, errors, docs notes) must remain UTF-8; do not use ANSI/CP949/UTF-16.
3. For any text corruption reports (`U+FFFD`, replacement char), retype the affected strings from a clean UTF-8 source and validate before commit.
4. On Windows/PowerShell, avoid text-write commands with implicit encoding defaults:
   - Avoid: `Set-Content` / `Out-File` without explicit UTF-8 options.
   - Prefer: `apply_patch` for edits, or explicit UTF-8 APIs/flags.
5. If shell-based file writes are unavoidable, explicitly force UTF-8 (no BOM):
   - `Set-Content -Encoding utf8`
   - `[System.IO.File]::WriteAllText(path, text, New-Object System.Text.UTF8Encoding($false))`
6. For Korean text edits, verify immediately after edit:
   - Run `npm run check:text` and `npm run check:text:replacements`.
   - Re-open changed files and confirm Korean is readable (no garbled CJK-looking fallback glyphs).
7. Never mass-rewrite files that contain Korean strings using unknown encoding pipelines.

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
npm run check:openapi
npm run prisma:generate
npm run typecheck
npm run build:web
```

## Operator Execution Rule (Including AI)

1. Any code or doc change must run the full validation sequence in order before commit/push:
   1. `npm run check:text`
   2. `npm run check:openapi`
   3. `npm run typecheck`
   4. `npm run build:web` (for web scope changes)
2. `npm run prisma:generate` must be re-run when Prisma schema or Prisma model usage changes.
3. Do not commit or push if the above checks fail.
4. For AI-assisted changes, run the validation sequence first, then commit and push in the same workflow.

## Public Repository Rules

1. This repository is PUBLIC. Assume every commit, PR comment, and workflow log is externally visible.
2. Never commit secrets or sensitive values (passwords, tokens, cookies, private keys, internal-only credentials, real invite codes).
3. Never print secrets in CI logs, PR comments, or automation script output.
4. `main` must be updated only through pull requests. Direct push to `main` is prohibited.
5. Every AI/operator task must start from latest `origin/main` using an isolated branch and worktree.

## AI Branch and Worktree Standard

1. Do not develop directly in the primary checkout when running multiple AI sessions.
2. Create one isolated worktree per task from `origin/main`:

```bash
npm run ai:worktree -- --task "<task-slug>"
```

3. Worktree path is created under `.worktrees/` and should map 1:1 with a single feature branch.
4. Never reuse the same branch/worktree for unrelated tasks.
5. Do not run `ai:ship` from `main` or `develop`; use feature branches only.
6. `ai:ship` is designed to run inside linked worktrees (not primary checkout) to reduce multi-agent conflicts.

## AI Auto-PR Automation

1. After implementation, run the automated ship command:

```bash
npm run ai:ship -- --commit "type(scope): summary" --title "type(scope): summary"
```

2. `ai:ship` executes required validation in order, then performs:
   1. `git add -A`
   2. `git commit`
   3. `git push --set-upstream origin <branch>`
   4. `gh pr create --base main --head <branch>`
3. `gh` authentication must be active before running automation (`gh auth status`).
4. If validation fails, fix root cause first. Do not bypass checks to force PR creation.
5. Emergency override for primary checkout exists but should be avoided: `--allowPrimaryCheckout`.

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
4. `npm run check:openapi` must pass.
5. `npm run typecheck` must pass.
6. Run `npm run build:web` when touching web code.
7. AI-assisted changes must complete validation and then commit/push together.

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
