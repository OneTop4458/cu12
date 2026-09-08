export function getSyncBatchPolicy(types: readonly string[], once: boolean) {
  if (!once || types.length === 0 || types.some((type) => type !== "SYNC" && type !== "NOTICE_SCAN")) return null;
  return { maxJobs: 10, maxClaimDurationMs: 10 * 60_000, idleGraceMs: 15_000 };
}

export function canClaimSyncBatchJob(policy: NonNullable<ReturnType<typeof getSyncBatchPolicy>>, processed: number, elapsedMs: number) {
  return processed < policy.maxJobs && elapsedMs < policy.maxClaimDurationMs;
}

export function resolveSyncBatchUserId(userId: string | undefined, processed: number, serverSupportsBatch: boolean) {
  return serverSupportsBatch && processed > 0 ? undefined : userId;
}
