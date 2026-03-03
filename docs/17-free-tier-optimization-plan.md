# Free-Tier Optimization Plan

## Objective

Keep CU12 Automation within free-tier limits for GitHub Actions, Vercel, and Neon while preserving acceptable UX and worker reliability.

## Key Changes

1. Scheduled sync frequency changed from every 30 minutes to every 2 hours.
2. Scheduled workflows now skip consume stage when dispatch created zero jobs.
3. `worker-consume` now supports job-type filtering and skips Playwright install for digest-only execution.
4. CodeQL changed to weekly schedule only (manual runs remain available).
5. Dashboard initial load now uses aggregated bootstrap API and adaptive polling.
6. Daily retention cleanup removes old operational data.
7. Daily Actions usage forecast provides early warning.

## Free-Tier Guardrails

1. GitHub Actions monthly included minutes target: keep projected usage below 80%.
2. Vercel request volume target: reduce periodic dashboard requests via bootstrap + adaptive polling.
3. Neon storage/query target: control unbounded growth with retention cleanup.

## Monitoring Signals

1. `Actions Usage Forecast` workflow summary:
   - `< 80%`: normal
   - `80% ~ 95%`: attention
   - `>= 95%`: immediate mitigation
2. Scheduled workflows:
   - Dispatch created count
   - Consume run count
3. DB cleanup summary:
   - Deleted rows by table per run

## Immediate Mitigation If Usage Spikes

1. Temporarily increase sync interval (for example, 2h -> 3h/4h).
2. Disable non-critical scheduled workflows.
3. Reduce dashboard polling aggressiveness.
4. Trigger retention cleanup manually.
