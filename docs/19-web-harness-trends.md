# Web and Agent Harness Review

## Status and Method

Research snapshot: **2026-09-08**. Primary sources were opened and read on that date. This document records repository-specific decisions, not a new product specification or permission to redesign the website. The user subsequently approved the bounded general web improvements in the [UI/UX delivery record](20-ui-ux-improvement-plan.md), alongside the administrator features. That record tracks implementation and acceptance evidence separately from this research snapshot.

"Harness" here means the instructions, tools, execution environment, state, and feedback used to turn an agent request into a verified change. The recommendations below are engineering judgments based on the cited sources and the current repository, not claims that every new platform feature is necessary or that current accessibility/performance targets already pass.

## Repository Baseline

- `AGENTS.md` already defines isolation, public-repository protection, validation, PR shipping, and operational rules. `DESIGN.md` defines the existing visual contract.
- `package.json` routes `ai:start`, `ai:ship`, and `ai:clean` to PowerShell scripts. `scripts/ai-pr.ps1` runs the validation gate before staging and shipping; `test/ops` covers operational scripts. Another agent framework is not needed to supply these controls.
- Living specifications, runbooks, dated audits, plans, and ADRs already have a home in `docs/`. There is no repository-local `.agents/skills/` or `.codex/` instruction tree to migrate.
- The web application already uses Next.js App Router, server route entry points, interactive client components, semantic CSS tokens, and shared UI primitives. Current dashboard/admin clients contain substantial interaction logic. File size alone does not establish a performance defect.

## Eight Applicable Decisions

| Topic | Evidence and maturity | Decision for CU12 |
| --- | --- | --- |
| 1. Short instructions with routes to detail | Current Codex guidance loads instructions along the project path and has a default combined 32 KiB limit. Additional files are useful only when their scope is clear. [AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | **Adopt now:** add a compact context map to `AGENTS.md`. Keep existing operational protections in place; use `docs/00-index.md` and `DESIGN.md` instead of copying their contents into more prompts. Defer a broad instruction split until a concrete loading or ownership problem exists. |
| 2. Reusable skills with context loaded on demand | Current skills load their short metadata first and full instructions when selected. Repository-local skills are discovered under `.agents/skills`. [Build skills](https://learn.chatgpt.com/docs/build-skills) | **Defer scaffolding:** existing scripts and runbooks cover setup, validation, and shipping. Create a narrowly scoped skill only when a repeated workflow is missing; reference those commands rather than duplicating them. Do not add model-specific configuration or another dependency for this review. |
| 3. Durable plans for long tasks | OpenAI's 2025 execution-plan example treats plans as living documents. The recipe is now explicitly archived, so its model recommendations and long template are not current requirements. [Execution-plan recipe](https://developers.openai.com/cookbook/articles/codex_exec_plans) | **Adopt the limited pattern:** multi-area or multi-session work gets a focused, maintained document with scope, decisions, remaining work, and acceptance evidence. Keep small tasks lightweight. Reuse existing `docs/` plans/ADRs rather than introducing a second planning directory or copying the entire recipe. |
| 4. Bounded parallel work and one integration owner | Current subagent guidance favors independent work and concise returned evidence; concurrent writes can increase conflicts and coordination cost. [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | **Adopt now:** assign file ownership and keep bootstrap, dependency installation, Prisma generation, branch mutation, and final shipping under one coordinator. Subagents return findings and verification status. Preserve executable checks in `scripts/` and CI; more prose cannot replace a failing gate. |
| 5. Keyboard access and predictable operational controls | WCAG 2.2 is an established recommendation, not a new visual style. It adds AA criteria for unobscured focus and minimum target size; 24 CSS pixels has specified exceptions, while 44 CSS pixels is the separate AAA target. WAI's modal pattern specifies focus containment, closing, and return behavior. [WCAG 2.2 changes](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | **Adopt as acceptance criteria for the approved work:** prioritize keyboard-operable dialogs, clear labels, visible focus, and reliable save/error feedback over decoration. Reuse existing primitives for administrator forms and the dashboard overlays identified in the UI audit. Acceptance evidence belongs in the delivery record; this research makes no WCAG conformance claim. |
| 6. Server rendering with small interactive boundaries | Current Next.js guidance keeps data access and secrets on the server and uses Client Components where interaction requires them. This is established App Router composition. [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | **Retain for new admin work:** keep SMTP credentials and persistence behind authenticated server code, returning only the display state required by the form. Defer a broad dashboard component migration until a measured bottleneck or feature boundary justifies it. Do not adopt a newer React API merely because current framework examples use it. |
| 7. Perceived responsiveness supported by measurement | INP is a stable Core Web Vital: good field responsiveness is at most 200 ms at the 75th percentile, evaluated separately for mobile and desktop. It measures delay until the next paint, not the entire network operation. Next.js loading boundaries can keep shared layouts interactive during navigation. [INP](https://web.dev/articles/inp), [loading.js](https://nextjs.org/docs/app/api-reference/file-conventions/loading) | **Plan before optimization:** examine common actions such as filtering, opening details, and saving settings; show pending/result state while async work runs. Profile a production build before introducing virtualization or decomposing clients for speed. Server timings and local screenshots do not establish field INP. No new analytics service or performance result is asserted here. |
| 8. Native platform features selected by compatibility | The evolving Baseline 2026 inventory includes features such as `field-sizing`, container style queries, and `@scope`. "Newly available" means support across core browsers; "Widely available" follows after 30 months. [Baseline](https://web.dev/baseline), [Baseline 2026](https://web.dev/baseline/2026?hl=en) | **Adopt the compatibility check; defer replacement:** use newer CSS only to solve an observed problem, with an appropriate fallback and browser verification. Existing tokens, responsive gutters, and bounded table scrolling remain suitable. Defer decorative transitions, a new CSS architecture, or native-control migration without a demonstrated benefit. |

## Instruction and Folder Changes

The accessibility and App Router patterns above are established practice. Baseline 2026 entries are newly interoperable features, which is different from both experimental status and broad installed-browser coverage. No preview or experimental platform feature is required by this change.

The bounded harness change adds context routing and task/handoff rules to `AGENTS.md`. It preserves the existing session, secret-handling, validation, PR, and deployment rules. No new AI directory, plugin, agent model setting, or execution dependency is required.

One existing encoding example was also corrected: Windows PowerShell 5.1 writes a BOM with `Set-Content -Encoding utf8`, which conflicts with this repository's no-BOM policy. The explicit .NET UTF-8 encoder example is suitable for that policy. This is a concrete harness reliability fix, not a change to the encoding requirement. [Microsoft PowerShell encoding documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.5)

`DESIGN.md` remains the current visual contract. The [UI/UX delivery record](20-ui-ux-improvement-plan.md) distinguishes approved changes and their acceptance evidence from deferred measurement and performance work. Operational behavior belongs in living specifications and runbooks; this research snapshot should not be used to infer that a planned feature has shipped.

## Source Dates

All sources below were accessed **2026-09-08**. Dates are the page's displayed publication/update dates when available; an undated living page is not described as a 2026 release.

| Primary source | Displayed date or status |
| --- | --- |
| [Codex AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | Living documentation; no publication/update date displayed |
| [OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills) | Living documentation; no publication/update date displayed |
| [OpenAI Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | Living documentation; no publication/update date displayed |
| [OpenAI execution-plan recipe](https://developers.openai.com/cookbook/articles/codex_exec_plans) | Published 2025-10-07; marked archived when accessed |
| [W3C WCAG 2.2 changes](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) | Describes the recommendation published 2023-10-05 |
| [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Living guidance; no publication/update date displayed |
| [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | Updated 2026-08-25 |
| [Next.js loading.js](https://nextjs.org/docs/app/api-reference/file-conventions/loading) | Updated 2026-06-08 |
| [web.dev INP](https://web.dev/articles/inp) | Published 2022-05-06; updated 2025-09-02 |
| [web.dev Baseline](https://web.dev/baseline) and [2026 inventory](https://web.dev/baseline/2026?hl=en) | Living compatibility reference and evolving 2026 feature set |
| [Microsoft PowerShell character encoding](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.5) | Updated 2024-01-19 |
