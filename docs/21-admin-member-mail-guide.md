# Administrator Member and Mail Guide

Delivery status (2026-09-08): implemented for review; production schema/configuration rollout is separate. Member, mail, and operations fixtures have been rendered at 1440, 1024, 719, and 390px with no document overflow. Save/reload, failed-save recovery, dialog focus, template reset, and mock-only SMTP actions are covered by integration checks. The final pull request records the full repository validation result. General website redesign remains deferred in [the UI/UX plan](20-ui-ux-improvement-plan.md).

## Navigation

The shared administrator navigation has five destinations: members (`/admin`), mail (`/admin/mail`), site notices (`/admin/site-notices`), policies (`/admin/system/policies`), and operations (`/admin/operations`). Operations provides local links to system status, jobs, workers, reconciliation, and cleanup; existing route URLs remain available.

## Member Management

1. Use member search and the status filter to find an account. Details show the stored account, automation, approval, and mail state.
2. Open the edit dialog from the row or detail view. Edit the name, role, active/test-user status, CU12 campus, automation toggles, and mail recipient preferences in one save. The account connection status remains visible in details.
3. The existing login ID is read-only. This form does not replace portal credentials. A blank local password preserves the existing password; a nonblank local password is available only for test users and is required when converting a normal user to a test user.
4. Account settings require a linked portal account. Mail preferences can be saved without a portal link. Profile, account, and mail changes share one transaction, so a failed preference save cannot partially update the member.
5. Approval remains a separate decision. An unapproved member cannot be activated through edit, and an administrator cannot deactivate, demote, or change the test/normal type of their own account. Refresh and retry if the member's approval, withdrawal, or test-user state changed while the form was open.
6. The additional-actions menu contains synchronization, impersonation, test mail, activation, and withdrawal. Availability follows the member's current state; withdrawal remains distinct from temporary deactivation.

The active optional mail preferences are recipient email, delivery enabled, deadline alerts, and auto-learning alerts. Saving them keeps routine digest and notice-only mail disabled. Policy publication mail uses a saved recipient address independently of these optional alert switches. Approval request mail requires an enabled subscription for an active approved administrator. The global mail delivery switch applies to all mail kinds.

## Shared Mail Configuration

Apply `MailSettings` and `MailTemplate` with the normal `Deploy Vercel` schema-sync stage, or `DB Bootstrap` when schema application must be performed separately. Both web and worker mail read these tables. A missing settings row uses ENV defaults; a missing table or database failure does not silently bypass stored delivery controls and requires deployment/schema repair.

The mail page saves one shared configuration for web and worker delivery:

| Setting | Behavior |
| --- | --- |
| Delivery enabled | Global switch; OFF also prevents policy, approval, and test mail. Saving configuration does not send a message. |
| ENV | Default source. Each runtime reads its own `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`. Keep Vercel and GitHub Actions settings aligned. |
| CUSTOM | Uses the saved host, port, TLS mode, username, password, and sender exclusively; it does not fill missing fields from ENV. A blank username permits unauthenticated SMTP. |
| TLS mode | STARTTLS requires a TLS upgrade; TLS uses an encrypted connection from the start; NONE disables TLS negotiation. ENV retains its existing port-based behavior. |
| Sender | CUSTOM uses the saved sender email and optional display name. ENV uses `SMTP_FROM`. |
| Password | Stored encrypted with `APP_MASTER_KEY`; only a configured/not-configured flag returns to the browser. Blank input preserves it. Explicit clear removes it; an enabled CUSTOM username requires a valid password. |

Changing a saved SMTP host or username requires entering a replacement password or explicitly clearing the old one. This prevents a stored credential from being reused for a different host or account without an explicit choice. Web and worker must share the same `APP_MASTER_KEY` for CUSTOM credentials to decrypt.

The environment-configured indicator checks the web runtime's variable presence only. It is not a connection test and does not inspect GitHub Actions secrets.

After saving, **connection verification** checks the saved SMTP connection without sending a message. It fails while delivery is OFF. **Test mail** sends one real message to the entered address using the saved settings and TEST template. SMTP actions are disabled while server settings have unsaved changes; save TEST template changes separately before testing them. Template preview and configuration save do not send mail. Changing settings does not resend earlier skipped or failed messages.

## Mail Templates

Templates customize the subject and plain-text content surrounding the application's generated details:

| Kind | Generated content |
| --- | --- |
| `DEADLINE` | Imminent deadline alerts collected during synchronization |
| `AUTOLEARN_RESULT` | Auto-learning execution results |
| `AUTOLEARN_TERMINAL` | Terminal auto-learning completion or failure notice |
| `POLICY_UPDATE` | Published policy changes |
| `ADMIN_APPROVAL_REQUEST` | Pending member approval request for an administrator |
| `TEST` | Administrator test message, including the member test-mail action |

Allowed placeholders are `{{subject}}`, `{{recipient}}`, and `{{date}}`; the body must also contain `{{content}}` exactly once. The date uses the Asia/Seoul time zone. Subjects accept 1–200 characters without line breaks, and bodies accept 1–20,000 characters. Blank text, NUL characters, and unknown or malformed placeholders are rejected.

Template text is escaped when rendered as HTML; only the application's generated content supplies HTML. Keep `{{content}}` to retain result, deadline, approval, and policy details. Preview uses sample values and is not evidence of delivery. Reset deletes the override and restores the application's default rendering without sending a message.

## Verification and Troubleshooting

1. On a settings/template storage error, check the schema-sync stage and `DB Bootstrap` before changing SMTP credentials.
2. On `SMTP_NOT_CONFIGURED`, verify the selected source. ENV requires all five variables in the runtime that sends mail; CUSTOM requires its saved host and sender.
3. On password-required or password-unavailable errors, check the saved username and re-enter the password after confirming `APP_MASTER_KEY` alignment. Never copy a password or encrypted value into a public issue or workflow log.
4. On a connection error, inspect the sanitized DNS, connection, TLS, authentication, or timeout reason. Correct the relevant setting before trying verification again.
5. Review administrator mail audit events and existing `MailDelivery` history for sends. The standalone configuration test records an audit event; worker and member-targeted test flows also record their existing delivery history.

The HTTP request/response contract is maintained in [OpenAPI](04-api/openapi.yaml). Automated checks use synthetic users and mocked SMTP; an intentional operational test is separate from local validation.
