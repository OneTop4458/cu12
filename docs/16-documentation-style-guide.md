# Documentation Style Guide

## Language Policy

1. Default language: English.
2. Korean summary allowed only in `README.ko.md`.

## Formatting Rules

1. Use short, explicit headings.
2. Prefer numbered steps for procedures.
3. Keep architecture docs implementation-linked, not abstract.
4. Record exact endpoint and workflow IDs when relevant.

## Update Policy

1. Update docs in the same PR as behavior changes.
2. Update OpenAPI whenever request/response semantics change.
3. Add migration notes when auth or data model changes.

## Validation

Run before pushing:

```bash
npm run check:text
npm run typecheck
npm run build:web
```

## Review Checklist

- Does this doc match the current code path?
- Does it include enough detail for operator handoff?
- Are all secrets/keys referenced by canonical names?