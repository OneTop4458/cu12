import { SiteNoticeType } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getDashboardAccount } from "@/server/cu12-account";
import { getCyberCampusApprovalState } from "@/server/cyber-campus-autolearn";
import { getDashboardSummary } from "@/server/dashboard";
import { getSyncQueueSummaryForUser, listJobsForUser } from "@/server/queue";
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
  const account = await timing.measure("account", () => getDashboardAccount(userId));
  const provider = account?.provider ?? "CU12";

  const [summary, syncQueue, siteNotices, jobs, cyberCampus] = await Promise.all([
    timing.measure("summary", () => getDashboardSummary(userId, provider)),
    timing.measure("sync-queue", () => getSyncQueueSummaryForUser(userId)),
    timing.measure("site-notices", () => listSiteNotices(undefined, false)),
    timing.measure("jobs", () => listJobsForUser(userId, jobsLimit)),
    timing.measure("cyber-campus", () =>
      provider === "CYBER_CAMPUS"
        ? getCyberCampusApprovalState(userId)
        : Promise.resolve({
          session: {
            available: false,
            status: null,
            expiresAt: null,
            lastVerifiedAt: null,
          },
          approval: null,
        }),
    ),
  ]);

  const maintenanceNotice = siteNotices.find((notice) => notice.type === SiteNoticeType.MAINTENANCE) ?? null;

  return applyServerTimingHeader(jsonOk({
    summary,
    syncQueue,
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
