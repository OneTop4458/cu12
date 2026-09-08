# Free-Tier Optimization Plan

## Objective

Reduce redundant synchronization and startup work while preserving autolearn execution and notifications. Standard GitHub-hosted runner minutes in this public repository are free; measure concurrency, queue wait, provider latency, and storage separately.

## Key Changes

1. Scheduled sync scans at 00:07/12:07 UTC. Active accounts keep a 720-minute freshness interval; accounts without active provider courses, autolearn, activity detection, digest, or important mail use 1440 minutes. Near-deadline mail checks bypass reuse.
2. Scheduled sync requests worker dispatch only for newly created jobs or existing pending jobs; zero new jobs alone does not skip recovery of pending work.
3. `worker-consume` supports job-type filtering; routine digest dispatch is disabled.
4. CodeQL changed to weekly schedule only (manual runs remain available).
5. Dashboard bootstrap and independent course, deadline, and job requests start together; a count-only activity request preserves the topbar badge while details wait until the notification center opens, and session refresh waits for actual user activity.
6. Daily DB cleanup applies retention windows for logs, terminal jobs, mail deliveries, and withdrawn accounts, while still removing legacy bogus course notices; focused manual repair can clear notification events for one user.
7. Daily Actions usage forecast provides early warning.

## Free-Tier Guardrails

1. GitHub Actions capacity target: preserve worker headroom and measure job execution time separately from queue delay; do not apply a 2,000-minute budget to public standard runners.
2. Vercel request volume target: reduce periodic dashboard requests via bootstrap + adaptive polling.
3. Neon storage/query target: control known legacy cleanup drift and avoid unnecessary scheduled worker runs.
4. Dashboard hydration target: keep eight dynamic API requests; the mounted activity request must return only the attention count and never the 80-row detail payload.

## Monitoring Signals

1. `Actions Usage Forecast` workflow summary currently uses a legacy private-repository budget estimate. Replacing it with job-level capacity measurements is part of the next delivery.
2. Scheduled workflows:
   - Dispatch created count
   - Consume run count
3. DB cleanup summary:
   - Deleted retention rows and withdrawn users older than 6 months
   - Deleted legacy bogus notices
   - Deleted notification events in manual `user_repair` mode

## Immediate Mitigation If Usage Spikes

1. Compare SYNC count, runtime, freshness skips, and notification age by provider before changing the active/quiet policy. Preserve manual sync for urgent updates.
2. Disable non-critical scheduled workflows.
3. Reduce dashboard polling aggressiveness.
4. Trigger DB cleanup manually with the narrow mode needed for the incident.

## September 2026 Delivery

- Implemented, pending release validation: manual and scheduled full SYNC share a user/provider key. Legacy active jobs are reused during rollout; manual requests advance future jobs and disable scheduled freshness skips.
- Implemented, pending release validation: SYNC and post-AUTOLEARN snapshots share persistence and deadline notification processing before advancing ProviderSyncState. Failed/partial collections do not advance the checkpoint; authoritative empty rosters do.
- Provision the additive ProviderSyncState table with DB Bootstrap before promoting this release. Do not backfill historical jobs as they do not prove the new completion contract.
- The scheduler is best effort: a fresh checkpoint can skip a twice-daily scan. Exact elapsed time also depends on GitHub scheduling delays. Manual sync remains available.
- Validate provider isolation, empty/partial/failed snapshots, future-job acceleration, concurrent requests, and deadline-sensitive eligibility.
- Next: bounded short-sync batches, idle/handoff efficiency, and duplicate deployment/verification removal.
- Deferred pending measurements: 48–72 hour sync, increased worker concurrency, autolearn slot partitioning, or separate worker hosting.
- Compare a complete daily sync/autolearn cycle before claiming measured savings. A quiet cohort changing from two collections to one theoretically halves its scheduled collections, not total Actions usage.
