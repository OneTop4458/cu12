## Summary

- What changed:
- Why:

## Validation

- [ ] `pnpm run check:text`
- [ ] `pnpm run check:openapi`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run test:all`
- [ ] `pnpm run build:web` when web code changed

## UI regression checklist

- [ ] This pull request has no user-facing UI change. If checked, skip the remaining UI items.
- [ ] I read `DESIGN.md` and preserved its contract, or updated it for an explicitly requested design change.
- [ ] I rendered the real component or page at 1440px, 1024px, 719px, and 390px.
- [ ] The document has no horizontal overflow at the required widths.
- [ ] The topbar, active notice, activity controls, and user menu do not overlap.
- [ ] Relevant loading, empty, success, failure, and long-text states remain usable.
- [ ] Korean interface text is readable and has no replacement characters.
