import type { PortalProvider } from "@cu12/core";
import { buildSyncIdempotencyKey, resolveSyncProviders } from "@cu12/core";
import { prisma } from "@/lib/prisma";
import { dispatchWorkerRun, type WorkerDispatchResult } from "@/server/github-actions-dispatch";
import { decideManualDispatch } from "@/server/manual-dispatch-policy";
import { enqueueJob } from "@/server/queue";

export interface SyncDispatchJobResult {
  provider: PortalProvider;
  jobId: string;
  status: "PENDING" | "RUNNING";
  deduplicated: boolean;
}

export interface QueueSyncJobsInput {
  userId: string;
  campus: string | null | undefined;
  requestedProviders?: Iterable<string | PortalProvider>;
  reason: string;
  runAfter?: Date;
}

export interface QueueSyncJobsResult {
  providers: PortalProvider[];
  results: SyncDispatchJobResult[];
  dispatch: WorkerDispatchResult;
}

function buildSkippedDuplicateDispatch(): WorkerDispatchResult {
  return {
    state: "SKIPPED_DUPLICATE",
    dispatched: false,
    errorCode: "MANUAL_DISPATCH_SKIPPED_DUPLICATE",
    error: "Manual sync request skipped due to duplicate in-flight jobs.",
  };
}

export function formatSyncTargets(providers: PortalProvider[]): string {
  if (providers.length === 0) return "no providers";
  return providers.map((provider) => (provider === "CYBER_CAMPUS" ? "Cyber Campus" : "CU12")).join(", ");
}

export function buildSyncDispatchNotice(input: QueueSyncJobsResult): string {
  if (input.providers.length === 0) {
    return "No sync target is available for this account.";
  }

  const targets = formatSyncTargets(input.providers);
  const allDeduplicated = input.results.length > 0 && input.results.every((result) => result.deduplicated);

  if (allDeduplicated) {
    return input.dispatch.state === "SKIPPED_DUPLICATE"
      ? `${targets} sync is already in progress.`
      : `${targets} sync was deduplicated and redispatch was requested.`;
  }

  return input.dispatch.dispatched
    ? `${targets} sync request was accepted.`
    : `${targets} sync request was accepted, but worker dispatch is delayed.`;
}

export async function queueSyncJobsForUser(input: QueueSyncJobsInput): Promise<QueueSyncJobsResult> {
  const providers = resolveSyncProviders(input.campus, input.requestedProviders);
  const results: SyncDispatchJobResult[] = [];
  let shouldDispatch = false;

  for (const provider of providers) {
    // Reuse active legacy keys as well while workers from the previous release drain.
    const existing = await prisma.jobQueue.findFirst({
      where: { userId: input.userId, type: "SYNC", status: { in: ["PENDING", "RUNNING"] },
        payload: { path: ["provider"], equals: provider } },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    });
    const queued = existing ? { job: existing, deduplicated: true } : await enqueueJob({
      userId: input.userId,
      type: "SYNC",
      payload: {
        userId: input.userId,
        provider,
        reason: input.reason,
      },
      idempotencyKey: buildSyncIdempotencyKey(input.userId, provider),
      runAfter: input.runAfter,
    });
    let { job } = queued;
    const { deduplicated } = queued;
    if (deduplicated && job.status === "PENDING") {
      // A user refresh takes precedence over a future scheduled retry and freshness skip.
      const runAfter = input.runAfter ?? new Date();
      if (job.runAfter > runAfter) shouldDispatch = true;
      await prisma.jobQueue.updateMany({
        where: { id: job.id, status: "PENDING" },
        data: {
          runAfter: job.runAfter > runAfter ? runAfter : job.runAfter,
          payload: { userId: input.userId, provider, reason: input.reason },
        },
      });
      job = { ...job, runAfter: job.runAfter > runAfter ? runAfter : job.runAfter };
    }

    results.push({
      provider,
      jobId: job.id,
      status: job.status === "RUNNING" ? "RUNNING" : "PENDING",
      deduplicated,
    });

    if (!deduplicated) {
      shouldDispatch = true;
      continue;
    }

    const decision = decideManualDispatch({
      status: job.status,
      createdAt: job.createdAt,
      runAfter: job.runAfter,
      startedAt: job.startedAt,
    });
    if (decision.shouldDispatch) {
      shouldDispatch = true;
    }
  }

  return {
    providers,
    results,
    dispatch: providers.length === 0
      ? {
        state: "SKIPPED_NO_PENDING",
        dispatched: false,
        errorCode: "SYNC_PROVIDER_UNAVAILABLE",
        error: "SYNC_PROVIDER_UNAVAILABLE",
      }
      : shouldDispatch
        ? await dispatchWorkerRun("sync", input.userId)
        : buildSkippedDuplicateDispatch(),
  };
}
