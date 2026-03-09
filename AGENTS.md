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
   - Prefer: `apply_patch` when available, or explicit UTF-8 no-BOM APIs.
5. If shell-based file writes are unavoidable, explicitly force UTF-8 (no BOM):
   - `Set-Content -Encoding utf8`
   - `[System.IO.File]::WriteAllText(path, text, New-Object System.Text.UTF8Encoding($false))`
6. For Korean text edits, verify immediately after edit:
   - Run `pnpm run check:text` and `pnpm run check:text:replacements`.
   - Re-open changed files and confirm Korean is readable (no garbled fallback glyphs).
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

## Public Repository Rules

1. This repository is PUBLIC. Assume every commit, PR comment, and workflow log is externally visible.
2. Never commit secrets or sensitive values (passwords, tokens, cookies, private keys, internal-only credentials, real invite codes).
3. Never print secrets in CI logs, PR comments, or automation script output.
4. `main` must be updated only through pull requests. Direct push to `main` is prohibited.
5. Every AI/operator task must start from latest `origin/main` using an isolated branch.
6. Branch protection baseline for `main`:
   - required status checks: `test`, `secret-scan`
   - required approving reviews: `0`
   - required conversation resolution: disabled

## Execution Context Detection

1. Detect the current checkout before creating any worktree:
   - linked worktree: `.git` is a file
   - primary checkout: `.git` is a directory
2. Codex desktop linked worktrees with `CODEX_THREAD_ID` are the default AI execution context.
3. In that Codex-linked mode, the current worktree is authoritative. Do not create nested repo-local `.worktrees/session-*` worktrees.
4. Repo-local `.worktrees/*` are fallback isolation only for manual shells or non-Codex parallel work.
5. Session lock file (`.codex-session.lock`) marks an active branch/worktree. Do not override an active lock unless `--force` is intentional.

## Codex Session Bootstrap

1. Package manager standard is `pnpm`.
2. If `pnpm` is not on PATH yet, run `corepack enable pnpm` once on the machine.
3. Every Codex session must start with `pnpm run ai:start -- --task "<task-slug>"`.
4. In a Codex-linked worktree, `ai:start` must:
   - fetch latest `origin/main`
   - create or reuse the current-worktree branch `ai/session-<session-id>`
   - use `ai/<task>-<timestamp>` only with `--new-task`
   - write or refresh `.codex-session.lock`
5. In this mode, `ai:start` must not create an additional repo-local worktree.
6. Prefer a separate Codex session for unrelated work instead of nesting a worktree inside the current one.

## Manual Fallback Worktree

1. Use `pnpm run ai:worktree -- --task "<task-slug>"` only when you are outside the default Codex-linked flow and need an extra local worktree.
2. Outside Codex-linked mode, `pnpm run ai:start` may still create or attach repo-local `.worktrees/session-*` worktrees.
3. Do not run multi-agent work directly in the primary checkout.
4. `ai:ship` must not run from `main` or `develop`; use feature branches only.

## Dependencies and Prisma

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Re-run `pnpm install --frozen-lockfile` when any of the following is true:
   - `pnpm-lock.yaml` changed
   - the active Node version changed
   - the current worktree has no usable install yet
3. Otherwise, reuse the existing install for the current worktree.
4. Run `pnpm run prisma:generate` after a fresh install and whenever `prisma/schema.prisma` or Prisma model usage changes.
5. CI, deployment, and scripted validation stages must run `pnpm run prisma:generate` explicitly; do not rely on install hooks.
6. Required local validation commands:

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run check:text
pnpm run check:openapi
pnpm run typecheck
pnpm run build:web
```

## Operator Execution Rule (Including AI)

1. Any code or doc change must run the validation sequence before commit/push:
   1. `pnpm run check:text`
   2. `pnpm run check:openapi`
   3. `pnpm run prisma:generate` when required by the rules above or when running in CI/fresh installs
   4. `pnpm run typecheck`
   5. `pnpm run build:web` (for web scope changes)
2. Do not commit or push if the above checks fail.
3. For AI-assisted changes, run the validation sequence first, then commit and push in the same workflow.

## AI Auto-PR Automation

1. For AI implementation tasks that produce code/doc changes, default finish line is `pnpm run ai:ship` unless the user explicitly requests otherwise (`no-pr`, `no-push`, plan-only, research-only).
2. After implementation, run:

```bash
pnpm run ai:ship -- --commit "type(scope): summary" --title "type(scope): summary"
```

3. `ai:ship` executes validation, then stages, commits, pushes, and opens a PR.
4. `--commit` / `--title` are optional. When omitted, `ai:ship` generates defaults from the current branch slug.
5. `gh` authentication must be active before running automation (`gh auth status`).
6. If validation fails, fix the root cause first. Do not bypass checks to force PR creation.
7. Controlled exceptions:
   - `--noPr`: push only, skip PR creation.
   - `--noPush --noPr`: local commit only.
8. On success, `ai:ship` releases the current `.codex-session.lock` and prints the cleanup follow-up command.

## Session Close and Cleanup

1. After PR merge or when a repo-local worktree is no longer needed, run `pnpm run ai:clean`.
2. `ai:clean` is responsible for:
   - removing merged and clean repo-local `.worktrees/*`
   - deleting stale `.codex-session.lock` files
   - deleting merged local `ai/*` branches that are no longer checked out
   - running `git worktree prune --expire=7.days.ago`
3. `ai:clean` must skip the current worktree and any path with an active lock unless `--force` is explicitly supplied.
4. Never prune active worktrees used by a live Codex session.

## Codex Review Policy

1. Codex review is optional guidance for PR quality and is not a required merge gate.
2. Merge readiness is determined by required checks (currently `test`, `secret-scan`) plus branch protection rules.

## Secret Leak Response Baseline

1. If any key/token/password is exposed, treat it as compromised immediately.
2. Rotate/revoke the credential first, then investigate usage and blast radius.
3. Verify no secret values were printed in Actions logs, PR comments, or issue threads.
4. After rotation, rerun CI secret scan and confirm clean status before merge/redeploy.

## Deployment Baseline

1. DB update: `DB Bootstrap` or `pnpm run prisma:push`
2. Fresh auth setup: run `Auth Reset Bootstrap`
3. Web deploy: Vercel production deploy (`apps/web`)
4. Worker run: `worker-consume.yml` (manual/scheduled)
5. Validation:
   - `/api/health` returns 200
   - recent worker consume run succeeded

## Change Checklist

1. Code and docs must be updated together.
2. API/schema changes require OpenAPI updates.
3. `pnpm run check:text` must pass.
4. `pnpm run check:openapi` must pass.
5. `pnpm run typecheck` must pass.
6. Run `pnpm run prisma:generate` after fresh installs and Prisma-affecting changes.
7. Run `pnpm run build:web` when touching web code.
8. AI-assisted changes must complete validation and then commit/push together.

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