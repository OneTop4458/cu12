# Documentation Index

This repository uses **English as the default documentation language**.
A Korean summary is available only in `README.ko.md`.

## Document Map

- `docs/01-prd.md`: Product requirements and success metrics
- `docs/02-architecture.md`: Runtime architecture and execution flow
- `docs/03-data-model.md`: Prisma data model and ownership boundaries
- `docs/04-api/openapi.yaml`: API contract (source of truth for route behavior)
- `docs/05-cu12-endpoint-catalog.md`: External CU12 endpoint inventory
- `docs/06-session-token-lifecycle.md`: Session/challenge/invite token lifecycle
- `docs/07-concurrency-queue-spec.md`: Queue claim and concurrency control
- `docs/08-autolearn-engine-spec.md`: Auto-learning worker behavior
- `docs/09-github-actions-runbook.md`: CI/CD and workflow operations
- `docs/10-security-checklist.md`: Security hardening checklist
- `docs/11-test-matrix.md`: Test coverage matrix
- `docs/12-operational-runbook.md`: Incident and day-2 operations
- `docs/13-roadmap-todo.md`: Delivery roadmap
- `docs/14-cloud-setup-playbook.md`: Full cloud deployment setup
- `docs/15-audit-report.md`: Change audit snapshot
- `docs/16-documentation-style-guide.md`: Writing and maintenance rules
- `docs/17-free-tier-optimization-plan.md`: Free-tier usage optimization policy
- `docs/18-web-ui-ux-redesign.md`: Web UI modernization details and component reference
- `docs/adr/0001-hybrid-worker-model.md`: ADR for cloud worker model
- `docs/adr/0002-token-strategy.md`: ADR for token strategy

## Maintenance Rules

1. Update docs in the same PR when changing behavior.
2. Keep `docs/04-api/openapi.yaml` synchronized with implementation.
3. Preserve end-to-end consistency across web app, worker, DB schema, and workflows.
4. Validate with `npm run check:text` before push.

## Baseline Date

- Current baseline: **2026-03-03**
- docs/18-web-ui-ux-redesign.md: Web UI modernization details and component reference
