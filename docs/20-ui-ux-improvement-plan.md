# UI/UX Improvement Plan

Reviewed: 2026-09-08. Status: proposed follow-up work for general web pages; no dashboard, login, FAQ, or legal-page redesign is implemented by this plan.

## Scope and evidence

Preserve the university identity, full-width page shells, provider distinction, and dashboard section order in [DESIGN.md](../DESIGN.md). The separately requested administrator member and mail management work is implementation scope; the general-page items below remain plan-only.

This review inspected the real source components and existing local QA screenshots captured on 2026-09-08: dashboard at 1440, 1024, 719, and 390px; administrator at 1440 and 390px; member detail at 390px; login at 1440 and 390px; and the legal empty state at 1440px. The screenshots use synthetic fixtures with empty course data and long account labels. They support layout and content observations, not conclusions about production data, performance, or complete accessibility conformance. No new browser session or production mutation was needed for this planning review.

Primary implementation references:

- [Dashboard client](../apps/web/app/dashboard/dashboard-client.tsx): `grid-kpi`, provider synchronization state, custom `modal-overlay` blocks, and the empty course list.
- [Dashboard loading](../apps/web/app/dashboard/loading.tsx): four generic loading panels, compared with five summary panels on the loaded page.
- [Global styles](../apps/web/app/globals.css): mobile KPI stacking, responsive table rows, sticky topbar, and full-width shells.
- [Shared dialog](../apps/web/components/ui/dialog.tsx): the existing Radix primitive available for consistent modal behavior.
- [Legal document page](../apps/web/app/_components/legal-document-page.tsx): duplicate empty-policy messages in the header and body.

## Proposed work, in priority order

| Priority | Observed friction | Smallest proposed change | Value and acceptance check |
| --- | --- | --- | --- |
| P1 | Several dashboard overlays are custom `div`/`section` blocks. Settings and action confirmation have no dialog role, and the component does not implement focus containment, focus restoration, or Escape handling. The manual declares modal semantics but uses the same custom overlay approach. | Use the existing dialog primitive for the affected dashboard overlays, retaining their content, dimensions, and action order. First reproduce the keyboard behavior in a real browser; do not rewrite unrelated page state. | Keyboard users can open, operate, and close each overlay without entering the background page. Focus moves inside, Tab/Shift+Tab remain inside, Escape closes dismissible overlays, and focus returns to the trigger. Long forms scroll internally with reachable save and close actions. |
| P2 | Synchronization panels expose queue codes such as `IDLE`; progress also prints job status values. The empty fixture combines zero counts, absent synchronization history, and an otherwise blank course-status section, making the next useful action harder to identify. | Add Korean display labels for existing states and one explicit course empty-state explanation. Distinguish never synchronized, synchronized with no courses, and failed/unavailable data using actual API state; reuse the existing synchronization action. | A user can identify whether data is current, pending, unavailable, or genuinely empty without interpreting internal codes. Do not show a successful empty state while a request has failed or is loading. Provider-specific failures remain separate. |
| P2 | At 390px, five overall KPI panels and two provider panels all stack before synchronization and automatic learning controls. The empty fixture is already 2664px tall; this is a density issue, not evidence of a document-width defect. | Prototype a more compact mobile summary within the existing section order: reduce excess KPI vertical space and try two columns only where Korean labels and values remain readable. Keep every metric and both providers visible. | Compare the same fixture before/after at 390px. The first operational control appears higher without smaller body copy, clipping, hidden metrics, or page overflow. Keep the current layout if the density change reduces readability. Desktop structure remains unchanged. |
| P3 | The legal page displays the same missing-policy message twice. | Keep one informative empty message and the existing navigation action. | An unavailable document shows one clear explanation. Published policy content, history, comparison links, and consent requirements remain unchanged. |

P1 and P2 are worth implementing as separate, bounded follow-ups. P3 is a small polish item and can wait until the legal page is otherwise touched. These are proposals, not claims that the current release has already resolved them.

## Administrator work in the current implementation scope

The baseline administrator screen presents nine top-level destinations, an always-visible registration form, and seven similarly styled member actions. At 390px those actions become seven full-width buttons per member. Editing also populates the registration form above the table, away from the selected member.

The authorized administrator work should address these observed problems through a smaller shared navigation, member creation/editing dialogs, a direct detail-to-edit path, and an action menu for less frequent member operations. Keep the existing operational routes available through local navigation rather than deleting capabilities. Destructive actions need distinct styling and an explicit confirmation identifying the target member.

For the requested mail administration, keep member preferences with the member editor and shared transport/templates on the mail page. Clearly distinguish environment configuration from administrator-managed SMTP configuration. Display password configuration status without returning its value; explain whether a blank password preserves the saved secret. Template preview uses sample data and does not send mail. Saving configuration and any explicit test-send action remain separate. Errors should preserve the user's draft and identify the affected field or section.

## Validation for any follow-up UI implementation

| Width | Required review |
| --- | --- |
| 1440px | Preserve full-width page gutters and desktop information order. Check long Korean labels, long account names, all provider states, and modal layering over the sticky topbar. |
| 1024px | Verify summary values and labels remain readable; controls and notice actions must not collide as available width contracts. |
| 719px | Verify the existing wrapped topbar and notice row, all primary actions, dialog dimensions, and any internal table scroll container. |
| 390px | Verify the proposed density change using identical fixtures, operable form controls, visible error text, internal modal scrolling, and keyboard/focus behavior after opening and closing overlays. |

At each width, assert `document.documentElement.scrollWidth <= document.body.clientWidth`. Use actual components with synthetic empty, loaded, loading, failure, pending/running/completed, long-text, and disconnected-account states. Reset scroll position before full-page screenshots; a sticky header captured mid-page is not by itself proof of a live overlap bug. Check keyboard focus separately from screenshots. Check targets against the WCAG 2.2 minimum-size or spacing rules; no blanket accessibility-conformance claim should be made from these checks alone.

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
