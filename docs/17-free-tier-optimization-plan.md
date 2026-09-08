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
7. Weekly Actions capacity reporting measures actual job runtime and initial wait in an explicitly bounded recent-run sample.

## Free-Tier Guardrails

1. GitHub Actions capacity target: preserve worker headroom and measure job execution time separately from queue delay; do not apply a 2,000-minute budget to public standard runners.
2. Vercel request volume target: reduce periodic dashboard requests via bootstrap + adaptive polling.
3. Neon storage/query target: control known legacy cleanup drift and avoid unnecessary scheduled worker runs.
4. Dashboard hydration target: keep eight dynamic API requests; the mounted activity request must return only the attention count and never the 80-row detail payload.

## Monitoring Signals

1. `Actions Usage Forecast` separates completed job minutes, provisional in-progress minutes, and initial workflow wait. It samples the latest 200 runs from a seven-day listing capped at 1,000 and includes PRs and available attempts. It never labels this sample as total billed usage.
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

- Released in PR #239: manual and scheduled full SYNC share a user/provider key. Legacy active jobs are reused during rollout; manual requests advance future jobs and disable scheduled freshness skips.
- Released in PR #239: SYNC and post-AUTOLEARN snapshots share persistence and deadline notification processing before advancing ProviderSyncState. Failed/partial collections do not advance the checkpoint; authoritative empty rosters do.
- Provision the additive ProviderSyncState table with DB Bootstrap before promoting this release. Do not backfill historical jobs as they do not prove the new completion contract.
- The scheduler is best effort: a fresh checkpoint can skip a twice-daily scan. Up to fifteen minutes of due-boundary slack prevents short completion delays from systematically skipping the next scheduled pass. Larger GitHub delays can still affect elapsed time. Manual sync remains available.
- Validate provider isolation, empty/partial/failed snapshots, future-job acceleration, concurrent requests, and deadline-sensitive eligibility.
- Implemented in this release: bounded sync batches, fifteen-second idle exits, post-run handoff, and transactional per-user sync claim locking.
- Implemented in this release: exact-commit deployment deduplication, serialized DB operations, DB change gating, main CI duplication removal, and native-main Vercel deployment exclusion.
- Implemented in this release: weekly bounded job-level capacity reporting without a misleading public-repository minute budget.
- Local acceptance: 334 web/worker/ops tests, text/OpenAPI checks, Prisma generation, typecheck, lint, web build, and actionlint passed. The release PR records production rollout evidence.
- Future queue reservation or slot-allocation changes require separate load measurements; active-run counting now covers all nonterminal states and pages, while the existing dispatch ceiling remains a best-effort admission check.
- Deferred pending measurements: 48–72 hour sync, increased worker concurrency, autolearn slot partitioning, or separate worker hosting.
- Compare a complete daily sync/autolearn cycle before claiming measured savings. A quiet cohort changing from two collections to one theoretically halves its scheduled collections, not total Actions usage.
- The [autolearn runtime audit](22-autolearn-runtime-audit.md) found that cancellation-query latency was being added to every nominal playback second. Capacity estimates must separate required playback from that removable overhead and from quota-related retry waits.
- Bot auto-merges require a successful-check completion publisher because GITHUB_TOKEN may suppress both push and PR-closed events. The publisher runs only trusted main code, respects existing auto-merge authorization and branch checks, and uses the existing deployment deduplication guard.
