# Auto-learning Engine Spec

## Scope

- Target: CU12 online learning flows for VOD, materials, and quizzes.
- Excluded: assignments, debates, surveys, attendance-only items, and unsupported quiz DOM contracts.

## Execution Steps

1. Authenticate to CU12 with mapped credentials.
2. Resolve target lecture(s) from request payload or active list.
3. Parse pending learning tasks from todo/course pages.
4. For VOD tasks, open the player page, keep playback context alive for the required duration, and exit with the CU12 player routine.
5. For material tasks, open `contents_material_view_form.acl` and verify the follow-up todo snapshot no longer lists that material as pending.
6. For quiz tasks, open the quiz runner, parse each question from the live DOM, generate an answer with OpenAI, and submit through the page’s own JS/DOM flow.
7. Retry quiz questions while CU12 reports attempts remain; stop with a clear failure when attempts are exhausted or the DOM contract is unsupported.
8. If run chunk is truncated, enqueue continuation AUTOLEARN job automatically.
9. Refresh snapshots and record learning run result.

## Runtime Controls

- `AUTOLEARN_TIME_FACTOR`: speed factor against nominal remaining time.
- `AUTOLEARN_CHUNK_TARGET_SECONDS`: per-run chunk target budget in seconds (default 5400).
- `AUTOLEARN_MAX_TASKS`: maximum tasks processed per run.
- `AUTOLEARN_CHAIN_MAX_SECONDS`: total continuation chain cap across chunks (default 43200).
- `PLAYWRIGHT_ACCEPT_LANGUAGE`: request-language header consistency.
- `AUTOLEARN_HUMANIZATION_ENABLED`: enables conservative human-like timing variation.
- `AUTOLEARN_DELAY_MIN_MS` / `AUTOLEARN_DELAY_MAX_MS`: per-step interaction delay range.
- `AUTOLEARN_NAV_SETTLE_MIN_MS` / `AUTOLEARN_NAV_SETTLE_MAX_MS`: post-navigation settle delay range.
- `AUTOLEARN_TYPING_DELAY_MIN_MS` / `AUTOLEARN_TYPING_DELAY_MAX_MS`: per-character typing delay range.
- `OPENAI_API_KEY`: required when quiz auto-solving is enabled.
- `OPENAI_MODEL`: OpenAI model name used for quiz answers (`gpt-5.4` default).
- `OPENAI_TIMEOUT_MS`: per-request OpenAI timeout.
- Safe default is conservative (close to real watch time).
- `worker --once` hands off pending AUTOLEARN jobs by requesting the next Actions dispatch.
- This module does not implement anti-bot bypass logic or fingerprint spoofing.

## Failure Handling

- Handle duplicate-play dialogs and unexpected modal prompts.
- If page contract changes, fail fast with clear error capture.
- If quiz answer generation is unavailable or OpenAI credentials are missing, fail the quiz task with a clear operator-facing error.
- Queue retry policy handles transient failures.

## Output

- Updated learning snapshots.
- `LearningRun` logs with status, processed counts, and error details.
