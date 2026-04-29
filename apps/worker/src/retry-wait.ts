export interface RetryJobSummary {
  id: string;
  type: string;
  userId: string;
  runAfter: string | null;
}

export type RetryWaitDecisionReason =
  | "not_queued"
  | "missing_retry_job"
  | "invalid_run_after"
  | "due_now"
  | "due_soon"
  | "outside_wait_cap";

export interface RetryWaitDecision {
  shouldWait: boolean;
  waitMs: number;
  runAfterMs: number | null;
  reason: RetryWaitDecisionReason;
}

export function decideRetryWait(input: {
  retryQueued: boolean;
  retryJob: RetryJobSummary | null | undefined;
  maxWaitMs: number;
  nowMs?: number;
}): RetryWaitDecision {
  if (!input.retryQueued) {
    return { shouldWait: false, waitMs: 0, runAfterMs: null, reason: "not_queued" };
  }

  if (!input.retryJob?.runAfter) {
    return { shouldWait: false, waitMs: 0, runAfterMs: null, reason: "missing_retry_job" };
  }

  const runAfterMs = Date.parse(input.retryJob.runAfter);
  if (!Number.isFinite(runAfterMs)) {
    return { shouldWait: false, waitMs: 0, runAfterMs: null, reason: "invalid_run_after" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const waitMs = Math.max(0, runAfterMs - nowMs);
  if (waitMs === 0) {
    return { shouldWait: true, waitMs: 0, runAfterMs, reason: "due_now" };
  }

  if (waitMs <= input.maxWaitMs) {
    return { shouldWait: true, waitMs, runAfterMs, reason: "due_soon" };
  }

  return { shouldWait: false, waitMs, runAfterMs, reason: "outside_wait_cap" };
}
