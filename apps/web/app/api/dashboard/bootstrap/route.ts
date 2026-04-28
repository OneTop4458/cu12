import { SiteNoticeType } from "@prisma/client";
import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAuthContext } from "@/lib/http";
import {
  isMissingMailSubscriptionStoreError,
  warnMissingMailSubscriptionStore,
} from "@/lib/mail-subscription-compat";
import { prisma } from "@/lib/prisma";
import { applyServerTimingHeader, ServerTiming } from "@/lib/server-timing";
import { getDashboardAccount } from "@/server/cu12-account";
import { getCyberCampusApprovalState } from "@/server/cyber-campus-autolearn";
import { combineDashboardSummaries, getDashboardSummaries } from "@/server/dashboard";
import {
  EMPTY_CYBER_CAMPUS_APPROVAL_STATE,
  IDLE_SYNC_QUEUE_SUMMARY,
  loadOptionalDashboardSegment,
} from "@/server/dashboard-fallback";
import { getSyncQueueSummaryForUser, getSyncQueueSummaryForUserByProvider } from "@/server/queue";
import { listSiteNotices } from "@/server/site-notice";
import { getDashboardManualGuideState } from "@/server/user-guide";

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

async function resolveMailPreference(userId: string) {
  const userPromise = prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      cu12Account: {
        select: {
          emailDigestEnabled: true,
        },
      },
    },
  });
  const subscriptionPromise = prisma.mailSubscription.findUnique({ where: { userId } })
    .catch((error) => {
      if (!isMissingMailSubscriptionStoreError(error)) {
        throw error;
      }
      warnMissingMailSubscriptionStore();
      return null;
    });

  const [user, subscription] = await Promise.all([userPromise, subscriptionPromise]);

  if (!user) {
    return null;
  }

  if (!subscription) {
    return {
      email: user.email,
      enabled: true,
      alertOnNotice: false,
      alertOnDeadline: true,
      alertOnAutolearn: true,
      digestEnabled: false,
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
    digestEnabled: false,
    digestHour: subscription.digestHour,
    updatedAt: subscription.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const timing = new ServerTiming();
  try {
    const context = await requireAuthContext(request);
    if (!context) return jsonError("Unauthorized", 401);

    const url = new URL(request.url);
    void parseLimit(url.searchParams.get("deadlinesLimit"), 20, 100);
    void parseLimit(url.searchParams.get("notificationsLimit"), 40, 200);
    void parseLimit(url.searchParams.get("messagesLimit"), 20, 100);
    void parseLimit(url.searchParams.get("jobsLimit"), 20, 100);
    const userId = context.effective.userId;
    const account = await timing.measure("account", () => loadOptionalDashboardSegment(
      "dashboard/bootstrap",
      "account",
      () => getDashboardAccount(userId),
      null,
    ));

    const [providerSummaries, syncQueue, siteNotices, preference, cyberCampus, providerSyncQueues, dashboardManualGuide] = await Promise.all([
      timing.measure("summary", () => getDashboardSummaries(userId)),
      timing.measure("sync-queue", () => loadOptionalDashboardSegment(
        "dashboard/bootstrap",
        "sync-queue",
        () => getSyncQueueSummaryForUser(userId),
        IDLE_SYNC_QUEUE_SUMMARY,
      )),
      timing.measure("site-notices", () => loadOptionalDashboardSegment(
        "dashboard/bootstrap",
        "site-notices",
        () => listSiteNotices(undefined, false, "TOPBAR"),
        [],
      )),
      timing.measure("mail-pref", () => resolveMailPreference(userId)),
      timing.measure("cyber-campus", () => loadOptionalDashboardSegment(
        "dashboard/bootstrap",
        "cyber-campus",
        () => getCyberCampusApprovalState(userId),
        EMPTY_CYBER_CAMPUS_APPROVAL_STATE,
      )),
      timing.measure("provider-sync-queue", () => loadOptionalDashboardSegment(
        "dashboard/bootstrap",
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
      timing.measure("user-guide", () => getDashboardManualGuideState(userId)),
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
        userGuide: {
          dashboardManual: dashboardManualGuide,
        },
        preference,
      },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    ), timing);
  } catch (error) {
    console.error("[dashboard/bootstrap] failed", error);
    return jsonError("Dashboard bootstrap failed. Please refresh and try again.", 503, "DASHBOARD_BOOTSTRAP_FAILED");
  }
}
