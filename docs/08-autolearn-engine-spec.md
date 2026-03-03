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
6. Refresh snapshots and record learning run result.

## Runtime Controls

- `AUTOLEARN_TIME_FACTOR`: speed factor against nominal remaining time.
- `AUTOLEARN_MAX_TASKS`: maximum tasks processed per run.
- Safe default is conservative (close to real watch time).

## Failure Handling

- Handle duplicate-play dialogs and unexpected modal prompts.
- If page contract changes, fail fast with clear error capture.
- Queue retry policy handles transient failures.

## Output

- Updated learning snapshots.
- `LearningRun` logs with status, counts, and error details.