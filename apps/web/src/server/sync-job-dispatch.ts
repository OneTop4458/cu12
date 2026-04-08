import type { PortalProvider } from "@cu12/core";
import { resolveSyncProviders } from "@cu12/core";
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
    const { job, deduplicated } = await enqueueJob({
      userId: input.userId,
      type: "SYNC",
      payload: {
        userId: input.userId,
        provider,
        reason: input.reason,
      },
      idempotencyKey: `sync:${input.userId}:${provider}:${input.reason}`,
      runAfter: input.runAfter,
    });

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
