# Autolearn Runtime Audit

Date: 2026-09-08. Baseline: main 7e27112. Measurements are from pre-fix GitHub job logs, not a production load test.

## Findings

The player wait loop subtracted only requested sleep milliseconds. Each tick awaited cancellation/status queries and sometimes a progress callback, while their duration was excluded from the countdown. The player remained open during these calls. The outer and inner cancellation callbacks also queried the same job status twice.

The affected wait loops are identical in the CU12 and Cyber Campus implementations. They were unchanged between 49b9f27 and 7e27112; the recent sync batching change did not introduce this issue.

| Run | Completed tasks | Nominal reported playback time | Start-to-summary time | Total worker job time |
|---|---:|---:|---:|---:|
| [34177237976](https://github.com/OneTop4458/cu12/actions/runs/34177237976) | 2 | 50.0 min | 76.18 min | 79.15 min |
| [34084503202](https://github.com/OneTop4458/cu12/actions/runs/34084503202) | 2 | 50.0 min | 75.94 min | 77.17 min |
| [34098793205](https://github.com/OneTop4458/cu12/actions/runs/34098793205) | 2 | 50.0 min | 69.54 min | 71.15 min |

The nominal values above are unredacted runtime progress totals. They are not a claim about the original media file's duration or a change to its attendance requirements. Setup, portal navigation, post-playback snapshot collection, and persistence explain additional overhead outside the playback loop.

Twenty-five autolearn runs contained forty-three attempt-start markers. Five runs each logged four OpenAI 429 insufficient_quota failures. Their 1/5/15-minute queue retry sequence can add about 21 idle minutes per run without restoring access. Some other attempts failed during post-playback roster verification and retried; those are separate from the clock defect and do not alone prove repeat playback of an already completed lesson.

GitHub log masking prevents complete reconstruction of every task's numeric data. Live member totals and current OpenAI billing state were not queried: local production database credentials and Vercel CLI authentication were unavailable. The per-run timing defect is reproducible independently of member counts.

## Correction

- Use a shared monotonic deadline for both provider playback loops. Keep the configured required duration, time factor, player exit flow, and portal completion checks.
- Include status-query/callback time in elapsed player-open time and avoid the nested duplicate status read.
- Publish progress after crossing an interval boundary, including a final zero-remaining update.
- Stop AUTOLEARN retries for recognized OpenAI billing/quota failures. Keep temporary throttling, service failures, and ordinary portal recovery behavior.
- Do not change API credentials, billing limits, balances, or members' automation settings.

OpenAI distinguishes temporary rate limiting from billing/credit/spend errors and states that retrying the latter does not restore access: [official error guidance](https://developers.openai.com/api/docs/guides/error-codes).

## Validation and Expected Effect

The deterministic regression uses a one-second tick and 500 ms status latency. The original algorithm takes 90 simulated seconds for a 60-second requirement; the corrected algorithm takes 60. Slow progress callbacks, deadline-crossing queries, cancellation, and skipped exact heartbeat boundaries are covered.

For the representative 50-minute run, removing accumulated callback time should bring runtime closer to 50 minutes plus setup/navigation/snapshot overhead, approximately 52–55 minutes if those other costs stay similar. This is an estimate, not a post-release measurement. The earlier assumption that all autolearn runner time was unavoidable must not be used for further capacity estimates.

Before expanding admissions substantially, compare required playback and actual runtime on normal post-release jobs and separately verify quiz quota availability. The release PR records the required text/OpenAPI/Prisma/typecheck/test/build gate and production rollout.
