# Documentation Style Guide

## Language Policy

1. Default language: English.
2. Korean summary allowed only in `README.ko.md`.

## Encoding Policy

1. Use **UTF-8 without BOM** for all source, documentation, and config files.
2. Do not save files as UTF-16, CP949/EUC-KR, ANSI, or any mixed encoding.
3. Never paste Korean text with unknown source encoding; verify raw content in UTF-8 before commit.
4. If encoding corruption appears (`replacement character` or garbled characters), revert and re-enter that text in UTF-8 in a clean editor.
5. AI agents must keep Korean UI strings in UTF-8 and avoid binary-safe transforms that rewrite text (e.g., shell tools with implicit ANSI/legacy encoding).

## AI Editing Safety (Windows/PowerShell)

1. Prefer `apply_patch` for text edits, especially when files contain Korean copy.
2. Do not use `Set-Content` / `Out-File` without explicit UTF-8 settings.
3. If shell write is unavoidable, force UTF-8 (no BOM):
   - `Set-Content -Encoding utf8`
   - `[System.IO.File]::WriteAllText(path, text, New-Object System.Text.UTF8Encoding($false))`
4. After touching Korean strings, run:
   - `pnpm run check:text`
   - `pnpm run check:text:replacements`
5. Re-open modified files and visually verify Korean readability before commit.

## Formatting Rules

1. Use short, explicit headings.
2. Prefer numbered steps for procedures.
3. Keep architecture docs implementation-linked, not abstract.
4. Record exact endpoint and workflow IDs when relevant.
5. Prefer Mermaid for architecture and flow diagrams when a diagram materially helps readers.

## Update Policy

1. Update docs in the same PR as behavior changes.
2. Update OpenAPI whenever request/response semantics change.
3. Add migration notes when auth or data model changes.
4. For AI-assisted changes, update implementation + operation docs together and include validation commands that were run.

## Validation

Run before pushing:

```bash
corepack pnpm run check:text
corepack pnpm run check:openapi
corepack pnpm run prisma:generate
corepack pnpm run typecheck
corepack pnpm run test:all
corepack pnpm run build:web
```

For AI-assisted changes, pushing is allowed only after the required validation sequence completes successfully. If the change did not affect Prisma or did not require a fresh install, `prisma:generate` is still safe and remains the repository default in CI and documented validation flows.

## Review Checklist

- Does this doc match the current code path?
- Does it include enough detail for operator handoff?
- Are all secrets/keys referenced by canonical names?
- If the document is historical, is that status made explicit near the top?
