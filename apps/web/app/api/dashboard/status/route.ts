import { SiteNoticeType } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getDashboardAccount } from "@/server/cu12-account";
import { getCyberCampusApprovalState } from "@/server/cyber-campus-autolearn";
import { combineDashboardSummaries, getDashboardSummaries } from "@/server/dashboard";
import { getSyncQueueSummaryForUser, getSyncQueueSummaryForUserByProvider, listJobsForUser } from "@/server/queue";
import { listSiteNotices } from "@/server/site-notice";

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  const jobsLimit = parseLimit(url.searchParams.get("jobsLimit"), 10, 50);
  const userId = context.effective.userId;
  await timing.measure("account", () => getDashboardAccount(userId));

  const [providerSummaries, syncQueue, siteNotices, jobs, cyberCampus, providerSyncQueues] = await Promise.all([
    timing.measure("summary", () => getDashboardSummaries(userId)),
    timing.measure("sync-queue", () => getSyncQueueSummaryForUser(userId)),
    timing.measure("site-notices", () => listSiteNotices(undefined, false)),
    timing.measure("jobs", () => listJobsForUser(userId, jobsLimit)),
    timing.measure("cyber-campus", () => getCyberCampusApprovalState(userId)),
    timing.measure("provider-sync-queue", async () => ({
      CU12: await getSyncQueueSummaryForUserByProvider(userId, "CU12"),
      CYBER_CAMPUS: await getSyncQueueSummaryForUserByProvider(userId, "CYBER_CAMPUS"),
    })),
  ]);
  const summary = combineDashboardSummaries(providerSummaries);

  const maintenanceNotice = siteNotices.find((notice) => notice.type === SiteNoticeType.MAINTENANCE) ?? null;

  return applyServerTimingHeader(jsonOk({
    summary,
    providerSummaries,
    syncQueue,
    providerSyncQueues,
    siteNotices,
    maintenanceNotice,
    jobs,
    cyberCampus,
  }, {
    headers: {
      "cache-control": "no-store",
    },
  }), timing);
}
