# Auto-learning Engine Spec

## Scope

- Target: CU12 online video learning flows.
- Excluded: automatic quiz/exam/assignment submission.

## Execution Steps

1. Authenticate to CU12 with mapped credentials.
2. Resolve target lecture(s) from request payload or active list.
3. Parse pending learning tasks from todo/course pages.
4. Open VOD page and keep playback context alive for required duration.
5. Trigger save/exit routine used by CU12 player flow.
6. If run chunk is truncated, enqueue continuation AUTOLEARN job automatically.
7. Refresh snapshots and record learning run result.

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
- Safe default is conservative (close to real watch time).
- `worker --once` hands off pending AUTOLEARN jobs by requesting the next Actions dispatch.
- This module does not implement anti-bot bypass logic or fingerprint spoofing.

## Failure Handling

- Handle duplicate-play dialogs and unexpected modal prompts.
- If page contract changes, fail fast with clear error capture.
- Queue retry policy handles transient failures.

## Output

- Updated learning snapshots.
- `LearningRun` logs with status, counts, and error details.
