import { JobStatus } from "@prisma/client";
import type { WorkerDispatchResult } from "@/server/github-actions-dispatch";
import { dispatchWorkerRun, type WorkerDispatchType } from "@/server/github-actions-dispatch";

export const MANUAL_PENDING_REDISPATCH_MS = 5 * 60 * 1000;
export const MANUAL_RUNNING_REDISPATCH_MS = 10 * 60 * 1000;

export type ManualDispatchReason = "new_request" | "fresh_duplicate" | "pending_stale" | "running_stale";

export interface ManualDispatchDecision {
  shouldDispatch: boolean;
  reason: ManualDispatchReason;
}

export interface ManualDispatchInput {
  status: JobStatus;
  createdAt: Date;
  startedAt: Date | null;
}

export interface ManualDispatchRuntimeInput extends ManualDispatchInput {
  deduplicated: boolean;
}

export interface ManualDispatchResult {
  decision: ManualDispatchDecision;
  dispatch: WorkerDispatchResult;
}

export function decideManualDispatch(input: ManualDispatchInput, now = new Date()): ManualDispatchDecision {
  if (input.status === JobStatus.PENDING) {
    const ageMs = now.getTime() - input.createdAt.getTime();
    if (ageMs >= MANUAL_PENDING_REDISPATCH_MS) {
      return { shouldDispatch: true, reason: "pending_stale" };
    }
    return { shouldDispatch: false, reason: "fresh_duplicate" };
  }

  if (input.status === JobStatus.RUNNING && input.startedAt) {
    const runningMs = now.getTime() - input.startedAt.getTime();
    if (runningMs >= MANUAL_RUNNING_REDISPATCH_MS) {
      return { shouldDispatch: true, reason: "running_stale" };
    }
  }

  return { shouldDispatch: false, reason: "fresh_duplicate" };
}

export async function dispatchManualJob(
  userId: string,
  type: WorkerDispatchType,
  input: ManualDispatchRuntimeInput,
): Promise<ManualDispatchResult> {
  const decision = input.deduplicated
    ? decideManualDispatch({
      status: input.status,
      createdAt: input.createdAt,
      startedAt: input.startedAt,
    })
    : { shouldDispatch: true, reason: "new_request" as const };

  if (!decision.shouldDispatch) {
    return {
      decision,
      dispatch: {
        state: "SKIPPED_DUPLICATE",
        dispatched: false,
        errorCode: "MANUAL_DISPATCH_SKIPPED_DUPLICATE",
        error: `Manual ${type} request skipped due to duplicate in-flight job.`,
      },
    };
  }

  return {
    decision,
    dispatch: await dispatchWorkerRun(type, userId),
  };
}
