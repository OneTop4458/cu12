# Documentation Index

This repository uses **English as the default documentation language**. A Korean summary is provided only in `README.ko.md`.

## Living Docs

- `docs/01-prd.md`: Current product scope, requirements, and success metrics
- `docs/02-architecture.md`: Runtime architecture, provider flows, dispatch model, and internal API boundaries
- `docs/03-data-model.md`: Prisma domain model, ownership boundaries, cleanup posture, and protection rules
- `docs/04-api/openapi.yaml`: Public and internal HTTP contract
- `docs/05-cu12-endpoint-catalog.md`: Observed CU12 endpoint inventory used by sync and automation
- `docs/06-session-token-lifecycle.md`: Cookie, challenge-token, portal-session, and approval-session lifecycle
- `docs/07-concurrency-queue-spec.md`: Queue states, dispatch rules, claim order, and retry behavior
- `docs/08-autolearn-engine-spec.md`: CU12-specific auto-learning execution details inside the worker
- `docs/09-github-actions-runbook.md`: CI/CD, dispatch, bootstrap, and workflow operations
- `docs/10-security-checklist.md`: Security controls and incident baseline
- `docs/11-test-matrix.md`: Test coverage and validation gate
- `docs/12-operational-runbook.md`: Day-2 operational procedures and incident handling
- `docs/13-roadmap-todo.md`: Current delivery roadmap
- `docs/14-cloud-setup-playbook.md`: Cloud deployment and environment setup guide
- `docs/16-documentation-style-guide.md`: Documentation policy and editing rules
- `docs/17-free-tier-optimization-plan.md`: Runtime cost-control guardrails
- `docs/adr/0001-hybrid-worker-model.md`: ADR for the worker architecture
- `docs/adr/0002-token-strategy.md`: ADR for the token strategy

## Historical Snapshots

- `docs/15-audit-report.md`: Point-in-time audit snapshot from 2026-03-03
- `docs/18-web-ui-ux-redesign.md`: Point-in-time UI refresh notes from 2026-03-04

## Maintenance Rules

1. Update docs in the same PR as behavior changes.
2. Keep `docs/04-api/openapi.yaml` aligned with request/response semantics, not just route presence.
3. Keep environment-variable names synchronized with `.env.example`, `apps/web/src/lib/env.ts`, and `apps/worker/src/env.ts`.
4. Keep workflow schedules and operational notes synchronized with `.github/workflows/*.yml`.
5. Preserve dated docs as historical records and mark them clearly when they are no longer the primary current source.

## Baseline Date

- Current living-doc baseline: **2026-04-28**
