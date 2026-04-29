# Auto-learning Engine Spec

## Scope

- This document describes the **CU12 execution path inside the worker**.
- Cyber Campus AUTOLEARN uses the same queue envelope but adds provider-session reuse and approval-session orchestration before the worker can proceed.
- For Cyber Campus runs, a stored portal session is only a reuse hint. If the saved session is missing, expired, or rejected by the upstream portal, the worker falls back to a fresh credential login before deciding that manual approval is required.
- Current supported CU12 task types are `VOD`, `MATERIAL`, and `QUIZ` when quiz auto-solve is enabled and OpenAI credentials are configured.
- Excluded task types include assignments, debates, surveys, attendance-only items, and unsupported quiz DOM contracts.

## Execution Steps

1. Authenticate to CU12 with the mapped encrypted credentials.
2. Resolve the target lecture set from the queued request.
3. Parse pending learning tasks from todo/course pages.
4. For VOD tasks, keep the player context alive for the required duration and exit through the normal page flow.
5. For material tasks, open `contents_material_view_form.acl` and verify the follow-up snapshot no longer reports the item as pending.
6. For quiz tasks, open the quiz runner, parse each question from the live DOM, generate an answer with OpenAI, and submit through the page's own JS/DOM flow.
7. If the run exceeds the chunk budget, enqueue a continuation AUTOLEARN job.
8. Refresh snapshots and record the `LearningRun` result.

## Runtime Controls

- `AUTOLEARN_TIME_FACTOR`
- `AUTOLEARN_CHUNK_TARGET_SECONDS`
- `AUTOLEARN_MAX_TASKS`
- `AUTOLEARN_CHAIN_MAX_SECONDS`
- `AUTOLEARN_PROGRESS_HEARTBEAT_SECONDS`
- `AUTOLEARN_STALL_TIMEOUT_SECONDS`
- `WORKER_ONCE_IDLE_GRACE_MS`
- `WORKER_RETRY_WAIT_MAX_MS`
- `PLAYWRIGHT_NAVIGATION_TIMEOUT_MS`
- `PLAYWRIGHT_NAVIGATION_RETRIES`
- `PLAYWRIGHT_NAVIGATION_RETRY_BASE_MS`
- `PLAYWRIGHT_ACCEPT_LANGUAGE`
- `PLAYWRIGHT_LOCALE`
- `PLAYWRIGHT_TIMEZONE`
- `PLAYWRIGHT_VIEWPORT_WIDTH` / `PLAYWRIGHT_VIEWPORT_HEIGHT`
- `AUTOLEARN_HUMANIZATION_ENABLED`
- `AUTOLEARN_DELAY_MIN_MS` / `AUTOLEARN_DELAY_MAX_MS`
- `AUTOLEARN_NAV_SETTLE_MIN_MS` / `AUTOLEARN_NAV_SETTLE_MAX_MS`
- `AUTOLEARN_TYPING_DELAY_MIN_MS` / `AUTOLEARN_TYPING_DELAY_MAX_MS`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_TIMEOUT_MS`

## Failure Handling

- Duplicate-play dialogs and unexpected prompts are handled explicitly where the current DOM contract allows.
- If the portal contract changes, the worker fails fast with clear error codes.
- If quiz auto-solve is disabled or OpenAI credentials are missing, quiz tasks are excluded and the run continues with the remaining supported tasks.
- Queue retry policy handles transient failures; terminal portal/contract errors surface as queue failure reasons.
- Playwright `page.goto` navigation failures are retried only for bounded transient timeout/network errors. Click-driven `waitForURL` flows are not retried here because repeated submissions can duplicate portal actions.
- Dashboard approval UX should treat `requestedAction=BOOTSTRAP|START|CONFIRM` as asynchronous worker-owned steps and keep polling until the session returns to a user-input state or completes.

## Output

- Updated snapshots and task state
- `LearningRun` rows with processed counts and error metadata
- Optional continuation queue rows for truncated AUTOLEARN chains
