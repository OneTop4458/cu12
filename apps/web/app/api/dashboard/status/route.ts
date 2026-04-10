import { SiteNoticeType } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getDashboardAccount } from "@/server/cu12-account";
import { getCyberCampusApprovalState } from "@/server/cyber-campus-autolearn";
import { combineDashboardSummaries, getDashboardSummaries } from "@/server/dashboard";
import {
  EMPTY_CYBER_CAMPUS_APPROVAL_STATE,
  IDLE_SYNC_QUEUE_SUMMARY,
  loadOptionalDashboardSegment,
} from "@/server/dashboard-fallback";
import { getSyncQueueSummaryForUser, getSyncQueueSummaryForUserByProvider, listJobsForUser } from "@/server/queue";
import { listSiteNotices } from "@/server/site-notice";

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const url = new URL(request.url);
    const jobsLimit = parseLimit(url.searchParams.get("jobsLimit"), 10, 50);
    const userId = context.effective.userId;
    await timing.measure("account", () => loadOptionalDashboardSegment(
      "dashboard/status",
      "account",
      () => getDashboardAccount(userId),
      null,
    ));

    const [providerSummaries, syncQueue, siteNotices, jobs, cyberCampus, providerSyncQueues] = await Promise.all([
      timing.measure("summary", () => getDashboardSummaries(userId)),
      timing.measure("sync-queue", () => loadOptionalDashboardSegment(
        "dashboard/status",
        "sync-queue",
        () => getSyncQueueSummaryForUser(userId),
        IDLE_SYNC_QUEUE_SUMMARY,
      )),
      timing.measure("site-notices", () => loadOptionalDashboardSegment(
        "dashboard/status",
        "site-notices",
        () => listSiteNotices(undefined, false),
        [],
      )),
      timing.measure("jobs", () => loadOptionalDashboardSegment(
        "dashboard/status",
        "jobs",
        () => listJobsForUser(userId, jobsLimit),
        [],
      )),
      timing.measure("cyber-campus", () => loadOptionalDashboardSegment(
        "dashboard/status",
        "cyber-campus",
        () => getCyberCampusApprovalState(userId),
        EMPTY_CYBER_CAMPUS_APPROVAL_STATE,
      )),
      timing.measure("provider-sync-queue", () => loadOptionalDashboardSegment(
        "dashboard/status",
        "provider-sync-queue",
        async () => ({
          CU12: await getSyncQueueSummaryForUserByProvider(userId, "CU12"),
          CYBER_CAMPUS: await getSyncQueueSummaryForUserByProvider(userId, "CYBER_CAMPUS"),
        }),
        {
          CU12: IDLE_SYNC_QUEUE_SUMMARY,
          CYBER_CAMPUS: IDLE_SYNC_QUEUE_SUMMARY,
        },
      )),
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
  } catch (error) {
    console.error("[dashboard/status] failed", error);
    return jsonError("Dashboard status failed. Please refresh and try again.", 503, "DASHBOARD_STATUS_FAILED");
  }
}
