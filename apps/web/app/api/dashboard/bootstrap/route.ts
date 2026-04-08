import { SiteNoticeType } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getDashboardAccount } from "@/server/cu12-account";
import { getCyberCampusApprovalState } from "@/server/cyber-campus-autolearn";
import { combineDashboardSummaries, getDashboardSummaries } from "@/server/dashboard";
import { getSyncQueueSummaryForUser, getSyncQueueSummaryForUserByProvider } from "@/server/queue";
import { listSiteNotices } from "@/server/site-notice";

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function resolveMailPreference(userId: string) {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        cu12Account: {
          select: {
            emailDigestEnabled: true,
          },
        },
      },
    }),
    prisma.mailSubscription.findUnique({ where: { userId } }),
  ]);

  if (!user) {
    return null;
  }

  const accountDigestEnabled = user.cu12Account?.emailDigestEnabled ?? true;

  if (!subscription) {
    return {
      email: user.email,
      enabled: true,
      alertOnNotice: true,
      alertOnDeadline: true,
      alertOnAutolearn: true,
      digestEnabled: accountDigestEnabled,
      digestHour: 8,
      updatedAt: null,
    };
  }

  return {
    email: subscription.email,
    enabled: subscription.enabled,
    alertOnNotice: subscription.alertOnNotice,
    alertOnDeadline: subscription.alertOnDeadline,
    alertOnAutolearn: subscription.alertOnAutolearn,
    digestEnabled: subscription.digestEnabled && accountDigestEnabled,
    digestHour: subscription.digestHour,
    updatedAt: subscription.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  const context = await requireAuthContext(request);
  if (!context) return jsonError("Unauthorized", 401);

  const url = new URL(request.url);
  void parseLimit(url.searchParams.get("deadlinesLimit"), 20, 100);
  void parseLimit(url.searchParams.get("notificationsLimit"), 40, 200);
  void parseLimit(url.searchParams.get("messagesLimit"), 20, 100);
  void parseLimit(url.searchParams.get("jobsLimit"), 20, 100);
  const userId = context.effective.userId;
  const account = await timing.measure("account", () => getDashboardAccount(userId));

  const [providerSummaries, syncQueue, siteNotices, preference, cyberCampus, providerSyncQueues] = await Promise.all([
    timing.measure("summary", () => getDashboardSummaries(userId)),
    timing.measure("sync-queue", () => getSyncQueueSummaryForUser(userId)),
    timing.measure("site-notices", () => listSiteNotices(undefined, false)),
    timing.measure("mail-pref", () => resolveMailPreference(userId)),
    timing.measure("cyber-campus", () => getCyberCampusApprovalState(userId)),
    timing.measure("provider-sync-queue", async () => ({
      CU12: await getSyncQueueSummaryForUserByProvider(userId, "CU12"),
      CYBER_CAMPUS: await getSyncQueueSummaryForUserByProvider(userId, "CYBER_CAMPUS"),
    })),
  ]);
  const summary = combineDashboardSummaries(providerSummaries);

  if (!preference) {
    return jsonError("User not found", 404);
  }
  const maintenanceNotice = siteNotices.find((notice) => notice.type === SiteNoticeType.MAINTENANCE) ?? null;

  return applyServerTimingHeader(jsonOk(
    {
      context: {
        actor: context.actor,
        effective: context.effective,
        impersonating: context.impersonating,
      },
      summary,
      providerSummaries,
      syncQueue,
      providerSyncQueues,
      siteNotices,
      maintenanceNotice,
      account: account
        ? {
          provider: account.provider,
          cu12Id: account.cu12Id,
          campus: account.campus,
          accountStatus: account.accountStatus,
          statusReason: account.statusReason,
          autoLearnEnabled: account.autoLearnEnabled,
          quizAutoSolveEnabled: account.quizAutoSolveEnabled,
          lastLoginAt: account.user.lastLoginAt,
          lastLoginIp: account.user.lastLoginIp,
        }
        : null,
      cyberCampus,
      preference,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  ), timing);
}
