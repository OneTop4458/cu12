# UI/UX Improvement Plan and Delivery Record

Reviewed and implemented: 2026-09-08. The user approved the bounded dashboard and legal-page improvements after reviewing the original plan. The accepted changes and local acceptance checks are complete; the pull request records the final repository-wide validation and release result. Original findings remain below as the pre-change baseline.

## Scope and evidence

Preserve the university identity, full-width page shells, provider distinction, and dashboard section order in [DESIGN.md](../DESIGN.md). Approved general-page scope covers shared dashboard dialogs, Korean state and course empty-state copy, mobile summary density, and the duplicate legal empty message. Administrator member and mail management is also implementation scope. Login branding, loading-placeholder changes, and performance restructuring are outside this implementation.

This review inspected the real source components and existing local QA screenshots captured on 2026-09-08: dashboard at 1440, 1024, 719, and 390px; administrator at 1440 and 390px; member detail at 390px; login at 1440 and 390px; and the legal empty state at 1440px. The screenshots use synthetic fixtures with empty course data and long account labels. They support layout and content observations, not conclusions about production data, performance, or complete accessibility conformance. No new browser session or production mutation was needed for this planning review.

Primary sources inspected for the original baseline:

- [Dashboard client](../apps/web/app/dashboard/dashboard-client.tsx): `grid-kpi`, provider synchronization state, custom `modal-overlay` blocks, and the empty course list.
- [Dashboard loading](../apps/web/app/dashboard/loading.tsx): four generic loading panels, compared with five summary panels on the loaded page.
- [Global styles](../apps/web/app/globals.css): mobile KPI stacking, responsive table rows, sticky topbar, and full-width shells.
- [Shared dialog](../apps/web/components/ui/dialog.tsx): the existing Radix primitive available for consistent modal behavior.
- [Legal document page](../apps/web/app/_components/legal-document-page.tsx): duplicate empty-policy messages in the header and body.

## Original review findings and accepted scope

| Priority | Observed friction | Smallest proposed change | Value and acceptance check |
| --- | --- | --- | --- |
| P1 | Several dashboard overlays are custom `div`/`section` blocks. Settings and action confirmation have no dialog role, and the component does not implement focus containment, focus restoration, or Escape handling. The manual declares modal semantics but uses the same custom overlay approach. | Use the existing dialog primitive for the affected dashboard overlays, retaining their content, dimensions, and action order. First reproduce the keyboard behavior in a real browser; do not rewrite unrelated page state. | Keyboard users can open, operate, and close each overlay without entering the background page. Focus moves inside, Tab/Shift+Tab remain inside, Escape closes dismissible overlays, and focus returns to the trigger. Long forms scroll internally with reachable save and close actions. |
| P2 | Synchronization panels expose queue codes such as `IDLE`; progress also prints job status values. The empty fixture combines zero counts, absent synchronization history, and an otherwise blank course-status section, making the next useful action harder to identify. | Add Korean display labels for existing states and one explicit course empty-state explanation. Distinguish never synchronized, synchronized with no courses, and failed/unavailable data using actual API state; reuse the existing synchronization action. | A user can identify whether data is current, pending, unavailable, or genuinely empty without interpreting internal codes. Do not show a successful empty state while a request has failed or is loading. Provider-specific failures remain separate. |
| P2 | At 390px, five overall KPI panels and two provider panels all stack before synchronization and automatic learning controls. The empty fixture is already 2664px tall; this is a density issue, not evidence of a document-width defect. | Prototype a more compact mobile summary within the existing section order: reduce excess KPI vertical space and try two columns only where Korean labels and values remain readable. Keep every metric and both providers visible. | Compare the same fixture before/after at 390px. The first operational control appears higher without smaller body copy, clipping, hidden metrics, or page overflow. Keep the current layout if the density change reduces readability. Desktop structure remains unchanged. |
| P3 | The legal page displays the same missing-policy message twice. | Keep one informative empty message and the existing navigation action. | An unavailable document shows one clear explanation. Published policy content, history, comparison links, and consent requirements remain unchanged. |

These findings are the pre-change baseline. The user approved P1, both P2 items, and P3 for implementation after reviewing this plan. Their delivery and acceptance results are tracked below.

## General-page delivery status

| Item | Current status | Acceptance evidence |
| --- | --- | --- |
| Dashboard shared dialogs | Implemented and verified | At all four widths, manual/settings/sync confirmation/auto-learning confirmation/approval retain Tab and Shift+Tab focus, close with Escape when dismissible, and restore the invoker. Required mail setup and blocking progress preserve dismissal guards. Settings values wrap within the table without clipping |
| Korean state labels and course empty states | Implemented and verified | Dashboard records failures per provider while retaining prior rows for failed providers. Eleven presentation regressions and three course-route regressions pass. Rendered partial/total failure fixtures name the failed providers, offer retry, and preserve a healthy CU12 course |
| Mobile summary density | Implemented and measured | At up to 640px, overall/provider summaries use two columns and the fifth overall metric spans a row. All five overall metrics and both providers remain present/readable; four-width checks found no document overflow |
| Legal empty-message deduplication | Implemented and rendered | All four widths show exactly one missing-policy message and no document overflow. The content fallback and published policy/history links remain in `LegalDocumentPage` |

Current implementation evidence is in the [dashboard component](../apps/web/app/dashboard/dashboard-client.tsx), [presentation helpers](../apps/web/src/lib/dashboard-presentation.ts), [helper regressions](../apps/web/test/dashboard-presentation.test.ts), and [global styles](../apps/web/app/globals.css). The [course-list route](../apps/web/app/api/dashboard/courses/route.ts) now lets unrecoverable reads reach its `503` response while keeping successful empty reads at `200`; its [route regressions](../apps/web/test/dashboard-courses-status.test.ts) also preserve legacy raw-read recovery. This supports the UI's failure-versus-empty distinction without changing the success payload.

The implementation baseline and updated page were rendered with the same synthetic empty-dashboard fixture at each required width. The first immediate-sync button's top position is measured in document coordinates with the page scrolled to the top. Both baseline and updated renders had no document overflow.

| Viewport width | First sync action before (CSS px) | First sync action after (CSS px) |
| --- | --- | --- |
| 1440px | 727.953 | 727.953 |
| 1024px | 727.953 | 727.953 |
| 719px | 1005.469 | 1005.469 |
| 390px | 1467.516 | 1085.391 |

At 390px the first sync action appears 382.125 CSS pixels higher, a 26% reduction in its distance from the page top. The other three widths retain the same position. Local after screenshots were captured as `dashboard-after-{width}.png`; this is a same-fixture layout measurement, not production performance or INP evidence.

## Delivered administrator changes

The baseline administrator screen presented nine top-level destinations, an always-visible registration form, and seven similarly styled member actions. At 390px those actions became seven full-width buttons per member. Editing populated the registration form above the table, away from the selected member.

The implemented administrator interface has five shared navigation destinations, member creation/editing dialogs, a direct detail-to-edit path, and an action menu for less frequent member operations. Existing operational routes remain available through local navigation. Withdrawal retains distinct styling and target-specific confirmation. The [administrator guide](21-admin-member-mail-guide.md) records the current flows and their validation scope.

Member mail preferences are edited with the member, while shared transport/templates have a dedicated mail page. ENV and CUSTOM SMTP configuration are distinct. The browser receives password configuration status only, with blank input preserving the saved secret. Template preview uses sample data and does not send mail; saving configuration and explicit test sending remain separate. Failed saves preserve drafts and display a result message.

## Validation requirements and results

| Width | Required review |
| --- | --- |
| 1440px | Preserve full-width page gutters and desktop information order. Check long Korean labels, long account names, all provider states, and modal layering over the sticky topbar. |
| 1024px | Verify summary values and labels remain readable; controls and notice actions must not collide as available width contracts. |
| 719px | Verify the existing wrapped topbar and notice row, all primary actions, dialog dimensions, and any internal table scroll container. |
| 390px | Verify the proposed density change using identical fixtures, operable form controls, visible error text, internal modal scrolling, and keyboard/focus behavior after opening and closing overlays. |

At each width, assert `document.documentElement.scrollWidth <= document.body.clientWidth`. Use actual components with synthetic empty, loaded, loading, failure, pending/running/completed, long-text, and disconnected-account states. Reset scroll position before full-page screenshots; a sticky header captured mid-page is not by itself proof of a live overlap bug. Check keyboard focus separately from screenshots. Check targets against the WCAG 2.2 minimum-size or spacing rules; no blanket accessibility-conformance claim should be made from these checks alone.

Completed local interaction checks include:

- Manual, member settings, sync confirmation, auto-learning confirmation, and Cyber Campus approval at all four widths: modal fit, contained Tab/Shift+Tab navigation, Escape dismissal, and focus returned to the invoker.
- Blocking progress remains open after Escape or an outside click. Required initial mail setup also blocks its close button; a failed save keeps the draft and a successful retry closes the setup dialog.
- Partial and total provider `503` fixtures show named failure messages and retry. A healthy provider's course remains visible when the other provider fails.
- A slow course-notice request can be closed before completion and reopened without an old response overwriting the new view.
- Member settings property-table widths equal their scroll widths at every viewport: 940, 940, 647, and 318 CSS pixels for 1440, 1024, 719, and 390px respectively. Value-cell right bounds stay inside the table, and campus values use Korean display names. The scoped fixed-table layout and text wrapping resolved the clipping found during QA.
- The legal empty state appears exactly once at each width. Dashboard and legal fixtures have no document overflow; the measured mobile summary result is recorded above.

The pull request records the final repository-wide validation and release result. These fixture and keyboard checks establish the scoped behavior above; they do not establish production INP or complete WCAG conformance.

The current four-panel loading placeholder differs from the five-panel loaded summary. Measure the visible transition under slow responses before changing it. Likewise, measure interaction responsiveness before splitting the large dashboard client or changing its fetch strategy. A source-file size or a screenshot is not a performance measurement.

## Areas requiring no visual change now

- The university crest, campus image, Pretendard typography, semantic palette, borders, and restrained motion already support the product identity.
- Keep the recent full-width page-shell change. Do not restore a global maximum width.
- Keep login's staged portal verification, approval, and consent flow. The reviewed login layout does not justify a redesign.
- Keep the dedicated notice row, provider-specific state, dashboard section order, and existing course-table disclosures.
- Do not add a new component library, AI chat panel, decorative card system, animation package, or framework migration on the basis of trends alone.

## Research basis

The relevant direction is consistent interaction, accessible controls, and measurable responsiveness. The broader dated review is [Web and Harness Engineering Trends](19-web-harness-trends.md).

- [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes contained keyboard focus, initial focus, focus restoration, modal semantics, and a visible close control. It supports the overlay proposal above.
- [W3C WCAG 2.2 additions](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) cover unobscured focus and a 24-by-24 CSS-pixel minimum pointer target with defined exceptions. These are concrete checks for dense controls, not a requirement to restyle the product.
- [web.dev INP guidance](https://web.dev/articles/inp) uses a good responsiveness threshold of at most 200ms at the 75th percentile, assessed separately for mobile and desktop. INP measures feedback through the next paint, not total background-job or network duration; this review collected no production INP data.
