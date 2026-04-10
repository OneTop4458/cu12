import type { CyberCampusApprovalState } from "@/server/cyber-campus-autolearn";
import type { SyncQueueSummary } from "@/server/queue";

export const IDLE_SYNC_QUEUE_SUMMARY: SyncQueueSummary = {
  state: "IDLE",
  staleJobIds: [],
  runningCount: 0,
  runningStaleCount: 0,
  pendingCount: 0,
  pendingStaleCount: 0,
};

export const EMPTY_CYBER_CAMPUS_APPROVAL_STATE: CyberCampusApprovalState = {
  session: {
    available: false,
    status: null,
    expiresAt: null,
    lastVerifiedAt: null,
  },
  approval: null,
};

export async function loadOptionalDashboardSegment<T>(
  scope: string,
  label: string,
  loader: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    console.error(`[${scope}] ${label} failed`, error);
    return fallback;
  }
}
